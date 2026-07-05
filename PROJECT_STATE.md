# Project State

Extracted directly from the live database, current code, and git working
tree on 2026-07-05. This is a snapshot, not a plan — no recommendations or
next steps are included here by design.

## 1. Schema snapshot

Pulled via `\d <table>` against the live `theke` Postgres database.

### `regions`

| Column | Type | Notes |
|---|---|---|
| region_id | varchar PK | slug, e.g. `kavala` |
| region_name_el | varchar NOT NULL | |
| region_name_en | varchar NOT NULL | |
| level | varchar NOT NULL | `'municipality'` for all 5 current rows |
| parent_region_id | varchar, FK → regions.region_id | **exists, never populated** — all 5 rows have NULL |
| ydom_authority_name | varchar | |
| deya_provider_id | varchar, FK → utility_providers.provider_id | |
| deddie_region_id | varchar, FK → utility_providers.provider_id | NULL for Drama and Xanthi (no ΔΕΔΔΗΕ provider record linked to either) |
| status | varchar NOT NULL, default `'pending'` | now means "at least one utility provider populated," not "has coefficient data" |
| has_coefficient_data | boolean, nullable | added this session |
| has_zone_level_coefficient_text | boolean, nullable | added this session, distinct field from the above |
| created_at | timestamp NOT NULL | |

### `utility_providers`

| Column | Type | Notes |
|---|---|---|
| provider_id | varchar PK | |
| provider_type | varchar NOT NULL | `'water'` or `'electric_grid'` in current data |
| provider_name | varchar NOT NULL | |
| base_url | varchar | |
| coverage_region_ids | varchar[] NOT NULL, default `'{}'` | |
| status | varchar NOT NULL, default `'pending'` | |
| created_at | timestamp NOT NULL | |

### `documents`

| Column | Type | Notes |
|---|---|---|
| id | serial PK | |
| title | text | |
| doc_type | varchar | |
| identifier | varchar | |
| issue_number | varchar | |
| series | varchar | |
| date | date | |
| source | varchar | |
| language | varchar, default `'el'` | |
| content | text | |
| raw_json | jsonb | **write-only in practice** — populated for `manual_entry_pending`/stub docs (`stub_note` key) via direct SQL, but no backend schema/endpoint reads or exposes it. Not in `schemas.py` at all. |
| created_at | timestamp NOT NULL | |
| content_hash | text | |
| company_id | integer, FK → companies.id | |
| municipality | varchar | legacy free-text field for municipality-tenant-uploaded docs; independent of the newer `region_id` |
| uploaded_by | integer, FK → users.id | |
| status | varchar NOT NULL, default `'active'` | |
| replaces_document_id | integer, FK → documents.id (self) | |
| source_name | varchar | |
| scope | varchar NOT NULL, default `'national'` | `'national'` or `'regional'` |
| region_id | varchar, FK → regions.region_id | |
| authority | varchar | |
| permit_stage | varchar | |
| content_type | varchar | |
| extraction_status | varchar | |
| last_verified_at | date | |
| applies_to_first_time_homeowner | boolean | **written during Section-1 backfill, never read** — absent from `schemas.py`, no router or frontend code references it |
| needs_review | boolean NOT NULL, default `false` | added this session |

Indexes present include two full-text GIN indexes (`title`, `content`, Greek
config), a partial unique index on `content_hash` split by
`company_id IS NULL` vs not, and a partial index on `needs_review = true`.

### `projects`

| Column | Type | Notes |
|---|---|---|
| id | serial PK | |
| company_id | integer, FK → companies.id | |
| name | text | |
| municipality | varchar | legacy free-text, still the field shown in the UI table |
| address | text | |
| created_at | timestamp NOT NULL | |
| region_id | varchar, FK → regions.region_id | added this session |

### `companies`

| Column | Type | Notes |
|---|---|---|
| id | serial PK | |
| name | text NOT NULL | |
| plan | varchar, default `'basic'` | **exists, zero references anywhere in `backend/app`** — not read or written by any router |
| created_at | timestamp NOT NULL | |
| type | varchar NOT NULL, default `'construction'` | |
| is_suspended | boolean NOT NULL, default `false` | |
| logo_path | text | |

### `users`

Standard fields (id, company_id, email, role, password_hash, created_at,
is_active, preferred_locale) — all actively used, no dead columns found.

### Other tables that exist but have no router/service code referencing them

Confirmed via grep across `backend/app/routers` and `backend/app/services`
— these only appear in `models.py`'s class definitions:

- `doc_links` (model: `DocLink`)
- `chat_sessions` (model: `ChatSession`) — notably, `backend/app/routers/chat.py` does not write to this table at all; chat messages are not persisted anywhere currently
- `project_documents` (model: `ProjectDocument`)

## 2. Regions and providers — current real state

Query: `SELECT r.*, (SELECT count(*) FROM documents d WHERE d.region_id = r.region_id) FROM regions r`

| region_id | status | has_coefficient_data | has_zone_level_coefficient_text | deya_provider_id | deddie_region_id | documents tagged |
|---|---|---|---|---|---|---|
| drama | active | NULL | false | deyad-dramas | NULL | 3 |
| kavala | active | false | true | deya-kavalas | deddie-kavala | 3 |
| paggaio | active | false | NULL | deyaap-paggaiou | deddie-kavala | 4 |
| thassos | active | false | NULL | deya-thassou | deddie-kavala | 4 |
| xanthi | active | NULL | true | deyax-xanthis | NULL | 3 |

`utility_providers`:

| provider_id | provider_type | status | coverage_region_ids |
|---|---|---|---|
| deddie-kavala | electric_grid | active | {kavala, paggaio, thassos} |
| deyaap-paggaiou | water | active | {paggaio} |
| deyad-dramas | water | active | {drama} |
| deya-kavalas | water | active | {kavala} |
| deya-thassou | water | active | {thassos} |
| deyax-xanthis | water | active | {xanthi} |

No ΔΕΔΔΗΕ provider record exists for Drama or Xanthi (their `deddie_region_id`
is NULL) — the `deddie-kavala` provider's coverage was only ever extended to
cover the Kavala regional unit's municipalities.

## 3. Document inventory

Query against `documents WHERE status = 'active'` (223 rows total):

**By `extraction_status`:**

| extraction_status | count |
|---|---|
| full_text | 206 |
| manual_entry_pending | 10 |
| NULL | 5 |
| reference_only | 2 |

**By `content_type`:**

| content_type | count |
|---|---|
| NULL | 137 |
| legal_reference | 37 |
| regulatory_change_notice | 28 |
| procedural_howto | 14 |
| faq | 4 |
| form | 3 |

**`needs_review`:** 1 true, 222 false.

### The 10 `manual_entry_pending` documents, individually

| id | title | region | reason (from `raw_json->>'stub_note'`, or noted if absent) |
|---|---|---|---|
| 185 | ΦΕΚ τΑ΄/10/1.2.2016 (Κτηματολόγιο) | — | **no stored note** — predates the `stub_note` convention; content is 1 character (scanned PDF, no text layer) |
| 209 | Έγκριση επέμβασης σε δασική έκταση | — | No official primary-source procedural page found; secondary sources (ecopress.gr, b2green.gr) exist but weren't ingested. Cites Ν.998/1979 άρθρο 45 and a 2021 ΥΠΕΝ decision as legal basis. |
| 210 | Καταχώριση/δήλωση κτίσματος στο Κτηματολόγιο | — | The gov.gr e-declaration page is the closest official entry point but has no dedicated new-construction step; not classified `reference_only` because it doesn't point at the right specific procedure. |
| 212 | Συντελεστές δόμησης ... ΥΔΟΜ Δήμου Καβάλας | kavala | Kavala's ΥΔΟΜ page is a contact directory only, no coefficient content. |
| 215 | Συντελεστές δόμησης ... ΥΔΟΜ Δήμου Παγγαίου | paggaio | Same gap as Kavala — contact directory + generic forms only. |
| 218 | Συντελεστές δόμησης ... ΥΔΟΜ Δήμου Θάσου | thassos | Services/hours/checklists listed, no coefficient content. |
| 222 | Συντελεστές δόμησης ... ΥΔΟΜ Δήμου Ξάνθης | xanthi | cityofxanthi.gr is Joomla with no `<article>`/`<main>` tag at all — extraction returns nothing (clean failure, not a fix attempted). |
| 225 | Έγκριση ΓΠΣ Δήμου Δράμας | drama | FEK reference confirmed (896/Δ/1994) and fetched, but it's a scanned 1994 document — 20 characters extracted (a barcode), no usable text. |
| 226 | ΓΠΣ Δήμου Παγγαίου — εκκρεμεί εντοπισμός ΦΕΚ | paggaio | The FEK number itself was not located despite web-research effort; municipality references a 2023 amendment but not the original approval's FEK number. |
| 227 | ΓΠΣ Δήμου Θάσου — εκκρεμεί εντοπισμός ΦΕΚ | thassos | Same — FEK number not located. |

### The 1 `needs_review` document

| id | title | source_name | region | reason |
|---|---|---|---|---|
| 219 | Δήμος Δράμας - Building Permits Department | dimos_dramas_ydom | drama | `dimos-dramas.gr`'s template embeds a "recent posts" widget contributing extra `<article>` tags ahead of the real page content; the crawler's first-`<article>`-tag extraction grabbed a council-meeting agenda instead of the building-permits page. Flagged automatically by the multi-article ambiguity check, not manually. |

## 4. Known bugs fixed — verified against current code (not memory)

**Note on provenance:** none of this is in git commit history yet — see
Section 6. Every fix below exists only as an uncommitted working-tree
change. Line numbers are current as of this snapshot.

**1. Article/main extraction fallback (empty-`<article>` issue)**
`crawler/crawler/ingest.py`, `extract_article_text()` (~line 264). Prevents:
a page whose `<article>` tag exists but is empty (real content sits as a
sibling inside `<main>` instead, e.g. deyapaggaiou.gr) silently returning no
content, because a plain `find("article") or find("main")` doesn't fall
through — an empty Tag object is still truthy in Python.

**2. Multi-article ambiguity safeguard**
Same function, `ExtractedContent` dataclass (~line 253) with an `ambiguous`
field; consumed in `ingest_html_page()` (~line 291-321) which sets
`needs_review=extracted.ambiguous` on insert. Prevents: a page with more
than one `<article>` tag (e.g. a "recent posts" widget) having its first
tag silently trusted as the real content, when it may be something
unrelated entirely (confirmed to actually happen on dimos-dramas.gr, doc
id 219 above).

**3. Staleness sweep clobbering a same-day review flag**
`crawler/crawler/staleness.py`, the `UPDATE` in `run()` (~line 30-36) —
condition is `SET needs_review = true WHERE ... AND needs_review = false`,
i.e. it only ever raises the flag, never lowers it. Prevents: a document
flagged `needs_review=true` for a non-staleness reason (like the multi-
article case) on the same day it's inserted (`last_verified_at = today`,
i.e. not stale) having that flag silently cleared by the very next weekly
sweep, before any human sees it.

**4. `last_verified_at` not set on insert**
`crawler/crawler/ingest.py`, `insert_document()` INSERT statement (~line
136-140) — includes `last_verified_at` set to `CURRENT_DATE` unconditionally
on every insert. Prevents: every newly-crawled document accumulating
`last_verified_at = NULL` forever (since nothing else in the pipeline ever
set it), which would make every single new document "never verified" by
the staleness sweep's logic, forever.

**5. `needs_review` visibility (a fifth fix, related to #2, worth listing
separately since it was a distinct gap):**
`backend/app/services/visibility.py`, end of `visible_documents_filter()`
(line 69): `return or_(*conditions) & Document.needs_review.is_(False)`.
Prevents: a flagged document appearing as normal, trustworthy content in
Search/Sources/Chat/`GET /documents/{id}` for any user whose company can
otherwise see its region — the flag existed (fix #2) before this, but
nothing enforced it against read paths until this line was added.

## 5. KNOWN_DECISIONS.md — current contents (summarized)

The file exists at repo root, 194 lines, 5 entries. Summarized here; full
text is in the file itself.

1. **Region-scoped visibility is company-wide, not per-project.** Any
   project in a region unlocks that region's docs for the whole company,
   not just the project's users. Revisit trigger: a real company with 3+
   active regions *and* an actual complaint about noise — not a time-based
   or speculative trigger.

2. **Generic `html_page` ingest can silently pick the wrong content on
   multi-`<article>` pages.** Covers the Drama decoy-article discovery, the
   `ambiguous` flag, the staleness-sweep-only-raises fix, and the
   subsequent visibility-suppression fix (both closed as of this pass).
   Explicitly documents that a title/breadcrumb sanity heuristic was
   considered and *not* built. Revisit trigger: a second real instance of
   this failure mode on a live source.

3. **Region `status` redefinition + the two-field coefficient tracking.**
   Documents why `status` no longer gates on coefficient data, why
   `has_coefficient_data` and `has_zone_level_coefficient_text` are two
   separate fields rather than one, and that finding a region's GPS ΦΕΚ
   number is manual research (converged 2/5, found-but-unusable 1/5,
   unconverged 2/5).

4. **Zone-to-plot matching (the GIS problem) is explicitly out of scope.**
   States the two compounding reasons (spatial/GIS data + legal
   interpretation of conditional clauses) and that the revisit trigger is a
   deliberate product decision to support per-plot answers, not "more
   time."

5. **Current product framing** — a plain statement that the KB currently
   answers "what does the law say for this municipality's zones," not
   "what applies to my specific plot."

### Discussed in conversation but NOT currently in KNOWN_DECISIONS.md

- The decision to leave the ~132 bulk `fek_search_api` documents
  unclassified (`authority`/`permit_stage`/`content_type` all NULL) rather
  than guess, because keyword-based auto-classification on that specific
  bulk set was shown to produce false positives. This was reported to the
  user at the time but never written into the decisions file.
- The decision to keep the "edge case" documents (tourist-investment
  licensing, fire-damage-affected-property circulars) in the KB as-is,
  per explicit user instruction, rather than pruning them.
- Who reviews the staleness/`needs_review` queue and how often (user
  stated they'll review it personally, weekly) — this is an operational
  commitment, not currently written anywhere in the repo.
- That no "mark reviewed" action/endpoint exists to clear a `needs_review`
  flag once a human has looked at it — the only way a flag currently
  changes is the staleness sweep raising it further (never lowering), or a
  developer manually updating the row. This was noted in passing during
  the visibility-fix work but isn't recorded as a standing limitation.

## 6. Open threads

- **Nothing in this session's work is committed to git.** `git log`'s most
  recent commit is `cac3f4e` ("Recreate reference dashboard design, sidebar
  layout, and notifications"). Every change described in this document —
  the entire KB/regions/documents architecture, the 5 regions, the GPS FEK
  ingestion, the bug fixes, the logo/favicon replacement — exists only as
  uncommitted working-tree modifications: `git status` shows exactly 20
  modified files and 2 untracked (`KNOWN_DECISIONS.md`,
  `crawler/crawler/staleness.py`) as of just before this document was
  written; this file itself is a third untracked file once created.
- **ΑΑΠ/ΦΕΚ ingestion state:** landed, not partial, for what it covers.
  `crawler/crawler/fek_api.py`'s `RELEVANT_SERIES_CODES` includes `15`
  (Α.Α.Π.) as of this session. The 5-region manual GPS-FEK lookup produced
  2 usable ingests (Kavala, Xanthi — docs 223, 224), 1 found-but-unusable
  (Drama — doc 225), and 2 not-located (Paggaio, Thassos — docs 226, 227).
  No code exists to systematically discover a region's GPS FEK number;
  each lookup so far was manual, one at a time.
- **Chat/RAG pipeline remains an explicit stub** — 3 TODO comments in
  `backend/app/routers/chat.py`, `backend/app/services/embeddings.py`, and
  `backend/app/services/rag.py`, all reading "Phase 1, Week 3/4" (from the
  original blueprint's plan, predating this session's KB work). This is
  pre-existing and unrelated to the regional buildout.
- **No other TODO/FIXME/XXX markers exist** in `backend/app`,
  `crawler/crawler`, or `frontend/app` beyond the 3 chat/RAG ones above.

## 7. What's demonstrably working right now

For each item: whether it was verified end-to-end, and whether there's an
automated test.

| Capability | Verified how | Automated test? |
|---|---|---|
| Region-scoped document visibility (a company only sees a region's docs if it has a project there) | Manually, via curl as a real logged-in user, for Kavala, then re-confirmed for Drama and Xanthi during later work | No |
| `needs_review` suppression from Search/Sources/Chat/`GET /documents/{id}` | Manually, via curl: confirmed the flagged Drama document is absent from search results, absent from its ΥΔΟΜ source group, and 404s on direct fetch, while still appearing in the two admin-only endpoints | No |
| Staleness queue (`GET /admin/stale-documents`) and the "only raise, never lower" sweep behavior | Manually: ran the sweep before and after the multi-article flag was set, confirmed the flag survived a sweep | No |
| Multi-`<article>` ambiguity detection | Manually: ran `extract_article_text()` directly against the Drama URL and confirmed `ambiguous=True`; then ran the full crawler pipeline once and confirmed the resulting DB row had `needs_review=true` | No |
| Region creation → project → visibility unlock, in the actual browser UI (not just via API) | Once, manually, in a real browser session for Kavala only (create project via the dashboard form, confirm ΔΕΥΑ Καβάλας appears in Sources, confirm the document opens) | No |
| Logo/favicon replacement | Manually, screenshotted in the browser in both light and dark themes | No |

**The entire automated test suite is one file**, `backend/tests/test_health.py`,
containing a single test that asserts `GET /health` returns
`{"status": "ok"}`. No automated coverage exists for any region, document
visibility, staleness, or ingestion behavior described in this document —
everything above was checked by hand, once, in the course of building it.
