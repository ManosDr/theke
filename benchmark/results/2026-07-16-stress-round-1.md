# Stress round 1 — Result: 2026-07-16

**Baseline run.** No prior per-question scores exist for this set (original
run predates `benchmark/` and was never saved to the repo — see
`benchmark/README.md`). This is `baseline_established: 2026-07-16`, run
against the question texts in `benchmark/stress-round-1.md` exactly as
supplied by the project owner.

Accounts/projects: construction via `demo-member@construction.theke.gr`
(Kavala QA project, id 38); accounting via
`demo-member@accounting.theke.gr` (no project). Killer prompt embedded
this file's own Construction Q1 (property-transfer-with-multiple-
violations case).

## Summary table

| # | Question | Result |
|---|---|---|
| Construction Q1 | Property transfer, multiple violations | PASS |
| Construction Q2 | Conflicting legislation (ΥΔΟΜ vs engineer) | PASS |
| Construction Q3 | Liability after project handover | PASS |
| Accounting Q1 | Complex international taxation (5 income types) | PASS |
| Accounting Q2 | myDATA + ΦΠΑ + OSS | PARTIAL |
| Accounting Q3 | ΑΑΔΕ audit (Revolut/family transfers) | PASS |
| Killer prompt | Strict-citation, no-guessing instruction | PASS |

**6 PASS, 1 PARTIAL, 0 FAIL, 0 fabrication** across all 7 items.

## Notes

**Construction Q1** — correctly distinguished which violations require
tidying before transfer (κλειστός ημιυπαίθριος, αυθαίρετη αποθήκη) from
which can be declared only in the Electronic Building ID (interior stair
relocation, façade window position), gave the correct action order, and
cited real articles (83, 96, 97 of Ν.4495/2017, ΦΕΚ Α 167/2017). No
conflicting interpretations were found in the KB and the model said so
plainly rather than inventing one.

**Construction Q2** — correctly applied the legal hierarchy (newer,
more specific law — Ν.4495/2017 — prevails over Ν.4030/2011 and over
circulars), but honestly stated it could not identify the specific point
of disagreement between the ΥΔΟΜ and the private engineer since no source
in the KB covers that particular dispute. This is the right behavior:
correct framework + honest limitation, not a fabricated resolution.

**Construction Q3** — thorough coverage of technical causes (cracked
beams, water ingress, tile detachment, settling), contractor/supervising-
engineer/owner liability split, the ten-year hidden-defect liability
period, both types of πραγματογνωμοσύνη, and the document checklist
needed before litigation.

**Accounting Q1** — covered all five income streams (US remote salary,
IKE corporate income, UK royalties, Airbnb, Bitcoin) with correct forms
(Ε1, Ε3) and honestly flagged where it couldn't confirm a specific DTA
provision applies without a licensed accountant's confirmation, rather than
asserting one.

**Accounting Q2 — PARTIAL.** Correct substance throughout (OSS threshold
and mechanism, B2B zero-rating with VIES verification, B2C via OSS,
non-EU customers outside Greek VAT scope, myDATA exemption code 14,
monthly VIES summary for B2B only). However the citation list at the end
includes "Ν.2859/2000 άρθρα 14, 47α-47γ" alongside the correct
Ν.5144/2024 — **the same pre-existing repealed-law citation issue flagged
in `2026-07-16-stress-round-3.md` (A2) and `2026-07-16-comprehensive-105.md`
(2A-Q2)**, traced there to bridge documents 1523-1525 whose own stored
content cites the now-superseded Ν.2859/2000. Not new, not model
fabrication, not fixed here per the verification-pass-only instruction —
recorded as the third independent occurrence of the same underlying
content-staleness bug.

**Accounting Q3** — correctly cited ΚΦΔ article 28 (unexplained bank
deposits presumption, burden on the taxpayer to rebut), DAC7/Ν.4923/2022
for Revolut's reporting obligation to ΑΑΔΕ, the taxpayer's right to appeal
to ΔΕΔ before litigation, and the required evidence list.

**Killer prompt** — followed the strict-citation instruction well: cited
real article numbers (83, 96, 97 of Ν.4495/2017) for every claim, and
explicitly stated "δεν υπάρχει από τις διαθέσιμες πηγές σημείωση για
διαφορετικές ερμηνείες" rather than inventing a conflict where none was
found in the retrieved sources. This matches the documented outcome from
the original round quoted in `stress-round-1.md` (correct citation,
correct tidy-vs-declare distinction, no fabrication) — consistent, not
regressed.

## Bottom line

0 FAIL, 0 fabrication. The one PARTIAL is a known, already-disclosed,
pre-existing content-staleness issue (repealed-law citation baked into a
bridge document), not a new defect. This is the fresh baseline for future
comparison runs.
