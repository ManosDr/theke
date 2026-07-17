# 2A-Q2 citation fix — Result: 2026-07-17

**Fix applied:** corrected the repealed-law citation in bridge document
1525 (`myDATA και VIES για Διεθνείς Συναλλαγές`), the source of the
Ν.2859/2000 citation flagged three times in the 2026-07-16 regression
sweep (Set 3 A2, Set 1 2A-Q2, Set 2 Accounting Q2).

## Investigation

Read the "Νομική βάση" line and inline citations in all three bridge
documents named in the fix request:

- **1523** (Αυθαίρετες Παραβάσεις και Μεταβίβαση Ακινήτου) — cites only
  Ν.4495/2017. No Ν.2859/2000 reference. **Not affected, not changed.**
- **1524** (Κατασκευαστικά Προβλήματα μετά Παράδοση) — cites only ΑΚ
  (Αστικός Κώδικας) άρθρα 693-702 and Ν.4495/2017 άρθρο 25. No
  Ν.2859/2000 reference. **Not affected, not changed.**
- **1525** (myDATA και VIES για Διεθνείς Συναλλαγές) — the only one of
  the three that actually cited Ν.2859/2000 (three times: two inline,
  one in the "Νομική βάση" summary line). **This is the document that
  was fixed.**

## Article-number mapping (verified against the ingested full text of
Ν.5144/2024, docs 296-298)

Rather than assume a 1:1 renumbering, each old citation was checked
against the actual current-law text:

| Old (Ν.2859/2000) | New (Ν.5144/2024) | Verification |
|---|---|---|
| Άρθρο 14 (reverse charge / place-of-supply basis for the B2B EU citation) | **Άρθρο 18, παρ. 2(α)** ("Τόπος παροχής υπηρεσιών" — γενικός κανόνας Β2Β) | Confirmed by reading Άρθρο 18's text directly in doc 296: paragraph 2(a) states the general rule that the place of supply for B2B services is where the recipient is established — this is the actual current basis for the German-client reverse-charge scenario. |
| Άρθρο 14 παρ. 2 (non-EU customer, outside VAT scope) | **Άρθρο 18, παρ. 2(α)** (same provision — it's one general B2B rule, not two) | Same paragraph governs both the EU-B2B and non-EU-B2B scenarios; the old code's "παρ. 2" distinction doesn't have a separate counterpart in the new code because it's a single general rule regardless of the recipient's location. |
| Άρθρα 47α-47γ (OSS/IOSS special schemes) | **Άρθρα 56-58** | Confirmed via doc 297's table of contents and article headers: Άρθρο 56 = "Ειδικό καθεστώς για υπηρεσίες... μη εγκατεστημένους εντός της ΕΕ" (non-Union scheme), Άρθρο 57 = "Ειδικό καθεστώς για ενδοκοινοτικές εξ αποστάσεως πωλήσεις αγαθών... και για υπηρεσίες που παρέχονται από υποκείμενους... εγκατεστημένους εντός της ΕΕ αλλά μη εγκατεστημένους στο κράτος μέλος κατανάλωσης" (Union scheme — this is the one covering our SaaS B2C-to-other-EU-states scenario), Άρθρο 58 = "Ειδικό καθεστώς για εξ αποστάσεως πωλήσεις αγαθών που εισάγονται από τρίτες χώρες" (import scheme / IOSS). |

Note that the old article 14's "παρ. 2" split did not carry forward
1:1 — this was caught precisely because the mapping was verified against
the actual new-law text rather than assumed.

## Content change (doc 1525)

- Inline: `"Reverse Charge — άρθρο 14 Ν.2859/2000"` → `"Reverse Charge —
  άρθρο 18 παρ. 2(α) Ν.5144/2024"`
- Inline: `άρθρο 14 παρ. 2 Ν.2859/2000 — τόπος παροχής εκτός ΕΕ` →
  `άρθρο 18 παρ. 2(α) Ν.5144/2024 — γενικός κανόνας Β2Β: τόπος παροχής
  εκεί όπου είναι εγκατεστημένος ο λήπτης, άρα εκτός ΕΕ`
- Νομική βάση line: `Ν.2859/2000 άρθρα 14, 47α-47γ (OSS), Α.1138/2020
  (myDATA υποχρεώσεις), VIES Κανονισμός ΕΕ 904/2010` → `Ν.5144/2024
  άρθρο 18 (τόπος παροχής υπηρεσιών· παρ. 2(α) γενικός κανόνας Β2Β),
  άρθρα 56-58 (ειδικά καθεστώτα OSS/IOSS: 56 = μη εγκατεστημένοι εκτός
  ΕΕ, 57 = ενδοκοινοτικό/Union scheme, 58 = εισαγωγές τρίτων
  χωρών/IOSS), Α.1138/2020 (myDATA υποχρεώσεις), VIES Κανονισμός ΕΕ
  904/2010`

Existing embeddings for doc 1525 were deleted and regenerated (2 chunks)
against the corrected content, following the same delete-then-
`embed_document()` pattern already used by the admin revalidation
endpoint (`backend/app/routers/admin.py`'s `revalidate_document`).

## Re-verification: 2A-Q2 re-run

Query: *"Ελληνική εταιρεία παρέχει υπηρεσίες σε επιχείρηση στη Γερμανία.
Πώς αντιμετωπίζεται ο ΦΠΑ και ποιες είναι οι υποχρεώσεις VIES;"*
(`demo-member@accounting.theke.gr`, no project)

```
SEARCH top: dist=0.425 doc=1525 | dist=0.455 doc=1079 | dist=0.494 doc=1525
CHAT status=200 gap=true citations=2
```

> Όταν μια ελληνική εταιρεία παρέχει υπηρεσίες σε επιχείρηση στη Γερμανία,
> οι υποχρεώσεις σχετικά με τον ΦΠΑ και το VIES είναι οι εξής:
>
> 1. **ΦΠΑ**: Σύμφωνα με το άρθρο 18, παρ. 2(α) του Ν.5144/2024, ο
> γενικός κανόνας για συναλλαγές μεταξύ επιχειρήσεων (B2B) είναι ότι ο
> τόπος παροχής των υπηρεσιών είναι εκεί όπου είναι εγκατεστημένος ο
> λήπτης των υπηρεσιών. Επομένως, για υπηρεσίες που παρέχονται από
> ελληνική εταιρεία σε επιχείρηση στη Γερμανία, ο ΦΠΑ είναι μηδενικός
> ("Reverse Charge") και το τιμολόγιο εκδίδεται χωρίς ΦΠΑ [1]. Στο
> myDATA, η καταχώριση γίνεται με κατηγορία εσόδου 1.1 και κωδικό
> εξαίρεσης 22 για ενδοκοινοτική παροχή υπηρεσιών [1].
>
> 2. **Υποχρεώσεις VIES**: Η ελληνική εταιρεία που παρέχει υπηρεσίες
> B2B σε επιχείρηση σε άλλο κράτος-μέλος της ΕΕ, όπως η Γερμανία,
> υποχρεούται να υποβάλει ανακεφαλαιωτικό πίνακα (VIES) μέσω της
> ΑΑΔΕ/TAXISnet μέχρι το τέλος κάθε μήνα για τον προηγούμενο μήνα [1].
> Η εταιρεία πρέπει να επαληθεύσει το έγκυρο ΑΦΜ/VAT number του λήπτη
> στο VIES πριν την τιμολόγηση με μηδενικό συντελεστή ΦΠΑ [2].
>
> Η εφαρμογή του νόμου απαιτεί επιβεβαίωση από αδειούχο λογιστή ή
> φοροτεχνικό, για να διασφαλιστεί η σωστή τήρηση όλων των διαδικασιών.

**Confirmed: citation now correctly shows Ν.5144/2024, article 18 παρ.
2(α), with the correct current-law provision.** Content/substance
unchanged (still correct) — only the citation was stale.

## Result

**Fixed.** This resolves the citation for 2A-Q2 → PASS (was PARTIAL).
The same fix should also resolve the identical issue previously observed
in Set 3's A2 and Set 2's Accounting Q2, since all three traced back to
this same bridge document — not independently re-run here since Fix 1's
scope was 2A-Q2 specifically, but flagged for the next full sweep to
confirm.
