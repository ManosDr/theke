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

## No "mark reviewed" mechanism exists for `needs_review` documents

**What was found:** There is no endpoint or UI action to clear a
`needs_review` flag once a human has looked at a document and corrected or
dismissed it. The only way a document currently leaves the queue is a
developer directly updating the row (e.g. via SQL), since
`crawler/crawler/staleness.py`'s sweep only ever raises the flag, never
lowers it (see the multi-`<article>` entry below for why).

**Why not built yet:** This gap was noticed while building the
visibility-suppression fix, at a point where the review queue itself was
brand new and unpopulated - there was nothing yet to justify a dedicated
resolution workflow beyond a manual DB edit.

**Revisit when:** The queue's real backlog grows to the point where manual
database edits become the routine way of clearing it, rather than a rare
one-off - that's the sign a proper "mark reviewed" action (and a decision
on whether it re-triggers re-crawl/re-verification) is worth building.

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
