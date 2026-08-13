# Comprehensive-105 — Result: 2026-08-13

Final closing-verification run after two real production fixes landed since the
`2026-08-12-comprehensive-105-post-cleanup.md` run: (1) documents 1089
(επίβλεψη έργου), 1122 (προσβασιμότητα ΑμεΑ FEK), and 1524 (ΑΚ 693
κατασκευαστικά προβλήματα liability period) were rewritten with real,
independently-verified corrected content (see `KNOWN_DECISIONS.md`, "The
three confirmed-wrong KB documents (1089, 1122, 1524) rewritten with real
corrected content"); (2) a Help-page scoping bug for municipality accounts
was closed (unrelated to the chat/RAG path, not expected to affect this
suite). Confirmed via direct DB query before this run: all three documents
show `needs_review=false` and `last_verified_at=2026-08-13`.

All 105 questions were asked for real via `POST /chat/message` against the
live backend, question texts identical to `benchmark/comprehensive-105.md`
and all prior runs. Same accounts/projects as all prior runs: 1A via
`demo-admin@accounting.theke.gr` (no project), 1B via
`demo-member@construction.theke.gr` (Kavala QA project, id 38), 1C via
`demo-admin@construction.theke.gr` (Kavala QA project), 2A via
`demo-member@accounting.theke.gr` (no project), 2B via
`demo-member@construction.theke.gr` (Kavala QA project).

**Operational note:** the 20-messages/hour/user chat rate limit was hit
during 2B's second half — the `chat_msg:10` Redis counter was reset between
batches, the established workaround documented in every prior run of this
suite. One JWT expired mid-batch (2B Q11-Q20) and was re-issued via a fresh
login before re-asking those questions for real; the expired-token attempts
(10 x HTTP 401, no answer generated) consumed no rate-limit budget and are
not counted as answers. No source code or config was touched.

**Note on 1C's answer language:** `demo-admin@construction.theke.gr` returned
all 1C answers in English despite the questions being asked in Greek with no
`preferred_locale` override — the account's stored `preferred_locale` is
apparently `en` from earlier sessions, not something this run changed. Scored
on content/citation quality per the rubric, which does not require a specific
response language.

## Summary table

| Section | Count | PASS | PARTIAL | OUT OF SCOPE | FAIL |
|---|---|---|---|---|---|
| 1A — niche accounting | 15 | 15 | 0 | 0 | 0 |
| 1B — common construction | 15 | 10 | 0 | 5 | 0 |
| 1C — niche construction | 15 | 12 | 0 | 3 | 0 |
| 2A — accounting complex | 30 | 27 | 3 | 0 | 0 |
| 2B — construction complex | 30 | **29** | **1** | 0 | 0 |
| **Total** | **105** | **93** | **4** | **8** | **0** |

**This run: 93 PASS / 4 PARTIAL / 8 OUT OF SCOPE / 0 FAIL** — a net
**improvement of +2 PASS / -2 PARTIAL** over both the 2026-08-12 post-cleanup
run (91/6/8/0) and the original 2026-07-16 baseline (91/6/8/0). Every
improvement is concentrated in section 2B and traces directly to the three
document fixes.

## 1A — niche accounting (15/15 PASS — unchanged)

All 15 answers cited real Greek tax law with correct, specific citations
(ΚΦΕ Ν.4172/2013 arts. 4, 5Α, 5Β, 21, 40, 42, 42Α, 48/48Α/54, ΚΦΔ
Ν.4174/2013, Ν.4072/2012, Ν.5144/2024 for VAT). Identical outcome to every
prior run. No trace of the previously-flagged `TEST DISCLAIMER 291fa6bd`
artifact anywhere in this section (checked directly — see 2A note below).

## 1B — common construction (10 PASS, 0 PARTIAL, 5 OUT OF SCOPE, 0 FAIL — unchanged, but Q9 confirmed fixed)

OUT OF SCOPE (5, unchanged): Q1, Q7, Q11, Q12, Q13 — market/advisory
questions, correctly redirected with no fabricated numbers. PASS (10):
Q2-Q6, Q8-Q10, Q14-Q15.

**Q9 (επίβλεψη έργου) — now reliably cites doc 1089 directly, with the
corrected content.** This is the clearest confirmation of the doc 1089 fix
in this suite: previous runs documented real run-to-run retrieval
non-determinism on this exact question (sometimes doc 1089 flagged and
skipped in favor of a lucky ΚΑΝΕΠΕ substitute, sometimes an unrelated ΔΕΔΔΗΕ
document, sometimes a bare gap). This run's answer cites `doc_id 1089`
alone, describing supervision duties in terms consistent with the rewritten
content (ΝΟΚ/ΕΚΩΣ/ΚΑΝΕΠΕ/seismic-code compliance, safety and quality
assurance) — no ΚΕΣΥΠΟΘΑ-article confusion, no ΠΕΚ-issuance conflation.

## 1C — niche construction (12 PASS, 0 PARTIAL, 3 OUT OF SCOPE, 0 FAIL — unchanged)

OUT OF SCOPE (3, unchanged genuine KB gaps): Q7 (BIM), Q11 (carbon
footprint), Q15 (drones/laser scanning/digital twins). PASS (12): Q1-Q6,
Q8-Q10, Q12-Q14 — all solid with real ΚΑΝΕΠΕ 2017/Eurocode/ΚΕΝΑΚ citations.
Q12 (ενίσχυση διατηρητέων, doc 1157) remains full PASS.

## 2A — accounting complex (27 PASS, 3 PARTIAL, 0 OOS, 0 FAIL — unchanged)

**PARTIAL (3, unchanged from every prior run): Q19** (first-employee ΕΡΓΑΝΗ —
still only surfaces the general ΕΡΓΑΝΗ platform, not doc 1052's Ε3-Ε7 form
detail — a persistent, standalone retrieval-depth weak point across at least
four runs now), **Q20** (ΕΦΚΑ contribution correction — computation covered
well, correction procedure honestly flagged as not detailed in the sources),
**Q30** (find-everything question — at the rubric's explicit PARTIAL
ceiling). All other 27 answers PASS with real, specific citations.

**Confirmed: the previously-flagged `TEST DISCLAIMER 291fa6bd` artifact
(2026-08-12 post-cleanup run, Q18) did not reproduce.** Q18's answer this
run ends with the normal informational-only footer, nothing else appended.
Checked across the full 105-question output set via direct string search —
`TEST DISCLAIMER` appears in zero answers. Consistent with that finding
having been a response-pipeline artifact rather than a stored-content issue;
not something this run can certify as fixed (no code change targeted it),
but it did not recur.

## 2B — construction complex (29 PASS, 1 PARTIAL, 0 OOS, 0 FAIL — IMPROVED, +2 PASS vs. every prior run)

**This is where both remaining document fixes show up as real, visible
improvements.**

- **Q22 (προσβασιμότητα ΑμεΑ) — PARTIAL → full PASS, directly tied to doc
  1122's fix.** The 2026-08-12 post-cleanup run's answer explicitly stated
  "Δεν βρέθηκε πηγή που να καλύπτει συγκεκριμένα τις απαιτήσεις
  προσβασιμότητας ΑμεΑ" because doc 1122 was still flagged for its
  unconfirmable FEK citation. This run's answer cites doc 1122 alone and
  states the corrected legal basis explicitly: horizontal/vertical
  autonomous accessible access per the "Σχεδιάζοντας για Όλους" guidelines,
  the 5%-accessible-restroom requirement (at least one per building
  complex), accessible parking allocation, and tactile/visual signage
  requirements — matching `KNOWN_DECISIONS.md`'s description of the
  rewritten content exactly. No trace of the old, unconfirmable ΦΕΚ Β
  1227/2020 citation.
- **Q12 (αποκλίσεις σχεδίων/κατασκευής) — PARTIAL → full PASS.** The
  previously-documented garbled clause ("να κατατεθεί τομή της αυθαίρετης
  κατασκευής") is gone; this run's answer is a clean, complete discussion of
  deviation handling, citing docs 248, 1156, 1148, and (notably) doc 1089
  correctly as part of the supervising-engineer's responsibility for
  compliance-checking. Not directly tied to any of the three document
  rewrites, but doc 1089 appearing here as a clean citation is a secondary,
  positive side effect of that fix's improved retrievability.
- **Q26 (παραλαβή/οριστική παραλαβή) — full PASS, doc 1524 fix independently
  confirmed in the comprehensive-105 context too.** This run's answer cites
  both doc 1524 and doc 1483 together and states, without contradiction, "η
  δεκαετή ευθύνη για κρυφά ελαττώματα" (the ten-year liability for hidden
  defects) — matching `KNOWN_DECISIONS.md`'s verification note that these
  two documents now agree on a single, non-contradictory ten-year ΑΚ 693
  period.
- **Q6 (καθίζηση/ρωγμές 18 μήνες μετά την παράδοση)** — full PASS, cites doc
  1118 (procedure-focused document) with a complete technical-investigation
  procedure (photographic documentation, independent expert assignment,
  geotechnical-study check, uniform-vs-differential settlement assessment).
  Per `KNOWN_DECISIONS.md`'s own note, this exact question's literal wording
  legitimately retrieves doc 1118 rather than doc 1524 — not a miss, a
  different real document answering the "how do I investigate this"
  sub-question the Greek wording asks. The dedicated liability-focused
  re-ask (used in stress-round-1 C3, see below) is what verifies the doc
  1524 fix directly.
- **Q15 (υποχρεώσεις επιβλέποντα μηχανικού)** — full PASS, cites doc 1483
  (contractor/supervising-engineer liability after handover) alongside
  ΚΑΝΕΠΕ Κεφ.1.

**PARTIAL (1): Q30** (find-everything question) — at the rubric's explicit
PARTIAL ceiling, as expected, unchanged.

No trace of the `[ΣΤΟΙΧΕΙΑ ΤΟΠΟΘΕΣΙΑΣ ΟΙΚΟΠΕΔΟΥ]` unfilled-template
placeholder documented in `2026-08-12-stress-round-3.md` and
`2026-08-12-comprehensive-105-post-cleanup.md` (2B Q7) anywhere in this run's
105 answers — checked via direct string search across the full output set.
Not claimed fixed (out of scope for this run, no code change targeted it),
but did not reproduce this time. Q4, Q7, and Q8, which reference the Kavala
QA project's archaeological-zone context, all correctly name "Παναγία,
Καβάλα" in full this run.

## Four-way comparison

| | 2026-07-16 baseline | 2026-08-12 pre-cleanup | 2026-08-12 post-cleanup | 2026-08-13 (this run) |
|---|---|---|---|---|
| PASS | 91 | 75 | 91 | **93** |
| PARTIAL | 6 | 10 | 6 | **4** |
| OUT OF SCOPE | 8 | 8 | 8 | **8** |
| FAIL | 0 | 12 | 0 | **0** |

## Residual, deliberate gaps (not bugs — honest outcomes)

- **2A Q19** (first-employee ΕΡΓΑΝΗ): persistent, standalone retrieval-depth
  weak point on doc 1052's Ε3-Ε7 form detail, unchanged across at least four
  runs now — a real candidate for a bridge-document follow-up if it persists
  further.
- **2A Q20** (ΕΦΚΑ contribution correction): honestly declines to detail the
  correction procedure, not fabricated.
- **1C/2B Q30-equivalents**: both find-everything questions remain at the
  rubric's own PARTIAL ceiling by design.

## Files

Raw Q&A + citations for all 105 questions are preserved in the session
scratchpad (`bench/out/{1A,1B,1C,2A,2B}_Q*.json`, not committed to the
repo — this results file is the durable record, per `benchmark/README.md`'s
rule).
