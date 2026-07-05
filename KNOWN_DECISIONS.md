# Known decisions & tradeoffs

Judgment calls made during implementation that are deliberate but not
necessarily final — each has a trigger condition for when it's worth
revisiting. Not a general TODO list; only things that were explicitly chosen
over an alternative, where the alternative might become the better choice
later.

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
