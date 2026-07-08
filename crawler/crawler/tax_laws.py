"""Tax-vertical core law ingestion.

lawspot.gr renders a law's *entire* article-by-article text inline on one
index page (`/nomothesia/nomos-{number}-{year}/`) rather than paginating -
confirmed by inspecting the DOM directly (`div.post__body` contains every
`<article class="legislation__article">`, full text present in raw HTML, no
JS rendering involved). That single fetch replaces what would otherwise be
one HTTP request per article.

Not every source law is available there, and one of the four laws named in
the original ingestion plan (Ν.2859/2000, the old ΦΠΑ code) was repealed on
2024-10-11 and replaced by Ν.5144/2024 - so this module also carries a
fek.gr fallback (the same public/free ΦΕΚ blob storage `crawler.fek_api`
already uses for construction sources) for the two laws lawspot doesn't
serve in full: ΚΦΔ Ν.4174/2013 and the current ΦΠΑ code Ν.5144/2024. The
fek.gr fallback gives the original enactment text only (no accumulated
amendments) - a real, disclosed limitation, not a silent one.
"""

import re
from datetime import date as date_cls

import fitz  # PyMuPDF
import psycopg
import requests
from bs4 import BeautifulSoup, Tag

from crawler.fek_api import BLOB_BASE_URL
from crawler.ingest import content_hash, document_exists, document_exists_by_hash, insert_document

USER_AGENT = "thekebot/0.1 (construction compliance assistant; contact: manos.drams@gmail.com)"

_ARTICLE_NUMBER_RE = re.compile(r"Άρθρο\s+(\d+)")
_MEROS_SPLIT_RE = re.compile(r"(?=ΜΕΡΟΣ\s+[Α-Ω]+)")
_KEFALAIO_SPLIT_RE = re.compile(r"(?=ΚΕΦΑΛΑΙΟ\s+[Α-Ω]+['΄’]?)")
MAX_DOCUMENT_CHARS = 200_000


def _fetch(url: str) -> str:
    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    return resp.text


def parse_lawspot_articles(html: str) -> list[dict]:
    """Walks `div.post__body`'s children in document order. Most laws are a
    flat list of `<article>` tags (ΜΕΡΟΣ/ΚΕΦΑΛΑΙΟ headers embedded as plain
    text at the end of the last article before the transition); omnibus laws
    instead wrap each ΚΕΦΑΛΑΙΟ in its own `div.chapter` - handled by
    recursing into any `div` with that class, so both shapes fall out of the
    same walk. Returns [{chapter, number, text}] in document order.
    """
    soup = BeautifulSoup(html, "html.parser")
    post_body = soup.find("div", class_="post__body")
    if post_body is None or not isinstance(post_body, Tag):
        return []

    articles: list[dict] = []

    def walk(container: Tag, chapter_header: str | None) -> None:
        for child in container.find_all(recursive=False):
            if not isinstance(child, Tag):
                continue
            classes = child.get("class") or []
            if child.name == "div" and "chapter" in classes:
                first_article = child.find("article", class_="legislation__article")
                heading = chapter_header
                if first_article is not None and isinstance(first_article, Tag):
                    before = []
                    for c in child.find_all(recursive=False):
                        if c is first_article:
                            break
                        before.append(c.get_text(" ", strip=True))
                    if before:
                        heading = " ".join(before).strip() or chapter_header
                walk(child, heading)
            elif child.name == "article" and "legislation__article" in classes:
                body = child.find("div", class_="body")
                text = (body if body is not None else child).get_text("\n", strip=True)
                match = _ARTICLE_NUMBER_RE.search(text)
                number = int(match.group(1)) if match else None
                articles.append({"chapter": chapter_header, "number": number, "text": text})

    walk(post_body, None)
    return articles


def scrape_lawspot_law(slug: str, *, chapter_prefix: str | None = None) -> list[dict]:
    """Fetches and parses a law's full text from lawspot.gr. When
    `chapter_prefix` is given, only articles whose chapter heading starts
    with it are kept - used to pull just the ΕΝΦΙΑ chapter out of Ν.4223/2013,
    an omnibus law that bundles several unrelated topics under one ΦΕΚ."""
    url = f"https://www.lawspot.gr/nomothesia/{slug}/"
    html = _fetch(url)
    articles = parse_lawspot_articles(html)
    if chapter_prefix:
        articles = [a for a in articles if a["chapter"] and a["chapter"].startswith(chapter_prefix)]
    return articles


def _greedy_pack(pieces: list[str], max_chars: int) -> list[str]:
    """Packs consecutive pieces (already split at a safe legal boundary -
    ΜΕΡΟΣ or ΚΕΦΑΛΑΙΟ - never mid-article) into groups up to max_chars, same
    greedy-append shape as embeddings.chunk_text but at document-part
    granularity instead of embedding-chunk granularity."""
    packed: list[str] = []
    current = ""
    for piece in pieces:
        if current and len(current) + len(piece) > max_chars:
            packed.append(current)
            current = piece
        else:
            current += piece
    if current:
        packed.append(current)
    return packed


def _split_by_meros(text: str, max_chars: int) -> list[str]:
    """Splits at ΜΕΡΟΣ boundaries first (coarsest, used by ΚΦΕ); if the law
    has no ΜΕΡΟΣ divisions (e.g. the ΦΠΑ code, which goes straight to
    ΚΕΦΑΛΑΙΟ), falls back to ΚΕΦΑΛΑΙΟ boundaries instead. Either way, pieces
    are then greedily packed back up towards max_chars rather than kept as
    one document per part, so a law with many short parts doesn't explode
    into dozens of tiny document rows."""
    if len(text) <= max_chars:
        return [text]

    parts = [p for p in _MEROS_SPLIT_RE.split(text) if p.strip()]
    if len(parts) <= 1:
        parts = [p for p in _KEFALAIO_SPLIT_RE.split(text) if p.strip()]
    if len(parts) <= 1:
        return [text]

    return _greedy_pack(parts, max_chars)


def ingest_lawspot_law(
    conn: psycopg.Connection,
    *,
    slug: str,
    law_number: str,
    year: str,
    title: str,
    source_name: str,
    chapter_prefix: str | None = None,
) -> list[int]:
    articles = scrape_lawspot_law(slug, chapter_prefix=chapter_prefix)
    if not articles:
        print(f"  no articles found for {slug} (chapter_prefix={chapter_prefix!r}), skipping")
        return []

    full_text = "\n\n".join(a["text"] for a in articles)
    parts = _split_by_meros(full_text, MAX_DOCUMENT_CHARS)
    index_url = f"https://www.lawspot.gr/nomothesia/{slug}/"

    doc_ids = []
    for i, part_text in enumerate(parts, start=1):
        source = index_url if len(parts) == 1 else f"{index_url}#part{i}"
        if document_exists(conn, source):
            print(f"  already ingested, skipping: {source}")
            continue
        part_title = title if len(parts) == 1 else f"{title} (Μέρος {i}/{len(parts)})"
        doc_id = insert_document(
            conn,
            title=part_title,
            doc_type="law",
            identifier=f"{law_number}/{year}",
            doc_date=None,
            source=source,
            content=part_text,
            content_hash_value=content_hash(part_text.encode("utf-8")),
            source_name=source_name,
            vertical_slug="tax_accounting",
        )
        print(f"  inserted document id={doc_id} ({len(part_text)} chars) [{source_name}] part {i}/{len(parts)}")
        doc_ids.append(doc_id)
    return doc_ids


def ingest_fek_law(
    conn: psycopg.Connection,
    *,
    series_code: int,
    year: int,
    issue_number: int,
    title: str,
    law_number: str,
    law_year: str,
    doc_date: date_cls,
    source_name: str,
) -> int | None:
    """Fallback for laws lawspot.gr doesn't serve in full: the original ΦΕΚ
    enactment PDF from et.gr's public blob storage. This is the as-enacted
    text only, not a living/consolidated version - a real limitation, not a
    silent one (see this module's docstring)."""
    url = f"{BLOB_BASE_URL}/{series_code:02d}/{year}/{year}{series_code:02d}{issue_number:05d}.pdf"
    if document_exists(conn, url):
        print(f"  already ingested, skipping: {url}")
        return None

    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    pdf_bytes = resp.content
    hash_value = content_hash(pdf_bytes)
    if document_exists_by_hash(conn, hash_value):
        print(f"  already ingested (same content), skipping: {url}")
        return None

    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        text = "\n".join(page.get_text() for page in doc)

    parts = _split_by_meros(text, MAX_DOCUMENT_CHARS)
    last_id = None
    for i, part_text in enumerate(parts, start=1):
        source = url if len(parts) == 1 else f"{url}#part{i}"
        part_title = title if len(parts) == 1 else f"{title} (Μέρος {i}/{len(parts)})"
        last_id = insert_document(
            conn,
            title=part_title,
            doc_type="law",
            identifier=f"{law_number}/{law_year}",
            issue_number=str(issue_number),
            series="Α",
            doc_date=doc_date,
            source=source,
            content=part_text,
            content_hash_value=content_hash(part_text.encode("utf-8")) if len(parts) > 1 else hash_value,
            source_name=source_name,
            vertical_slug="tax_accounting",
        )
        print(f"  inserted document id={last_id} ({len(part_text)} chars) [{source_name}] part {i}/{len(parts)}")
    return last_id
