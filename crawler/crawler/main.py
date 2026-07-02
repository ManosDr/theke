import psycopg

from crawler import fek_api
from crawler.config import DATABASE_URL
from crawler.discovery import discover_pdf_links
from crawler.ingest import (
    ingest_discovered_pdf,
    ingest_fek_document,
    ingest_html_page,
    ingest_reference_only,
    ingest_seed_document,
)
from crawler.sources import SEED_DOCUMENTS, SOURCES

# Modes whose source URL is a listing page to discover PDF links from, plus
# how to discover candidates and how to ingest each one.
DISCOVERY_FUNCTIONS = {
    "full_pdf": lambda source: discover_pdf_links(source["url"]),
    "reference_only": lambda source: discover_pdf_links(source["url"]),
    "fek_api": lambda source: fek_api.discover_recent(),
}
DISCOVERY_MODE_HANDLERS = {
    "full_pdf": ingest_discovered_pdf,
    "reference_only": ingest_reference_only,
    "fek_api": ingest_fek_document,
}
# Modes whose source URL IS the document - no discovery step.
DIRECT_MODE_HANDLERS = {
    "html_page": ingest_html_page,
}


def run() -> None:
    with psycopg.connect(DATABASE_URL) as conn:
        for seed in SEED_DOCUMENTS:
            print(f"Ingesting seed {seed['identifier']} from {seed['source_name']}...")
            try:
                ingest_seed_document(conn, seed)
            except Exception as exc:
                print(f"  failed: {exc}")

        for source in SOURCES:
            if not source.get("enabled"):
                print(f"Skipping {source['name']} (not yet enabled)")
                continue

            mode = source["mode"]

            if mode in DIRECT_MODE_HANDLERS:
                print(f"Fetching {source['name']} ({source['url']})...")
                try:
                    DIRECT_MODE_HANDLERS[mode](
                        conn, url=source["url"], title=source["description"], source_name=source["name"]
                    )
                except Exception as exc:
                    print(f"  failed: {exc}")
                continue

            print(f"Discovering documents at {source['name']} ({source['url']})...")
            try:
                candidates = DISCOVERY_FUNCTIONS[mode](source)
            except Exception as exc:
                print(f"  discovery failed: {exc}")
                continue

            print(f"  found {len(candidates)} candidate(s)")
            handler = DISCOVERY_MODE_HANDLERS[mode]
            for candidate in candidates:
                try:
                    handler(conn, source_name=source["name"], **candidate)
                except Exception as exc:
                    print(f"  failed on {candidate['url']}: {exc}")


if __name__ == "__main__":
    run()
