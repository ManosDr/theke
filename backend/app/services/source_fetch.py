"""Fetches and extracts plain text from a source URL, for the two features
that need to compare a live source against something already stored: the
data-source content-hash sync (app/routers/admin.py's sync_data_source) and
the AI revalidation copilot (app/routers/admin.py's revalidate_document).

Mirrors crawler/crawler/ingest.py's extract_article_text()/content_hash()
approach (prefer <article>, fall back to <main>) rather than importing that
module directly - the crawler is a separate deployable service with its own
container/dependencies (see docker-compose.yml), not something the backend
can import at runtime.

Every fetch goes through app/services/politeness.py's PoliteFetcher (per-host
delay, robots.txt respect, ban detection) - both callers used to issue plain
unthrottled httpx requests, which is exactly the pattern that got the
crawler package's IP banned before its own politeness layer existed (see
KNOWN_DECISIONS.md).
"""

import hashlib

import httpx
from bs4 import BeautifulSoup

from app.services.politeness import DEFAULT_FETCHER, CrawlBlocked, RobotsDisallowed

USER_AGENT = DEFAULT_FETCHER.user_agent
_FETCH_TIMEOUT = 30.0


def _extract_html_text(html: str) -> str | None:
    soup = BeautifulSoup(html, "html.parser")

    article = soup.find("article")
    if article:
        text = article.get_text(separator="\n", strip=True)
        if text:
            return text

    main = soup.find("main")
    if main:
        text = main.get_text(separator="\n", strip=True)
        if text:
            return text

    # Broader fallback than the crawler's article-only approach: many
    # government pages (e-nomothesia.gr, aade.gr) don't use semantic
    # HTML5 <article>/<main> tags at all. Strips non-content elements
    # before taking the body's text so navigation/scripts don't dilute it.
    body = soup.find("body")
    if not body:
        return None
    for tag in body.find_all(["script", "style", "nav", "header", "footer"]):
        tag.decompose()
    text = body.get_text(separator="\n", strip=True)
    return text or None


async def fetch_raw(url: str) -> httpx.Response:
    """Fetches `url` through the shared PoliteFetcher and raises on any
    failure: httpx.HTTPError (unreachable/non-2xx), CrawlBlocked (banned/
    rate-limited), or RobotsDisallowed (robots.txt says no). Callers that
    need to distinguish these (e.g. sync_data_source reporting a ban
    distinctly) should call this directly; fetch_url_content below collapses
    all three to None for callers that don't."""
    resp = await DEFAULT_FETCHER.get(url, timeout=_FETCH_TIMEOUT)
    resp.raise_for_status()
    return resp


def extract_content(resp: httpx.Response, url: str) -> str | None:
    """Extracts plain text from an already-fetched response - PDF-aware,
    HTML-aware, None if there's nothing extractable."""
    content_type = resp.headers.get("content-type", "")
    if "pdf" in content_type or url.lower().endswith(".pdf"):
        try:
            import fitz  # PyMuPDF - already a backend dependency

            with fitz.open(stream=resp.content, filetype="pdf") as doc:
                text = "\n".join(page.get_text() for page in doc)
        except Exception:
            return None
        return text.strip() or None

    return _extract_html_text(resp.text)


async def fetch_url_content(url: str) -> str | None:
    """Fetches `url` and returns its extracted plain text, or None if the
    URL is unreachable, returns an error status, has no extractable content,
    or was blocked/disallowed. Never raises - every failure mode collapses to
    None so callers can treat "no content" uniformly regardless of cause.
    Use fetch_raw()/extract_content() directly if the cause needs to be
    distinguished (e.g. a ban reported distinctly from an ordinary failure)."""
    try:
        resp = await fetch_raw(url)
    except (httpx.HTTPError, CrawlBlocked, RobotsDisallowed):
        return None
    return extract_content(resp, url)


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
