"""Fetches and extracts plain text from a source URL, for the two features
that need to compare a live source against something already stored: the
data-source content-hash sync (app/routers/admin.py's sync_data_source) and
the AI revalidation copilot (app/routers/admin.py's revalidate_document).

Mirrors crawler/crawler/ingest.py's extract_article_text()/content_hash()
approach (prefer <article>, fall back to <main>) rather than importing that
module directly - the crawler is a separate deployable service with its own
container/dependencies (see docker-compose.yml), not something the backend
can import at runtime.
"""

import hashlib

import httpx
from bs4 import BeautifulSoup

USER_AGENT = "thekebot/0.1 (regulatory compliance assistant; contact: manos.drams@gmail.com)"
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


async def fetch_url_content(url: str) -> str | None:
    """Fetches `url` and returns its extracted plain text, or None if the
    URL is unreachable, returns an error status, or has no extractable
    content. Never raises - every failure mode collapses to None so callers
    can treat "no content" uniformly regardless of cause."""
    try:
        async with httpx.AsyncClient(timeout=_FETCH_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": USER_AGENT})
            resp.raise_for_status()
    except httpx.HTTPError:
        return None

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


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
