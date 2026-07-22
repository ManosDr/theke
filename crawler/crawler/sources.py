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
    {
        "name": "eugo_e_adeies",
        "description": "EUGO (point of single contact) - e-Άδειες building permit issuance overview",
        "url": "https://eugo.gov.gr/services/344883",
        "mode": "html_page",  # no robots.txt on eugo.gov.gr (404) - no stated restriction
        "enabled": True,
    },
    {
        "name": "deddie_new_connection",
        "description": "HEDNO/ΔΕΔΔΗΕ - new electricity grid connection procedure",
        "url": "https://www.deddie.gr/en/services/network-connection/new-connection/",
        "mode": "html_page",  # deddie.gr has no robots.txt (404) - no stated restriction
        "enabled": True,
    },
    {
        "name": "aade_property_transfer_tax",
        "description": "ΑΑΔΕ - real estate transfer/gift/inheritance tax return overview",
        "url": "https://www.aade.gr/en/tax-return-real-estate-transfer-gifts-parental-provision-and-inheritance",
        "mode": "html_page",  # aade.gr robots.txt does not restrict /en/ content pages
        "enabled": True,
    },
    {
        "name": "deyakav_new_connection",
        "description": "ΔΕΥΑ Καβάλας - new water/sewer connection application requirements (regional, Kavala)",
        "url": "https://deyakav.gr/apps/",
        "mode": "html_page",  # robots.txt only disallows /wp-admin/
        "enabled": True,
    },
    {
        "name": "dimospaggaiou_ydom",
        "description": "Δήμος Παγγαίου - Building Directorate contact/forms page (regional, Paggaio)",
        "url": "https://dimospaggaiou.gr/e-dikaiologitika/diefthinsi-domisis-poleodomikou-sxediasmou-kai-efarmogon/",
        "mode": "html_page",  # robots.txt only disallows /wp-admin/
        "enabled": True,
    },
    {
        "name": "deyapaggaiou_new_connection",
        "description": "ΔΕΥΑΑ Παγγαίου - new water/sewer/irrigation connection application requirements (regional, Paggaio)",
        "url": "https://deyapaggaiou.gr/chrisima-engrafa/",
        "mode": "html_page",  # robots.txt only disallows /wp-admin/
        "enabled": True,
    },
    {
        "name": "thassos_ydom",
        "description": "Δήμος Θάσου - Building Directorate (ΥΔΟΜ) services, permit-category checklists (regional, Thassos)",
        "url": "https://www.thassos.gr/%CF%85%CF%80%CE%B7%CF%81%CE%B5%CF%83%CE%B9%CE%B1-%CE%B4%CE%BF%CE%BC%CE%B7%CF%83%CE%B7%CF%83-%CF%85%CE%B4%CE%BF%CE%BC/",
        "mode": "html_page",  # robots.txt only disallows /wp-admin/
        "enabled": True,
    },
    {
        "name": "deyathassou_new_connection",
        "description": "ΔΕΥΑ Θάσου - new water supply connection application requirements (regional, Thassos)",
        "url": "https://deyathassou.gr/%CE%BD%CE%AD%CE%B1-%CF%83%CF%8D%CE%BD%CE%B4%CE%B5%CF%83%CE%B7-%CF%80%CE%B1%CF%81%CE%BF%CF%87%CE%AE%CF%82-%CE%BD%CE%B5%CF%81%CE%BF%CF%8D/",
        "mode": "html_page",  # robots.txt only disallows /wp-admin/
        "enabled": True,
    },
    {
        "name": "dimos_dramas_ydom",
        # Deliberate re-test of the multi-<article> decoy bug (see
        # crawler/crawler/ingest.py's ExtractedContent.ambiguous) - this page's
        # template embeds a "recent posts" widget that adds extra <article>
        # tags ahead of the real content. Keep this note as a code comment,
        # not in "description" below - description is used verbatim as the
        # ingested document's public-facing title (see main.py's
        # DIRECT_MODE_HANDLERS call), so it must read like a real title.
        "description": "Δήμος Δράμας - Building Permits Department (regional, Drama)",
        "url": "https://dimos-dramas.gr/service/dimarchos/genikos-grammateas/dnsi-poleodomias/tm-ekdosis-ikonomikon-adion-elegchou-kataskevon/",
        "mode": "html_page",  # robots.txt only disallows /suggest/, /Forms/, /Dictionary/, etc. - not this page
        "enabled": True,
    },
    {
        "name": "deyad_new_connection",
        "description": "ΔΕΥΑ Δράμας - required documents for a new water network connection (regional, Drama)",
        "url": "https://deyad.gr/dikaiologitika-gia-syndesi-me-to-diktyo-ydrefsis/",
        "mode": "html_page",  # robots.txt only disallows one JSON asset path
        "enabled": True,
    },
    {
        "name": "deyaxanthis_faq",
        "description": "ΔΕΥΑ Ξάνθης - FAQ covering required documents for water service and sewerage connection (regional, Xanthi)",
        "url": "https://www.deyaxanthis.gr/syxnes-erwtiseis/",
        "mode": "html_page",  # robots.txt only disallows one JSON asset path
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
