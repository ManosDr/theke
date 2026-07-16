# Stress round 3 — 10 scenarios + nightmare prompt

See `benchmark/README.md` for the scoring rubric. This set has a real prior
baseline (reconstructed from `KNOWN_DECISIONS.md`'s per-question narrative
across the "Stress benchmark round 3 safety fixes", "Bridge documents for
stress benchmark round 3", and "Citation marker numbering fixed" entries),
so runs of this file *can* be diffed against a documented previous score -
unlike `comprehensive-105.md` and `stress-round-1.md`.

Accounts: construction questions via `demo-member@construction.theke.gr` on
the Kavala QA project (`project_id=38`, `region_id=kavala`); accounting
questions via `demo-member@accounting.theke.gr`, no project.

## Construction

**C1 — Listed building renovation to boutique hotel**
> Πελάτης αγόρασε διατηρητέο κτίριο στο κέντρο της πόλης και θέλει να το
> μετατρέψει σε boutique hotel. Ποιες εγκρίσεις απαιτούνται, ποιες
> υπηρεσίες εμπλέκονται, ποια δικαιολογητικά χρειάζονται και ποια
> νομοθεσία διέπει κάθε στάδιο της διαδικασίας;

Most recent documented score: **PASS** (was PARTIAL - silently omitted the
tourism-operating-license track; fixed by the `Ειδικό Σήμα Λειτουργίας`
bridge document, `doc_id` 1699, confirmed by re-run in the same round).

**C2 — Forest map dispute on a 1965 title**
> Οικόπεδο διαθέτει τίτλους ιδιοκτησίας από το 1965, αλλά στους δασικούς
> χάρτες εμφανίζεται ως δασική έκταση. Ποιες είναι οι διαθέσιμες
> διαδικασίες, ποια δικαιολογητικά απαιτούνται, ποια είναι τα σχετικά
> χρονικά όρια και ποια νομοθεσία εφαρμόζεται;

Most recent documented score: **HONEST GAP**. A bridge document (`doc_id`
1700, Ν.3889/2010 as amended by Ν.4685/2020) was ingested in the Phase 5
round but - per `KNOWN_DECISIONS.md`'s own caveat - never independently
re-run against this exact question afterward. Treat this run as the first
real check of whether it actually closed the gap.

**C3 — ΝΟΚ vs. transitional provisions conflict**
> Κατά την έκδοση οικοδομικής άδειας, ο μηχανικός θεωρεί ότι εφαρμόζεται ο
> Νέος Οικοδομικός Κανονισμός, ενώ η ΥΔΟΜ επικαλείται μεταβατικές
> διατάξεις. Ποιο νομοθετικό πλαίσιο ισχύει σήμερα, ποιες τροποποιήσεις
> έχουν γίνει και ποια διάταξη υπερισχύει;

Most recent documented score: **FAIL** (residual fabrication risk). ΝΟΚ
(Ν.4067/2012) was ingested (`doc_id` 1660-1662), a cross-instrument
fabrication guard and a scoped hierarchy-rule precondition were both added
to the system prompt - each measurably changed the answer's structure
(ΝΟΚ now retrieved and cited; the answer now separates what each law covers
before concluding) but the last documented re-run still closed with an
unconfirmed "Ν.4495/2017 prevails" conclusion. **Report the full verbatim
answer for this one, not just a score** - this is the regression test for
the hierarchy-rule scoping fix.

**C4 — Supplementary works on public contract**
> Κατά την εκτέλεση δημόσιου έργου προέκυψαν εργασίες που δεν
> περιλαμβάνονταν στην αρχική σύμβαση. Πότε μπορούν να εγκριθούν
> συμπληρωματικές εργασίες, ποιες διαδικασίες απαιτούνται και ποια
> νομοθεσία τις διέπει;

Most recent documented score: **PASS** (was HONEST GAP; fixed by the
Ν.4412/2016 Άρθρο 132 bridge document, `doc_id` 1701, confirmed by re-run -
this is also the question that surfaced and then confirmed-fixed the
citation-marker-numbering bug).

**C5 — Liability apportionment after storm damage**
> Μετά από έντονη κακοκαιρία εμφανίστηκαν σοβαρές ζημιές σε νέο κτίριο.
> Πώς διαχωρίζεται η ευθύνη μεταξύ φυσικού φαινομένου, κατασκευαστικού
> σφάλματος και πλημμελούς συντήρησης; Παράθεσε τη σχετική νομοθεσία και
> τυχόν τεχνικές οδηγίες.

Most recent documented score: **PASS** (original run, unchanged since).

## Accounting

**A1 — Startup with foreign investor**
> Νεοσύστατη ΙΚΕ λαμβάνει επένδυση από ξένο επενδυτικό fund. Ποιες είναι
> οι φορολογικές, λογιστικές και εταιρικές υποχρεώσεις, ποια παραστατικά
> απαιτούνται και ποια νομοθεσία εφαρμόζεται;

Most recent documented score: **PASS** (was PARTIAL - silently omitted the
foreign-investment-specific sub-question; fixed by the UBO/Ν.4557/2018
bridge document, `doc_id` 1702, confirmed by re-run in the same round).

**A2 — Digital services to non-EU customers**
> Ελληνική εταιρεία παρέχει συνδρομητικές ψηφιακές υπηρεσίες σε πελάτες σε
> ΗΠΑ, Ηνωμένο Βασίλειο, Καναδά και Αυστραλία. Πώς αντιμετωπίζεται ο ΦΠΑ σε
> κάθε περίπτωση και ποιες υποχρεώσεις προκύπτουν σύμφωνα με την ελληνική
> και ευρωπαϊκή νομοθεσία;

Most recent documented score: **PASS** (original run, unchanged since).

**A3 — Indirect audit techniques**
> Η ΑΑΔΕ εφαρμόζει έμμεσες τεχνικές ελέγχου λόγω μεγάλων τραπεζικών
> καταθέσεων. Πότε επιτρέπεται η χρήση τους, ποια δικαιώματα έχει ο
> φορολογούμενος και ποιες αποφάσεις ή εγκύκλιοι ρυθμίζουν τη διαδικασία;

Most recent documented score: **HONEST GAP** (unchanged - no bridge
document was written for this one; the task explicitly noted ΑΑΔΕ's own
operational circulars are the hardest source category to reliably access
and left this as a residual, disclosed gap rather than force a document).

**A4 — Merger of two ΙΚΕ**
> Δύο ΙΚΕ πρόκειται να συγχωνευθούν. Ποιες είναι οι λογιστικές,
> φορολογικές και εταιρικές ενέργειες που απαιτούνται, ποια είναι η σωστή
> σειρά τους και ποια νομοθεσία τις προβλέπει;

Most recent documented score: **HONEST GAP**. A bridge document (`doc_id`
1703, Ν.4601/2019 Άρθρα 42-45) was ingested in the Phase 5 round but - per
`KNOWN_DECISIONS.md`'s own caveat - never independently re-run against this
exact question afterward. Treat this run as the first real check.

**A5 — Company with 4 concurrent activity types**
> Μία εταιρεία δραστηριοποιείται σε λιανική πώληση, ηλεκτρονικό εμπόριο,
> παροχή συμβουλευτικών υπηρεσιών και βραχυχρόνια μίσθωση ακινήτων. Ποιες
> είναι οι φορολογικές και λογιστικές υποχρεώσεις για κάθε δραστηριότητα,
> ποιες διαφέρουν και ποιες διατάξεις εφαρμόζονται σε κάθε περίπτωση;

Most recent documented score: **PASS** (original run, unchanged since -
minor accuracy wobble noted on short-term-rental VAT reasoning, not scored
as a hard error).

## Nightmare prompt (run twice)

Template - insert C2's or A3's question text where marked:

> Θέλω να αναλύσεις την παρακάτω υπόθεση χρησιμοποιώντας αποκλειστικά την
> knowledge base. Για κάθε συμπέρασμα: παράθεσε τον νόμο, το άρθρο και το
> σχετικό ΦΕΚ. Αν η διάταξη έχει τροποποιηθεί, εμφάνισε και την ισχύουσα
> μορφή της. Αν υπάρχουν αντικρουόμενες εγκύκλιοι ή ερμηνείες, παρουσίασέ
> τες όλες και εξήγησε ποια υπερισχύει. Αν λείπει πληροφορία από την
> knowledge base, μην κάνεις υποθέσεις — δήλωσε ακριβώς τι λείπει και γιατί
> δεν μπορεί να εξαχθεί ασφαλές συμπέρασμα. Στο τέλος, πρόσθεσε λίστα όλων
> των πηγών που χρησιμοποίησες με υπερσυνδέσμους. Υπόθεση: [C2 or A3 text]

Scored on 4 properties, each met/not met (not a single PASS/FAIL):
(a) article + ΦΕΚ cited for every claim, (b) amended-provision current form
surfaced where relevant, (c) conflicting circulars/interpretations named
explicitly, or explicitly stated none exist, (d) missing information named
explicitly rather than guessed.

**Nightmare 1 (C2 embedded)** - most recent documented scoring: (a) N/A -
met (no claims made to cite), (b) N/A, (c) **not met** (never explicitly
resolved "none found" vs. naming conflicts, just gestured at absence),
(d) **met** (3 specific missing items named). Also failed the instruction
to append a hyperlinked source list - omitted entirely.

**Nightmare 2 (A3 embedded)** - most recent documented scoring: (a) **not
met** (cites ΚΦΔ Ν.4174/2013 and άρθρο 14 generally, never a ΦΕΚ number),
(b) **not met** (no amendment-currency check performed), (c) **not met**
(same pattern as nightmare 1), (d) **met**. Appended a numbered
"Χρησιμοποιημένα Αποσπάσματα" list - an attempt at the requested source
list, but without hyperlinks as instructed.
