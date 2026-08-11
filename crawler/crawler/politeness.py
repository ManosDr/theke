"""Shared HTTP politeness layer for the crawler: per-host rate limiting,
robots.txt Crawl-delay respect, and ban/block detection that is reported
distinctly from an ordinary fetch failure.

Built after a manual citation-URL audit issued 9 sequential unthrottled
requests to e-nomothesia.gr and got the requesting IP permanently banned by
the site's Elxis CMS security module (see KNOWN_DECISIONS.md, 2026-08-08 -
"Pre-launch citation-URL audit"). crawler.main's monthly run has the same
shape - many sequential requests, and fek_api.discover_recent() alone makes
up to 35 sequential POSTs to one host with zero delay - so it carries the
same risk against production's IP. Every raw `requests.get`/`requests.post`
call in this package should go through DEFAULT_FETCHER instead.
"""

import time
import urllib.robotparser
from urllib.parse import urlparse

import requests

CONTACT_EMAIL = "manos.drams@gmail.com"
# Distinct from the ad-hoc per-module UA strings this package used to carry
# (all now consolidated here) - names the crawler, states its purpose, and
# gives a real contact so a site operator who notices the traffic has a way
# to reach us instead of just banning silently, which is what happened.
USER_AGENT = f"thekebot/0.1 (regulatory compliance research crawler for theke.ai; contact: {CONTACT_EMAIL})"

# Conservative floor even when a host's robots.txt specifies no Crawl-delay
# at all. robots.txt Crawl-delay, when present, wins if it's larger.
DEFAULT_MIN_DELAY_SECONDS = 2.5
REQUEST_TIMEOUT = 30
ROBOTS_TIMEOUT = 10

# Phrases seen on real block/ban pages. e-nomothesia.gr's Elxis CMS security
# module returns exactly "Request dropped! You have been banned!" - the
# others are common enough across other CMS/WAF block pages that treating
# them the same way (loud, distinct report) is worth the small false-positive
# risk; missing a real ban silently is the worse failure mode.
_BLOCK_PAGE_SIGNATURES = (
    "you have been banned",
    "request dropped",
    "security alert",
    "access denied",
    "ip has been blocked",
    "your ip has been blocked",
    "blocked by",
)


class CrawlBlocked(Exception):
    """The host appears to have blocked/banned the crawler: HTTP 403, HTTP
    429, or a 2xx response whose body matches a known block-page signature.
    Distinct from an ordinary RequestException so callers can surface a ban
    loudly (its own summary section, its own notification) instead of
    folding it into a generic "N sources failed" count, which is exactly how
    the e-nomothesia.gr ban went unnoticed until an unrelated audit."""

    def __init__(self, host: str, url: str, status_code: int | None, reason: str):
        self.host = host
        self.url = url
        self.status_code = status_code
        self.reason = reason
        super().__init__(f"Blocked by {host}: {reason} (status={status_code}, url={url})")


class RobotsDisallowed(Exception):
    """robots.txt explicitly disallows fetching this URL for our user agent.
    Distinct from CrawlBlocked (a host telling us not to, in advance, via
    the standard mechanism, vs. a host actively rejecting/banning us) and
    from an ordinary failure (this is expected, polite behavior, not an
    error)."""

    def __init__(self, host: str, url: str):
        self.host = host
        self.url = url
        super().__init__(f"robots.txt disallows fetching {url} for {USER_AGENT!r}")


class PoliteFetcher:
    """One instance per crawl run (see DEFAULT_FETCHER below - every module
    in this package shares it). Tracks per-host last-request-time and cached
    robots.txt so repeated calls across many URLs on the same host (many PDFs
    linked off one ΥΠΕΝ listing page, 35 sequential ΦΕΚ search-API calls,
    etc.) stay spaced out automatically - callers never sleep themselves."""

    def __init__(self, min_delay: float = DEFAULT_MIN_DELAY_SECONDS, user_agent: str = USER_AGENT):
        self.min_delay = min_delay
        self.user_agent = user_agent
        self._last_request_at: dict[str, float] = {}
        self._robots_cache: dict[str, urllib.robotparser.RobotFileParser | None] = {}

    def _robots_for(self, host: str, scheme: str) -> urllib.robotparser.RobotFileParser | None:
        if host in self._robots_cache:
            return self._robots_cache[host]
        rfp = urllib.robotparser.RobotFileParser()
        try:
            resp = requests.get(
                f"{scheme}://{host}/robots.txt", timeout=ROBOTS_TIMEOUT, headers={"User-Agent": self.user_agent}
            )
            # A 4xx/5xx robots.txt is treated as "no restrictions stated" -
            # the conventional crawler default, and what every host in this
            # package already effectively assumed before this module existed.
            if resp.status_code >= 400:
                self._robots_cache[host] = None
                return None
            rfp.parse(resp.text.splitlines())
        except requests.RequestException:
            self._robots_cache[host] = None
            return None
        self._robots_cache[host] = rfp
        return rfp

    def can_fetch(self, url: str) -> bool:
        parsed = urlparse(url)
        rfp = self._robots_for(parsed.netloc, parsed.scheme)
        if rfp is None:
            return True
        try:
            return rfp.can_fetch(self.user_agent, url)
        except Exception:
            return True

    def _delay_for(self, host: str) -> float:
        rfp = self._robots_cache.get(host)
        crawl_delay = None
        if rfp is not None:
            try:
                cd = rfp.crawl_delay(self.user_agent)
                if cd is not None:
                    crawl_delay = float(cd)
            except Exception:
                crawl_delay = None
        return max(self.min_delay, crawl_delay or 0.0)

    def _wait(self, host: str) -> float:
        """Sleeps if needed so this request respects the host's delay since
        the last request. Returns the number of seconds actually slept (0 if
        none was needed), so a caller/test can verify the delay was really
        applied rather than just trusting the code path exists."""
        delay = self._delay_for(host)
        last = self._last_request_at.get(host)
        if last is not None:
            remaining = delay - (time.monotonic() - last)
            if remaining > 0:
                time.sleep(remaining)
                return remaining
        return 0.0

    def _check_block(self, resp: requests.Response, host: str, url: str) -> None:
        if resp.status_code == 403:
            raise CrawlBlocked(host, url, resp.status_code, "HTTP 403 Forbidden")
        if resp.status_code == 429:
            raise CrawlBlocked(host, url, resp.status_code, "HTTP 429 Too Many Requests")
        if resp.status_code < 400:
            content_type = resp.headers.get("content-type", "")
            if "html" in content_type or "text" in content_type:
                snippet = (resp.text or "")[:2000].lower()
                for sig in _BLOCK_PAGE_SIGNATURES:
                    if sig in snippet:
                        raise CrawlBlocked(host, url, resp.status_code, f"block-page signature matched: {sig!r}")

    def get(self, url: str, **kwargs) -> requests.Response:
        return self._request("GET", url, **kwargs)

    def post(self, url: str, **kwargs) -> requests.Response:
        return self._request("POST", url, **kwargs)

    def _request(self, method: str, url: str, **kwargs) -> requests.Response:
        parsed = urlparse(url)
        host = parsed.netloc
        self._robots_for(host, parsed.scheme)  # populate cache (and any Crawl-delay) before computing the wait
        if not self.can_fetch(url):
            raise RobotsDisallowed(host, url)

        self._wait(host)
        kwargs.setdefault("timeout", REQUEST_TIMEOUT)
        headers = kwargs.pop("headers", {}) or {}
        headers.setdefault("User-Agent", self.user_agent)
        try:
            resp = requests.request(method, url, headers=headers, **kwargs)
        finally:
            # Recorded even on exception (timeout/connection error) - a
            # host that just timed out still deserves the same delay before
            # the next attempt, not a free pass to be hit again immediately.
            self._last_request_at[host] = time.monotonic()
        self._check_block(resp, host, url)
        return resp


# Shared across every module in this package - see the module docstring.
# A single instance is what makes the per-host delay actually work across
# module boundaries (discovery.py finding links, then ingest.py downloading
# them, can both be on the same host within one crawl run).
DEFAULT_FETCHER = PoliteFetcher()
