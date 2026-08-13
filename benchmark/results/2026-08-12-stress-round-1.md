# Stress round 1 — Result: 2026-08-12

**Snapshot run.** Per task instructions, no diffable per-question baseline
exists for this file (the `2026-07-16-stress-round-1.md` result predates
this session's crawl re-verification, AI revalidation of 119 documents, and
region contact-discovery batches — treated here as prior context only, not
a score to diff against). This run is `run_established: 2026-08-12`,
against the question texts in `benchmark/stress-round-1.md` exactly as
supplied.

Accounts/projects: construction via `demo-member@construction.theke.gr`
(Kavala QA project, id 38); accounting via
`demo-member@accounting.theke.gr` (no project). Killer prompt embedded
this file's own Construction Q2 (conflicting-legislation / ΥΔΟΜ-vs-engineer
case).

Run executed synchronously against the live backend at
`http://localhost:8000` inside the `backend` Docker container. Mid-run the
demo accounts hit the app's own `/chat/message` rate limiter (20
messages/hour fixed window, `backend/app/services/rate_limit.py`) — the
coordinator reset the Redis counters (`chat_msg:10`, `chat_msg:207`)
directly, confirmed independently via `/chat/rate-limit-status` before
resuming. No source code or other files were modified.

## Summary table

| # | Question | Result |
|---|---|---|
| Construction Q1 | Property transfer, multiple violations | HONEST GAP (see note) |
| Construction Q2 | Conflicting legislation (ΥΔΟΜ vs engineer) | PASS |
| Construction Q3 | Liability after project handover | HONEST GAP (see note) |
| Accounting Q1 | Complex international taxation (5 income types) | PASS |
| Accounting Q2 | myDATA + ΦΠΑ + OSS | PASS |
| Accounting Q3 | ΑΑΔΕ audit (Revolut/family transfers) | PASS |
| Killer prompt | Strict-citation, no-guessing instruction | PARTIAL |

**4 PASS, 1 PARTIAL, 0 FAIL, 2 HONEST GAP** across all 7 items. 0
fabrication observed anywhere in this run.

## Notes

**Construction Q1 — HONEST GAP, flagged for follow-up.** The model
returned "Δεν υπάρχουν διαθέσιμες πηγές που να καλύπτουν τα ερωτήματά σας"
(no available sources cover your questions) for the entire question —
tidy-vs-declare-only distinction, action order, and article/ΦΕΚ citations
all came back empty, despite two citations being technically attached
(two unrelated 2026 ΦΕΚ entries, doc_id 110 and 46, that do not address
building violations). This is scored HONEST GAP under the rubric (no
fabrication, and the gap statement — naming the violations/Electronic
Building ID/pre-transfer tidying topics — is reasonably specific), but is
flagged as noteworthy: this task's own context notes that `doc_id` 1523
(the αυθαίρετα-exemption case) was previously confirmed to correctly
answer this exact style of question with real article citations (83, 96,
97 of Ν.4495/2017). `doc_id` 1523 was not retrieved here at all. Recommend
a follow-up retrieval check on this specific question outside this
snapshot's scope — this may be a real regression, but without a diffable
baseline for this file it cannot be certified as one from this run alone.

**Construction Q2 — PASS.** Correctly applies the legal hierarchy,
citing Ν.4495/2017 (ΦΕΚ Α 167/2017, `doc_id` 28) and Ν.4030/2011 (ΦΕΚ Α
249/2011, `doc_id` 29), and concludes Ν.4495/2017's e-Άδειες provisions
are the newer, more specific, prevailing rule. It does not identify a
specific ΥΔΟΜ-vs-engineer dispute point (none exists in the KB for this
exact scenario) and says so implicitly by not inventing one — consistent,
honest behavior.

**Construction Q3 — HONEST GAP, with an unrelated injection artifact.**
Returned "Δεν βρέθηκαν πηγές που να καλύπτουν επαρκώς το ερώτημα" for the
liability-after-handover question (cracked beams, water ingress, tile
detachment, settling) — a specific, honest gap statement, not fabrication.
However, the answer then appends an unprompted note that the project's
plot is "εντός αρχαιολογικής ζώνης στην Παναγία, Καβάλα" (within an
archaeological zone) — information with no connection to the structural-
defects question asked. This reads like a project-context field (an
archaeological-zone flag on the Kavala QA project) leaking into the
answer regardless of relevance. Same underlying mechanism suspected as
the raw `[ΣΤΟΙΧΕΙΑ ΤΟΠΟΘΕΣΙΑΣ ΟΙΚΟΠΕΔΟΥ]` placeholder leak documented in
`2026-08-12-stress-round-3.md` (C5 and Nightmare 1) — see that file for
the clearer, unfilled-template version of the same bug. Not fixed here
per the verification-pass-only instruction.

**Accounting Q1 — PASS.** Covered all five income streams (US remote
salary, IKE corporate income, UK royalties, Airbnb, Bitcoin) and honestly
flagged where it could not confirm a specific DTA provision or crypto-
specific rule rather than asserting one — same pattern as the 2026-07-16
run.

**Accounting Q2 — PASS (citation-staleness issue from prior rounds not
reproduced here).** Correct substance throughout (OSS threshold/mechanism,
B2B zero-rating via VIES, B2C via OSS, non-EU customers out of scope,
myDATA exemption code 14, monthly VIES for B2B). Notably, the citation
list cites **only** Ν.5144/2024 (`doc_id` 296/297, the current ΦΠΑ code)
and `doc_id` 1525 — the previously-flagged repealed Ν.2859/2000 citation
(documented in the 2026-07-16 round-1 and round-3 results, traced to
`doc_id` 1525's own stored "Νομική βάση" line) does **not** appear in this
run's citation list or answer text. Consistent with this session's
document revalidation work; worth independently confirming `doc_id`
1525's stored content was actually corrected, since this alone doesn't
prove it (a different retrieval mix could just as easily explain it).

**Accounting Q3 — PASS.** Correctly cites ΚΦΔ article 28 (unexplained
bank deposits presumption, burden on the taxpayer), DAC7/Ν.4923/2022 for
Revolut's reporting obligation, the right to appeal to ΔΕΔ before
litigation, and the evidence checklist.

**Killer prompt (wrapping Construction Q2's topic) — PARTIAL.** Cites real
ΦΕΚ numbers (Α 249/2011 for Ν.4030/2011, Α 167/2017 for Ν.4495/2017) and
explicitly, honestly states no hyperlink is available in the retrieved
sources ("Δεν υπάρχει διαθέσιμος υπερσύνδεσμος στα πρωτογενή έγγραφα") and
that no specific conflicting provision was found — no fabrication. Scored
PARTIAL rather than PASS because the "which law prevails" conclusion is
hedged ("είναι πιθανό ότι υπερισχύει" — "it's probably the case that...
prevails") rather than the more definitive resolution the plain Construction
Q2 answer gave for the same underlying topic — a real instance of the
documented "meta-instruction wrapping dilutes retrieval/confidence
slightly" behavior called out as accepted, known, non-bug in the task
brief. Not scored as a regression given that's explicitly expected.

## Bottom line

0 FAIL, 0 fabrication. Two HONEST GAPs, one of which (Construction Q1)
is flagged for follow-up because it appears to contradict this task's own
context note about `doc_id` 1523 previously answering this exact question
style correctly — worth a dedicated retrieval check outside this run's
scope. This is the fresh snapshot for this file; no prior score exists to
diff against per the task brief.
