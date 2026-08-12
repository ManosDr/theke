"""Pure, I/O-free logic shared between crawler/crawler/politeness.py and
backend/app/services/politeness.py: the identifying constants and the
block/ban exception types used by both services' PoliteFetcher.

The PoliteFetcher classes themselves stay separately implemented on each
side, on purpose - the crawler is a cron-triggered batch script where a
blocking time.sleep is fine, the backend is a live FastAPI server sharing
one event loop, where a blocking sleep inside a request handler would stall
every other concurrent request. Unifying that part would force one side to
adopt the other's concurrency model, which is a worse outcome than the
small amount of duplication it would remove. See KNOWN_DECISIONS.md.
"""

CONTACT_EMAIL = "manos.drams@gmail.com"
USER_AGENT = f"thekebot/0.1 (regulatory compliance research crawler for theke.ai; contact: {CONTACT_EMAIL})"

# Conservative floor even when a host's robots.txt specifies no Crawl-delay
# at all. robots.txt Crawl-delay, when present, wins if it's larger.
DEFAULT_MIN_DELAY_SECONDS = 2.5

# Phrases seen on real block/ban pages. e-nomothesia.gr's Elxis CMS security
# module returns exactly "Request dropped! You have been banned!" - the
# others are common enough across other CMS/WAF block pages that treating
# them the same way (loud, distinct report) is worth the small false-positive
# risk; missing a real ban silently is the worse failure mode.
BLOCK_PAGE_SIGNATURES = (
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
    from an ordinary fetch error so callers can surface a ban loudly instead
    of folding it into a generic "failed" outcome."""

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
