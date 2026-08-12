"""Async port of crawler/crawler/politeness.py's per-host rate limiting,
robots.txt Crawl-delay respect, and ban/block detection - mirrored rather
than imported because the crawler package lives in a separate Docker
service/container (see docker-compose.yml) the backend cannot reach at
runtime, the same rationale already used for source_fetch.py's HTML
extraction and region_contact_discovery.py's scrape logic. If the
politeness rules themselves are ever tuned, check the other copy too -
see KNOWN_DECISIONS.md for the wider assessment of this duplication.

Built because POST /admin/data-sources/{id}/sync had no throttling of its
own - a wholly separate HTTP call path from the crawler package's now-
protected one, and the exact kind of unthrottled sequential-request
pattern that got the crawler's IP banned by e-nomothesia.gr's Elxis CMS
(see KNOWN_DECISIONS.md, "Crawler politeness controls").
"""

import asyncio
import time
import urllib.robotparser
from urllib.parse import urlparse

import httpx

CONTACT_EMAIL = "manos.drams@gmail.com"
USER_AGENT = f"thekebot/0.1 (regulatory compliance research crawler for theke.ai; contact: {CONTACT_EMAIL})"

DEFAULT_MIN_DELAY_SECONDS = 2.5
REQUEST_TIMEOUT = 30.0
ROBOTS_TIMEOUT = 10.0

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
    """The host appears to have blocked/banned us: HTTP 403, HTTP 429, or a
    2xx response whose body matches a known block-page signature. Distinct
    from an ordinary httpx error so callers can surface a ban loudly instead
    of folding it into a generic "sync failed" outcome."""

    def __init__(self, host: str, url: str, status_code: int | None, reason: str):
        self.host = host
        self.url = url
        self.status_code = status_code
        self.reason = reason
        super().__init__(f"Blocked by {host}: {reason} (status={status_code}, url={url})")


class RobotsDisallowed(Exception):
    """robots.txt explicitly disallows fetching this URL for our user agent -
    expected, polite behavior, not an error."""

    def __init__(self, host: str, url: str):
        self.host = host
        self.url = url
        super().__init__(f"robots.txt disallows fetching {url} for {USER_AGENT!r}")


class PoliteFetcher:
    """One shared instance for the whole backend process (see DEFAULT_FETCHER
    below). Tracks per-host last-request-time and cached robots.txt so
    repeated admin-triggered syncs against the same host stay spaced out."""

    def __init__(self, min_delay: float = DEFAULT_MIN_DELAY_SECONDS, user_agent: str = USER_AGENT):
        self.min_delay = min_delay
        self.user_agent = user_agent
        self._last_request_at: dict[str, float] = {}
        self._robots_cache: dict[str, urllib.robotparser.RobotFileParser | None] = {}

    async def _robots_for(self, host: str, scheme: str) -> urllib.robotparser.RobotFileParser | None:
        if host in self._robots_cache:
            return self._robots_cache[host]
        rfp = urllib.robotparser.RobotFileParser()
        try:
            async with httpx.AsyncClient(timeout=ROBOTS_TIMEOUT) as client:
                resp = await client.get(f"{scheme}://{host}/robots.txt", headers={"User-Agent": self.user_agent})
            # A 4xx/5xx robots.txt is treated as "no restrictions stated" -
            # the conventional crawler default.
            if resp.status_code >= 400:
                self._robots_cache[host] = None
                return None
            rfp.parse(resp.text.splitlines())
        except httpx.HTTPError:
            self._robots_cache[host] = None
            return None
        self._robots_cache[host] = rfp
        return rfp

    def can_fetch(self, url: str) -> bool:
        parsed = urlparse(url)
        rfp = self._robots_cache.get(parsed.netloc)
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

    async def _wait(self, host: str) -> float:
        """Sleeps if needed so this request respects the host's delay since
        the last request. Returns the number of seconds actually slept (0 if
        none was needed), so a caller/test can verify the delay was really
        applied rather than just trusting the code path exists."""
        delay = self._delay_for(host)
        last = self._last_request_at.get(host)
        if last is not None:
            remaining = delay - (time.monotonic() - last)
            if remaining > 0:
                await asyncio.sleep(remaining)
                return remaining
        return 0.0

    def _check_block(self, resp: httpx.Response, host: str, url: str) -> None:
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

    async def get(self, url: str, **kwargs) -> httpx.Response:
        parsed = urlparse(url)
        host = parsed.netloc
        await self._robots_for(host, parsed.scheme)  # populate cache (and any Crawl-delay) before computing the wait
        if not self.can_fetch(url):
            raise RobotsDisallowed(host, url)

        await self._wait(host)
        kwargs.setdefault("timeout", REQUEST_TIMEOUT)
        headers = kwargs.pop("headers", {}) or {}
        headers.setdefault("User-Agent", self.user_agent)
        follow_redirects = kwargs.pop("follow_redirects", True)
        try:
            async with httpx.AsyncClient(follow_redirects=follow_redirects) as client:
                resp = await client.get(url, headers=headers, **kwargs)
        finally:
            # Recorded even on exception (timeout/connection error) - a host
            # that just timed out still deserves the same delay before the
            # next attempt, not a free pass to be hit again immediately.
            self._last_request_at[host] = time.monotonic()
        self._check_block(resp, host, url)
        return resp


# Shared across every caller in the backend process - a single instance is
# what makes the per-host delay actually work across requests separated in
# time (two admin-triggered syncs of sources on the same host, minutes
# apart, still respect the delay against each other).
DEFAULT_FETCHER = PoliteFetcher()
