"""Download -> extract -> store pipeline, plus a reference-only path for
sources whose robots.txt disallows fetching the documents themselves
(e.g. ypen.gov.gr disallows */*.pdf$ - see crawler/sources.py).

Chunking + embeddings (Phase 1, Week 3) are deliberately left out here: this
module's job is just getting text into `documents`, which is enough to
prove the crawl -> DB path end to end. Once OPENAI_API_KEY is wired up, a
separate step will chunk `documents.content` and populate `embeddings`.
"""

import hashlib
import re
from dataclasses import dataclass
from datetime import date as date_cls

import fitz  # PyMuPDF
import psycopg
import requests
from bs4 import BeautifulSoup

USER_AGENT = "thekebot/0.1 (construction compliance assistant; contact: manos.drams@gmail.com)"

# Rich anchor text, as used by ΤΕΕ's e-adeies listing, e.g.
# "ΥΑ (ΦΕΚ B' 6548/31.12.2021) - ..." or "Ν 4964 (ΦΕΚ A' 150/30.07.2022) - ...".
# Most reliable pattern since it's human-written prose, not a filename slug.
_FEK_CITATION_RE = re.compile(
    r"[ΦF][ΕE][ΚK]\s*([ΑΒΓΔΕABCDE])['΄’`]?\s*(\d+)\s*/\s*(\d{1,2}\.\d{1,2}\.\d{4}|\d{4})"
)
# Filename convention 'ΦΕΚ-1234-Β_dd.mm.yyyy' (number before series) - seen on ΥΠΕΝ.
_FEK_FILENAME_NUM_FIRST_RE = re.compile(
    r"[ΦF][ΕE][ΚK][-_\s]*(\d+)[-_\s]*([ΑΒΓΔΕABCDE])[-_\s]*(\d{1,2}[.\-]\d{1,2}[.\-]\d{4})?"
)
# Filename convention 'FEK-B-3136' (series before number) - seen on ΤΕΕ.
_FEK_FILENAME_SERIES_FIRST_RE = re.compile(r"[ΦF][ΕE][ΚK][-_\s]*([ΑΒΓΔΕABCDE])[-_\s]*(\d+)")
_DATE_RE = re.compile(r"(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})")
# Filename convention '2664_1998_1e0600c9fe.pdf' (law/decree number _ year _ hash) - seen on ktimatologio.gr.
_LAW_NUMBER_YEAR_RE = re.compile(r"/(\d{1,5})_(\d{4})_[0-9a-f]{6,}\.pdf", re.IGNORECASE)


def download(url: str) -> bytes:
    resp = requests.get(url, timeout=30, headers={"User-Agent": USER_AGENT})
    resp.raise_for_status()
    return resp.content


def extract_text(pdf_bytes: bytes) -> str:
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        return "\n".join(page.get_text() for page in doc)


def content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _parse_date(text: str) -> date_cls | None:
    m = _DATE_RE.search(text)
    if not m:
        return None
    d, mo, y = m.groups()
    try:
        return date_cls(int(y), int(mo), int(d))
    except ValueError:
        return None


def guess_metadata(title: str, url: str) -> dict:
    """Best-effort regex extraction of ΦΕΚ identifiers from anchor text or a
    filename. Tries patterns in order of reliability: rich prose citations
    first (e.g. ΤΕΕ's "ΦΕΚ B' 6548/31.12.2021"), then filename conventions
    that vary in number/series order between sites.
    """
    meta: dict = {"issue_number": None, "series": None, "date": None, "identifier": None}

    law_number = _LAW_NUMBER_YEAR_RE.search(url)
    if law_number:
        meta["identifier"] = f"{law_number.group(1)}/{law_number.group(2)}"
        return meta

    citation = _FEK_CITATION_RE.search(title)
    if citation:
        meta["series"] = citation.group(1)
        meta["issue_number"] = citation.group(2)
        date_part = citation.group(3)
        if "." in date_part:
            meta["date"] = _parse_date(date_part)
        return meta

    text = f"{title} {url}"
    num_first = _FEK_FILENAME_NUM_FIRST_RE.search(text)
    if num_first:
        meta["issue_number"] = num_first.group(1)
        meta["series"] = num_first.group(2)
        if num_first.group(3):
            meta["date"] = _parse_date(num_first.group(3))
        return meta

    series_first = _FEK_FILENAME_SERIES_FIRST_RE.search(text)
    if series_first:
        meta["series"] = series_first.group(1)
        meta["issue_number"] = series_first.group(2)

    if meta["date"] is None:
        meta["date"] = _parse_date(text)

    return meta


def document_exists(conn: psycopg.Connection, source: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM documents WHERE source = %s LIMIT 1", (source,))
        return cur.fetchone() is not None


def document_exists_by_hash(conn: psycopg.Connection, hash_value: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM documents WHERE content_hash = %s LIMIT 1", (hash_value,))
        return cur.fetchone() is not None


def insert_document(
    conn: psycopg.Connection,
    *,
    title: str,
    doc_type: str,
    source: str,
    identifier: str | None = None,
    issue_number: str | None = None,
    series: str | None = None,
    doc_date: date_cls | None = None,
    content: str | None = None,
    content_hash_value: str | None = None,
    source_name: str | None = None,
    needs_review: bool = False,
    vertical_slug: str = "construction",
) -> int:
    # embed_pending_documents() (backend/app/services/embeddings.py) only
    # picks up extraction_status='full_text' rows - without this, ingested
    # documents silently never get embedded/searchable.
    extraction_status = "full_text" if content else "reference_only"

    with conn.cursor() as cur:
        # vertical_slug is resolved by slug rather than a hardcoded id, since
        # row ids aren't guaranteed stable across envs. Defaults to
        # construction since every call site predates the tax vertical
        # except crawler/tax_laws.py, which passes vertical_slug explicitly.
        cur.execute(
            """
            INSERT INTO documents
                (title, doc_type, identifier, issue_number, series, date, source, language, content, content_hash, source_name, last_verified_at, needs_review, vertical_id, extraction_status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'el', %s, %s, %s, CURRENT_DATE, %s, (SELECT id FROM verticals WHERE slug = %s), %s)
            RETURNING id
            """,
            (title, doc_type, identifier, issue_number, series, doc_date, source, content, content_hash_value, source_name, needs_review, vertical_slug, extraction_status),
        )
        row = cur.fetchone()
        assert row is not None
        doc_id = row[0]
    conn.commit()
    return doc_id


def ingest_seed_document(conn: psycopg.Connection, seed: dict) -> int | None:
    if document_exists(conn, seed["url"]):
        print(f"  already ingested, skipping: {seed['identifier']}")
        return None

    pdf_bytes = download(seed["url"])
    text = extract_text(pdf_bytes)

    doc_id = insert_document(
        conn,
        title=seed["title"],
        doc_type=seed["doc_type"],
        identifier=seed["identifier"],
        issue_number=seed["issue_number"],
        series=seed["series"],
        doc_date=date_cls.fromisoformat(seed["date"]),
        source=seed["url"],
        content=text,
        content_hash_value=content_hash(pdf_bytes),
        source_name=seed["source_name"],
    )
    print(f"  inserted document id={doc_id} ({len(text)} chars extracted)")
    return doc_id


def ingest_discovered_pdf(conn: psycopg.Connection, *, url: str, title: str, source_name: str) -> int | None:
    """Full download + text extraction, for sources whose robots.txt allows it."""
    if document_exists(conn, url):
        print(f"  already ingested (same url), skipping: {title}")
        return None

    pdf_bytes = download(url)
    hash_value = content_hash(pdf_bytes)
    if document_exists_by_hash(conn, hash_value):
        print(f"  already ingested (same content), skipping: {title}")
        return None

    text = extract_text(pdf_bytes)
    meta = guess_metadata(title, url)

    doc_id = insert_document(
        conn,
        title=title,
        doc_type="law" if meta["identifier"] else "circular",
        identifier=meta["identifier"],
        issue_number=meta["issue_number"],
        series=meta["series"],
        doc_date=meta["date"],
        source=url,
        content=text,
        content_hash_value=hash_value,
        source_name=source_name,
    )
    print(f"  inserted document id={doc_id} ({len(text)} chars) [{source_name}]")
    return doc_id


def ingest_fek_document(
    conn: psycopg.Connection,
    *,
    url: str,
    title: str,
    series: str,
    issue_number: str,
    date: str,
    source_name: str,
) -> int | None:
    """Like ingest_discovered_pdf, but series/issue_number/date come straight
    from et.gr's search API instead of being regex-guessed from a filename.
    """
    if document_exists(conn, url):
        print(f"  already ingested (same url), skipping: {title}")
        return None

    pdf_bytes = download(url)
    hash_value = content_hash(pdf_bytes)
    if document_exists_by_hash(conn, hash_value):
        print(f"  already ingested (same content), skipping: {title}")
        return None

    text = extract_text(pdf_bytes)
    month, day, year = date.split("/")

    doc_id = insert_document(
        conn,
        title=title,
        doc_type="law" if series == "Α" else "circular",
        identifier=title,
        issue_number=issue_number,
        series=series,
        doc_date=date_cls(int(year), int(month), int(day)),
        source=url,
        content=text,
        content_hash_value=hash_value,
        source_name=source_name,
    )
    print(f"  inserted document id={doc_id} ({len(text)} chars) [{source_name}]")
    return doc_id


@dataclass
class ExtractedContent:
    text: str | None
    # True when more than one <article> tag was found and the first was used
    # as a guess (e.g. a "recent posts" widget contributes extra <article>
    # tags alongside the real content) - dimos-dramas.gr does this, and the
    # first tag turned out to be an unrelated council-meeting agenda instead
    # of the building-permits page it was supposed to be. Never trust this
    # silently; the caller must flag the resulting document for review.
    ambiguous: bool = False


def extract_article_text(html: str) -> ExtractedContent:
    """Prefer <article>, but fall back to <main> when <article> exists yet is
    empty (e.g. deyapaggaiou.gr wraps a 0-content <article> tag next to the
    real content, which sits as a sibling inside <main> instead) - a plain
    `find("article") or find("main")` doesn't fall through here since an
    empty Tag is still truthy."""
    soup = BeautifulSoup(html, "html.parser")

    articles = soup.find_all("article")
    if len(articles) == 1:
        text = articles[0].get_text(separator="\n", strip=True)
        if text:
            return ExtractedContent(text)
    elif len(articles) > 1:
        text = articles[0].get_text(separator="\n", strip=True)
        if text:
            return ExtractedContent(text, ambiguous=True)

    main = soup.find("main")
    if main:
        text = main.get_text(separator="\n", strip=True)
        if text:
            return ExtractedContent(text)

    return ExtractedContent(None)


def ingest_html_page(
    conn: psycopg.Connection, *, url: str, title: str, source_name: str, vertical_slug: str = "construction"
) -> int | None:
    """For sources whose content IS the page itself (FAQ/guide pages) rather
    than a listing of linked PDFs, e.g. e-ΕΦΚΑ's ΑΠΔ guidance pages. Re-crawling
    monthly and comparing content_hash surfaces silent edits to the guidance.
    """
    resp = requests.get(url, timeout=30, headers={"User-Agent": USER_AGENT})
    resp.raise_for_status()
    extracted = extract_article_text(resp.text)
    if not extracted.text:
        print(f"  no <article>/<main> content found, skipping: {url}")
        return None

    if extracted.ambiguous:
        print(f"  WARNING: multiple <article> tags found, took the first as a guess - flagging for manual review: {url}")

    hash_value = content_hash(extracted.text.encode("utf-8"))
    if document_exists_by_hash(conn, hash_value):
        print(f"  already ingested (unchanged), skipping: {title}")
        return None
    if document_exists(conn, url):
        print(f"  content changed since last crawl, re-ingesting: {title}")

    doc_id = insert_document(
        conn,
        title=title,
        doc_type="guide",
        source=url,
        content=extracted.text,
        content_hash_value=hash_value,
        source_name=source_name,
        needs_review=extracted.ambiguous,
        vertical_slug=vertical_slug,
    )
    print(f"  inserted document id={doc_id} ({len(extracted.text)} chars) [{source_name}]")
    return doc_id


def ingest_reference_only(conn: psycopg.Connection, *, url: str, title: str, source_name: str) -> int | None:
    """Store title/link/date without fetching the file itself - for sources
    whose robots.txt disallows crawling the documents (e.g. ypen.gov.gr).
    """
    if document_exists(conn, url):
        print(f"  already indexed, skipping: {title}")
        return None

    meta = guess_metadata(title, url)
    doc_id = insert_document(
        conn,
        title=title,
        doc_type="reference",
        issue_number=meta["issue_number"],
        series=meta["series"],
        doc_date=meta["date"],
        source=url,
        content=None,
        content_hash_value=None,
        source_name=source_name,
    )
    print(f"  indexed reference id={doc_id} (no content fetched, robots.txt disallows it) [{source_name}]")
    return doc_id
