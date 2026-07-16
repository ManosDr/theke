# stress-round-3 — result — 2026-07-16

Baseline comparison: `KNOWN_DECISIONS.md`'s per-question narrative (see
`benchmark/stress-round-3.md` for the reconstructed baseline this run
diffs against). Run against the live app after: ΝΟΚ ingestion, the
cross-instrument fabrication guard, the silent-omission rule, the
retrieval diversity cap, the citation-numbering fix, the hierarchy-rule
scoping fix, and all 5 Phase-5 bridge documents.

## Summary table

| Q | Previous | Current | Changed? |
|---|---|---|---|
| C1 | PASS | PASS | No |
| C2 | HONEST GAP | **PASS** | **Yes — improved** |
| C3 | FAIL | FAIL | No (see full verbatim below) |
| C4 | PASS | PASS | No |
| C5 | PASS | **PARTIAL** | **Yes — changed** (see note below) |
| A1 | PASS | PASS | No |
| A2 | PASS | PASS | No (new finding below, not a score change) |
| A3 | HONEST GAP | HONEST GAP | No (minor citation-precision note) |
| A4 | HONEST GAP | **PASS** | **Yes — improved** |
| A5 | PASS | PASS | No |
| Nightmare 1 (a) | N/A | Partially met | Improved |
| Nightmare 1 (b) | N/A | Met | Improved |
| Nightmare 1 (c) | Not met | Not met | No |
| Nightmare 1 (d) | Met | Met | No |
| Nightmare 2 (a)-(d) | not/not/not/met | not/not/not/met | No |

**No regressions.** 2 improvements (C2, A4 - both bridge docs from the
prior round confirmed working for the first time), 1 changed-but-not-worse
(C5, discussed below), 1 unchanged known issue (C3 - the hierarchy-rule
scoping did not fully close this), 1 new independent finding unrelated to
recent work (A2's source document citing a repealed law).

## C3 — full verbatim (regression test for the hierarchy-rule scoping fix)

**Query:** Κατά την έκδοση οικοδομικής άδειας, ο μηχανικός θεωρεί ότι
εφαρμόζεται ο Νέος Οικοδομικός Κανονισμός, ενώ η ΥΔΟΜ επικαλείται
μεταβατικές διατάξεις. Ποιο νομοθετικό πλαίσιο ισχύει σήμερα, ποιες
τροποποιήσεις έχουν γίνει και ποια διάταξη υπερισχύει;

**Search (top 3 of 10):** dist=0.4326 doc=28 "Ν 4495 (ΦΕΚ Α 167/2017) –
άρθρα 28-43"; dist=0.4446 doc=206 "EUGO ... e-Άδειες building permit
issuance overview"; dist=0.4612 doc=28 (same doc, 2nd chunk).

**Answer (verbatim):**

> Για το ζήτημα της ισχύουσας νομοθεσίας κατά την έκδοση οικοδομικής
> άδειας, υπάρχουν δύο κύριες πηγές νομοθεσίας που σχετίζονται με το Νέο
> Οικοδομικό Κανονισμό:
>
> 1. **Νέος Οικοδομικός Κανονισμός (ΝΟΚ)**: Ο Νόμος 4067/2012 καθορίζει
> τις γενικές διατάξεις του Νέου Οικοδομικού Κανονισμού, οι οποίες
> εφαρμόζονται στις οικοδομικές άδειες. Πρόκειται για τον αρχικό νόμο που
> τέθηκε σε ισχύ το 2012 και περιλαμβάνει τις γενικές κατευθύνσεις [6].
>
> 2. **Ν. 4495/2017**: Πρόκειται για το νεότερο πλαίσιο το οποίο επίσης
> εμπεριέχει διατάξεις σχετικές με την έκδοση και τον έλεγχο των
> οικοδομικών αδειών και προβλέπει διαδικασίες για την ενημέρωση του
> φακέλου και την αναθεώρηση των αδειών [1]. Ειδικές διατάξεις του
> Ν. 4495/2017 εστιάζουν στη διαδικασία έκδοσης των αδειών και τις
> ευθύνες του επιβλέποντος μηχανικού, κάτι που είναι κρίσιμο κατά τις
> μεταβατικές φάσεις μεταξύ παλαιού και νέου θεσμικού πλαισίου [4].
>
> Για το ερώτημα ποια διάταξη υπερισχύει, ο **Ν. 4495/2017** είναι πιο
> πρόσφατος σε σύγκριση με τον ΝΟΚ και εισάγει ειδικές διαδικασίες και
> μεταβατικές διατάξεις για την εφαρμογή του [1], [2]. Επομένως, στις
> περιπτώσεις που αυτές οι διατάξεις τροποποιούν ή καθορίζουν νεότερες
> διαδικασίες, ο Ν. 4495/2017 υπερισχύει ως το νεότερο και ειδικότερο
> νομοθέτημα.
>
> Τροποποιήσεις και ενημερώσεις μπορούν να γίνουν σε μελλοντικές
> νομοθετικές εξελίξεις, αλλά μέχρι την ημερομηνία των υφιστάμενων
> δεδομένων, αυτές οι δύο είναι οι κύριες διατάξεις που εφαρμόζονται στην
> κλίμακα εφαρμογής των οικοδομικών αδειών στην Ελλάδα.
>
> Οι παραπάνω πληροφορίες είναι για ενημέρωση μόνο. Συμβουλευτείτε
> αδειούχο μηχανικό για το συγκεκριμένο έργο σας.

**Assessment: still FAIL, unchanged from the last documented state.** ΝΟΚ
(`doc_id` 1660) is retrieved and named this time (a real, confirmed
improvement over the pre-ingestion state), and the answer does structurally
separate what each law covers before concluding (also an improvement in
form). But the final paragraph still asserts "Ν. 4495/2017 υπερισχύει ως το
νεότερο και ειδικότερο νομοθέτημα" - an unconfirmed cross-instrument
hierarchy claim no retrieved source establishes. This is exactly the
failure mode the `ΚΑΝΟΝΑΣ ΑΠΟΦΥΓΗΣ ΣΥΓΧΥΣΗΣ ΝΟΜΟΘΕΤΗΜΑΤΩΝ` guard and the
hierarchy-rule scoping precondition both target, and both measurably
changed the answer's structure without changing its conclusion. Consistent
with `KNOWN_DECISIONS.md`'s own note that this is a known, disclosed,
not-yet-closed residual risk - not a new regression from this run.

## C5 — score change note (PASS → PARTIAL)

The new answer is more conservative than the documented PASS baseline: it
explicitly states "Δεν βρέθηκε συγκεκριμένη πηγή που να αναφέρεται στη
συντήρηση" and "Δεν βρέθηκε συγκεκριμένη αναφορά στο νομοθετικό πλαίσιο ή
τεχνικές οδηγίες που να ρυθμίζουν ειδικά την κατανομή ευθύνης" for two of
the three causal categories the question asks about (maintenance
responsibility, and the overall legal apportionment framework). This
reads as the silent-omission rule (`ΚΑΝΟΝΑΣ ΠΛΗΡΟΤΗΤΑΣ ΠΟΛΛΑΠΛΩΝ
ΕΡΩΤΗΜΑΤΩΝ`) doing exactly what it was built for - surfacing an honest gap
that a prior, more confident-sounding answer may have glossed over, rather
than a new factual error. Scored PARTIAL under the stated rubric ("correct
as far as it goes but misses a sub-part") because two of three causal
categories are left unsourced, but this is a stricter/more honest read of
the same underlying content gap, not new bad information. Flagging as
"changed" per the instructions rather than silently treating it as a
non-event.

## A2 — new finding, not a score change

Citation `[1]` in A2's answer ("άρθρο 14 παρ. 2 Ν.2859/2000") traces
directly to `doc_id` 1525's own stored content, which lists "Ν.2859/2000
άρθρα 14, 47α-47γ" as its "Νομική βάση" - the model did not fabricate
this, it faithfully quoted the source. But Ν.2859/2000 (the old ΦΠΑ code)
was repealed 2024-10-11 and replaced by Ν.5144/2024 (per
`crawler/crawler/tax_laws.py`'s own docstring, written in an earlier
session). This is a pre-existing content-staleness issue in `doc_id` 1525
- written before this round's work, unrelated to anything changed in the
last several rounds - not a new regression. Not fixed in this pass per
the "verification pass only" instruction; flagging for a future targeted
correction of that document's legal-basis line.

## A3 — minor citation-precision note

The answer names ΚΦΔ Ν.4174/2013 άρθρο 14 ("υποχρεώσεις παροχής
πληροφοριών") as the basis for *when* indirect audit techniques are
permitted - a less precise fit than άρθρο 28 (the actual presumption-of-
income provision), which an earlier run in this same session correctly
cited for this same question. Both articles are real and exist in the
retrieved sources; this reads as a synthesis-precision wobble across runs
rather than a fabrication, and the answer's core HONEST GAP behavior
(explicitly flagging missing circulars/αποφάσεις) is unchanged. Not scored
as a regression.
