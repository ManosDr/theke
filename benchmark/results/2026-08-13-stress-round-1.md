# Stress round 1 — Result: 2026-08-13

Final closing-verification run, diffed against `2026-08-12-stress-round-1.md`
(the most recent snapshot for this file — note that file itself carried no
diffable baseline from before it, per its own header, so this is the first
run of stress-round-1 with a real prior score to compare against). Same
question texts as `benchmark/stress-round-1.md`, same accounts/projects:
construction via `demo-member@construction.theke.gr` (Kavala QA project, id
38); accounting via `demo-member@accounting.theke.gr` (no project). Killer
prompt embedded Construction Q2 (conflicting-legislation / ΥΔΟΜ-vs-engineer
case), same choice as the 2026-08-12 run for a like-for-like comparison.

Run executed synchronously against the live backend at
`http://localhost:8000`. The `chat_msg:10` / `chat_msg:207` Redis counters
were cleared before this run per the established rate-limit workaround; all
8 questions (7 + killer prompt) completed in a single pass with no retries
needed.

## Summary table

| # | Question | 2026-08-12 | 2026-08-13 (this run) | Changed? |
|---|---|---|---|---|
| Construction Q1 | Property transfer, multiple violations | HONEST GAP | **PASS** | **Yes — improved** |
| Construction Q2 | Conflicting legislation (ΥΔΟΜ vs engineer) | PASS | PASS | No |
| Construction Q3 | Liability after project handover | HONEST GAP | **PASS** | **Yes — improved, doc 1524 fix confirmed** |
| Accounting Q1 | Complex international taxation (5 income types) | PASS | PASS | No |
| Accounting Q2 | myDATA + ΦΠΑ + OSS | PASS | PASS | No |
| Accounting Q3 | ΑΑΔΕ audit (Revolut/family transfers) | PASS | PASS | No |
| Killer prompt | Strict-citation, no-guessing instruction | PARTIAL | PARTIAL | No |

**6 PASS, 1 PARTIAL, 0 FAIL, 0 HONEST GAP** across all 7 items — up from the
2026-08-12 run's 4 PASS / 1 PARTIAL / 2 HONEST GAP. Both HONEST GAPs from
that run are gone. 0 fabrication observed anywhere in this run.

## Notes

**Construction Q1 — HONEST GAP → PASS, the flagged regression is resolved.**
The 2026-08-12 run returned a bare "no sources cover this" response and
flagged this as a likely regression against this task's own context note
that `doc_id` 1523 (the αυθαίρετα-exemption case) previously answered this
exact style of question correctly. This run's answer retrieves and cites
`doc_id` 1523, 1087, and 1088, correctly distinguishes which violations must
be regularized before transfer (the enclosed semi-outdoor space and the
unauthorized storage room) from which can be declared directly in the
Electronic Building ID (the relocated staircase and window position,
contingent on structural/fire-safety impact), lays out the correct order of
actions (engineer assignment → e-Άδειες declaration → fine payment →
Electronic Building ID update → notarized transfer), and grounds the
mandatory-regularization conclusion in Άρθρο 83 of Ν.4495/2017. No
fabrication, real citations throughout. The retrieval flakiness flagged in
2026-08-12 did not reproduce here.

**Construction Q2 — PASS, unchanged.** Same as 2026-08-12: correctly applies
the legal hierarchy, citing Ν.4495/2017 (`doc_id` 28) and Ν.4030/2011
(`doc_id` 29), concludes Ν.4495/2017's provisions prevail as the newer law.

**Construction Q3 — HONEST GAP → PASS, directly confirms the doc 1524
fix.** The 2026-08-12 run returned a bare gap response plus an unprompted,
irrelevant archaeological-zone note (the leaked-context artifact documented
in `2026-08-12-stress-round-3.md`). This run's answer is a complete,
well-structured liability analysis: technical causes for each symptom
(cracked beams → poor foundation/concrete quality; water ingress → deficient
waterproofing/drainage; settlement → geotechnical-study gap), separate
liability findings for the contractor ("υπεύθυνος... για δέκα έτη από την
παράδοση, όπως επιτάσσει το ΑΚ άρθρο 693"), the supervising engineer (civil
liability for failure to verify compliance with the approved study), and the
owner (duty to notify defects within a reasonable time), citing `doc_id`
1524 by name alongside `doc_id` 1483 and 1119 (technical expert-report
procedure). The ten-year ΑΚ 693 period is stated cleanly, with no trace of
the old "5 έτη (10 έτη για δομικές βλάβες)" split that made doc 1524 wrong
in the first place, and no archaeological-context leak this time either.

**Accounting Q1, Q2, Q3 — all PASS, unchanged** from 2026-08-12 in substance
and citation quality.

**Killer prompt (wrapping Construction Q2's topic) — PARTIAL, unchanged.**
Cites real ΦΕΚ numbers (Α 249/2011 for Ν.4030/2011, Α 167/2017 for
Ν.4495/2017), explicitly and honestly states no hyperlink is available
("Δεν διατίθενται σε αυτή τη βάση δεδομένων υπερσύνδεσμοι προς τα πρωτογενή
έγγραφα") rather than fabricating one — no fabrication. Still scored PARTIAL
because the hyperlink requirement (an explicit instruction in the prompt
itself) is not met. Minor positive note versus 2026-08-12: this run's
"which law prevails" conclusion is stated plainly ("ο νόμος υπερισχύει...")
rather than hedged with "είναι πιθανό ότι..." as in the prior run — not
enough on its own to move the score, since the hyperlink gap is the binding
constraint, but a small confidence improvement on the same accepted
"meta-instruction wrapping dilutes retrieval slightly" behavior.

## Bottom line

0 FAIL, 0 fabrication. Both of the 2026-08-12 run's HONEST GAPs (Construction
Q1 and Q3) resolved to full PASS this run, with Q3 directly and cleanly
confirming the doc 1524 fix: a clean ten-year ΑΚ 693 liability statement with
no contradiction and no leaked project-context artifact. No new regression
found. The killer prompt remains the suite's one PARTIAL, for the same
documented, accepted reason (meta-instruction wrapping slightly dilutes
retrieval/instruction-following versus plainly-phrased questions on the same
topic) — not treated as a defect.
