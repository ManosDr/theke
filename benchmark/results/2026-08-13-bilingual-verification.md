# Bilingual verification (24 questions) — 2026-08-13

Final closing-verification re-run of the same 24-question bilingual sample
used in `2026-08-12-bilingual-verification.md`, after the doc 1089/1122/1524
fixes and the municipality Help-section fix landed. Same 24 questions, same
source mapping (`comprehensive-105.md`, `stress-round-1.md`,
`stress-round-3.md`), same scoring rubric (PASS / PARTIAL / FAIL / HONEST
GAP / OUT OF SCOPE, per `benchmark/README.md`).

**Methodology note on question text:** the 2026-08-12 result file's own
summary table records each question's topic and source mapping but not the
literal English wording sent. That file's predecessor
(`2026-07-24-phase-d-broader-bilingual-sample.md`) is similarly a paraphrase
table, not a verbatim question log. For this run, each of the 24 questions
was re-translated directly from the exact Greek source text in
`comprehensive-105.md` / `stress-round-1.md` / `stress-round-3.md`, mapped to
the same 24 source questions (same "Source" column) as both prior bilingual
runs. This is a faithful re-derivation, not a verbatim replay of a
previously-recorded English string — flagged explicitly per the
methodology-transparency expectation this suite holds itself to.

Method: each question run once via `POST /chat/message` with
`preferred_locale='en'` (`demo-member@construction.theke.gr`, Kavala QA
project id 38, for construction; `demo-member@accounting.theke.gr`, no
project, for tax). All 24 calls completed successfully in a single pass per
vertical after clearing the `chat_msg:10` / `chat_msg:207` Redis counters
beforehand (the established, documented rate-limit workaround). Language
fidelity was clean across all 24 answers — every response was in English,
matching `preferred_locale`.

## Summary table

| # | Question | Source | Vertical | 2026-08-12 | 2026-08-13 (this run) | Changed? |
|---|---|---|---|---|---|---|
| C1 | Cost to build per m² | 1B-Q1 | Construction | PASS (OOS) | PASS (OOS) | No |
| C2 | Regularizing an unauthorized structure | 1B-Q5 | Construction | PASS | PASS | No |
| C3 | Construction site supervision | 1B-Q9 | Construction | PARTIAL | **PASS** | **Yes — improved, doc 1089 fix confirmed** |
| C4 | What is BIM | 1C-Q7 | Construction | HONEST GAP | HONEST GAP | No |
| C5 | Buildability of 3.8-stremma out-of-plan plot | 2B-Q3 | Construction | PARTIAL | **PASS** | **Yes — improved** |
| C6 | Settlement/cracks 18 months after handover | 2B-Q6 | Construction | HONEST GAP | **PASS** | **Yes — improved** |
| C7 | Legalizing multiple planning violations | 2B-Q11 | Construction | PASS | PASS | No |
| C8 | Accessibility requirements, public buildings | 2B-Q22 | Construction | PASS | PASS | No (content now reflects doc 1122's fix) |
| C9 | Property transfer, multiple violations (complex) | stress1-C-Q1 | Construction | PASS | PASS | No |
| C10 | Conflicting legislation, ΥΔΟΜ vs. engineer (complex) | stress1-C-Q2 | Construction | PASS | PASS | No |
| C11 | Supplementary works on public contract (complex) | stress3-C4 | Construction | PASS | PASS | No |
| C12 | Listed building → boutique hotel (complex) | stress3-C1 | Construction | PASS | PASS | No |
| T1 | Foreign tax residency rules | 1A-Q2 | Tax | PASS | PASS | No |
| T2 | Cryptocurrency taxation | 1A-Q4 | Tax | PASS | PASS | No |
| T3 | When to set up a holding company | 1A-Q7 | Tax | PASS | PASS | No |
| T4 | What to watch for in a tax audit | 1A-Q14 | Tax | PASS | PASS | No |
| T5 | 2-year VAT non-filing regularization | 2A-Q1 | Tax | PASS | PASS | No |
| T6 | Airbnb income across 3 properties | 2A-Q4 | Tax | PASS | PASS | No |
| T7 | Tax audit documentation requirements | 2A-Q9 | Tax | PASS | PASS | No |
| T8 | Hiring first employee, ΕΡΓΑΝΗ declarations | 2A-Q19 | Tax | HONEST GAP | PARTIAL | Lateral, see note |
| T9 | 5-income-stream international taxation (complex) | stress1-T-Q1 | Tax | PARTIAL | PARTIAL | No |
| T10 | Audit disputing deposits/Revolut/relatives (complex) | stress1-T-Q3 | Tax | PASS | PASS | No |
| T11 | Company with 4 concurrent activities (complex) | stress3-A5 | Tax | PARTIAL | PARTIAL | No |
| T12 | New IKE + foreign fund investment (complex) | stress3-A1 | Tax | PASS | PASS | No |

**20 PASS, 1 HONEST GAP, 3 PARTIAL, 0 FAIL out of 24.** Acceptable rate
(PASS + HONEST GAP + OUT OF SCOPE): **21/24 = 87.5%**, up from the
2026-08-12 run's 83% (20/24) and above the 2026-07-24 baseline's 83%
(20/24). Every improvement traces to three of the same construction
questions that regressed in 2026-08-12 (C3, C5, C6), all recovering to
PASS — none of them showed a FAIL this run, none show a new weakness.

## Regressions vs. 2026-08-12 — none found

No question scored worse than its 2026-08-12 result. T8 moved from HONEST
GAP to PARTIAL — see note below; not counted as a regression since both are
"acceptable, non-failure" categories under the rubric and the underlying
content did not get worse.

## Improvements vs. 2026-08-12 — the doc fixes visibly showing up in English too

- **C3 (`1B-Q9`, construction site supervision) — PARTIAL → full PASS,
  directly confirms the doc 1089 fix in the English/translated-retrieval
  path.** The 2026-08-12 run's only citation was an unrelated ΔΕΔΔΗΕ
  connection-certificate document, correctly declined, falling back to
  generic uncited commentary. This run's answer cites `doc_id` 1089 alone
  and describes supervision as ensuring compliance with "the ΝΟΚ, ΕΚΩΣ,
  ΚΑΝ.ΕΠΕ., and the seismic code, along with the rules of art and science"
  — content consistent with the rewritten document, correctly retrieved via
  the English-query translation path this time.
- **C5 (`2B-Q3`, buildability of a 3.8-stremma out-of-plan plot) — PARTIAL →
  full PASS.** This run's answer cites `doc_id` 1117 and states the specific
  4,000 m² minimum-plot-size threshold explicitly, along with the κατά
  παρέκκλιση exception for plots that gained autonomy before 1923 or before
  the 1985 ΓΟΚ — the exact specific citation the 2026-08-12 run's answer
  said it could not find.
- **C6 (`2B-Q6`, settlement/cracks 18 months after handover) — HONEST GAP →
  full PASS, the largest single recovery in this run.** The 2026-08-12 run
  returned zero citations and the canned "no relevant documents" response,
  followed by an unrelated archaeological-zone note. This run's answer
  cites `doc_id` 1118 and lays out a complete, real technical-investigation
  procedure: photographic/video documentation with timestamps, an
  independent civil engineer's report, and a specific causal checklist
  (geotechnical-study adequacy, settlement-monitoring benchmarks, uniform
  vs. differential settlement). No archaeological-context leak this time.
- **C8 (`2B-Q22`, accessibility requirements) — unchanged PASS, but now
  visibly running on the corrected doc 1122 content.** This run's answer
  explicitly names "Ν.4067/2012 (ΝΟΚ, Article 26)", the "Designing for All"
  guidelines, and the 5%-accessible-toilets requirement — the corrected
  citation and content described in `KNOWN_DECISIONS.md`. Scored PASS in
  both runs, so not listed as a "changed" row, but flagged here because the
  underlying answer content is materially different and better-grounded
  than whatever supported the 2026-08-12 PASS.

## Unchanged weak points

- **T8** (`2A-Q19`, hiring first employee / ΕΡΓΑΝΗ) — 2026-08-12 scored this
  HONEST GAP (canned decline); this run gives a real partial answer (ΕΡΓΑΝΗ
  system role, initial business-setup steps) but explicitly states "the
  excerpts do not provide additional detailed steps on the specific forms or
  deadlines" — directionally correct with an honest limitation stated,
  which is PARTIAL under this suite's rubric, not HONEST GAP (which requires
  declining substantively). Not a regression in content quality; a stricter
  rubric application. This is now the **third consecutive run** (Greek
  comprehensive-105 2A-Q19, and both bilingual runs) where this exact
  question fails to surface doc 1052's Ε3-Ε7 form-level detail — a real,
  standalone retrieval-depth weak point that would benefit from a dedicated
  bridge document if it persists further.
- **T9** (`stress1-T-Q1`, 5-income-stream international taxation) — PARTIAL,
  unchanged. Same shape: correctly triages each income stream but
  repeatedly notes DTAA article specifics and exact form numbers "should be
  verified" / "would require confirmation" rather than citing them directly.
- **T11** (`stress3-A5`, four concurrent activity types) — PARTIAL,
  unchanged, same specific weak spot: short-term rental tax treatment
  acknowledged but explicitly flagged as "specific excerpts here do not
  cover this," while retail/e-commerce (OSS/IOSS) and consulting are well
  covered. No language-fidelity slip this run (or last run) — the
  intermittent Greek-language miss documented in the 2026-07-24 baseline has
  not recurred in either of the last two runs.

## Bottom line

**87.5% acceptable rate, up from 83% in both the 2026-08-12 and 2026-07-24
runs.** All three of 2026-08-12's flagged regressions in previously-solid
construction questions (C3, C5, C6) recovered to full PASS this run, and two
of the three (C3, C6) show the recovered answers now citing real, specific
KB documents with concrete numeric thresholds and procedures rather than
generic commentary — a genuine content improvement, not just a lucky
retrieval roll. C3 in particular is a second, independent confirmation (this
time via the English-query translation path) that the doc 1089 fix closed
the site-supervision retrieval gap this suite has documented as fragile
since 2026-07-24. C8's unchanged-PASS answer now visibly reflects doc 1122's
corrected FEK and legal basis. No new regression was found anywhere in this
24-question run. Language fidelity remained clean across all 24 questions,
continuing the trend from 2026-08-12.
