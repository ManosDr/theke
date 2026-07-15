# theke — Capabilities & Limitations

This is a factual inventory of what the app actually does today, written to be
pasted into a fresh Claude session as the brief for generating a test plan.
It is deliberately blunt about gaps and stubs — a tester needs to know what's
*supposed* to not work, or every honest limitation reads as a bug.

Snapshot date: 2026-07-08. Facts below were confirmed against the live dev
database and source code, not recalled from memory.

---

## 1. What theke is

A Greek regulatory-compliance AI assistant, multi-tenant, serving two
independent "verticals":

- **Construction** (`construction`) — building-permit and compliance
  guidance for construction companies and municipalities, regionally scoped
  (a company's visible documents depend on which municipality/region its
  projects are in).
- **Tax & Accounting** (`tax_accounting`) — Greek tax law and ΑΑΔΕ procedure
  guidance for accounting firms, not regionally scoped (all tax content is
  national).

Every company belongs to exactly one vertical, set at creation and changeable
only by a super admin (Companies screen → "Αλλαγή Vertical"). A user's chat
experience, retrieval scope, disclaimer text, and dashboard UI are all driven
by their company's vertical.

## 2. Roles & permissions

Three roles, each scoped to a company (except super_admin, which is
platform-wide and has no company):

| Role | Scope | Can do |
|---|---|---|
| `super_admin` | Platform-wide | Everything in the admin section (6 screens below); no chat/project features of their own (no company) |
| `admin` | One company | Manage the company's users/invites/roles, upload public-KB documents (construction only), request document removal, view audit log, everything a `member` can do |
| `member` | One company | Chat, search, manage own projects/clients, upload project-scoped documents |

Company `type` (display-only tag, not a permission gate): `construction`,
`municipality`, `accounting`. Only `municipality` changes UI behavior
directly (logo display, no project/client section on the dashboard). Any
other `type` shows the vertical-appropriate project/client section — this
was a real bug until just now (see §13).

## 3. Authentication

- JWT bearer tokens, 15-minute expiry (`access_token_expire_minutes`) — a
  session goes stale and redirects to `/login?sessionExpired=1` on the next
  API call after expiry, no silent refresh.
- Password minimum length: 8 characters (registration, password reset).
- Login lockout: 5 failed attempts (`LOGIN_FAILURE_LIMIT`) — check the exact
  lockout window/message when testing this.
- Registration: two paths — `company_name` (creates a new company; requires
  `vertical_slug`, but **the frontend registration form never sends one and
  only offers "construction"/"municipality" as company types** — self-serve
  signup for a new accounting firm is not reachable through the UI today,
  only via direct seeding) or `invite_token` (joins an existing company at
  the role/vertical the invite specifies).
- Password reset: email-link flow: `POST /auth/forgot-password` →
  `POST /auth/reset-password`. Deliberately returns the same response
  whether or not the email exists (no user-enumeration leak — confirmed
  fixed earlier this project, not a current gap). Actually emailed via
  Resend when `EMAIL_ENABLED=true` (`app/services/email.py`); otherwise a
  token is still created but nothing is sent (see KNOWN_DECISIONS.md — the
  link is deliberately never logged either way). A super admin can also
  force-reset any user's password directly from the Companies screen's
  Χρήστες list (`POST /admin/users/{id}/reset-password`, generates a
  one-time password shown once) or trigger the same email-link flow on the
  user's behalf.
- `/docs` and `/redoc` (FastAPI's auto-generated API explorer) are only
  served when `ENVIRONMENT != "production"`.

## 4. Chat / RAG behavior

- `POST /chat/message`: takes a free-text question, optional `project_id`.
  Retrieves relevant chunks via **hybrid search** (vector similarity + full-text
  search, combined with Reciprocal Rank Fusion), then answers via an LLM with
  citations back to specific documents.
- **Per-vertical system prompt and disclaimer**, live-editable by a super
  admin (Verticals & Content screen) with no server restart needed — the
  prompt/disclaimer is read from the DB on every request.
- **Project/client-scoped retrieval**: when `project_id` is given, retrieval
  merges the vertical's public KB with three private tiers: company-wide
  documents, customer-wide documents (visible to every project under that
  customer, when the active project has a `customer_id`), and project-only
  documents. A document scoped to customer A is never visible from a
  different customer's project or a customer-less project.
- **Off-topic guard**: an explicit system-prompt instruction steers the model
  away from answering questions outside its vertical (e.g. a construction
  company asking a tax question) — this is a soft LLM-level guard, not a
  hard filter; it can in principle be argued around like any system prompt.
- **Gap detection**: a response is flagged `gap=true` when the retrieval
  found nothing confident enough or the off-topic guard fired — surfaced to
  the super admin's "gap queries" list (what people ask that the KB doesn't
  cover).
- **Citations**: every non-gap answer includes `document_id`, title,
  authority, source URL, extraction status, and (for utility-provider
  documents) a contact phone/email pulled from `UtilityProvider`/`Region`.
- **Feedback**: thumbs up/down per assistant message (`POST /chat/feedback`),
  aggregated into the super admin's sentiment donut.
- **Product feedback widget**: a floating button on every page (all
  authenticated roles) opens a short form — category (bug / suggestion /
  content gap), optional 500-char message, current page URL auto-captured —
  posted to `POST /user-feedback`. Separate from chat message feedback; surfaces
  in the super admin's Ανατροφοδότηση screen under "Σχόλια Χρηστών", with
  content-gap items pulled into their own always-visible card since they feed
  the KB gap workflow directly.
- **Rate limit**: 20 messages/hour per user (`CHAT_MESSAGE_LIMIT`), a Redis
  counter — returns HTTP 429 with a Greek message once exceeded. This is
  real and will trigger during heavy testing; not a bug.
- **Location context injection** (construction only, see §7): if the active
  project has a resolved lat/lon, the system prompt gets an extra
  labeled section with address/ΚΑΕΚ/zone/archaeological-flag info, and the
  retrieval query itself is enriched with the municipality name.

## 5. Knowledge base — actual current contents

Live counts, not aspirational:

| Vertical | Active docs | Superseded | Removed |
|---|---|---|---|
| Construction | 230 | 1 | 3 |
| Tax & Accounting | 33 | 0 | 0 |

By authority (construction-heavy; tax docs mostly have `authority=None`
since they predate that field being populated for the tax ingestion pass):
`tee` (26), `ktimatologio` (24), `ydom` (17), `aade` (11), `ypen` (7),
`deya` (6), `efka` (4), `deddie` (2), `dasarcheio` (1).

**Regional tier (construction only)** — exactly 5 municipalities have any
regional content at all:

| Region | Has building-coefficient/setback figures (`has_coefficient_data`) |
|---|---|
| Δήμος Καβάλας (kavala) | No (confirmed absent, not just unresearched) |
| Δήμος Παγγαίου (paggaio) | No |
| Δήμος Θάσου (thassos) | No |
| Δήμος Δράμας (drama) | Unresearched (`None`) |
| Δήμος Ξάνθης (xanthi) | Unresearched (`None`) |

**Any other Greek municipality has zero regional-tier content** — a
construction company with a project outside these 5 regions gets
national-tier answers only (still real and cited, just not
municipality-specific). This is the single most important scoping fact for
testing construction-vertical retrieval: don't expect region-specific
answers for, say, Θεσσαλονίκη or Πάτρα.

**Utility providers** (water/electric-grid contacts, used for citation
contact info): 6 providers, all in the Καβάλα/Δράμα/Ξάνθη/Πάγγαιο/Θάσος
cluster (Δ.Ε.Υ.Α. × 5 municipalities + ΔΕΔΔΗΕ Καβάλας). No coverage
elsewhere.

**Staleness tracking**: a weekly job flags `needs_review=true` on any
document whose `last_verified_at` is missing or >6 months old. Currently 1
document flagged. A super admin clears this via the Documents screen's
"Σήμανση ως ελεγμένο" action, which requires an explicit confirmation
checkbox (server-enforced, not just a disabled button).

## 6. Document lifecycle

- **Statuses**: `active`, `superseded`, `removed`, plus `extraction_status`
  values `full_text`, `reference_only`, `manual_entry`, `manual_entry_pending`
  layered on top (see the Documents screen's flattened badge logic in
  KNOWN_DECISIONS.md if the two-field model is confusing during testing).
- **Supersede workflow**: an admin marks document A as superseded by document
  B (both must be the same vertical); A disappears from tenant search/chat
  immediately, both remain visible to admins with the replacement chain
  shown. Reversible via "Undo supersede."
- **Removal**: a company can request removal of a *public* document it
  disagrees with; a super admin approves/rejects. Approving sets
  `status=removed` (soft delete, recoverable in principle via direct DB
  access only — no "undo remove" endpoint).
- **Uploads**:
  - Company-level public KB upload (construction companies only, PDF, max
    25MB): extracted via PyMuPDF, chunked, embedded immediately.
  - Project/client-scoped upload (any vertical, PDF/DOCX/TXT, max 10MB):
    private to that project, included in retrieval only when that
    project_id is active.
- **Crawler-sourced documents** (the majority) update via a scheduled job per
  `data_sources` row's cadence (daily/weekly/monthly/custom) — the actual
  re-crawl trigger from the admin UI's "Sync now" button is an **honest
  stub**: it updates the scheduling bookkeeping fields (`last_crawled_at`,
  `next_crawl_at`) but does not invoke a real scraper (no per-source
  dispatch table exists yet — see KNOWN_DECISIONS.md).

## 7. GIS / location features — exact scope (the archaeological-zone question)

This is the part most likely to be misunderstood, so it's spelled out fully.

**What's real:**
- **Reverse geocoding** (coordinates → address/municipality): a real, live
  call to the public Nominatim (OpenStreetMap) API. Works for any point in
  Greece (or the world) — this part *is* nationwide.

**What's an honest stub (not "not yet implemented" — confirmed dead):**
- **Cadastral parcel lookup** (ΚΑΕΚ, plot area, parcel boundary geometry):
  the public Ktimatologio WFS endpoint that would provide this returns 404
  for every request — confirmed dead despite being the government's own
  documented INSPIRE endpoint. `lookup_cadastral_parcel()` returns
  `available: false` immediately, for any coordinates, anywhere in Greece.
- **Zone/building-coefficient lookup** (ΤΕΕ SDIG): no public API exists at
  all for this service (phone/email support only, per ΤΕΕ). Same honest-stub
  pattern, same result: unavailable everywhere, not just outside some
  covered area.

**Archaeological-zone flag — the specific question asked:**
This is **not a live government API integration at all**. There is no
public, working Archaeological Cadastre API (its own developer page is a
JS-only SPA with no discoverable endpoint). Instead,
`check_archaeological_flag()` runs a RAG search against the *same knowledge
base* used for chat, looking for a document that (a) clears a similarity
threshold and (b) textually mentions the plot's municipality.

**Real coverage: exactly one place, Παναγία / Δήμος Καβάλας.** There is
exactly one ingested document about an actual archaeological zone
(`Αρχαιολογική Ζώνη Παναγίας Καβάλας`, doc id 318) — confirmed by direct
database query, not assumption. Dropping a pin anywhere else in Greece —
including well-known real archaeological areas (Ακρόπολη, Δελφοί, Κνωσός,
anywhere) — will resolve `archaeological_flag: false`, not because that
place isn't protected, but because **nothing about it exists in the
knowledge base to find.** This is a false-negative risk baked into the
architecture, disclosed in KNOWN_DECISIONS.md as a known, accepted
limitation (municipality-level granularity at best, and only where content
happens to exist) rather than a bug — but it means "does theke correctly
flag archaeological zones nationwide" should test as **"no, it only works
for the one place we manually wrote a KB entry for,"** not as a pass/fail
against real archaeological-zone geography.

**Practical test implication**: a location test suite should distinguish
"does reverse geocoding work" (yes, anywhere) from "does the archaeological
flag work" (only for the Kavala/Panagia coordinates already used in this
project's own manual testing) from "does cadastral/zone lookup work"
(no, nowhere, by design, pending a real data source).

## 8. Regional/staleness admin features (construction only)

- A super admin's "stale documents" queue lists everything flagged
  `needs_review=true`.
- Region records track `has_coefficient_data` (real ΓΠΣ/ΖΟΕ figures ingested)
  separately from `has_zone_level_coefficient_text` (figures exist but are
  organized by named zone, not parcel/address — resolving "what's my plot's
  coefficient" still requires a real zone map this pipeline doesn't have).

## 9. Multi-vertical admin (super_admin only) — 6 screens

All under `/admin/*`, gated on `role === "super_admin"`, all reachable via
the sidebar's vertical switcher (Κατασκευές / Λογιστική / Όλα) which
persists to `localStorage` and filters every screen below simultaneously.

1. **Dashboard** (`/dashboard` for super_admin) — combined view (two
   vertical stat cards side by side) or single-vertical view (one full-width
   panel), each showing active documents / total messages / gap rate
   (all-time, not a rolling window — labeled "Ερωτήματα," not "queries/30d,"
   since no 30-day windowing exists for this stat). Below that: platform
   attention row (suspended tenants, gap rate, stale docs), an activity
   chart, and a companies summary strip.
2. **Documents** (`/admin/documents`) — full KB browser: filter by vertical/
   status/authority/content-type/superseded-only/free-text, paginated table,
   per-row menu (view detail drawer, mark reviewed, mark/undo superseded,
   remove), supersede modal with live search for the replacement doc.
3. **Data Sources** (`/admin/data-sources`) — grouped by vertical, each
   source card shows computed health (healthy/overdue/failed/syncing/
   inactive/never-synced — computed client-side from timestamps/status
   fields, not a distinct backend field), a cadence editor (frequency +
   custom-days + active toggle + notes), and the "Sync now" honest-stub
   button from §6.
4. **Companies** (`/admin/companies`) — table with vertical badge, active
   users/projects counts, status; detail modal shows users (with role),
   projects/clients, 30-day message count + gap rate, suspend/reactivate,
   and vertical reassignment (with a warning naming exactly how many
   documents the company will lose access to).
5. **Vertical Content Editor** (`/admin/verticals`) — per-vertical editable
   tagline, welcome message, disclaimer (150-char counter + live preview),
   system prompt override (collapsed behind a toggle, monospace, permanent
   warning banner, reset-to-default), off-topic hint, and a read-only
   "uses regional scoping" badge. Saves take effect on the next chat request
   with no restart.
6. **Shell chrome** — collapsible sidebar (280px⇄64px), A-/A+ font-scale
   control (80-140%, persisted), language pill, theme toggle, notification
   bell, avatar. Applies to every role, not just super_admin (only the
   vertical switcher and admin nav tree are super_admin-gated).

**Deliberately not built** (disclosed, not oversights — see
KNOWN_DECISIONS.md for the reasoning): a separate cross-tenant "all users"
or "all pending invites" screen (folded into the Companies detail modal
instead); the dev-only Component Gallery from the design prototype; a
"+ Νέο Έγγραφο" manual document-creation button (no backend endpoint for
it); a real calendar widget in the cadence editor (a plain number input
covers the same field); self-serve registration for a new accounting
company (see §3).

## 10. Non-admin frontend

- **Dashboard** (company admin/member): admin sees team/access/pending-
  approval/pending-invite counts (vertical-agnostic, same for every company
  type). Member sees a welcome message plus — as of this session's fix — a
  vertical-appropriate section: construction/municipality members see a
  Projects list (name, municipality, default flag, region-based creation
  form); accounting members see a Clients list (name, notes, simpler
  creation form, no region selector) instead.
- `/projects/new` and `/projects/[id]` are also vertical-aware now: an
  accounting/tax member gets a simple name+notes client form/detail view
  (no map, no region, no customer fields); construction/municipality
  members see the unchanged map+plot+customer UI. Editing a client's notes
  from the detail page persists via `PATCH /projects/{id}` (`client_notes`
  was added to that endpoint's accepted fields to make this possible — it
  previously only accepted `name`/`customer_name`/`customer_notes`).
- **Sources / Search pages**: browse and full-text-search the same public
  KB the chat page retrieves from, with the same vertical/region scoping.
- **i18n**: full Greek/English toggle, persisted per-user (logged in) or to
  `localStorage` (logged out); a super admin can add custom locales and
  override any translation string live.
- **Theming**: light/dark, persisted per-user; default is light regardless
  of OS preference unless explicitly changed.

## 11. Demo accounts

No longer reachable from the public login page (see KNOWN_DECISIONS.md's
"demo login moved behind super admin" entry) - log in with the password
below directly, or (for a super admin) use "View as" on the Χρήστες admin
screen, which works for any user, not just these seven.

Password `demo1234` for all seven:

| Email | Role | Vertical |
|---|---|---|
| `demo-superadmin@theke.gr` | super_admin | — |
| `demo-admin@construction.theke.gr` | admin | construction |
| `demo-member@construction.theke.gr` | member | construction |
| `demo-admin@municipality.theke.gr` | admin | construction (type=municipality) |
| `demo-member@municipality.theke.gr` | member | construction (type=municipality) |
| `demo-admin@accounting.theke.gr` | admin | tax_accounting |
| `demo-member@accounting.theke.gr` | member | tax_accounting |

Demo Construction Co has one project with a resolved GIS location (the
Παναγία/Καβάλα coordinates used for the archaeological-flag testing above —
useful for exercising the location-context/map features specifically).
Demo Λογιστικό Γραφείο has one client (`is_client=true`, no location fields
— they don't apply to that vertical).

## 12. Infra / non-functional

- CORS: explicit `allow_origins` list (production) plus, only when
  `ENVIRONMENT != "production"`, a regex allowing any `localhost:<port>`
  (a dev-tooling accommodation, not a production behavior to test against).
- Security headers set via Nginx (confirmed present in an earlier pass, not
  re-verified this session).
- pgvector IVFFlat index present for embedding similarity search.
- Notifications: 5 real trigger points (crawl digest, municipality-content
  upload, invite accepted, removal requested, removal decided), polled every
  60s client-side, bell + unread dot + mark-all-read.

---

## For the tester: the short version

**Test these as real, working features**: chat retrieval + citations for
construction (5-region cluster) and tax (national), the full admin 6-screen
suite, vertical switcher filtering, reverse geocoding, document supersede/
review workflows, notifications, i18n/theming, rate limiting, the demo
accountant flow (just fixed).

**Don't test these as if they should work everywhere** — they're honest,
disclosed stubs or narrow-coverage features, not bugs waiting to be found:
cadastral parcel lookup (nowhere), TEE zone lookup (nowhere), archaeological
flag (Kavala/Panagia only), regional building-coefficient data (0 of 5
regions have real figures), "Sync now" (bookkeeping only, no real re-crawl).

Project/client detail pages (`/projects/[id]`, `/projects/new`) are now
vertical-aware too (simple client form for accounting/tax, unchanged
map+plot form for construction/municipality) — no longer a listed gap.
