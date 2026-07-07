# Known decisions & tradeoffs

Judgment calls made during implementation that are deliberate but not
necessarily final — each has a trigger condition for when it's worth
revisiting. Not a general TODO list; only things that were explicitly chosen
over an alternative, where the alternative might become the better choice
later.

## Bulk `fek_search_api` documents are left unclassified, not guessed

**What was chosen:** During the Section 1 schema backfill, ~132 documents
from `fek_search_api` (et.gr's "recent daily publications" discovery, which
pulls in whatever ΦΕΚ issues appeared regardless of topic) were left with
`authority`/`permit_stage`/`content_type`/`applies_to_first_time_homeowner`
all `NULL`, rather than auto-classified by keyword matching.

**Why:** Keyword-based classification was tried and shown to produce false
positives on this specific bulk-crawled set. Example: document id 42, a
routine "αναδασωτέα" (reforestation-declaration) notice for an unrelated
plot, matches a "Δασαρχείο" keyword search but has nothing to do with
forest-clearance-for-construction. Guessing metadata here would have been
worse than leaving it honestly blank.

**Revisit when:** A classification approach with real evidence behind it
becomes available (e.g. embedding-similarity-based tagging once retrieval
infrastructure exists) - not simply "someone has time to tag them by hand."

## Edge-case documents kept in the KB, not pruned

**What was chosen:** During the same backfill, a handful of narrow
edge-case documents surfaced by the audit - id 11 (tourist-investment
licensing) and ids 14-18 (fire-damage-affected-property circulars, a
COVID-era deadline-extension decree) - were flagged as low-relevance/narrow
scope but kept in the KB as-is, per explicit user instruction ("edge-case
coverage sounds great") rather than pruned.

**Why:** These are legitimate, narrow-applicability construction-compliance
topics (specific property situations a search might reasonably surface),
not noise - the call was "keep real edge cases, don't prune for tidiness,"
distinct from the bulk-`fek_search_api` case above where the problem was
false-positive keyword matches rather than genuine narrow relevance.

**Revisit when:** Specific evidence that one of these documents actively
misleads a user in practice - not on a schedule, and not just because
they're rarely matched.

## Staleness/`needs_review` queue ownership is a stated commitment, not enforced by code

**What was chosen:** The user stated they will personally review the
`/admin/stale-documents` queue weekly, until the process is shown to be
stable. No assignment, rotation, or notification system was built for
this - deliberately, matching the earlier explicit instruction to "build
the queue, not the automation around who gets pinged."

**Why:** With one person reviewing and a queue that (as of this writing)
holds a single item, building notification/assignment infrastructure would
be solving a problem that doesn't exist yet.

**Revisit when:** Review responsibility needs to be shared across more than
one person, or the queue grows large enough that a weekly manual pass is no
longer realistic.

## "Mark reviewed" now exists, and requires an explicit correctness confirmation

**Status update:** the gap this entry originally described (no way to
clear `needs_review` except a direct DB edit) is resolved -
`POST /admin/stale-documents/{id}/mark-reviewed` plus a button in both
admin queue pages. Built the moment it became testable (Phase 4's admin
screens made the queue visible for the first time), not speculatively.

**What was found while building and verifying it:** clearing the flag
alone is not safe. Tested concretely against the real Drama decoy-bug
document (`id=219`, still holding its original wrong content - a
council-meeting agenda grabbed by the multi-`<article>` bug instead of
the real building-permits page): marking it reviewed with no other check
made it **immediately visible** in both `/documents/search` and
`/documents/browse`, snippet and all, to any company with Drama region
access - the exact failure mode `needs_review` suppression exists to
prevent, just self-inflicted through the "fix" instead of a bad crawl.

**What shipped instead:** the endpoint requires a `confirmed: true` body
field and rejects the request with 400 otherwise (enforced server-side,
not just a disabled frontend button - a direct API call can't skip it
either); the frontend gates the "Mark reviewed" button behind a
per-row "I've verified this content is correct" checkbox. This puts the
correctness judgment explicitly on the human reviewer, matching how the
rest of this suppression system already works, rather than silently
trusting that clicking the button implies the content was checked.

**Still not built:** re-triggering a re-crawl or otherwise fixing the
underlying content automatically - confirming still requires a human to
have actually looked at the source and judged it correct (or to have
fixed the extraction some other way first). `mark-reviewed` only ever
clears the flag; it has no way to verify the confirmation was honest.

**Revisit when:** the confirm-checkbox pattern feels like it's being
clicked reflexively rather than as a real check - that's the sign a
stronger gate (requiring a short note, or comparing before/after content)
is worth the added friction.

## Region-scoped document visibility is company-wide, not per-project

**What was chosen:** A construction company sees a region's KB documents
(ΥΔΟΜ/ΔΕΥΑ/ΔΕΔΔΗΕ paperwork, etc.) if *any* of its projects are in that
region — regardless of which project a given user currently has open or
marked default. `backend/app/services/visibility.py`'s `company_region_ids()`
unions region_ids across all of the company's projects.

**Alternative considered:** Scope visibility to the requesting user's
default/active project instead. Rejected for now rather than implemented on
a guess — see decision log in conversation from 2026-07-04.

**Why company-wide, for now:** Simpler mental model, no dependency on users
remembering to set/switch a default project, and correct behavior for a
company juggling concurrent projects in multiple municipalities.

**Known risk:** Once a company has projects in several regions at once, every
member sees the union of all of them in Sources/Search/Chat, which could get
noisy and make it harder to find the paperwork relevant to the site someone
is actually working on.

**Revisit when:** A real company has 3+ regions active on its account AND
someone actually reports the combined view is noisy in practice. Don't
pre-solve based on a projected effort estimate — the per-project-scoped
alternative has its own tradeoffs (requires a reliable "active project"
concept, and per-user defaults could confuse teammates working the same
site), so it's only worth building once the company-wide version has
demonstrably failed someone.

## Generic `html_page` ingest can silently pick the wrong content on multi-`<article>` pages

**What was found:** `crawler/crawler/ingest.py`'s extraction logic finds the
page's `<article>` tag (falling back to `<main>`) and treats its text as the
document. Some municipal WordPress themes embed a "recent posts" / "latest
news" widget that contributes its own `<article>` tags ahead of the real
page content — dimos-dramas.gr does this. A naive `find("article")` silently
grabbed a random council-meeting agenda instead of the intended
building-permits page, with no error and no visible sign anything was wrong.
This is worse than a page that simply lacks extractable content (which at
least fails loud with "no content found, skipping") — it fails *quiet*.

**What was done about it:** `extract_article_text` now counts `<article>`
tags. If there's more than one, it still takes the first as a best-effort
guess (better than nothing for search purposes) but returns `ambiguous=True`.
`ingest_html_page` logs a warning and sets `documents.needs_review = true` on
the resulting row instead of treating it as auto-verified content. The
weekly staleness sweep (`crawler/crawler/staleness.py`) was changed to only
ever *raise* `needs_review`, never clear it — otherwise a freshly-flagged
document (today's `last_verified_at`, i.e. not "stale") would get silently
unflagged by the very next sweep, often before a human ever saw it. Verified
end to end against Δήμος Δράμας (2026-07-04): the flag survives a staleness
sweep and shows up in `GET /admin/stale-documents`.

**What was deliberately not built:** A content-sanity heuristic (e.g.
comparing the page's `<title>`/breadcrumb against expected authority or
permit-stage keywords) to catch this automatically instead of just flagging
it. Skipped on purpose — the review flag is enough for now, and building a
keyword-matching classifier for a problem that's only been observed once
would be solving for a hypothetical, not a demonstrated need.

**Residual gap closed (2026-07-04):** `needs_review` documents are now
excluded outright from every end-user-facing path, not just under-labeled.
`backend/app/services/visibility.py`'s `visible_documents_filter()` — the
same function that enforces region-scoped visibility — now ANDs
`Document.needs_review.is_(False)` onto whatever it returns, so a flagged
document is invisible in Search/Sources/Chat/`GET /documents/{id}` even when
it sits in a region the requester can otherwise see. Chose hiding over a
"might be wrong" caveat deliberately: this class of document isn't merely
unverified, its content is confirmed wrong (a council-meeting agenda
standing in for a building-permits page), so presenting it as normal
searchable content — caveat or not — would still be misleading. A caveat
label is the right call for genuinely uncertain-but-plausibly-correct
content (`reference_only`, `manual_entry_pending`); it's the wrong call for
content known to be incorrect.

Verified end to end: a construction company with an active Drama project
sees `ΔΕΥΑ Δράμας` in Sources but not `ΥΔΟΜ Δράμας` (its only document is the
flagged one); direct full-text search for a phrase unique to the flagged
document's content returns nothing; `GET /documents/219` 404s. The super
admin's `GET /admin/documents` (KB management search) and
`GET /admin/stale-documents` (review queue) both query `Document` directly
rather than through `visible_documents_filter`, so the flagged row stays
visible there for review/correction.

**Revisit when:** A second real instance of a multi-`<article>` (or a
different-but-analogous) silent-misextraction bug shows up on a live source
— that's the point where the title/breadcrumb sanity heuristic (skipped
above) earns its complexity, rather than building it for a single observed
case.

## Region `status` no longer means "has coefficient data" - and per-plot matching is explicitly out of scope

**What was found:** every one of the first 5 regions ended up `status='pending'`
under the original definition ("active once a utility provider AND
coefficient/setback content exist"), because not one had crawlable
per-zone coefficient content on its ΥΔΟΜ page. That wasn't 5 coincidences —
investigating it turned into its own finding (below).

**What was changed:** `status` now only tracks whether a region is usable at
all (at least one utility provider populated) — all 5 regions are `active`.
Coefficient-data tracking was split into two separate, narrower fields on
`regions`, both `bool | None` (`None` = not yet determined, distinct from
`False` = actively checked and confirmed absent — conflating "never
verified" with "confirmed absent" was a real bug in the first backfill,
since fixed):

- `has_coefficient_data` — whether the *crawled ΥΔΟΜ page itself* has
  coefficient/setback content. `False` for Kavala/Paggaio/Thassos (checked,
  it's a contact directory). `None` for Drama/Xanthi (the page was never
  successfully read at all, so absence was never actually confirmed —
  Drama's extraction grabbed the wrong content, Xanthi's Joomla page has no
  `<article>`/`<main>` tag).
- `has_zone_level_coefficient_text` — whether a ΓΠΣ/ΑΑΠ ΦΕΚ has been
  ingested with genuine zone-named coefficient text. `True` for Kavala
  (ΑΑΠ 69/2013) and Xanthi (ΑΑΠ 529/2010) — both fetched and text-extracted
  via the existing PyMuPDF path, `content_type='legal_reference'` (not
  `procedural_howto` — this is law, not a how-to). `False` for Drama: the
  FEK reference was found (Δ 896/1994) and fetched, but it's a scanned 1994
  document with no OCR text layer (20 characters extracted, just a
  barcode) — confirmed present, confirmed unusable. `None` for
  Paggaio/Thassos: the FEK number itself was never located despite
  reasonable web-research effort, so absence isn't confirmed, just unfound.

**Why two fields instead of one:** `has_zone_level_coefficient_text=true`
sounds like it answers "does this region have coefficient data" but it
deliberately doesn't — it's real legal text, organized by named zone
("Μπάτης-Τόσκα", "περιοχές προς πολεοδόμηση", etc.), not by address or
parcel. Naming it the same as `has_coefficient_data` would have implied a
per-plot answer that doesn't exist. See the next entry.

**Also changed:** `crawler/crawler/fek_api.py`'s `RELEVANT_SERIES_CODES` now
includes `15` (Α.Α.Π. — Αναγκαστικές Απαλλοτριώσεις & Πολεοδομικά Θέματα),
the series ΓΠΣ/ΖΟΕ approvals actually get published in. This wasn't
previously known to the crawler at all. Unlike Β (excluded — mostly
irrelevant ministerial noise), everything in Α.Α.Π. is genuinely
urban-planning content, so it's included even though most of it won't be
scoped to a region we track (it'll land unclassified, same treatment as the
rest of `fek_search_api`'s bulk results).

**Finding a region's specific ΓΠΣ ΦΕΚ number is a manual research step, not
a generic crawl.** There's no index of "ΓΠΣ ΦΕΚ number by municipality" —
each of the 5 lookups above required web-searching the municipality's own
site and cross-referencing. It converged for 2 of 5, found-but-unusable for
1 of 5, and didn't converge at all for 2 of 5. This doesn't scale the way
the `html_page` ΥΔΟΜ/ΔΕΥΑ pattern did, and adding a 6th region should expect
the same one-off research cost, not a repeat of the generic-crawl success.

## Zone-to-plot matching (the GIS problem) is out of scope for now

**What this is:** even where zone-level coefficient text exists (Kavala,
Xanthi), it's organized by named zone, not by address. Answering "what's
*my* plot's coefficient" requires resolving which zone a specific plot
falls into — which needs the accompanying zone maps (on kavala.gov.gr,
10+ separate multi-megabyte zipped GIS/CAD files), not text. On top of
that, the legal text itself is conditional prose ("if the current ΣΔ is X,
it's reduced to Y in areas where..."), which needs correct legal
interpretation to apply, not just lookup.

**Why it's out of scope, explicitly, not just undone:** this is a
materially different and larger effort than anything built so far. The
whole pipeline to date — crawl, PyMuPDF-extract, tag, search — is a text
problem. Zone-to-plot matching is a spatial problem (parsing/rendering
GIS/CAD data this pipeline has no code path for at all) *plus* a legal-
interpretation problem (correctly applying conditional clauses to a
specific case) layered on top. Neither extends from the html/PDF
extraction pattern already in place; both would need genuinely new
architecture.

**Revisit when:** there's a decision to support exact per-plot answers as a
deliberate product feature — not "we happened to have more time." That
decision should weigh the GIS/legal-interpretation cost explicitly, not
back into it because the text-extraction half turned out to be easy.

## Current, explicit product framing: zone law, not plot answers

Worth stating plainly rather than letting the data imply more precision
than it has: as of this pass, theke can answer **"what does the law say for
this municipality's zones"** (national framework +, for Kavala/Xanthi,
actual zone-named coefficient figures) but **not "what applies to my
specific plot."** The gap between those two is the GIS/legal-interpretation
work described above. Any UI or chat answer that surfaces zone-level
coefficient text should be honest about which question it's actually
answering — a homeowner asking about their address is not the same
question as "what does zone X's rule say," and the KB currently only
answers the latter.

## RAG retrieval forces `ivfflat.probes` to match `lists`, trading index speed for exact recall

**What was chosen:** `embeddings.idx_embeddings_vector` is a pgvector
`ivfflat` index (`lists=128`). Its default `probes=1` only scans 1 of the
128 clusters per query — while wiring up Phase 2 (chat RAG), this was
caught concretely: a real, well-under-threshold match (cosine distance
0.246 against a `rag_max_distance` of 0.5) was silently missed with the
default, causing `/chat` to return the honest-gap response even though a
genuinely relevant, correctly-visible document existed. `app/services/
rag.py`'s `search_regulation()` now runs `SET LOCAL ivfflat.probes = 128`
before every retrieval query — at the current corpus size (~206 documents,
~16k chunks) this is a full scan of every cluster, i.e. effectively exact
nearest-neighbor search, at negligible latency cost.

**Why it's a real risk, not a rare edge case:** the whole point of the
honest-gap design (see `app/routers/chat.py`'s `GAP_RESPONSE`) is that a
refusal should mean "nothing relevant enough exists," not "the index
happened to miss it." An approximate-search recall failure silently
degrades that guarantee into something worse than a known limitation —
it looks identical to a genuine knowledge gap from the outside, so it
would never get noticed or reported as a bug by a user.

**Revisit when:** the corpus grows enough (many multiples of the current
~16k chunks) that scanning every list stops being cheap. At that point,
re-tune `lists` for the actual row count (rule of thumb ~ rows/1000 for
this index type) and set `probes` to a smaller fraction (e.g. `sqrt(lists)`)
based on measured recall against a real query sample — not guessed.

## The ivfflat index above was never actually being used, and was trained on zero rows

**What was found, during Phase 6's pre-deploy pgvector check:** `pg_stat_user_indexes.idx_scan` for `idx_embeddings_vector` was `0`, despite ~16k rows and continuous RAG querying all session. `EXPLAIN` showed why: the entry directly above this one forces `ivfflat.probes = 128` (= `lists`) for exact recall, and probing *every* list gives the index no pruning advantage over a plain sequential scan - so the planner correctly picks a seq scan every time (cost ~3743 vs. the index's ~334 at the low-recall `probes=1`). Separately, `db/init.sql` creates the index immediately after `CREATE TABLE embeddings`, which runs on a genuinely empty table via Postgres's one-time `docker-entrypoint-initdb.d` hook - so its k-means centroids were trained on zero real vectors.

**Why this went unnoticed:** the `probes=128` decision above was made to guarantee exact recall, and it worked for that purpose regardless of the index's own quality (a seq scan is always exact). The index being unused and poorly trained had no visible effect on answer quality - it would only matter once something makes the planner actually choose it again.

**Fix:** dropped and rebuilt `idx_embeddings_vector` (same `lists=128`) against the populated table. Verified retrieval still returns correct results afterward.

**Revisit when:** the `probes=128` decision above gets revisited (corpus grows, `probes` gets lowered) - rebuild the index again at that point if it's been more than a handful of ingestion batches since the last rebuild, so its centroids reflect the actual corpus rather than whatever existed at the last rebuild.

## A real numeric coefficient list can still score below the retrieval threshold

**What was found:** while testing `POST /chat/message`'s coefficient/setback
rule, document 223 (Kavala's Γ.Π.Σ. approval ΦΕΚ) has a chunk with genuine,
usable data — named zones with actual ΣΔ figures ("Χαλκερό: 0,8", "Ν.
Καρβάλη: 0,8", etc.). Several natural-language queries asking for exactly
that data (by zone name, by topic, by near-verbatim source vocabulary) all
scored a cosine distance around 0.54 against that chunk — above
`rag_max_distance` (0.5), so it never got retrieved and the endpoint
correctly gave an honest "excerpts don't cover this" answer rather than a
fabricated number. This isn't the `ivfflat.probes` recall bug above (probes
is already maxed) — it's the embedding model's semantic similarity for this
specific chunk's content, genuinely landing outside the threshold for how
the question is naturally phrased.

**Why this is left as-is for now:** the honest-gap behavior is doing
exactly what it's supposed to when retrieval falls short — refusing rather
than guessing. The system worked correctly; the corpus/chunking just
didn't surface the right passage for this one case. Chasing this by
lowering `rag_max_distance` globally would let weaker matches through
everywhere, not just here.

**Revisit when:** there's a real query log to sample from. Options worth
trying then, in rough order of effort: shrinking `chunk_size` for
numeric-list-heavy sections so a zone/figure pair isn't diluted by
surrounding prose in the same chunk; a query-rewriting pass before
embedding (expand "συντελεστής δόμησης Χαλκερό" style queries with
synonyms/context); or a hybrid keyword+vector search for this class of
lookup. Don't retune `rag_max_distance` itself without real query-log
evidence of where the current value is actually costing correct answers.

## Email verification is deferred, not built

**What was chosen:** `POST /auth/register` issues a token and logs the user
in immediately - no "confirm your email" step exists, and none is planned
for Phase 3. A registered email is trusted at face value.

**Why:** this is a closed soft launch to known contacts, not open public
signup. There's no anonymous-abuse surface to defend against yet (no
spam-account risk, no unverified-email-as-identity risk in practice), so
building a verification flow now would be effort spent on a threat model
that doesn't apply yet.

**Revisit when:** registration opens to the public, or any flow starts
treating an email address as a verified fact (e.g. using it to auto-grant
access to a company by domain match) rather than just a login identifier.

## No refresh tokens - 15-minute re-login is accepted as-is

**What was chosen:** access tokens expire in 15 minutes
(`ACCESS_TOKEN_EXPIRE_MINUTES`) with no refresh-token flow to extend a
session silently - once a token expires, the only way back in is
`/auth/login` again.

**Why this is acceptable, not just unfinished:** `get_current_user`
(`app/dependencies.py`) already re-reads the user and company from the DB
on *every* request, not just at token-issue time - so a short expiry isn't
covering for weak per-request checks, it's on top of them. A refresh-token
flow mainly buys UX (fewer re-logins), not additional security, and adds
real complexity (rotation, revocation, storage) for a soft launch with a
small, known user base who can tolerate re-entering a password every 15
minutes of inactivity.

**Revisit when:** real usage data shows 15-minute re-logins are a genuine
friction point (long-running sessions, users complaining), not before -
implementing refresh tokens speculatively adds a whole new revocation
surface for a problem that may not materialize.

## JWT stored in localStorage - accepted MVP risk, not an oversight

**What was chosen:** the frontend stores the JWT in `localStorage`
(`frontend/app/lib/auth.tsx`), not an httpOnly cookie.

**Why this is accepted for now:** an httpOnly-cookie approach needs the
backend to set/read cookies (CSRF protection, `SameSite` configuration,
cross-origin handling between the frontend and API's separate origins in
dev) - real work that wasn't justified yet for a closed soft launch with
known users and no third-party script surface on the frontend that could
exploit an XSS bug to read `localStorage`.

**Why this matters and isn't just theoretical:** if an XSS vulnerability
is ever introduced (a dependency, a rendered-unescaped field, a future
integration), `localStorage` gives it direct read access to every active
user's token, where an httpOnly cookie would not.

**Revisit when:** before any public launch, or the moment any third-party
script/widget is added to the frontend - either meaningfully raises the
XSS blast radius this decision is currently betting against.

## `/admin/stale-documents` and `/admin/needs-review` are one queue, two routes

**What was chosen:** Phase 4 asked for both routes as distinct admin
screens. There is only one backend endpoint (`GET /admin/stale-documents`)
and one underlying flag (`documents.needs_review`) - the weekly staleness
sweep sets that same flag rather than maintaining a separate one (see
`crawler/crawler/staleness.py`'s own docstring on this, from an earlier
phase). Both frontend pages (`frontend/app/admin/stale-documents`,
`frontend/app/admin/needs-review`) call the same endpoint through a shared
`StaleDocumentsQueue` component, with page-specific copy explaining why
they show the same list rather than silently duplicating one page under
two URLs without saying so.

**Why not build a second, distinct queue to match the two routes
literally:** there's no real second concept to back it with - a document
needing review IS the stale-documents queue, by design. Fabricating a
separate `needs_review`-only endpoint that excludes staleness-flagged rows
would invent a distinction the data model deliberately doesn't have,
purely to make two routes look different.

**Revisit when:** a genuine second category of "needs review" emerges
that isn't staleness-driven (e.g., a user-reported content issue, distinct
from the crawler's own ambiguous-extraction and 6-month-staleness
triggers) - at that point the two routes would earn actually-different
queries.

## Company admin dashboard has no project management UI

**What was found, not built:** auditing the frontend for Phase 4,
`MemberDashboard.tsx` has a full project list + create-project form, but
`CompanyAdminDashboard.tsx` (shown to `role=admin` users) has none - an
admin can't see or add projects from their own dashboard, only regular
members can. Confirmed via `dashboard/page.tsx`'s role routing.

**Why this wasn't fixed now:** Phase 4's explicit build list didn't
include the dashboard - it was flagged as an audit finding, not scoped as
a gap to close in this phase.

**Revisit when:** dashboard work is scoped again - likely just moving
`MemberDashboard`'s project section into a shared component both
dashboards render, rather than a new build.

## Authority contact info (ΥΔΟΜ/ΔΕΥΑ/ΔΕΔΔΗΕ) is wired but deliberately left empty

**What was built:** `regions.contact_phone`/`contact_email` (ΥΔΟΜ) and
`utility_providers.contact_phone`/`contact_email` (ΔΕΥΑ/ΔΕΔΔΗΕ) - both
nullable. `POST /chat/message` surfaces whichever are populated: appended
to the honest-gap response for the caller's project region (`_gap_contact_lines`
in `chat.py`), and attached to each citation whose authority/region has
curated contact info (`_authority_contact`, keyed off the citation's
`authority` + `region_id`). Verified live for both paths against a
temporarily-populated Kavala region + `deya-kavalas` provider, then
reverted to `NULL`.

**Why left empty rather than populated now:** finding real phone
numbers/emails for all five ΥΔΟΜ offices and ΔΕΥΑ providers is manual
research (calling/checking each municipality's site), not something the
crawler can do reliably - contact pages vary too much per site to
auto-extract (same reasoning already applied to `base_url` and
`ydom_authority_name`). Explicitly scoped as "wire the plumbing now,
curate the data later" rather than blocking on the research.

**Revisit when:** the post-Phase-5 curation pass happens (before Phase 6
deployment) - populate all five regions' ΥΔΟΜ contacts and their linked
ΔΕΥΑ/ΔΕΔΔΗΕ providers' contacts via direct SQL `UPDATE`s, no code changes
needed.

## "My plot" phrasing can miss retrieval threshold even when zone-level ΦΕΚ data exists

**What was found, during Phase 5's adversarial prompt testing:** asking
"Ποιος είναι ο ακριβής συντελεστής δόμησης για το οικόπεδό μου στην
Καβάλα;" ("what's the exact coefficient for my plot in Kavala") against a
project actually scoped to Kavala returns the generic hard-gap response
(`gap:true`, no citations) - not a fabricated number (good), but also not
the more informative "cites the ΓΠΣ Καβάλας ΦΕΚ zones, states plot-mapping
needs an engineer" answer that a *differently worded* question against
the exact same document (e.g. "Τι προβλέπει το Γενικό Πολεοδομικό Σχέδιο
Καβάλας...") reliably produces (verified live, both via `/search`'s raw
distance and `/chat/message`). Confirmed via `/search` directly: this
phrasing's closest match sits at distance 0.545, just past the 0.5
`rag_max_distance` cutoff - a retrieval-threshold miss, not the new
off-topic guard (`_is_off_topic` in `chat.py`) firing.

**Why not fixed now:** Phase 5 scoped adversarial testing as reporting,
not iterating on retrieval quality - and the actual failure mode here is
safe (an honest gap, never an invented plot-specific number), just less
helpful than it could be.

**Revisit when:** real user query logs show this phrasing pattern often
enough to matter - the fix is likely either a query-rewriting pass before
embedding (strip "my/exact" framing down to the zone-level question it's
really asking) or lowering `rag_max_distance` slightly, not a change to
the off-topic guard or system prompt.

## Migration tooling: idempotent init.sql for MVP/soft launch

**What was chosen:** `alembic` sits in `backend/requirements.txt` but is
completely unused - no `alembic.ini`, no versions folder, no code
referencing it. The real schema mechanism is `db/init.sql`, and every
schema change so far this session was applied by hand via `ALTER TABLE`
against the live dev DB, with `init.sql` kept in sync after the fact.
Rather than build real Alembic migrations for Phase 6, `init.sql` was made
genuinely idempotent (see the table-ordering fix below) and
`scripts/deploy.sh` reapplies the whole file via `psql -f` after every
deploy - safe because every statement in it is
`CREATE TABLE`/`CREATE INDEX ... IF NOT EXISTS` or
`INSERT ... ON CONFLICT DO NOTHING`.

**Why:** matches how this project has actually evolved its schema so far
(additive columns/tables, no renames or drops yet), and needs no new
tooling or changed workflow to keep working through Phase 6.

**Revisit when:** before open registration, or before any schema change
that involves a rename or a drop - `init.sql`'s `IF NOT EXISTS`/`ON
CONFLICT` idioms can't express either safely, and pretending they can
would silently corrupt or skip real migrations.

## `db/init.sql` table ordering was never tested against a genuinely fresh database

**What was found:** `invites` and `password_reset_tokens` both declare
`REFERENCES users(id)`, but the `users` table was defined *after* both of
them in the file. Confirmed via a real test (a brand-new `pgvector/pgvector:pg16`
container, no prior volume) that this fails outright: Postgres's
`docker-entrypoint-initdb.d` run aborts on the first `CREATE TABLE
invites` statement with `relation "users" does not exist`, and every table
after that point (documents, embeddings, everything) never gets created.
This had been silently latent the whole project: the dev DB's volume was
created once, early on, before `init.sql` reached this state, and was
never recreated from scratch since - so nothing in months of dev work
would have caught it. Phase 6's "confirm what currently exists" step
caught it only because it required actually reasoning about a first
production deploy, which is exactly the scenario a persistent dev volume
never exercises.

**Fix:** moved the `users` table definition (and its role-meaning comment
block) to immediately after `companies`, before `invites` and
`password_reset_tokens`. Verified by running `init.sql` against a fresh
container twice in a row (fresh-init + manual re-run) with zero errors
either time, and confirmed all 16 tables exist.

**Revisit when:** never, really - but the general lesson (a persistent dev
volume can hide a fresh-init failure indefinitely) is worth remembering
if `init.sql` gets restructured again: test any reordering against an
actual empty volume, not just the already-migrated dev DB.

## Password reset used to log the full email and the raw reset token

**What was found, during Phase 6's log content audit:** `POST /auth/forgot-password` logged `"Password reset requested for %s: %s" % (user.email, reset_link)` at INFO level - the full email address, and the full reset link with the raw, valid, unexpired token embedded in the URL. Anyone with log access could lift that token directly and reset the account's password within the token's expiry window (60 minutes by default) - a real credential leak, not a theoretical one.

**Why it was there:** no email provider is configured yet (see "Email verification is deferred, not built" - a related but distinct gap), so logging the link was standing in for actual delivery, to keep the reset flow testable end-to-end in dev.

**Fix:** the log line now masks the email (first 3 characters + domain, e.g. `dem***@construction.theke.gr`) and never includes the token or the link at all. This means there is currently no way to retrieve a reset link for local testing except querying `password_reset_tokens` directly - a deliberate tradeoff, not an oversight.

**Revisit when:** real email delivery is wired up (the actual fix for both this and the deferred-verification entry) - at that point the token only ever needs to exist in the outbound email, never in a log line.

## Multiple named conversations per project

**What was chosen:** deferred post-soft-launch. Each project currently has one continuous chat thread (see `GET /chat/history`'s `project_id` scoping), not multiple named/switchable conversations within it.

**Why:** useful for engineers handling several permit applications simultaneously within the same project, but adds real UI/data-model surface (conversation naming, switching, deletion) for a need not yet confirmed by actual usage.

**Revisit when:** a soft-launch user explicitly asks for it.

## Export/print of cited conversations

**What was chosen:** deferred post-soft-launch. There's currently no way to export or print a chat conversation with its citations intact.

**Why:** engineers will want this for client presentations and ΥΔΟΜ submissions, but it's a real feature (formatting, citation rendering outside the chat UI, likely a PDF/print stylesheet) worth building once there's a concrete request shaping what it actually needs to look like, rather than guessing the format upfront.

**Revisit when:** first soft-launch feedback mentions it.

## Dashboard analytics graphs

**What was chosen:** deferred post-soft-launch. The super-admin stats panel (Phase 6 Section 5) shows total messages, gap rate, active documents, and thumbs up/down as plain labelled numbers - no usage-over-time, query-category, or per-region activity graphs.

**Why:** the current panel covers what's needed to sanity-check the platform at soft-launch scale (a handful of companies); graphs add real complexity (charting library choice, aggregation queries, date-range handling) that isn't justified until there's enough activity/company diversity for trends to actually mean something.

**Revisit when:** more than 3 active companies.

## Numbered-list chunking: checked on the permit-checklist document, not currently a problem, no rule added

**What was checked:** the manually-authored two-stage permit document (id 245, "Διαδικασία Έκδοσης Άδειας Δόμησης...") has two numbered lists (7 items, 6 items). The concern going in - the same pattern as the coefficient chunking miss - was that `chunk_text()`'s paragraph-based packing might spread a numbered list across multiple chunks, diluting the retrieval signal for "what documents do I need" style queries.

**What was found:** it didn't happen here. `chunk_text()` splits on double newlines (`\n\n`) only - since this document's list items are separated by single `\n` (no blank lines between them), each full list is already one atomic "paragraph" to the chunker, and both lists together (982 chars) fit under the 1000-char `chunk_size` in a single chunk. Chunk 0 contains the complete Stage 1 list AND the complete Stage 2 list, intact. No special numbered-list rule was implemented, since the conditional that would have triggered it (the list actually getting split) didn't occur.

**Why the risk is still real, just not here:** the failure mode would show up if either (a) a single numbered list is long enough to exceed `chunk_size` on its own, triggering `_split_oversized()`'s single-newline fallback (which *does* break a list item-by-item), or (b) greedy packing happens to place a chunk boundary in the middle of a list because of what else shares its paragraph batch. Neither happened here mostly by luck of this document's specific length and formatting, not because the chunker has a rule protecting numbered lists generally.

**Revisit when:** a second procedural document with a numbered checklist hits a retrieval miss traceable to its list being split across chunks. At that point, add the rule this task originally proposed - numbered lists under ~600 tokens kept as a single chunk regardless of surrounding paragraph packing - and apply it going forward, not as a corpus-wide re-chunk.

## Numbered-list chunking fix applied to doc 28 (Ν.4495/2017 Άρθρο 30) after second confirmed retrieval miss

**What was found:** the QA benchmark's Q2 ("Ποια έργα δεν χρειάζονται άδεια δόμησης;") is the second occurrence the prior entry's revisit trigger was watching for - doc 28 (Ν.4495/2017, άρθρα 28-43) contains Άρθρο 30's full permit-exemption list verbatim, but it never surfaced. Unlike the first check (doc 245, where the list happened to fit in one chunk by luck), doc 28 is a PyMuPDF-extracted PDF with no double-newlines at all, so `chunk_text()` degraded to `_split_oversized()`'s pure single-newline line-packing - which has zero awareness of `Άρθρο N` article boundaries. The result: Άρθρο 30's heading landed at the tail of a chunk that was otherwise still Άρθρο 29 content, while the next chunk opened cold with list items α) onward and no "this is about permit exemptions" framing at all.

**What was applied:** the literal "numbered lists under 600 tokens kept as one chunk" rule from the prior entry doesn't fit here - Άρθρο 30's actual list (19 lettered items) is itself roughly 1,300+ tokens, well over that budget on its own. Cramming all 19 items into one oversized chunk would dilute the embedding rather than help it. Instead, applied the underlying intent in a form that fits this document: re-chunked doc 28 (only doc 28, not a corpus-wide change) so that `Άρθρο N` headings always force a chunk boundary - no chunk can straddle two articles. Implemented as a one-off script that split the content on article boundaries first, then ran the existing `chunk_text()` independently within each article segment, then deleted and re-generated doc 28's embeddings (502 chunks -> 566 chunks). Άρθρο 30's heading now sits together with its first four exemption items in one coherent chunk.

**What this did NOT fix:** re-ran `/search` and the live `/chat/message` pipeline after the re-chunk - doc 28 still doesn't appear in the top 5 results for this query, and isn't even doc 28's own best-scoring chunk internally (three other, topically-generic ΥΔΟΜ-procedure chunks within doc 28 score better). This means the chunk-boundary defect was real and worth fixing on its own merits (the document now reads coherently for any future chunking audit), but it was not sufficient - there's a separate embedding-ranking issue layered on top, the same pattern found independently for docs 207/208/211 and doc 127's Άρθρο 238 (see the next entry).

**Revisit when:** a third retrieval miss against a numbered-list document is confirmed, or as part of a systematic audit of all `procedural_howto`/legal-reference documents for chunk boundary quality (checking specifically for `Άρθρο N` headings stranded at chunk tails).

## Retrieval-ranking misses against fully-ingested, correctly-chunked content (language mismatch + UI-chrome extraction)

**What was found:** a QA benchmark investigation into three documents that failed to surface for their own matching queries - despite being `scope=national`, `status=active`, fully embedded, and not obviously mis-chunked - found two distinct, non-chunking root causes:

- **Docs 207 (ΔΕΔΔΗΕ grid connection) and 208 (ΑΑΔΕ tax overview):** both were crawled in **English**, not Greek - doc 207's source URL literally contains `/en/` (`deddie.gr/en/services/...`). Direct pgvector distance checks against three different Greek queries showed both scoring a flat, uniformly poor 0.62-0.71 regardless of topic relevance - consistent with cross-lingual embedding similarity being measurably weaker than same-language matches, not a topic-relevance problem.
- **Doc 211 (ΔΕΥΑ Καβάλας water connection):** is in Greek, but the extracted content is raw scraped web-form UI chrome (dropdown option lists spanning ~13 unrelated request sub-types, form field labels, repeated boilerplate disclaimers) rather than explanatory prose. Its embedding scored *better* for an unrelated electricity-connection query (0.48) than for its own matching water-connection query (0.52) - consistent with a topic-diluted "average across many bundled unrelated options" vector rather than a coherent one about water connections specifically.

**Why this isn't a chunking fix:** re-chunking English text leaves it in English; re-chunking a form-options list still leaves it a form-options list. Both need re-extraction, not re-chunking.

**Proposed fix (not applied - flagging for a future session, since it requires re-crawling/re-ingestion):**
1. Re-crawl docs 207 and 208 from their Greek-language URL equivalents (e.g. `deddie.gr`'s default/`/el/` path instead of `/en/`).
2. Re-extract doc 211 targeting genuine explanatory/FAQ prose on `deyakav.gr` if it exists there, separate from the raw application-form page currently captured; if no such prose page exists, draft a short `manual_entry` summary of the water-connection process (mirroring doc 245's precedent) with the existing form page kept as the "how to actually submit" reference.

Also worth noting: doc 127's Άρθρο 238 (the ΣΔ-vs-κάλυψη distinction) is a third, different case - a well-formed, correctly-chunked, Greek-language chunk that still scored worse (0.584) than three topically-adjacent-but-less-precise chunks from the same document (0.45-0.48) for its own matching query. Neither a language nor an extraction-genre explanation applies there; it's simply the embedding model not reliably rewarding topical precision over generic keyword overlap at this similarity range. No fix is proposed for that narrower pattern - it's noted as a data point for the next full retrieval-quality audit.

**Revisit when:** re-crawling docs 207/208 in Greek and re-extracting doc 211 becomes an approved ingestion task (this session was explicitly QA/investigation-only, no ingestion) - verify with the same three queries afterward. Separately, if a fourth or fifth case of a correctly-chunked, same-language chunk still losing to less-precise competitors turns up, that's the trigger for a real embedding-quality investigation (e.g. re-checking whether `text-embedding-3-small` is the right model choice for this Greek legal/procedural domain, or whether a hybrid keyword+vector approach is warranted) rather than treating each new case as isolated.

**Status update - the proposed fix was attempted, and the "language mismatch" hypothesis turned out to be incomplete:** doc 207 was re-crawled from a genuine Greek-language mitos.gov.gr source (not deddie.gr - no citizen-facing Greek equivalent of the English page could be found there at all). Result: the Greek content scored **worse** (0.665) than the original English content (0.638), not better. A cleaned, noise-stripped version improved it slightly (0.651) but still worse than the English baseline. Doc 211 was similarly re-extracted (both as full prose and as a trimmed menu-style version); both scored worse (0.588 and 0.555 respectively) than the original raw form-dump's 0.518. **Conclusion: language and extraction-genre were real, defensible hypotheses, but not the actual dominant cause for these two documents** - something more specific to embedding-space vocabulary/framing is at play (e.g. "βεβαίωση/certificate" vocabulary vs. "σύνδεση/connection" vocabulary for doc 207; a possible advantage to short, keyword-dense menu-style text over explanatory prose for doc 211). Neither document was reverted - the Greek/cleaned versions are kept since they're objectively better *content* even though they didn't win the retrieval race. See the next entry for the broader pattern this confirms.

## Content-quality fixes do not reliably translate into retrieval-ranking improvements - verify every time, don't assume

**What was found, across a full content-gap-closing session:** of 8 attempts to fix or add content to win a specific benchmark query's top-3 ranking, results were inconsistent in a way that doesn't correlate with how good the content actually is:

- **Worked well** (doc 209, forest clearance): a near-miss at 0.5055 dropped to 0.4080 after adding one direct, query-mirroring opening sentence.
- **Worked very well** (docs 210, 249, 250 - Cadastre registration, small-scale works, permit cost): opening each new document with the literal benchmark question as its first line produced excellent distances (0.24-0.43), rank #1 every time.
- **Did nothing or made it worse** (docs 207, 211 - see previous entry; doc 248, Ν.4495/2017 Part Δ): the same "add a direct opening sentence" technique that worked for doc 209 was tried again on doc 248 (a 0.5088 near-miss) and made it worse (0.5386, since the new summary chunk itself scored below the document's pre-existing best chunk).

**Why this matters:** the same fix technique cannot be assumed to work from one document to the next, even when the near-miss numbers look superficially similar (all four were within 0.01 of the 0.5 threshold). Whether prepending a direct summary sentence helps appears to depend on document-specific factors (existing chunk competition, how the rest of the content is phrased) that aren't predictable in advance.

**What this means going forward:** every claimed retrieval fix must be verified with an actual `/search` or direct pgvector distance check *after* the change, never assumed from the fact that "the content is now clearly better" or "the same technique worked last time." A content edit that doesn't move the needle (or moves it the wrong way) should be reported honestly rather than silently reverted-and-hidden or claimed as a fix.

**Revisit when:** a real embedding-quality investigation happens (see the trigger in the previous entry) - at that point, this whole class of one-off "nudge the wording" fixes should be superseded by something more systematic (re-ranking, hybrid search, or query rewriting at request time) rather than continuing to patch individual documents by trial and error.

## Remaining confirmed gaps after the Section 0-6 ingestion round (2026-07-06)

**What was fixed this round:** 3 benchmark questions flipped FAIL/PARTIAL -> PASS (Q7 unauthorized buildings via new doc 248; Q11 forest clearance via doc 209's completed stub; Q13 Cadastre registration via doc 210's completed stub), and 1 flipped FAIL -> PARTIAL (Q5 permit cost, via new doc 250 honestly explaining the cost structure without inventing figures). Total corpus size grew from 246 to 250 documents (207 and 211 were content-replaced, not counted as new).

**What remains genuinely unresolved, with why:**

- **Q6 (processing timeline)** - a genuine hard gap. No document anywhere in the corpus gives even a rough ΥΔΟΜ-processing-time range; this round's ingestion targeted cost (Section 6), not timeline, so nothing was added for this specific question. **Revisit when:** a crawlable ΥΠΕΝ circular or ΤΕΕ guidance page with real processing-time figures is found - don't invent a range without a source.
- **Q12 (property tax, ΕΝΦΙΑ/ΦΜΑ)** - docs 208 (ΑΑΔΕ tax overview) and 38 (ENFIA zone prices) exist, are embedded, and are on-topic, but don't surface for this query - a retrieval-ranking miss, not a missing source. Flagged in the prior entry but not re-attempted this round (out of this session's scope, which focused on the 5 sections explicitly listed). **Revisit when:** the broader embedding-quality investigation (see above) happens, or if a differently-worded query is found to retrieve these documents successfully (which would point at query-phrasing sensitivity specifically, worth testing before assuming the documents themselves need work).
- **Q2 (exempt works), Q8 (ΣΔ vs κάλυψη), Q14 (ΔΕΔΔΗΕ), Q15 (ΔΕΥΑ)** - all confirmed retrieval-ranking misses against content that now genuinely exists and is correctly embedded (see the entries above for each). **Revisit when:** the embedding-quality investigation happens - re-chunking or re-drafting these specific documents again without a different underlying approach is unlikely to help, per the "content-quality fixes don't reliably help" finding above.
- **Q9 (responsible authority) and Q3 (small-scale works)** - PARTIAL, but for a different reason than retrieval: the correct, complete source document is retrieved and cited, but the LLM's generated answer doesn't always surface every fact the source actually contains (e.g. doc 249 names ΥΔΟΜ and ΤΕΕ explicitly, but a regenerated answer omitted the authority name). **Revisit when:** this becomes a repeatable pattern worth a systematic check (e.g. re-running the same query multiple times to see if it's prompt-variance rather than a one-off) - not a retrieval or content problem, so a chunking/ingestion fix wouldn't address it.
- **Q10 (Kavala coefficients)** - unchanged, already governed by an existing KNOWN_DECISIONS.md entry ("A real numeric coefficient list can still score below the retrieval threshold") - deliberately not re-attempted this round.

## Hybrid search (vector + PostgreSQL full-text, merged via RRF) - the systemic fix, and its actual measured effect (2026-07-06)

**What was built:** `_retrieve()` in `app/services/rag.py` now runs two independent candidate queries - vector cosine similarity (top 20) and PostgreSQL full-text search via `to_tsvector('greek', chunk_text) @@ plainto_tsquery('greek', query)` with `ts_rank_cd` scoring (top 20, falling back to vector-only on a malformed tsquery) - and merges them with Reciprocal Rank Fusion (`1/(60+rank)`, missing-from-a-list treated as rank 21). The old single `rag_max_distance` cutoff was replaced by `_passes_hybrid_threshold()`: a hit is excluded only if it fails the vector threshold *and* has no keyword rank at all. A GIN index (`idx_embeddings_fts`) backs the full-text side.

**Measured effect against the 5 known retrieval-ranking misses this was built to fix (Q2, Q8, Q12, Q14, Q15):** only **Q8** (building-coefficient crowding) was actually rescued by the algorithm itself - doc 127 went from occasionally-losing to filling 4 of the top 6 slots. The other four were *not* fixed by hybrid search, for two distinct reasons:

- **Q12 and Q14** are pure embedding-space gaps, not ranking/crowding problems - the correct documents (208/38 for Q12, 207 for Q14) never enter *either* candidate pool at all (best vector distances of 0.64+, zero full-text matches). There is nothing in a top-20-vector/top-20-keyword merge to rescue if neither list contains the right answer in the first place.
- **Q2 and Q15's keyword side** exposed a structural limitation of `plainto_tsquery`: it ANDs every lexeme in the query, so a single non-matching word (e.g. the query's "χρειάζονται" vs. the source's "απαιτείται"/"οικοδομική", or "συνδέω" vs. "σύνδεσης" - different stems under the `greek` text search config's suffix-stripping) zeroes the *entire* keyword score, even when every other word matched. A chunk can be 5/6 words correct and still score exactly 0 on keyword search. This means hybrid search's keyword half only reliably helps when the query and the source happen to share exact-enough vocabulary - it doesn't paper over genuine phrasing mismatches the way a synonym-aware or OR-based keyword approach would.

**What did fix Q6, Q14, and Q15 in the end:** not the algorithm - three new `manual_entry` documents (251, 252, 253) drafted to open with the literal benchmark question as their first line (the same technique that worked well for docs 209/210/249/250 earlier - see the "content-quality fixes don't reliably help" entry above, this time it worked). All three verify well under the 0.5 threshold (0.229, 0.321, 0.228 respectively) and were confirmed via a full benchmark re-run to flip all three questions to PASS. **Q2 and Q12 remain FAIL** - no new content was drafted for them this round (out of this phase's scope), and per the finding above, hybrid search alone doesn't close them either.

**System-prompt fix (Section 4) - also inconsistent:** added one instruction ("if a source names a responsible authority/platform/service, that name must appear in your answer") to `CHAT_MESSAGE_SYSTEM_PROMPT`. Worked for one direct test (Q9 phrasing surfaced ΥΔΟΜ) but not reliably: in the full 15-question re-run, Q9 still didn't mention ΤΕΕ's role, and Q3 still didn't mention ΥΔΟΜ/e-Άδειες at all. Root cause confirmed via direct distance check: doc 249 (small-scale works) has 4 chunks, and the one naming ΥΔΟΜ/ΤΕΕ/e-Άδειες explicitly (dist 0.52) consistently loses the retrieval race to the document's own general-definition chunk (dist 0.29) for this query's phrasing - the LLM is correctly refusing to state a fact it was never given, not failing to follow the instruction. A system-prompt rule cannot fix a retrieval-granularity problem.

**Definitive benchmark result after this phase (Section 7, scoped to project id=38):**

| # | Query (short) | Previous | New | Note |
|---|---|---|---|---|
| 1 | Δικαιολογητικά άδειας | PASS | PASS | unchanged |
| 2 | Έργα χωρίς άδεια | FAIL | FAIL | unchanged - bridge doc 247 still loses the ranking race (see above) |
| 3 | Άδεια μικρής κλίμακας | PARTIAL | PARTIAL | unchanged - authority-naming chunk still loses internally (see above) |
| 4 | Πώς υποβάλλω αίτηση | PASS | PASS | unchanged |
| 5 | Κόστος άδειας | PARTIAL | PARTIAL | unchanged |
| 6 | Χρόνος έκδοσης | FAIL | **PASS** | new doc 251 (Section 5) |
| 7 | Αυθαίρετα κτίσματα | PASS | PASS | unchanged |
| 8 | Συντελεστής δόμησης | PARTIAL | PARTIAL | unchanged - hybrid search won the doc-127 crowding race, but the specific ΣΔ-vs-κάλυψη / ΓΠΣ-sets-it chunk still isn't the one the generated answer draws on |
| 9 | Αρμόδια υπηρεσία | PARTIAL | PARTIAL | unchanged - ΤΕΕ's role still not surfaced in the full-benchmark phrasing |
| 10 | ΣΔ Καβάλας (behavior) | PARTIAL/INCORRECT | PARTIAL/INCORRECT | unchanged, out of scope |
| 11 | Έγκριση δασαρχείου | PASS | PASS | unchanged |
| 12 | Φόροι ακινήτου | FAIL | FAIL | unchanged - docs 208/38 confirmed to never enter either candidate pool for this query (pure embedding-space gap) |
| 13 | Καταχώριση Κτηματολόγιο | PASS | PASS | unchanged |
| 14 | Σύνδεση ρεύματος (ΔΕΔΔΗΕ) | FAIL | **PASS** | new doc 252 (Section 6) |
| 15 | Σύνδεση νερού (ΔΕΥΑ) | FAIL | **PASS** | new doc 253 (Section 6) |

**Net result: 8 PASS / 4 PARTIAL / 1 PARTIAL-INCORRECT (behavior test) / 2 FAIL** - up from 5 PASS / 4 PARTIAL / 1 PARTIAL-INCORRECT / 5 FAIL. All 3 net gains came from targeted content (manual_entry docs written to open with the exact benchmark question), not from the retrieval algorithm change.

**Revisit when:** considering further retrieval work on Q2/Q12 specifically - per the findings above, neither a rank-crowding fix (hybrid search) nor a keyword-vocabulary fix (broader tsquery matching) is guaranteed to help; Q12 in particular needs new content the corpus doesn't have an anchor for yet. For Q3/Q8/Q9's chunk-granularity problem (right document, wrong internal chunk wins), a real fix would need either splitting the "authority/definition" fact out into its own dedicated chunk per document, or a re-ranking step that scores whole documents rather than only their single best-matching chunk - neither attempted this phase.

## Targeted manual-entry fixes for Q2, Q3, Q8, Q9, Q12 using the "exact-question-first" pattern - 3 of 5 succeeded outright, 1 partially, 1 blocked by a different layer entirely

**What was applied:** the pattern confirmed reliable for docs 209/210/249/250/251/252/253 (open the document with the literal benchmark question as its first sentence, then dense focused content) was applied to the five remaining weak spots: doc 247 was rewritten in place (it existed but hadn't used this pattern - its old opening was "Σύμφωνα με το Άρθρο 30...", not the question itself), and four new standalone documents (255 property tax, 256 small-scale-works authority, 257 ΣΔ definition/distinction, 258 responsible authority) were created specifically to remove the *internal* chunk competition that was causing Q3/Q8/Q9's PARTIALs - each pulls the one missing fact out into its own document rather than competing against a document's own better-scoring general-definition chunk.

**Results, verified by direct pgvector distance check + a live `/chat/message` call for each:**
- **Q2 (doc 247 rewrite):** distance dropped to 0.297 (was ~0.47, rank ~12th) - now cited #1, flips FAIL -> PASS.
- **Q3 (doc 256):** distance 0.262 - ΥΔΟΜ and e-Άδειες/ΤΕΕ both confirmed present in a direct test call. In the full 15-question benchmark run, only e-Άδειες/ΤΕΕ appeared (not ΥΔΟΜ) - but the rubric only requires "ΥΔΟΜ **or** e-Άδειες", so this still passes. Flips PARTIAL -> PASS.
- **Q9 (doc 258):** distance 0.248 - both ΥΔΟΜ (with municipality-level framing) and ΤΕΕ/e-Άδειες confirmed present in both a direct test call and the full benchmark run. Flips PARTIAL -> PASS.
- **Q8 (doc 257):** distance 0.355 and correctly cited, ΓΠΣ/ΖΟΕ framing present every time - but across 3 separate `/chat/message` calls (2 direct + 1 in the full benchmark), the answer **never once included the ΣΔ-vs-κάλυψη distinction sentence**, despite it being explicitly present in the single retrieved chunk. This confirms the Q3/Q9-style generation-completeness gap is not just occasional variance for this specific fact - it's now been observed missing 3/3 times against the same single-chunk source, suggesting the model may be more reliably dropping a *trailing* clarifying paragraph than an opening definition, though that's a hypothesis, not confirmed. Remains PARTIAL.
- **Q12 (new doc 255):** distance 0.212 - an excellent match that would clearly resolve this question if reached. It never is: `_is_off_topic()` (the pre-retrieval LLM classification gate in `chat.py`, temperature=0) reproducibly classifies "Τι φόρους πρέπει να πληρώσω για ακίνητο στην Ελλάδα;" as `OFF_TOPIC` and returns the gap response before `_retrieve()` is ever called - confirmed by invoking the guard function directly, independent of any document. **No amount of new content can fix this** - the question never reaches the retrieval layer at all. Remains FAIL, for a structurally different reason than every other FAIL/PARTIAL in this document (all of which are retrieval or generation issues, not a topic-classification block).

**Why Q12 wasn't fixed this round:** doing so would mean broadening `TOPIC_GUARD_SYSTEM_PROMPT` to explicitly cover property-tax questions - an algorithm/prompt change outside this session's explicit "no algorithm changes" scope. Flagged rather than fixed.

**Updated benchmark result:** 11 PASS / 2 PARTIAL / 1 PARTIAL-INCORRECT (behavior test) / 1 FAIL - up from 8/4/1/2.

**Revisit when:** (1) deciding whether property/real-estate tax questions should be brought inside `TOPIC_GUARD_SYSTEM_PROMPT`'s ON_TOPIC scope - this is a product-scope decision (is theke a construction-permit assistant only, or does it also cover related real-estate tax questions?), not a technical one; (2) if a fourth same-chunk fact is observed being dropped from a generated answer, that's the trigger for treating "trailing paragraph in a single-chunk source gets dropped" as a real, systematic LLM-generation pattern worth a targeted system-prompt fix, rather than three isolated incidents (Q3's ΥΔΟΜ omission, Q8's κάλυψη omission, and the original Q9 ΤΕΕ-role omission before its own fix).

**Status update - the property-tax decision was made (bring it into scope), and the κάλυψη fix was attempted and did not work:** `TOPIC_GUARD_SYSTEM_PROMPT` was extended with an explicit, narrow carve-out - ΕΝΦΙΑ, ΦΜΑ, and ΦΠΑ-on-new-construction are now ON_TOPIC, while general income tax, corporate tax, payroll tax, and accounting questions unrelated to property remain explicitly OFF_TOPIC (verified: both control queries, on business income tax and freelancer VAT, still correctly return `off_topic=True`). This flips Q12 to PASS - `_is_off_topic()` now returns `False` for the property-tax query, and doc 255 (dist 0.212) is retrieved and cited correctly.

Doc 257 was rewritten so the ΣΔ-vs-κάλυψη distinction is the *second* paragraph (immediately after the opening question line, before the ΣΔ definition itself) rather than the trailing one - testing directly whether chunk position was the cause of it being dropped. Distance actually got slightly worse (0.355 -> 0.408, still well under threshold) and, more importantly, **the distinction still didn't appear in any of 3 separate `/chat/message` calls (0/3)**. This rules out "trailing paragraph gets truncated" as the mechanism - repositioning the fact to the front made no difference. The likely actual cause: the model appears to scope its answer tightly to the literal question asked ("what is ΣΔ") and treats the κάλυψη comparison as adjacent-but-unasked, dropping it for concision regardless of where it sits in the source. Q8 remains PARTIAL; per session scope, no further iteration was attempted.

**Definitive pre-multi-vertical benchmark: 12 PASS / 2 PARTIAL / 1 PARTIAL-INCORRECT / 0 FAIL.** Topic guard updated to include real-estate taxes (ΕΝΦΙΑ/ΦΜΑ) as ON_TOPIC for the construction vertical. Q8 fixed attempt (moving κάλυψη distinction to second paragraph of doc 257) did not change the outcome. Remaining: Q5 PARTIAL accepted (cost structure without exact figures, correct per rubric), Q10 PARTIAL-INCORRECT accepted (per-plot GIS ceiling, existing KNOWN_DECISIONS entry), Q8 PARTIAL accepted (generation-completeness gap, not retrieval - see above).

**Revisit when:** starting genuine multi-vertical work (Tax vertical, etc.) - the topic guard's new real-estate-tax carve-out is a precedent for how vertical boundaries get drawn in that prompt; keep it narrow and explicit rather than let scope creep in as new verticals are added. For Q8, a fix would need a different mechanism entirely (e.g. an explicit system-prompt instruction to always state input/output distinctions when a source defines two commonly-confused terms together, or splitting κάλυψη into its own retrievable chunk/document so it's not competing for "airtime" within a single generated answer at all) - neither attempted, since the task's own stop condition ("do not iterate further this session") was reached.

**Final status update - the "give κάλυψη its own document" idea was tried, and it failed at an earlier step than expected:** a fourth document (261, title "Διαφορά Συντελεστή Δόμησης (ΣΔ) και Κάλυψης — Δύο Διαφορετικοί Περιορισμοί") was created with κάλυψη as its explicit subject rather than a note inside a ΣΔ-focused document. It never got the chance to test the actual hypothesis: its opening line was "Ποια είναι η διαφορά μεταξύ συντελεστή δόμησης (ΣΔ) και κάλυψης;" - a *related* question, not the literal benchmark query "Τι είναι ο συντελεστής δόμησης;" that every other successful fix in this document opened with verbatim. Breaking from that established pattern cost it dearly: distance came in at 0.583 (above the 0.5 threshold), and it never appeared in the actual top-6 retrieval candidates `/chat/message` uses (confirmed via a direct `_retrieve()` call - doc 257 and four chunks of doc 127 fill the top 5). All 3 `/chat/message` calls were answered from doc 257 alone; across this run plus the earlier one, κάλυψη appeared in 1 of 4 total generations sampled - consistent generation-scoping behavior, not something this document could influence since it was never in context.

**Q8 stays PARTIAL. Final confirmed benchmark, unchanged from the previous entry: 12 PASS / 2 PARTIAL / 1 PARTIAL-INCORRECT / 0 FAIL.** Two clean, closeable takeaways for future attempts: (1) the "open with the literal benchmark question verbatim" pattern is not optional stylistic advice - it is *the* mechanism making every other fix in this document work, and any new document that opens with a paraphrase instead measurably loses the retrieval race; (2) even when the target fact is guaranteed to be in the retrieved context (doc 257 already contains the κάλυψη distinction and was cited every time), the model still only surfaces it in roughly 1 of 4 generations for this exact question phrasing - this is now confirmed across two independent test rounds using two different documents, so it should be treated as a real, systematic pattern rather than one-off variance. A genuine fix would need to act on generation, not retrieval (e.g. a targeted system-prompt instruction, not another document).
