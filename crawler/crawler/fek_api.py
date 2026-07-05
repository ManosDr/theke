"""ΦΕΚ (Government Gazette) discovery via et.gr's daily-publications search
API - the same JSON API the public search.et.gr "Ημερήσια Κυκλοφορία" page
itself calls (confirmed by inspecting real browser network traffic). Works
from a plain server-side POST, no session/browser required, and the
resulting documents are served from a publicly readable Azure Blob
container (Access-Control-Allow-Origin: *) with stable, predictable URLs -
no session tokens like the old pdfViewerForm links.
"""

import json
from datetime import date as date_cls, timedelta

import requests

SEARCH_API_URL = "https://searchetv99.azurewebsites.net/api/searchbydate"
BLOB_BASE_URL = "https://ia37rg02wpsa01.blob.core.windows.net/fek"
USER_AGENT = "thekebot/0.1 (construction compliance assistant; contact: manos.drams@gmail.com)"

# Series codes (et.gr's own search_IssueGroupID values, discovered empirically):
# 1=Α (laws), 2=Β (ministerial decisions), 3=Γ (civil service appointments),
# 4=Δ (urban planning), 11=ΑΕ-ΕΠΕ (company registrations), 14=Υ.Ο.Δ.Δ. (board
# appointments), 15=Α.Α.Π. (forced expropriations & urban planning matters -
# this is where Γ.Π.Σ./ΖΟΕ approvals actually get published, e.g. Kavala's
# "ΦΕΚ 69/ΑΑΠ/2013" - see KNOWN_DECISIONS.md).
# Only Α, Δ, and Α.Α.Π. are ingested: Β alone produced ~35 docs/day in
# testing (mostly unrelated ministerial decisions - budgets, appointments,
# etc.), which would swamp the knowledge base with construction-irrelevant
# noise every month. Α.Α.Π. is included despite not being scoped to our
# tracked regions specifically - unlike Β, every document in this series is
# genuinely urban-planning/expropriation content, so it's on-topic even for
# municipalities we haven't onboarded (it'll land unclassified, same as the
# rest of fek_search_api's bulk results - see Section 1's backfill notes).
RELEVANT_SERIES_CODES = {1, 4, 15}


def search_by_date(day: date_cls) -> list[dict]:
    resp = requests.post(
        SEARCH_API_URL,
        json={"datePublished": day.isoformat()},
        headers={"User-Agent": USER_AGENT},
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    return json.loads(body["data"])


def build_blob_url(record: dict) -> str:
    series_code = int(record["search_IssueGroupID"])
    issue_number = int(record["search_DocumentNumber"])
    year = record["search_PrimaryLabel"].rsplit("/", 1)[-1]
    return f"{BLOB_BASE_URL}/{series_code:02d}/{year}/{year}{series_code:02d}{issue_number:05d}.pdf"


def discover_recent(days_back: int = 35, series_codes: set[int] = RELEVANT_SERIES_CODES) -> list[dict]:
    """Search the last `days_back` circulation dates. Monthly cadence with a
    35-day lookback gives overlap so a slow month (crawler didn't run, host
    down, etc.) never leaves a gap. Re-crawls are cheap: ingest_discovered_pdf
    dedupes by URL/content hash, so already-seen issues are just skipped.
    """
    today = date_cls.today()
    candidates = []
    for offset in range(days_back):
        day = today - timedelta(days=offset)
        try:
            records = search_by_date(day)
        except Exception as exc:
            print(f"  ΦΕΚ search failed for {day.isoformat()}: {exc}")
            continue
        for record in records:
            if int(record["search_IssueGroupID"]) not in series_codes:
                continue
            series, issue_and_year = record["search_PrimaryLabel"].split(" ", 1)
            issue_number, year = issue_and_year.split("/")
            candidates.append(
                {
                    "url": build_blob_url(record),
                    "title": record["search_PrimaryLabel"],
                    "series": series,
                    "issue_number": issue_number,
                    "date": record["search_IssueDate"].split(" ")[0],  # "MM/DD/YYYY"
                }
            )
    return candidates
