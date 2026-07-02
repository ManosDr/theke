"""Known document sources for Phase 1 (per the blueprint's Crawler & Ingestion
Pipeline section). Each entry is a stub for `main.py` to iterate over -
actual scraping logic lands in Phase 1 Week 2.
"""

# mode:
#   "full_pdf"       - download and extract text (site's robots.txt allows it)
#   "reference_only" - index title/link/date only, never fetch the file
#                       (robots.txt disallows crawling it)
#   "html_page"      - the URL itself is the document (FAQ/guide page);
#                       re-crawled monthly and content_hash-compared to
#                       surface silent edits to the guidance
# enabled: False until the source's page structure has been checked by hand
# (see tasks for ΦΕΚ scraper) - main.py skips disabled sources.
SOURCES = [
    {
        "name": "fek_search_api",
        "description": "Government Gazette (ΦΕΚ) Series Α/Β/Δ via et.gr's daily-publications search API",
        "url": "https://search.et.gr/el/daily-publications/",
        "mode": "fek_api",  # not a listing page - see crawler/fek_api.py
        "enabled": True,
    },
    {
        "name": "ypen_nomothesia",
        "description": "Ministry of Environment & Energy (ΥΠΕΝ) - urban planning legislation",
        "url": "https://ypen.gov.gr/chorikos-schediasmos/poleodomia/nomothesia/",
        "mode": "reference_only",  # robots.txt: Disallow: /*.pdf$
        "enabled": True,
    },
    {
        "name": "tee_e_adeies",
        "description": "Technical Chamber of Greece (ΤΕΕ) e-Adeies circulars",
        "url": "https://web.tee.gr/e-adeies/nomothesia-egkyklioi/",
        "mode": "full_pdf",  # web.tee.gr has no robots.txt (404) - no stated restriction
        "enabled": True,
    },
    {
        "name": "aade_e9_enfia",
        "description": "ΑΑΔΕ - Ε9 declaration / Unified Property Tax (ΕΝΦΙΑ) circulars",
        "url": "https://www.aade.gr/en/e9enfia",
        "mode": "full_pdf",  # robots.txt does not restrict /sites/default/files/
        "enabled": True,
    },
    {
        "name": "efka_oikodomotechnika_koina",
        "description": "e-ΕΦΚΑ - insurance contributions for construction technical works (κοινές επιχειρήσεις)",
        "url": "https://www.e-efka.gov.gr/el/sychnes-eroteseis/asphalisi-eisphores/ergodotes/apd/koinon-epicheireseon-oikodomotechnikon-ergon",
        "mode": "html_page",  # robots.txt only restricts Google-Extended, not general crawling
        "enabled": True,
    },
    {
        "name": "efka_oikodomotechnika_apografi",
        "description": "e-ΕΦΚΑ - registration of private construction technical works (ένσημα/ΑΠΔ)",
        "url": "https://www.e-efka.gov.gr/el/sychnes-eroteseis/asphalisi-eisphores/ergodotes/metroo-ergodoton/elektronikes-yperesies-0/apographe-idiotikon-oikodomotechnikon-ergon-0",
        "mode": "html_page",
        "enabled": True,
    },
    {
        "name": "ktimatologio_thesmiko_plaisio",
        "description": "Hellenic Cadastre (Κτηματολόγιο) - institutional framework laws/decrees",
        "url": "https://www.ktimatologio.gr/foreas/thesmiko-plaisio",
        "mode": "full_pdf",  # no robots.txt restriction (content-signals format, none declared)
        "enabled": True,
    },
]

# Individually verified, directly downloadable documents used to seed the
# knowledge base before the generic crawlers in SOURCES are automated
# (per the blueprint's "ship the thinnest working slice first" step).
# Each URL was checked by hand to confirm it serves the real, complete,
# digitally-signed PDF (not a login page or partial excerpt).
SEED_DOCUMENTS = [
    {
        "source_name": "tee_portal",
        "url": "http://portal.tee.gr/portal/page/portal/TEE/MyTEE/auth4495/n4495.pdf",
        "title": "Έλεγχος και προστασία του Δομημένου Περιβάλλοντος και άλλες διατάξεις",
        "doc_type": "law",
        "identifier": "4495/2017",
        "series": "Α",
        "issue_number": "167",
        "date": "2017-11-03",
    },
]
