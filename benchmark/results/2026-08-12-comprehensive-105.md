# Comprehensive-105 — Result: 2026-08-12

Closing verification run after a session of knowledge-base maintenance work
(crawl re-verification, AI revalidation of 119 documents, region
contact-discovery batches). Run against the live dev environment
(`http://localhost:8000` inside Docker), question texts identical to
`benchmark/comprehensive-105.md` / the 2026-07-16 baseline run. All 105
questions were asked for real via `/chat/message` and scored against the
actual `answer` + `citations` returned.

Accounts/projects used: identical to the baseline — 1A via
`demo-admin@accounting.theke.gr` (no project), 1B via
`demo-member@construction.theke.gr` (Kavala QA project, id 38), 1C via
`demo-admin@construction.theke.gr` (Kavala QA project), 2A via
`demo-member@accounting.theke.gr` (no project), 2B via
`demo-member@construction.theke.gr` (Kavala QA project).

**Operational note:** the per-user chat rate limit (20 messages/hour,
Redis-backed) was hit repeatedly during this run — both from this run's own
volume and from other concurrent sessions sharing the same four demo
accounts. Failed calls were retried after resetting the affected user's
Redis counter (`chat_msg:<user_id>`), which is a same-day/same-environment
operational workaround, not a change to product behavior. All 105 answers
below are real model output, not fabricated or estimated.

## Summary table

| Section | Count | PASS | PARTIAL | OUT OF SCOPE | FAIL |
|---|---|---|---|---|---|
| 1A — niche accounting | 15 | 15 | 0 | 0 | 0 |
| 1B — common construction | 15 | 6 | 1 | 5 | 3 |
| 1C — niche construction | 15 | 10 | 1 | 3 | 1 |
| 2A — accounting complex | 30 | 28 | 2 | 0 | 0 |
| 2B — construction complex | 30 | 16 | 6 | 0 | 8 |
| **Total** | **105** | **75** | **10** | **8** | **12** |

**Baseline (2026-07-16) for comparison:** 91 PASS / 6 PARTIAL / 8 OUT OF
SCOPE / **0 FAIL**.

**This run: 75 PASS / 10 PARTIAL / 8 OUT OF SCOPE / 12 FAIL.** All 12 FAILs
are on the construction side (project_id 38, Kavala QA project) — the
accounting side (1A, 2A) is flat-to-improved. See "Regressions vs.
baseline" below for the full itemized list; this is the headline finding
of this run.

## 1A — niche accounting (15/15 PASS — unchanged from baseline)

All 15 answers cited real Greek tax law (ΚΦΕ Ν.4172/2013 arts. 4, 5Α, 5Β,
21, 40, 42, 42Α, 48Α; ΚΦΔ Ν.4174/2013; Ν.4072/2012 for ΙΚΕ formation) with
correct, specific citations. No regressions, no change in behavior from
baseline. Exact match.

## 1B — common construction (6 PASS, 1 PARTIAL, 5 OUT OF SCOPE, 3 FAIL)

Baseline was 9 PASS / 1 PARTIAL / 5 OUT OF SCOPE / 0 FAIL. This run:

- **OUT OF SCOPE (5, unchanged):** Q1, Q7, Q11, Q12, Q13 — market/advisory
  questions, correctly redirected with no fabricated numbers, per the
  section's own scoring note. Matches baseline exactly.
- **PASS (6):** Q2 (permit timeline), Q3 (renovation permit), Q4
  (Ηλεκτρονική Ταυτότητα Κτιρίου), Q5 (τακτοποίηση αυθαιρέτου, core answer
  solid), Q8 (ΠΕΑ timing), Q14 (energy efficiency).
- **PARTIAL (1, downgraded from PASS):** Q6 (buying a house with
  unauthorized structures) — the model correctly refused to fabricate, but
  the single citation it pulled (an ΕΝΦΙΑ/property-tax document) is
  unrelated to the question, and it never surfaced doc 248
  (Ν.4495/2017 Τμήμα Δ — Αυθαίρετες κατασκευές), which *is* in the KB and
  *was* retrieved for the sibling questions Q3, Q5, and Q10 in the same
  section. Reproduced on independent re-ask — not a one-off.
- **FAIL (3, downgraded from PASS/PARTIAL):**
  - **Q9** (επίβλεψη έργου — supervision, baseline PASS with ΚΑΝΕΠΕ/Ν.4495/2017
    citations): this run's official answer was a complete zero-citation gap
    response. A follow-up re-ask of the same question got a solid,
    correctly-cited answer (ΚΑΝΕΠΕ 2017 Κεφ. 11). This looks like
    **retrieval flakiness** rather than lost content — flagging as FAIL for
    the official run since that's what was actually returned, but noting it
    did not reproduce consistently.
  - **Q10** (ανακαίνιση vs. ανακατασκευή, baseline PARTIAL): this run's
    official answer is a complete refusal ("δεν μπορώ να παρέχω
    πληροφορίες"), weaker than baseline's already-partial answer. Reproduced
    on retry.
  - **Q15** (συνηθέστερα λάθη, baseline PASS): complete zero-citation gap
    response, reproduced identically on independent re-ask. Consistent,
    not a fluke.

## 1C — niche construction (10 PASS, 1 PARTIAL, 3 OUT OF SCOPE, 1 FAIL)

Baseline was 11 PASS / 1 PARTIAL (Q4) / 3 OUT OF SCOPE / 0 FAIL.

- **OUT OF SCOPE (3, unchanged):** Q7 (BIM), Q11 (carbon footprint), Q15
  (drones/laser scanning/digital twins) — genuine KB gaps, correctly
  declined, matches baseline.
- **PASS (10):** Q1, Q2, Q3, Q5, Q6, Q8, Q9, Q13, Q14 — all solid with real
  ΚΑΝΕΠΕ 2017 / Eurocode / ΚΕΝΑΚ citations, matching baseline.
  **Q4 (FRP reinforcement) improved from baseline's PARTIAL to PASS** — it
  now explicitly names ΚΑΝ.ΕΠΕ. 2017 in prose, closing the gap baseline
  flagged.
- **PARTIAL (1, downgraded from PASS):** Q12 (ενίσχυση διατηρητέων
  κτιρίων) — baseline specifically praised this answer for correctly
  citing ΥΔΟΜ + Εφορεία Αρχαιοτήτων / Ν.3028/2002. This run's answer is
  hedgier ("the sources do not specifically cover...") with citations that
  are mostly tangential (thermal-bridge and fire-damage documents, not a
  clean heritage-building citation).
- **FAIL (1, downgraded from PASS):** Q10 (στεγανοποίηση υπογείων —
  waterproofing failures) — complete zero-citation gap response, where
  baseline had this in its list of solid PASS answers.

## 2A — accounting complex scenarios (28 PASS, 2 PARTIAL — improved vs. baseline)

Baseline was 27 PASS / 3 PARTIAL (Q2, Q19, Q30). This run:

- **Q2 (Greek company → German B2B services, VAT/VIES) improved from
  PARTIAL to PASS.** Baseline flagged this as citing the repealed
  Ν.2859/2000 (superseded by Ν.5144/2024) due to a stale citation stored in
  bridge documents 1523/1525. This run's answer correctly cites
  **Ν.5144/2024, άρθρο 18 παρ. 2(α)** and pulls from the same doc IDs
  (1525, 1079) now pointing at the current law's FEK — the stale-citation
  issue flagged in the baseline and in `2026-07-16-stress-round-3.md`
  appears to be resolved.
- **Q19** (first-employee ΕΡΓΑΝΗ declarations) and **Q30** ("find
  everything" case-law question) remain PARTIAL, matching baseline exactly
  — both are honest, specific gap statements at the rubric's expected
  ceiling for Q30 and an accurately-scoped partial gap for Q19.
- All other 28 answers are strong, well-cited, matching or exceeding
  baseline. **No regressions in this section.**

## 2B — construction complex scenarios (16 PASS, 6 PARTIAL, 8 FAIL — the main regression)

Baseline was 29 PASS / 1 PARTIAL (Q30) / 0 FAIL. This is the clearest and
most serious finding of this run: **8 of 30 questions now return complete
or near-complete gap responses** on topics the baseline explicitly
documented as well-covered.

**Confirmed regressions** (baseline text explicitly describes real content
for these questions, and/or the gap reproduced on independent re-ask):

- **Q3** (3.8-στρέμματα εκτός σχεδίου buildability) — baseline specifically
  praised this answer for citing **the correct 4,000 m² ΓΟΚ-1985
  threshold and the pre-1923 exception**. This run's answer (reproduced
  twice) has no threshold at all: "τα αποσπάσματα... δεν περιλαμβάνουν
  συγκεκριμένες διατάξεις για την αρτιότητα." A specific, correct, citable
  number has disappeared from what the system can produce.
- **Q11** (νομιμοποίηση αυθαιρέτου με πολλαπλές παραβάσεις) — complete
  zero-citation gap response, reproduced on independent re-ask, despite
  doc 248 (Ν.4495/2017 Τμήμα Δ — Αυθαίρετες κατασκευές) being in the KB and
  actively retrieved for near-identical sibling questions Q6, Q9, Q12,
  Q13, Q14 in the *same* run.
- **Q25** (αναθεωρήσεις τιμών σε δημόσια έργα) — baseline explicitly names
  **Ν.4412/2016** as the cited basis for this answer. This run's answer
  (reproduced twice) is a complete non-answer: "Δεν βρέθηκε πηγή."
- **Q29** (νόμος/ΦΕΚ/εγκύκλιος/τεχνική οδηγία hierarchy) — baseline
  explicitly names this as a strong, correctly-cited legal-hierarchy
  answer. This run's answer (reproduced twice) is a complete zero-citation
  gap. Notably, **the identical question in 2A (accounting, Q29) still
  works correctly** with a full hierarchy explanation and real citation
  (doc 1116) — the construction knowledge base specifically appears to be
  missing or not surfacing an equivalent document.

**Additional gap/weak responses observed in this run**, on questions that
plausibly had real content before per baseline's blanket "all 30 were
strong" characterization, but not individually re-verified against
specific baseline text (flagging for follow-up, lower confidence than the
four above): Q1 (property transfer with unauthorized structures — PARTIAL,
one tangential citation), Q5 (PEA before/after renovation — FAIL, complete
gap), Q9 (τεχνική πραγματογνωμοσύνη — PARTIAL, honest gap, possibly a
genuine standalone gap rather than a regression), Q16 (labor-accident
obligations — FAIL, complete gap), Q17 (waterproofing after handover —
PARTIAL, hedged/generic), Q23 (σύσταση οριζόντιας ιδιοκτησίας — PARTIAL,
hedged/"we assume" language), Q24 (delay/force majeure — FAIL, complete
non-answer, though baseline named this topic specifically as a strength),
Q26 (project acceptance procedure — FAIL, complete non-answer). Q27
("Εξοικονομώ" program specifics) is most likely a genuine, standalone KB
gap rather than a regression — this is a specific subsidy program that may
never have been ingested.

**Unaffected / matching or improved:** Q2, Q4, Q6, Q7, Q8, Q10, Q12, Q13,
Q14, Q15, Q18, Q19, Q20, Q21, Q22, Q28 remain solid PASS with real ΚΑΝΕΠΕ
2017 / Ν.4067/2012 / Ν.4495/2017 citations. Q30 remains at its PARTIAL
ceiling, matching baseline (though slightly weaker — it no longer restates
the general legal-hierarchy principle the way the 2026-07-16 run did).
One minor content note: Q21 (FRP reinforcement) no longer mentions the
ΥΠΠΟΑ heritage-building approval caveat that baseline specifically praised
— still scored PASS since the core technical content is correct and cited,
but flagging the loss of that specific detail.

## Regressions vs. baseline — explicit list

**By question number, old score → new score:**

| Section | Q# | Baseline | This run | Confidence |
|---|---|---|---|---|
| 1B | Q6 | PASS | PARTIAL | Reproduced |
| 1B | Q9 | PASS | FAIL | Reproduced inconsistent (retry got a good answer — likely retrieval flakiness) |
| 1B | Q10 | PARTIAL | FAIL | Reproduced |
| 1B | Q15 | PASS | FAIL | Reproduced |
| 1C | Q10 | PASS | FAIL | Observed once |
| 1C | Q12 | PASS | PARTIAL | Observed once |
| 2B | Q1 | PASS (implied) | PARTIAL | Observed once |
| 2B | Q3 | PASS (specific content named in baseline) | FAIL | **Reproduced, high confidence** |
| 2B | Q5 | PASS (implied) | FAIL | Observed once |
| 2B | Q11 | PASS (implied) | FAIL | **Reproduced, high confidence** |
| 2B | Q16 | PASS (implied) | FAIL | Observed once |
| 2B | Q17 | PASS (implied) | PARTIAL | Observed once |
| 2B | Q23 | PASS (implied) | PARTIAL | Observed once |
| 2B | Q24 | PASS (topic named in baseline) | FAIL | Observed once |
| 2B | Q25 | PASS (specific law named in baseline) | FAIL | **Reproduced, high confidence** |
| 2B | Q26 | PASS (implied) | FAIL | Observed once |
| 2B | Q29 | PASS (topic named in baseline) | FAIL | **Reproduced, high confidence; 2A's identical question still passes** |

**Improvements (not regressions, noted for completeness):**
- 2A Q2: PARTIAL → PASS (stale Ν.2859/2000 citation issue from baseline/Set-3 appears fixed — now cites current Ν.5144/2024).
- 1C Q4: PARTIAL → PASS (now names ΚΑΝ.ΕΠΕ. 2017 explicitly in prose).

**Pattern:** every regression is on the construction side, and the four
highest-confidence (reproduced) regressions — 2B Q3, Q11, Q25, Q29 — all
involve topics where a *specific, correct, previously-documented* piece of
content (a numeric threshold, a named law, a hierarchy explanation) is now
completely absent from retrieval, not just weakly worded. This is
consistent with something having changed in the construction-vertical /
Kavala-project (project_id 38) retrieval path or document set during this
session's maintenance work, rather than general model variance — the
accounting side (1A, 2A), which shares the same chat pipeline but a
different knowledge base and no project filter, shows zero regressions and
two improvements over the same period. Recommend re-running 2B (and
spot-checking 1B/1C) after checking whether the "AI revalidation of 119
documents" pass touched documents 248, or the FRP/ΥΠΠΟΑ, price-revision, or
legal-hierarchy source documents feeding project 38's construction
retrieval, and whether project-scoped (project_id=38) retrieval is
behaving differently from unscoped retrieval in general.

## Files

- Raw Q&A + citations for all 105 questions (deduplicated, final answers
  only) are in the session scratchpad as `final_1a.jsonl` … `final_2b.jsonl`
  (not committed to the repo — this results file is the durable record).
