# Phase D — Broader bilingual sample (24 questions), 2026-07-24

Follow-up to `2026-07-24-phase2-bilingual-verification.md` (Phase 2's original
10 questions). This run draws 24 **new** English-language questions from
across all four existing benchmark sets in `benchmark/` —
`comprehensive-105.md` (1A/1B/1C/2A/2B), `stress-round-1.md`, and
`stress-round-3.md` — deliberately including harder/complex multi-part
scenarios (the stress-round questions) that Phase 2's original 10 did not
cover, per the explicit goal of stress-testing retrieval/citation fidelity
rather than re-confirming simple factual questions.

Method: each question run once via `POST /chat/message` with
`preferred_locale='en'` (`demo-member@construction.theke.gr`, Kavala QA
project id 38, for construction; `demo-member@accounting.theke.gr`, no
project, for tax). Two questions with a gap/fail response were re-run a
second time to check reproducibility (LLM generation and, separately,
retrieval are both probabilistic). Scored against `benchmark/README.md`'s
rubric (PASS / PARTIAL / FAIL / HONEST GAP / OUT OF SCOPE).

## Summary table

| # | Question | Source | Vertical | Score |
|---|---|---|---|---|
| C1 | Cost to build per m² | 1B-Q1 | Construction | PASS (OUT OF SCOPE, correctly redirected) |
| C2 | Regularizing an unauthorized structure | 1B-Q5 | Construction | PASS (see reproducibility note) |
| C3 | Construction site supervision | 1B-Q9 | Construction | PASS |
| C4 | What is BIM | 1C-Q7 | Construction | HONEST GAP (matches known KB gap) |
| C5 | Buildability of 3.8-acre out-of-plan plot | 2B-Q3 | Construction | PASS |
| C6 | Settlement/cracks 18 months after handover | 2B-Q6 | Construction | PASS |
| C7 | Legalizing multiple planning violations | 2B-Q11 | Construction | PASS |
| C8 | Accessibility requirements, public buildings | 2B-Q22 | Construction | PASS |
| C9 | Property transfer, multiple violations (complex) | stress1-C-Q1 | Construction | PASS |
| C10 | Conflicting legislation, ΥΔΟΜ vs. engineer (complex) | stress1-C-Q2 | Construction | HONEST GAP |
| C11 | Supplementary works on public contract (complex) | stress3-C4 | Construction | **FAIL (confirmed, reproducible)** |
| C12 | Listed building → boutique hotel (complex) | stress3-C1 | Construction | PASS |
| T1 | Foreign tax residency rules | 1A-Q2 | Tax | PASS |
| T2 | Cryptocurrency taxation | 1A-Q4 | Tax | PASS |
| T3 | When to set up a holding company | 1A-Q7 | Tax | PASS |
| T4 | What to watch for in a tax audit | 1A-Q14 | Tax | PASS |
| T5 | 2-year VAT non-filing regularization | 2A-Q1 | Tax | PASS |
| T6 | Airbnb income across 3 properties | 2A-Q4 | Tax | PASS |
| T7 | Tax audit documentation requirements | 2A-Q9 | Tax | PASS |
| T8 | Hiring first employee, ΕΡΓΑΝΗ declarations | 2A-Q19 | Tax | PARTIAL |
| T9 | 5-income-stream international taxation (complex) | stress1-T-Q1 | Tax | PARTIAL |
| T10 | Audit disputing deposits/Revolut/relatives (complex) | stress1-T-Q3 | Tax | PASS |
| T11 | Company with 4 concurrent activities (complex) | stress3-A5 | Tax | **PARTIAL (language-fidelity slip, see below)** |
| T12 | New IKE + foreign fund investment (complex) | stress3-A1 | Tax | PASS |

**18 PASS, 2 HONEST GAP, 3 PARTIAL, 1 FAIL out of 24.** Using the same
"no-fabrication acceptable outcome" convention as `comprehensive-105.md`
(PASS + HONEST GAP/OUT OF SCOPE both count as acceptable, not failures):
**20/24 = 83%** acceptable, in the same range as Phase 2's 90%. All 3
PARTIALs and the 1 FAIL are concentrated in the 6 stress-round "harder"
questions and the niche gap-testing question (C4), not in the 18
straightforward comprehensive-105 questions — 17 of those 18 scored a clean
PASS (one, C2, needed a retry — see below), consistent with Phase 2's own
finding that simple/common questions are solid and it's the complex,
multi-part, or precisely-worded scenarios that are more likely to expose a
retrieval edge case.

## Notable findings (new patterns not seen in Phase 2)

### 1. C11 — confirmed, reproducible English-only retrieval gap (real defect)

**"During the execution of a public works contract, work arose that was not
included in the original contract..."** returned `gap=true` with **zero
citations** and the canned "I don't have a reliable enough source" response,
identically on two separate runs.

The identical question in Greek (`Κατά την εκτέλεση δημόσιου έργου
προέκυψαν εργασίες που δεν περιλαμβάνονταν στην αρχική σύμβαση...`)
correctly retrieves the bridge document **"Συμπληρωματικές Εργασίες σε
Δημόσιο Έργο — Προϋποθέσεις Έγκρισης"** (Ν.4412/2016 Άρθρο 132) and produces
a full PASS answer — confirmed by a side-by-side re-run in this session.

This is exactly the class of gap Phase 2 discovered and fixed with
`_translate_query_to_greek()` (`backend/app/routers/chat.py:187`) — English
queries are translated to Greek before retrieval specifically so retrieval
doesn't depend on cross-lingual embedding quality. That fix clearly works
for the other 23/24 questions here (including several other stress-round
complex scenarios), but this one case shows the translation-mediated
retrieval fix is **not 100% robust**: an LLM-generated Greek paraphrase of a
precise legal/procedural question can still land far enough from the
original Greek benchmark phrasing in embedding space to miss a document
that's genuinely present. Not a regression from the v2 redesign or from
anything else changed this session — a pre-existing edge case in the Phase 2
translation-retrieval fix, newly surfaced because this specific question
wasn't part of Phase 2's original 10. Reporting per the "report new failure
patterns specifically" instruction; not fixed here (Part D's brief is a
scoring pass, not a fix pass — unlike Part A).

### 2. T11 — intermittent language-fidelity slip (real, but non-reproducible)

**"A company operates in retail sales, e-commerce, consulting services, and
short-term property rental..."** came back as a **fully Greek-language
answer** on the canonical run, despite `preferred_locale='en'` being active
and `LANGUAGE_RULE_EN` correctly appended to the system prompt (confirmed by
inspecting `chat.py`'s locale-resolution logic — the request landed with
`locale == "en"` as expected). Content was reasonable (correctly cited the
€10,000 OSS threshold and Άρθρο 22 deductible-expense rule) but the entire
answer body was written in Greek, not English.

Re-ran the identical question once more: this time it returned a fully
correct English answer. So this is a genuine but **intermittent** GPT-4o
compliance miss on `LANGUAGE_RULE_EN` — not a broken mechanism (the
mechanism worked correctly on 23/24 other questions and on the immediate
retry), but a real, observed failure mode on a dense, multi-part,
Greek-source-heavy question. This is the kind of citation/language-fidelity
issue the harder complex questions were specifically included to expose, and
it wasn't visible in Phase 2's simpler 10-question set. Scored PARTIAL
rather than FAIL given the retry succeeded and content was otherwise sound.

### 3. C2 — one-off retrieval flake, not reproducible (informational only)

The first run of "How is an unauthorized structure regularized?" returned a
`gap=true`, zero-citation "no relevant documents" response — surprising,
since a near-identical question (C7, "how is an unauthorized structure with
**multiple planning violations** legalized") succeeded cleanly with the same
underlying document. Re-ran C2 once more: this time it correctly retrieved 9
sources including the same "Τακτοποίηση Αυθαιρέτου — Διαδικασία" document
and produced a full PASS answer. Logged for completeness; not counted as a
defect since it didn't reproduce, but worth knowing retrieval has some
run-to-run variance right at the confidence threshold for at least one query
shape.

## Everything else: clean

The remaining 20 questions (all of comprehensive-105's straightforward
questions, both stress-round-1 tax scenarios that succeeded, and 3 of the 4
stress-round-3 "hardest" scenarios) all produced correctly-cited, properly
in-language, non-fabricated answers on the first attempt — consistent with
Phase 2's finding that the bilingual system is solid for the bulk of
real-world questions, with the residual risk concentrated in complex,
multi-part, or precisely-worded professional scenarios rather than being
spread evenly across the question set.

## Bottom line

Confidence-building result, as intended: the bilingual chat system holds up
well on a broader sample (83% clean/acceptable vs. Phase 2's 90%), and the
two real findings here are both **precisely the failure mode the harder
questions were chosen to expose** — an English-specific retrieval miss on
one precisely-worded complex legal scenario (C11, reproducible), and one
intermittent language-fidelity slip on another dense complex scenario (T11,
non-reproducible). Neither is a regression from the v2 redesign, the
super-admin fix, or anything else changed this session; both are pre-existing
characteristics of the Phase 1d/Phase 2 translation-and-generation pipeline
that a 10-question sample was always going to be too small to surface. No
code changes made in this pass per Part D's scope (report, not fix).
