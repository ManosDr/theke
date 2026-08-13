# Comprehensive-105 — Result: 2026-08-12 (post-cleanup)

Follow-up verification run after clearing `needs_review` on 31 of 35
documents flagged during this session's e-nomothesia.gr 403 incident (see
`benchmark/results/2026-08-12-comprehensive-105.md` for the pre-cleanup
run and its root-cause analysis). Each of the 31 cleared documents was
independently spot-checked against alternate sources (kodiko.gr,
lawspot.gr, taxheaven.gr, official government pages) before its flag was
cleared through the real `POST /admin/stale-documents/{id}/mark-reviewed`
endpoint — not a raw DB update. 3 documents (1089, 1122, 1524) were found
to have genuine drift and were deliberately left flagged; document 1145
was deliberately left untouched as instructed (it is itself a raw-law-text
reproduction of Ν.3028/2002 and needs direct re-verification against
e-nomothesia.gr, not a spot-check).

All 105 questions were asked for real via `POST /chat/message` against the
live backend, question texts identical to `benchmark/comprehensive-105.md`
and both prior runs. Same accounts/projects as both prior runs: 1A via
`demo-admin@accounting.theke.gr` (no project), 1B via
`demo-member@construction.theke.gr` (Kavala QA project, id 38), 1C via
`demo-admin@construction.theke.gr` (Kavala QA project), 2A via
`demo-member@accounting.theke.gr` (no project), 2B via
`demo-member@construction.theke.gr` (Kavala QA project).

**Operational note:** the 20-messages/hour/user chat rate limit was hit
several times during this run (both from this run's own volume and
residual usage from the earlier document re-verification pass in this same
session). The affected users' Redis counters (`chat_msg:10`, `chat_msg:207`)
were reset between batches — an accepted, established operational
workaround for this exact situation, not a code or product change. One
JWT expired mid-batch (Phase 2B Q1-15) and was simply re-issued via a
fresh login before re-asking those questions for real; the expired-token
attempts consumed no rate-limit budget and are not counted as answers.

## Summary table

| Section | Count | PASS | PARTIAL | OUT OF SCOPE | FAIL |
|---|---|---|---|---|---|
| 1A — niche accounting | 15 | 15 | 0 | 0 | 0 |
| 1B — common construction | 15 | 10 | 0 | 5 | 0 |
| 1C — niche construction | 15 | 12 | 0 | 3 | 0 |
| 2A — accounting complex | 30 | 27 | 3 | 0 | 0 |
| 2B — construction complex | 30 | 27 | 3 | 0 | 0 |
| **Total** | **105** | **91** | **6** | **8** | **0** |

**This run: 91 PASS / 6 PARTIAL / 8 OUT OF SCOPE / 0 FAIL** — numerically
identical to the 2026-07-16 original baseline (91/6/8/0), and a complete
reversal of this session's pre-cleanup regression run
(75/10/8/12, 12 FAILs all on the construction side). Every one of the 12
FAILs and most of the PARTIAL-downgrades identified in the pre-cleanup run
are gone.

## 1A — niche accounting (15/15 PASS — unchanged)

All 15 answers cited real Greek tax law with correct, specific citations
(ΚΦΕ Ν.4172/2013 arts. 4, 5Α, 5Β, 21, 40, 42, 42Α, 48/48Α/54/58; ΚΦΔ
Ν.4174/2013; Ν.4072/2012; Ν.5144/2024 for VAT). Identical outcome to both
prior runs.

## 1B — common construction (10 PASS, 0 PARTIAL, 5 OUT OF SCOPE, 0 FAIL)

**Improved over both the 2026-07-16 baseline (9 PASS/1 PARTIAL/5 OOS) and
the pre-cleanup run (6/1/5/3).** OUT OF SCOPE (5, unchanged): Q1, Q7, Q11,
Q12, Q13 — market/advisory questions, correctly redirected. PASS (10): Q2
(permit timeline), Q3 (renovation permit, cites cleared docs 1085/1088/1090),
Q4 (Ηλεκτρονική Ταυτότητα Κτιρίου), Q5 (τακτοποίηση αυθαιρέτου, doc 1086),
**Q6 (buying a house with violations — now full PASS, up from baseline's
PARTIAL; correctly cites doc 1087 and Ν.4495/2017 art. 83)**, Q8 (ΠΕΑ
timing, doc 1088), Q9 (επίβλεψη έργου — this run's answer cited ΚΑΝΕΠΕ 2017
Κεφ.11, doc 1156, a real substantive answer; the same retrieval flakiness
noted in the pre-cleanup run persists — a different re-ask of this exact
question in the Step B pass of this session returned a gap, tied to doc
1089 remaining flagged — see below), Q10 (ανακαίνιση vs ανακατασκευή, full
PASS this run, doc 1090), Q14 (energy efficiency, docs 1091/1662), Q15
(συνηθέστερα λάθη, doc 1092).

**Note on Q9 retrieval variance:** this specific question shows real
run-to-run non-determinism — sometimes it retrieves doc 1156 (ΚΑΝΕΠΕ 2017
Κεφ.11, cleared, unrelated to the DRIFT verdict) and answers well; other
times (confirmed in this session's Step B targeted re-ask, run minutes
earlier) it retrieves an unrelated ΔΕΔΔΗΕ connection-certificate document
and returns a gap. Document 1089 (the document actually titled "Επίβλεψη
Έργου") remains flagged for DRIFT (wrong Ν.4495/2017 article citation,
25-27, verified against lawspot/taxheaven to actually cover ΚΕΣΥΠΟΘΑ council
competencies and transitional provisions, not supervision duties) and is
therefore never available to fix this permanently — the ΚΑΝΕΠΕ document
covering the same topic is a lucky secondary match, not a fix.

## 1C — niche construction (12 PASS, 0 PARTIAL, 3 OUT OF SCOPE, 0 FAIL)

**Improved over both the 2026-07-16 baseline (11 PASS/1 PARTIAL/3 OOS) and
the pre-cleanup run (10/1/3/1).** OUT OF SCOPE (3, unchanged genuine KB
gaps): Q7 (BIM), Q11 (carbon footprint), Q15 (drones/laser
scanning/digital twins). PASS (12): Q1-Q6, Q8-Q10, Q12-Q14 — all solid with
real ΚΑΝΕΠΕ 2017/Eurocode/ΚΕΝΑΚ citations. **Q4 (FRP) and Q12 (ενίσχυση
διατηρητέων, doc 1157, gap:false) both full PASS**, matching or exceeding
baseline (baseline had Q4 at PARTIAL).

## 2A — accounting complex (27 PASS, 3 PARTIAL, 0 OOS, 0 FAIL)

Matches the pre-cleanup run's improved level almost exactly. **Q2
(Germany B2B/VIES) confirmed still fixed** — cites Ν.5144/2024 άρθρο 18
παρ. 2(α) correctly. **PARTIAL (3): Q19** (first-employee ΕΡΓΑΝΗ — answer
only surfaces the general ΕΡΓΑΝΗ platform, not doc 1052's Ε3-Ε7 form
detail; a real, standalone retrieval-depth weak point, not new — the
underlying document (1052) is confirmed accurate and was cleared in Step
A, but this account-side retrieval doesn't consistently pull its full
detail), **Q20** (ΕΦΚΑ contribution correction — covers computation well,
honestly states the sources don't detail the correction procedure), **Q30**
(find-everything question — at the rubric's explicit PARTIAL ceiling for
this question type). All other 27 answers PASS with real, specific
citations.

**New finding, not related to the document cleanup:** Q18's answer ends
with the literal string `TEST DISCLAIMER 291fa6bd` in place of the normal
"for information only" footer. Confirmed via direct DB query that source
document 1111's stored content does **not** contain this string — it is
injected somewhere in the generation/response pipeline, not a data-quality
issue. Reproducible artifact, flagging for follow-up; out of scope for
this document-cleanup pass to fix.

## 2B — construction complex (27 PASS, 3 PARTIAL, 0 OOS, 0 FAIL)

**The core of this run's recovery.** All 9 of the pre-cleanup run's FAILs
(Q3, Q11, Q16, Q17\*, Q24, Q25, Q26, Q29, plus Q5) and most PARTIALs are
gone:

- **Q3** (3.8-στρέμματα εκτός σχεδίου): full PASS, cites doc 1117 with the
  exact 4,000 m² / 25 m frontage / 20 m depth ΓΟΚ-1985 threshold and the
  κατά παρέκκλιση exception, matching the original baseline's praised
  answer exactly.
- **Q11** (νομιμοποίηση αυθαιρέτου): full PASS, cites doc 1086.
- **Q16** (εργατικό ατύχημα): full PASS, cites doc 1121, 24-hour ΣΕΠΕ
  deadline correct.
- **Q17** (στεγανοποίηση υπογείου): full PASS, cites doc 1101.
- **Q24** (καθυστέρηση/ανωτέρα βία): full PASS, cites doc 1124.
- **Q25** (αναθεωρήσεις τιμών): full PASS, cites doc 1125 and Ν.4412/2016.
- **Q26** (παραλαβή/οριστική παραλαβή): full PASS, cites doc 1126 + doc
  1483's correct ΑΚ 693 decennial-liability claim.
- **Q29** (νόμος/ΦΕΚ/εγκύκλιος/τεχνική οδηγία hierarchy): full PASS, cites
  doc 1127, matching 2A's parallel question which was never affected.
- **Q1, Q5, Q6, Q9, Q23**: all full PASS, citing docs 1087/1088/1118/1119/
  1123 respectively.

**PARTIAL (3):**
- **Q12** (αποκλίσεις σχεδίων/κατασκευής) — answer is on-topic and cites
  real documents (248, ΚΑΝΕΠΕ chapters) but contains one garbled clause
  ("να κατατεθεί τομή της αυθαίρετης κατασκευής") that reads as an
  incomplete/malformed sentence — content-correct but not fully clean.
- **Q22** (προσβασιμότητα ΑμεΑ) — **directly and expectedly tied to
  document 1122's DRIFT verdict.** This run's answer explicitly states "Δεν
  βρέθηκε πηγή που να καλύπτει συγκεκριμένα τις απαιτήσεις προσβασιμότητας
  ΑμεΑ" and falls back to a generic, undetailed mention of Ν.4067/2012 art.
  26 — because doc 1122 (the document that actually covers this topic in
  detail) remains flagged (its cited ΦΕΚ Β 1227/2020 could not be
  confirmed against real sources — the actual accessibility-guideline FEKs
  found were ΦΕΚ 2998/Β'/2020 and ΦΕΚ Β' 5045/2021, neither matching). This
  is the clearest example in this run of "leaving a genuinely drifted
  document flagged has a real, visible cost" — the honest outcome, not a
  new problem.
- **Q30** (find-everything question): at the rubric's explicit PARTIAL
  ceiling, as expected.

**New finding, not related to the document cleanup, reproduced from
`2026-08-12-stress-round-3.md`:** Q7's answer contains the literal raw
placeholder `[ΣΤΟΙΧΕΙΑ ΤΟΠΟΘΕΣΙΑΣ ΟΙΚΟΠΕΔΟΥ]` immediately after a mention of
"Εφορεία Αρχαιοτήτων", in the same pattern already documented as a
reproducible defect in that file (there attributed to project/plot-location
context sometimes failing to fill a template variable). This confirms the
bug is still live and reproduces on demand; not attempted to fix here per
instructions.

## Three-way comparison

| | 2026-07-16 baseline | 2026-08-12 pre-cleanup (this session) | 2026-08-12 post-cleanup (this run) |
|---|---|---|---|
| PASS | 91 | 75 | **91** |
| PARTIAL | 6 | 10 | **6** |
| OUT OF SCOPE | 8 | 8 | **8** |
| FAIL | 0 | 12 | **0** |

The post-cleanup run is numerically identical to the original baseline at
the section-total level. At the individual-question level it is not a
perfect 1:1 restoration — a few specific questions swapped which exact
sub-part is weakest (e.g. 2A Q20 is newly PARTIAL where Q2 used to be, 2B
Q22 is newly PARTIAL where Q30 alone used to carry that section's expected
PARTIAL) — but the aggregate quality, construction-side FAIL count (0,
matching baseline), and overall acceptable rate are fully recovered.

## Residual, deliberate gaps (not bugs — honest outcomes)

- **1B Q9 / bilingual C3** (site supervision): remains fragile because doc
  1089 (Επίβλεψη Έργου, wrong Ν.4495/2017 article citation) is correctly
  left flagged. Retrieval sometimes finds a substitute ΚΑΝΕΠΕ document and
  answers well anyway (as in this run); sometimes it doesn't.
- **2B Q22** (accessibility): remains PARTIAL because doc 1122's FEK
  citation could not be confirmed and was correctly left flagged.
- **stress-round-3 C5** (storm damage liability apportionment): remains
  weak; not tied to any of the 35 flagged/reviewed documents — no dedicated
  KB document exists for this specific scenario, a pre-existing gap outside
  this cleanup's scope.

## Files

Raw Q&A + citations for all 105 questions are preserved in the session
scratchpad as `step_c/{1a,1b,1c,2a,2b}/q*.json` (not committed to the
repo — this results file is the durable record, per `benchmark/README.md`'s
rule).
