# Stress round 3 — result — 2026-08-12

Baseline comparison: the per-question "Most recent documented score" lines
embedded directly in `benchmark/stress-round-3.md` (which itself carries
forward the `2026-07-16-stress-round-3.md` result plus the two bridge
documents — Ν.3889/2010-as-amended for C2, Ν.4601/2019 Άρθρα 42-45 for
A4 — that were ingested afterward but never independently re-run against
these exact questions until now).

Accounts: construction via `demo-member@construction.theke.gr` on the
Kavala QA project (`project_id=38`); accounting via
`demo-member@accounting.theke.gr`, no project. Run executed synchronously
against the live backend inside the `backend` Docker container.

**Note on this run's execution:** partway through, the demo accounts hit
the app's own `/chat/message` rate limiter (20 messages/hour fixed window
per user, enforced in `backend/app/services/rate_limit.py`) after only
~9 real questions — the per-user Redis counters (`chat_msg:10` for
construction, `chat_msg:207` for accounting) showed usage far above the
number of questions actually asked (81 and 55 respectively), which the
coordinator attributed to three parallel benchmark agents sharing the same
demo accounts. The coordinator reset both counters directly; headroom was
independently re-verified via `GET /chat/rate-limit-status` (15 and 19
remaining) before any further questions were asked. No files or source
code were touched to work around this. C1-C4 were not re-asked after the
reset (results preserved from before the limiter hit); C5 onward ran
fresh.

## Summary table

| Q | Baseline | Current | Changed? |
|---|---|---|---|
| C1 | PASS | **PARTIAL** | **Yes — regression, see below** |
| C2 | HONEST GAP | **PASS** | **Yes — improved, bridge doc confirmed** |
| C3 | FAIL | FAIL | No (see full verbatim below) |
| C4 | PASS | PASS | No |
| C5 | PASS | **PARTIAL** | **Yes — regression, see below** |
| A1 | PASS | PASS | No |
| A2 | PASS | PASS | No |
| A3 | HONEST GAP | HONEST GAP | No (minor citation-precision improvement) |
| A4 | HONEST GAP | **PASS** | **Yes — improved, bridge doc confirmed** |
| A5 | PASS | PASS | No |
| Nightmare 1 (a) | N/A | Not met | New finding (see below) |
| Nightmare 1 (b) | N/A | Met | Improved |
| Nightmare 1 (c) | Not met | Not met | No |
| Nightmare 1 (d) | Met | Met | No |
| Nightmare 2 (a)-(d) | not/not/not/met | not/not/not/met | No |

## Regressions vs. baseline

**Two regressions found: C1 (PASS → PARTIAL) and C5 (PASS → PARTIAL).**
Both are detailed below. Two improvements confirmed (C2, A4 — both bridge
documents now verified working for the first time). C3 is unchanged
(still FAIL). No other question changed.

### C1 — PASS → PARTIAL

Baseline: PASS, closed via the `Ειδικό Σήμα Λειτουργίας` bridge document
(`doc_id` 1699). This run still cites `doc_id` 1699 correctly and covers
the building-permit + tourism-operating-license (Ε.Σ.Λ.) dual track
accurately (Ν.4495/2017 for the permit, Ν.4276/2014 ΦΕΚ Α 155/2014 for the
Ε.Σ.Λ.). But the answer now explicitly self-flags a gap it didn't
disclose before: "Δεν βρέθηκαν συγκεκριμένα αποσπάσματα που να
προσδιορίζουν όλα τα απαραίτητα δικαιολογητικά για κάθε στάδιο της
διαδικασίας, ή άλλες πιθανές εμπλεκόμενες υπηρεσίες για το ειδικό
καθεστώς διατηρητέων κτιρίων" (no excerpts specify all required
documentation per stage, or other possibly-involved services for the
listed-building regime specifically). This is the same "silent-omission
rule doing its job" pattern noted for C5 in the 2026-07-16 round-3 result
— a stricter, more honest answer surfacing a real content gap rather than
glossing over it — but it is scored as a regression here per the task's
explicit instruction to flag anything worse by question ID, since the
question's own required deliverables (δικαιολογητικά per stage) are no
longer being answered with confidence.

### C5 — PASS → PARTIAL (with a new artifact-leak finding)

Baseline: PASS. This run's answer is markedly weaker: it hedges nearly
every claim ("μπορεί να...", "ενδέχεται να...") and does not cite any
specific liability-apportionment legislation (no Αστικός Κώδικας articles,
no ten-year hidden-defect liability period — contrast with Construction
Q3 in `2026-08-12-stress-round-1.md`, which is a closely related liability
question). It leans almost entirely on ΚΑΝΕΠΕ (a technical assessment
code, not a liability-allocation statute) for all three causal categories
the question asks about.

More significantly, the answer contains a raw, unfilled template
placeholder leaked directly into user-facing text:

> "...όπως η Εφορεία Αρχαιοτήτων για συγκεκριμένες περιπτώσεις που
> αφορούν αρχαιολογικούς χώρους **[ΣΤΟΙΧΕΙΑ ΤΟΠΟΘΕΣΙΑΣ ΟΙΚΟΠΕΔΟΥ]**."

`[ΣΤΟΙΧΕΙΑ ΤΟΠΟΘΕΣΙΑΣ ΟΙΚΟΠΕΔΟΥ]` ("PLOT LOCATION DATA") is not a citation
marker — it reads as an unsubstituted template variable. The exact same
placeholder string appears verbatim in the Nightmare 1 answer below,
confirming this is a reproducible bug, not a one-off model slip. Both
occurrences appear immediately after a mention of "Εφορεία Αρχαιοτήτων"
(the archaeological authority) — the Kavala QA project likely carries an
archaeological-zone context field that is sometimes correctly filled
(e.g., Construction Q3 in the round-1 result names "Παναγία, Καβάλα"
explicitly) and sometimes leaks unfilled. **Flagging as a new,
independently-discovered defect** — not something this verification pass
attempted to fix, per instructions, but worth a dedicated look at whatever
prompt-assembly step injects project/plot location context.

## C3 — full verbatim (regression test for the hierarchy-rule scoping fix)

**Query:** Κατά την έκδοση οικοδομικής άδειας, ο μηχανικός θεωρεί ότι
εφαρμόζεται ο Νέος Οικοδομικός Κανονισμός, ενώ η ΥΔΟΜ επικαλείται
μεταβατικές διατάξεις. Ποιο νομοθετικό πλαίσιο ισχύει σήμερα, ποιες
τροποποιήσεις έχουν γίνει και ποια διάταξη υπερισχύει;

**Citations returned (7):** `doc_id` 28 (Ν 4495, ΦΕΚ Α 167/2017, άρθρα
28-43), `doc_id` 206 (EUGO e-Άδειες overview), `doc_id` 1 (Έλεγχος και
προστασία του Δομημένου Περιβάλλοντος), `doc_id` 127 (Α 88/2026, generic
FEK), `doc_id` 1660 (Ν.4067/2012, ΦΕΚ Α 79/2012 — Νέος Οικοδομικός
Κανονισμός, άρθρα 1-10), `doc_id` 1146 (ΚΑΝΕΠΕ 2017 Κεφ.1), `doc_id` 9
(Ν 4951, ΦΕΚ Α 129/2022, άρθρα 155-157).

**Answer (verbatim):**

> Για την έκδοση οικοδομικής άδειας, οι σχετικές διατάξεις πρέπει να
> εξεταστούν βάσει δύο βασικών νόμων: του Νέου Οικοδομικού Κανονισμού
> (Ν.4067/2012) και του Ν.4495/2017.
>
> 1. **Νέος Οικοδομικός Κανονισμός**: Ο Ν.4067/2012 (ΦΕΚ Α 79/2012)
> αναφέρει ότι οι διατάξεις του εφαρμόζονται σε περιοχές εντός εγκεκριμένου
> ρυμοτομικού σχεδίου, με τις προβλεπόμενες εξαιρέσεις και προσαρμογές για
> τις περιοχές εκτός σχεδίου [5].
>
> 2. **Ν.4495/2017**: Αναφέρει τις διαδικασίες που πρέπει να ακολουθούνται
> για την έκδοση της οικοδομικής άδειας και περιλαμβάνει ενημέρωση της
> ΥΔΟΜ για τυχόν αλλαγές στη μελέτη. Οι άδειες πρέπει να εκδοθούν βάσει των
> προβλεπόμενων ελέγχων [1].
>
> Σε περιπτώσεις όπου η ΥΔΟΜ επικαλείται μεταβατικές διατάξεις, αποτελεί
> επιτακτική ανάγκη να παρακολουθείται η αναθεώρηση ή η ενημέρωση των
> υπαρχουσών αδειών. Η νομοθεσία που καθορίζει την έκδοση οικοδομικών
> αδειών μπορεί να περιλαμβάνει ειδικές ή μεταβατικές διατάξεις όπως αυτές
> αναλύονται στον Ν.4495/2017, που μπορεί να αντικαταστήσουν ή να
> συμπληρώσουν προηγούμενες κανονιστικές υποθέσεις [1], αν και δεν
> διαπιστώνεται συγκεκριμένη αναφορά σε μεταβατικές διατάξεις στα
> αποσπάσματα.
>
> **Συμπέρασμα**: Ανάμεσα στους δύο νόμους που αναφέρθηκαν, ο Ν.4495/2017
> υπερισχύει σε ζητήματα νεότερων προβλέψεων για την έκδοση οικοδομικών
> αδειών καθώς περιλαμβάνει ειδικές διαδικασίες εφαρμογής και έγγραφες
> τροποποιήσεις που πρέπει να ακολουθούνται [1]. Δεν βρέθηκε αναφορά σε
> συγκεκριμένες μεταβατικές διατάξεις που τροποποιούν την εφαρμογή του
> Ν.4067/2012 είτε στο ίδιο το κείμενο του Ν.4495/2017 είτε σε άλλα
> αποσπάσματα δεδομένων.
>
> Οι παραπάνω πληροφορίες είναι για ενημέρωση μόνο. Συμβουλευτείτε
> αδειούχο μηχανικό για το συγκεκριμένο έργο σας.

**Assessment: still FAIL, unchanged from the documented baseline.** ΝΟΚ
(`doc_id` 1660, Ν.4067/2012) is retrieved and named — same improvement
over the pre-ingestion state as before — and the answer does separate
what each law covers before concluding. It even adds one honest caveat
not present in the previously-documented run ("δεν διαπιστώνεται
συγκεκριμένη αναφορά σε μεταβατικές διατάξεις στα αποσπάσματα" — no
specific transitional-provisions text was found in the excerpts). But the
**Συμπέρασμα** paragraph still asserts, unqualified, that "ο Ν.4495/2017
υπερισχύει" (Ν.4495/2017 prevails) as a general cross-instrument hierarchy
claim — no retrieved source establishes this, and ΝΟΚ (Ν.4067/2012) is a
building-*design* regulation while Ν.4495/2017 governs building-*permit
issuance procedure*; they aren't straightforwardly in a hierarchy relation
at all for most purposes, which the answer doesn't surface. This is
exactly the failure mode the `ΚΑΝΟΝΑΣ ΑΠΟΦΥΓΗΣ ΣΥΓΧΥΣΗΣ ΝΟΜΟΘΕΤΗΜΑΤΩΝ`
guard and the hierarchy-rule scoping precondition both target. Consistent
with the baseline's own characterization: a known, disclosed, not-yet-
closed residual risk, not a new regression from this run.

## C2 — improvement confirmed (HONEST GAP → PASS)

First independent re-run of this question since the `doc_id` 1700 bridge
document (Ν.3889/2010 as amended by Ν.4685/2020) was ingested. The answer
now correctly identifies the "αντίρρηση" (objection) procedure against
the posted forest map, cites the amending relationship explicitly
("Ν.3889/2010, όπως τροποποιήθηκε ουσιωδώς από τον Ν.4685/2020"), the
105-day deadline (+20 days for residents abroad), the submission channels
(Κτηματολόγιο platform or in person at ΚΕΠ), and documentation
requirements (originals, certified copies, official translations for
foreign-language documents). **The bridge document closed the gap as
intended — confirmed working.**

## A4 — improvement confirmed (HONEST GAP → PASS)

First independent re-run since the `doc_id` 1703 bridge document
(Ν.4601/2019, merger provisions) was ingested. The answer correctly
sequences the ΙΚΕ merger process: σχέδιο σύμβασης συγχώνευσης → έγκριση
από τις συνελεύσεις (with the 10-day advance document-review right) →
καταχώριση στο ΓΕΜΗ → tax filings (Ν.4308/2014 double-entry books, annual
corporate income tax return). Cites Ν.4601/2019 as the legal basis
throughout. **The bridge document closed the gap as intended — confirmed
working.** (Note: the answer names Ν.4601/2019 generally rather than the
specific Άρθρα 42-45 called out in the bridge document's title — a minor
citation-granularity gap, not scored as a failure since the core legal
basis and procedure are both correct.)

## A3 — unchanged HONEST GAP, minor precision improvement

Still correctly flagged as HONEST GAP (no bridge document exists for
this one, as expected — ΑΑΔΕ's own operational circulars remain the
hardest source category to access). Citation precision improved slightly
versus the 2026-07-16 run: this answer correctly cites ΚΦΔ **άρθρο 28**
(the actual unexplained-deposits presumption provision) rather than the
less-precise άρθρο 14 fallback noted as a "synthesis-precision wobble" in
the prior result. Not scored as a change per the task's own framing (a
repeat HONEST GAP is not a regression), but noted as a positive precision
signal within the same overall score.

## Nightmare prompt (run twice)

### Nightmare 1 — C2 embedded

| Property | Baseline | Current |
|---|---|---|
| (a) article + ΦΕΚ cited for every claim | N/A (no claims made) | **Not met** |
| (b) amended-provision current form surfaced | N/A | **Met** |
| (c) conflicting circulars/interpretations named or none-exist stated | Not met | Not met |
| (d) missing information named explicitly | Met | Met |

Because the C2 gap has since closed (see above), this run's nightmare
answer now makes real substantive claims — so (a) becomes a real,
checkable criterion for the first time, and it is **not met**: the answer
names Ν.3889/2010 and Ν.4685/2020 but never gives a ΦΕΚ number for
either. (b) is newly met — the amendment relationship is stated
explicitly. (c) remains unmet, same pattern as before. (d) remains met,
with an explicit "Ελλείψεις Πληροφοριών" section naming what's missing
(δικαιολογητικά details, exact procedure/timing beyond what's stated, how
1965-era titles get weighed against forest-map status).

**Instruction-following note:** unlike the documented baseline (which
omitted the hyperlinked source list entirely), this run's answer does
append a "Λίστα Πηγών" section listing seven source titles — a partial
improvement — but still without hyperlinks as the prompt explicitly
requested, so the instruction remains only partially satisfied.

This answer also contains the same `[ΣΤΟΙΧΕΙΑ ΤΟΠΟΘΕΣΙΑΣ ΟΙΚΟΠΕΔΟΥ]`
unfilled-placeholder artifact documented under C5 above, in the same
archaeological-authority context: "...μπορεί να απαιτείται περαιτέρω
έγκριση από την Εφορεία Αρχαιοτήτων, γεγονός που μπορεί να επηρεάσει την
έκβαση της διαδικασίας **[ΣΤΟΙΧΕΙΑ ΤΟΠΟΘΕΣΙΑΣ ΟΙΚΟΠΕΔΟΥ]**." Two
independent occurrences in one run confirm this is reproducible.

### Nightmare 2 — A3 embedded

| Property | Baseline | Current |
|---|---|---|
| (a) article + ΦΕΚ cited for every claim | Not met | Not met |
| (b) amended-provision current form surfaced | Not met | Not met |
| (c) conflicting circulars/interpretations named or none-exist stated | Not met | Not met |
| (d) missing information named explicitly | Met | Met |

Unchanged on all four scored properties: cites ΚΦΔ Ν.4174/2013 άρθρο 14
generally without a ΦΕΚ number (a), performs no amendment-currency check
(b), never explicitly resolves "no conflicts found" vs. naming any (c),
and explicitly states what's missing and why no safe conclusion can be
drawn (d, met). **Minor regression on instruction-following:** the
documented baseline appended a numbered "Χρησιμοποιημένα Αποσπάσματα"
source list (without hyperlinks); this run's answer appends **no** source
list at all, despite the prompt's explicit final instruction to do so.
Not counted in the main regression table above since it's a sub-property
of an already-failing instruction, but worth noting as a step backward on
an already-weak dimension.

## Bottom line

**Two regressions (C1, C5), both PASS → PARTIAL** — flagged explicitly
per instructions. C5's regression comes with a genuinely new, reproducible
finding: a raw unfilled template placeholder (`[ΣΤΟΙΧΕΙΑ ΤΟΠΟΘΕΣΙΑΣ
ΟΙΚΟΠΕΔΟΥ]`) leaking into two independent answers whenever the
archaeological-zone/plot-location context is referenced — worth a
dedicated look outside this verification pass. Two confirmed
improvements (C2, A4 — both bridge documents now verified working for the
first time). C3 remains FAIL, unchanged, full verbatim above. A3 remains
an unchanged, expected HONEST GAP with a minor precision improvement. All
other questions (C4, A1, A2, A5) are unchanged PASS.
