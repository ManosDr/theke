# Comprehensive-105 — Result: 2026-07-16

**Baseline run.** No prior per-question scores exist for this set (original
run predates `benchmark/` and was never saved to the repo — see
`benchmark/README.md`). This is `baseline_established: 2026-07-16`, run
against the question texts in `benchmark/comprehensive-105.md` exactly as
supplied by the project owner.

Accounts/projects used: as specified in `comprehensive-105.md` — 1A via
`demo-admin@accounting.theke.gr` (no project), 1B via
`demo-member@construction.theke.gr` (Kavala QA project, id 38), 1C via
`demo-admin@construction.theke.gr` (Kavala QA project), 2A via
`demo-member@accounting.theke.gr` (no project), 2B via
`demo-member@construction.theke.gr` (Kavala QA project).

## Summary table

| Section | Count | PASS | PARTIAL | OUT OF SCOPE | FAIL |
|---|---|---|---|---|---|
| 1A — niche accounting | 15 | 15 | 0 | 0 | 0 |
| 1B — common construction | 15 | 9 | 1 | 5 | 0 |
| 1C — niche construction | 15 | 11 | 1 | 3 | 0 |
| 2A — accounting complex | 30 | 27 | 3 | 0 | 0 |
| 2B — construction complex | 30 | 29 | 1 | 0 | 0 |
| **Total** | **105** | **91** | **6** | **8** | **0** |

Zero FAILs across all 105 questions. The 8 OUT OF SCOPE calls are all
correctly-handled honest gaps (5 in 1B are market/advisory questions with
no fabricated numbers, per that section's explicit scoring note; 3 in 1C
are genuine niche-technology KB gaps, discussed below) — not defects.

## 1A — niche accounting (15/15 PASS)

All 15 answers cited real Greek tax law (ΚΦΕ Ν.4172/2013 articles 4, 5Α,
5Β, 21, 40, 42, 42Α, 48Α; ΚΦΔ Ν.4174/2013; Ν.4072/2012 for ΙΚΕ formation),
correctly handled compound/edge-case scenarios (stock options vs RSUs vs
ESOPs distinguished correctly, digital-nomad visa vs tax-residency
correctly separated as distinct questions), and honestly flagged narrower
sub-gaps inline rather than fabricating (e.g. Q1 notes the KB doesn't cover
startup-specific ESOP certification detail beyond the general regime, then
gives the correct general regime anyway).

## 1B — common construction (9 PASS, 1 PARTIAL, 5 OUT OF SCOPE)

Per this section's own scoring note: **Q1, Q7, Q11, Q12, Q13 are
market/advisory questions with no authoritative regulatory source** (cost
per m², cost of a static study, choosing a reliable contractor, renovation
duration, best value-for-money materials). All 5 were honestly redirected
with no fabricated numbers — correctly scored **OUT OF SCOPE**, matching
the rubric exactly.

**Q9, Q10, Q14, Q15 accept TECHNICAL JUDGMENT if a regulatory framework is
cited.** Q9 (επίβλεψη έργου), Q14 (energy efficiency), and Q15 (common
construction mistakes) all cited real frameworks (Ν.4495/2017 arts. 25-27,
ΝΟΚ/ΕΚΩΣ/ΚΑΝ.ΕΠΕ.) — **PASS**. Q10 (renovation vs. reconstruction) gave a
correct, cited definition of ανακαίνιση but explicitly said the source
doesn't define ανακατασκευή — **PARTIAL**: honest about the gap, but only
half the question got a framework-backed answer.

The remaining 9 (Q2, Q3, Q4, Q5, Q6, Q8, Q9, Q14, Q15) are straightforward
regulatory questions and all PASS with real citations.

## 1C — niche construction (11 PASS, 1 PARTIAL, 3 OUT OF SCOPE)

Per this section's scoring note, Q1, Q2, Q5, Q6, Q9, Q10, Q11, Q13, Q14,
Q15 accept TECHNICAL JUDGMENT if Greek technical standards are cited
(ΚΑΝΕΠΕ, ΕΚΩΣ, ΚΤΧ-2008, Ευρωκώδικες), and Q3, Q4, Q8 expect a specific
regulatory basis (Type KB). **Q7 and Q12 are not covered by either
exception** — standard base rubric applies.

- PASS (11): Q1 (πασσάλους/πέδιλα — Ευρωκώδικας 7), Q2 (γεωτεχνική
  κόστος), Q3 (σεισμική αποτίμηση — ΚΑΝ.ΕΠΕ. 2017), Q5 (τύπος σκυροδέματος
  — ΚΤΣ-2016/Ευρωκώδικας 2/ΕΛΟΤ ΕΝ 206), Q6 (χάλυβας vs σκυρόδεμα), Q8
  (θερμογέφυρες — ΚΕΝΑΚ Ν.4122/2013), Q9 (προκατασκευή), Q10
  (στεγανοποίηση), Q12 (ενίσχυση διατηρητέων — ΥΔΟΜ + Εφορεία
  Αρχαιοτήτων/Ν.3028/2002, confirms the fix from an earlier session round
  is still holding), Q13 (παθητικά κτίρια/NZEB — Ν.4122/2013 + EPBD
  2010/31/EU), Q14 (ποιοτικός έλεγχος — Ν.4495/2017 arts. 25-27, ΕΛΟΤ ΕΝ
  206).
- PARTIAL (1): Q4 (FRP ενίσχυση, Type KB expected) — technically solid
  content, real citation, but doesn't name a specific standard in prose the
  way Q3/Q8 do; a minor miss against the "Type KB" expectation, not a
  content defect.
- OUT OF SCOPE (3, genuine KB gaps, correctly declined without
  fabrication): **Q7 (BIM)**, **Q11 (carbon-footprint calculation)**,
  **Q15 (drones/laser scanning/digital twins)**. All three hit true
  near-zero search results and correctly triggered a gap response rather
  than inventing an answer. Q7 and Q15 additionally surfaced the
  project's archaeological-flag boilerplate (expected, documented
  behavior for project 38 — see project memory — not a new finding).
  **Flagging for future KB expansion**: these three questions describe a
  real, disclosed content gap in "modern construction technology
  awareness" topics (BIM, carbon accounting, digital surveying) — none of
  the current ingestion sources cover this ground. Not a regression, not
  fabrication, but a legitimate roadmap item if the product wants to
  cover these topics.

## 2A — accounting complex scenarios (27 PASS, 3 PARTIAL)

All 30 multi-issue scenarios got structured, well-cited answers (VAT
registration/OSS/IOSS thresholds, RSU/crypto/freelancer cross-border
taxation, tax audits, myDATA reconciliation, M&A tax neutrality, transfer
pricing, donations/inheritance brackets). Per the rubric, **Q30 has PARTIAL
as its acceptable ceiling** ("find all relevant laws/FEK/circulars for a
case") — it correctly hit that ceiling: cited the real hierarchy principle
(newer/more specific law prevails) but honestly declined to enumerate an
exhaustive, case-specific list, redirecting to myAADE/a licensed
professional. Scored **PARTIAL as expected**, not a defect.

Two other PARTIALs:
- **Q2** (Greek company → German B2B services, VAT/VIES): correct
  reverse-charge substance, but cites "άρθρο 14 του Ν.2859/2000" for the
  legal basis. **This is the same pre-existing stale-citation issue
  flagged in Set 3's A2 result** (`2026-07-16-stress-round-3.md`) — traced
  there to a bridge document (doc_id 1523-1525) whose own stored
  "Νομική βάση" line cites the now-repealed Ν.2859/2000 (superseded
  2024-10-11 by Ν.5144/2024). Not a new defect and not model fabrication —
  the model is faithfully quoting stale content in the KB. Per this run's
  "verification pass only" instruction, **not fixed here**; see the
  content-staleness note carried over from Set 3.
- **Q19** (first-employee ΕΡΓΑΝΗ declarations): correctly answered what it
  could, then explicitly and specifically named what the KB doesn't cover
  ("δεν βρέθηκε πηγή που να καλύπτει... τις ακριβείς δηλώσεις") instead of
  guessing. Honest, specific gap — PARTIAL, not a failure.

## 2B — construction complex scenarios (29 PASS, 1 PARTIAL)

All 30 answers were strong: property-transfer irregularities, small-scale
vs. full building permits, plot-size buildability (with the correct
4,000 m² ΓΟΚ-1985 threshold and pre-1923 exception), structural deviation
handling, seismic assessment (ΚΑΝ.ΕΠΕ. 2017), FRP reinforcement (with the
correct ΥΠΠΟΑ approval caveat for listed buildings), accessibility
requirements, horizontal-property formation, contract delay/force majeure,
public-works price revision (Ν.4412/2016), and legal-hierarchy questions.
As with 2A, **Q30 correctly hit its PARTIAL ceiling** — cited the real
hierarchy (Constitution → law → circular/technical guidance, newer/more
specific law prevails) without fabricating a case-specific exhaustive list.

## Cross-cutting findings (not new regressions — disclosed for the record)

1. **Repealed-law citation (Ν.2859/2000)** appears in 2A-Q2 and in Set 2's
   Stress-Accounting-Q2 (this run), in addition to Set 3's A2 (prior run).
   Traced to bridge documents 1523-1525's own stored content, not model
   fabrication. Confirmed pre-existing, not caused by anything in this
   session's recent commits. Flagged, not fixed, per the verification-pass
   instruction.
2. **Three genuine "modern construction technology" KB gaps** (1C-Q7 BIM,
   1C-Q11 carbon footprint, 1C-Q15 drones/digital twins) — correctly
   handled as honest gaps, not failures, but a real content-coverage
   roadmap item if desired.

## Bottom line

0 FAIL out of 105. Every OUT OF SCOPE and PARTIAL call matches this
section's own documented scoring exceptions or reflects an already-known,
pre-existing, non-regressive content issue. This is the fresh baseline for
future comparison runs.
