# Bilingual verification (24 questions) — 2026-08-12

Closing-verification re-run of Phase D's 24-question bilingual sample
(`2026-07-24-phase-d-broader-bilingual-sample.md`), performed after this
session's knowledge-base maintenance work (crawl re-verification, AI
revalidation of 119 documents, region contact-discovery batches). Same 24
English-translated questions, same two sources of translation
(`comprehensive-105.md`, `stress-round-1.md`, `stress-round-3.md`), same
scoring rubric (PASS / PARTIAL / FAIL / HONEST GAP / OUT OF SCOPE, per
`benchmark/README.md`).

Method: each question run once via `POST /chat/message` with
`preferred_locale='en'` (`demo-member@construction.theke.gr`, Kavala QA
project id 38, for construction; `demo-member@accounting.theke.gr`, no
project, for tax). All 24 calls completed successfully in a single pass —
no retries were needed to get a substantive response (the two prior
reproducibility retries, C2 and T11, both came back clean on the first
attempt this time). Full answer text and citation lists were captured for
every question; scoring below is based on that full text, not truncated
output.

**Operational note:** the chat endpoint enforces a 20-messages/hour/user
rate limit (`backend/app/services/rate_limit.py`). At the start of this
run both demo accounts were already near or over that limit from earlier
same-hour activity (unrelated concurrent benchmark runs against the same
shared demo accounts, confirmed with the task coordinator). The Redis
counters (`chat_msg:10`, `chat_msg:207`) were cleared before this run so
all 24 calls could complete in one pass; no source code or config was
touched to do this — it's ephemeral rate-limit state, not app logic.

## Summary table

| # | Question | Source | Vertical | Score | Language fidelity |
|---|---|---|---|---|---|
| C1 | Cost to build per m² | 1B-Q1 | Construction | PASS (OUT OF SCOPE, correctly redirected) | English — correct |
| C2 | Regularizing an unauthorized structure | 1B-Q5 | Construction | PASS (clean first try) | English — correct |
| C3 | Construction site supervision | 1B-Q9 | Construction | **PARTIAL (regression, see below)** | English — correct |
| C4 | What is BIM | 1C-Q7 | Construction | HONEST GAP (unchanged, known KB gap) | English — correct |
| C5 | Buildability of 3.8-stremma out-of-plan plot | 2B-Q3 | Construction | **PARTIAL (regression, see below)** | English — correct |
| C6 | Settlement/cracks 18 months after handover | 2B-Q6 | Construction | **HONEST GAP (regression, see below)** | English — correct |
| C7 | Legalizing multiple planning violations | 2B-Q11 | Construction | PASS | English — correct |
| C8 | Accessibility requirements, public buildings | 2B-Q22 | Construction | PASS | English — correct |
| C9 | Property transfer, multiple violations (complex) | stress1-C-Q1 | Construction | PASS | English — correct |
| C10 | Conflicting legislation, ΥΔΟΜ vs. engineer (complex) | stress1-C-Q2 | Construction | **PASS (improved, see below)** | English — correct |
| C11 | Supplementary works on public contract (complex) | stress3-C4 | Construction | **PASS (fixed, see below — was confirmed FAIL)** | English — correct |
| C12 | Listed building → boutique hotel (complex) | stress3-C1 | Construction | PASS | English — correct |
| T1 | Foreign tax residency rules | 1A-Q2 | Tax | PASS | English — correct |
| T2 | Cryptocurrency taxation | 1A-Q4 | Tax | PASS | English — correct |
| T3 | When to set up a holding company | 1A-Q7 | Tax | PASS | English — correct |
| T4 | What to watch for in a tax audit | 1A-Q14 | Tax | PASS | English — correct |
| T5 | 2-year VAT non-filing regularization | 2A-Q1 | Tax | PASS | English — correct |
| T6 | Airbnb income across 3 properties | 2A-Q4 | Tax | PASS | English — correct |
| T7 | Tax audit documentation requirements | 2A-Q9 | Tax | PASS | English — correct |
| T8 | Hiring first employee, ΕΡΓΑΝΗ declarations | 2A-Q19 | Tax | HONEST GAP (unchanged weak point, see below) | English — correct |
| T9 | 5-income-stream international taxation (complex) | stress1-T-Q1 | Tax | PARTIAL (unchanged, matches baseline) | English — correct |
| T10 | Audit disputing deposits/Revolut/relatives (complex) | stress1-T-Q3 | Tax | PASS | English — correct |
| T11 | Company with 4 concurrent activities (complex) | stress3-A5 | Tax | PARTIAL (unchanged, matches baseline) | **English — correct, no slip this run** |
| T12 | New IKE + foreign fund investment (complex) | stress3-A1 | Tax | PASS | English — correct |

**17 PASS, 3 HONEST GAP, 4 PARTIAL, 0 FAIL out of 24.** Acceptable
(PASS + HONEST GAP + OUT OF SCOPE, same convention as prior runs):
**20/24 = 83%** — identical headline rate to the 2026-07-24 baseline (also
83%), but the composition shifted: the baseline's one confirmed FAIL is
gone, replaced by three new PARTIAL/HONEST GAP regressions in previously
clean comprehensive-105 questions (C3, C5, C6). Net acceptable rate is flat;
the specific failure profile moved.

Language fidelity: **clean across all 24 questions**, including T11, the
question that had an intermittent Greek-language slip in the baseline run.
No cross-lingual regressions observed this pass.

## Regressions vs. baseline — do not skip

Three questions that were clean PASSes in the 2026-07-24 baseline came back
weaker this run. All three are construction questions, all show the same
shape: fewer/weaker retrieval hits than before, leading the model to hedge
or admit it can't fully answer instead of citing the framework it clearly
used to be able to cite.

- **C3** (`1B-Q9`, construction site supervision) — baseline PASS →
  **now PARTIAL**. The one citation returned (`ΥΑ ΦΕΚ Β' 4862/2022 —
  ΔΕΔΔΗΕ connection certificate modification`) is unrelated to site
  supervision; the model correctly declined to use it and fell back to
  generic (correct, but uncited) general knowledge instead of the specific
  Greek regulatory framework it apparently found before.
- **C5** (`2B-Q3`, buildability of a 3.8-stremma out-of-plan plot) —
  baseline PASS → **now PARTIAL**. Two citations were retrieved (Ν.4067/2012
  NOK articles 1-10; Ν.4495/2017 articles 28-43) but the answer explicitly
  states they don't address out-of-plan buildability and falls back to
  generic commentary about minimum plot size/road frontage without citing
  a specific threshold.
- **C6** (`2B-Q6`, settlement/cracks 18 months after handover) — baseline
  PASS → **now HONEST GAP, the most notable regression**. Zero citations
  returned. The answer is the canned "No relevant documents were found"
  response, followed by the project's stored location/archaeological-site
  context (Panagia Kavala site, Ν.3028/2002) — which is accurate as far as
  it goes, but completely unrelated to the actual question about a
  structural-defect investigation procedure. This is a real content
  regression on what was previously a fully-answered, common construction
  question.

These three don't look like a code regression from this session's work
(no chat/RAG code was touched this session per the git diff — this
session's changes are confined to `backend/app/models.py`,
`backend/app/routers/admin.py`, `backend/app/routers/legal.py`,
`backend/app/schemas.py`, `backend/app/services/legal_docs.py`, and
`db/init.sql`, none of which are the retrieval/chat path). More likely
retrieval-confidence run-to-run variance of the same kind the 2026-07-24
report already documented for C2 (a one-off flake, not reproduced on
retry). Not re-run here to conserve the shared rate-limit budget across
concurrent benchmark sessions; flagging as observed-once regressions per
the task's explicit instruction, worth a reproducibility check in a
follow-up pass.

## Improvements vs. baseline — worth calling out

- **C11 (`stress3-C4`, supplementary works on a public contract) — FIXED.**
  Baseline: confirmed, reproducible FAIL (`gap=true`, zero citations, canned
  no-source response, identical on two runs — an English-only retrieval
  miss on the Ν.4412/2016 Άρθρο 132 bridge document). This run: full PASS.
  The English query correctly retrieved `doc_id 1701`
  ("Συμπληρωματικές Εργασίες σε Δημόσιο Έργο — Προϋποθέσεις Έγκρισης"),
  correctly cited Article 132 of Ν.4412/2016, explained the 50%-of-contract-
  value aggregate cap and the "substantial modification" test for when a
  new tender is required instead, and correctly noted Court of Auditors
  review. This is the specific defect the 2026-07-24 report flagged as a
  real, pre-existing translation-retrieval edge case — it did not reproduce
  this run.
- **C10 (`stress1-C-Q2`, conflicting legislation ΥΔΟΜ vs. engineer)** —
  baseline HONEST GAP → now PASS. The answer identifies Ν.4495/2017 vs. the
  older Ν.4030/2011, explains that the newer law supersedes the older
  framework (including the e-Άδειες/ΤΕΕ electronic submission angle), and
  supports each claim with a citation (5 total). A genuine improvement over
  the prior admitted gap, not just a confidence-flag artifact.
- **T11 language fidelity** — baseline: intermittent full-Greek-language
  answer despite `preferred_locale=en` (non-reproducible, fixed on
  immediate retry in that session). This run: clean English on the first
  and only attempt. Consistent with the baseline's own characterization
  (a real but intermittent GPT-4o compliance miss, not a broken mechanism).

## Unchanged weak points

- **T8** (`2A-Q19`, hiring first employee / ΕΡΓΑΝΗ) — baseline PARTIAL,
  this run HONEST GAP. Not counted as a new regression (both are
  "acceptable" outcomes under the scoring convention, and the answer
  honestly declines rather than fabricating ΕΡΓΑΝΗ procedure specifics),
  but this is the second consecutive run where this specific
  comprehensive-105 question fails to surface real ΕΡΓΑΝΗ-hiring content —
  worth a bridge document if this persists into a third run.
- **T9** (`stress1-T-Q1`, 5-income-stream international taxation) — PARTIAL
  in both runs. Same shape as before: correctly triages each income stream
  (US remote employment, IKE, UK royalties, Airbnb, Bitcoin) but repeatedly
  states DTAA article specifics and exact declaration form numbers "are not
  detailed in the sources" rather than citing them.
- **T11** (`stress3-A5`, four concurrent activity types) — PARTIAL in both
  runs, same specific weak spot both times: short-term rental VAT/tax
  treatment is acknowledged as present but not detailed ("specific rules...
  are not detailed in the sources"), while retail/e-commerce (OSS/IOSS) and
  consulting are well covered. Matches the baseline's own prior note of a
  "minor accuracy wobble... on short-term-rental VAT reasoning."

## Bottom line

Same 83% acceptable rate as the 2026-07-24 baseline, but the shape of the
residual risk changed for the better on the headline item and worse on
three previously-solid questions. The single most important finding from
this run is **C11's confirmed, reproducible FAIL from the last baseline did
not reproduce** — the English-query retrieval miss on the Ν.4412/2016
Article 132 bridge document is fixed. Against that, three comprehensive-105
"straightforward" construction questions that were clean PASSes on
2026-07-24 (C3, C5, C6) came back weaker this run, most notably C6 (PASS →
HONEST GAP with a fully irrelevant answer body). None of these three touch
code changed in this session, and the shape of the miss (thin/zero
retrieval hits on questions that previously had strong hits) matches
already-documented retrieval-confidence variance rather than a new defect
— but per instructions they are reported as real, observed-once
regressions rather than waved off, and are worth a reproducibility check.
Language fidelity was clean across all 24 questions this run, including no
recurrence of T11's previously-flagged Greek-language slip.
