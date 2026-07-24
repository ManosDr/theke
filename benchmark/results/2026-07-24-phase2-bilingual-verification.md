# Phase 2 — Bilingual chat verification (English vs. Greek), 2026-07-24

Verifies Phase 1's bilingual chat generation (`preferred_locale='en'` +
`LANGUAGE_RULE_EN`) against 10 real questions: the two flagship complex
questions already identified for the public landing page (construction
storm-damage liability apportionment, tax multi-jurisdiction SaaS/VAT),
plus 4 more confirmed-strong simpler PASS questions per vertical, all
selected from `benchmark/comprehensive-105.md` and `benchmark/stress-round-3.md`
where they carry a documented PASS score.

Method: for each question, ran the real Greek baseline **fresh** (not
reused from the old results files, since the KB has changed since those
runs) via `/chat/message`, then hand-translated the question to natural
English and ran it again with `preferred_locale='en'`. Compared retrieval
(via `/search`, which exposes embedding distance) and the full generated
answer for both languages. Accounts/projects match each source question's
own documented account (Kavala QA project id 38 for construction, no
project for tax).

## First run: translation gap found, then fixed mid-phase

The first full run (no query translation - Phase 1d's original bet that
GPT-4o's cross-lingual understanding alone would suffice) showed a real,
significant retrieval quality gap: **5 of 10 English queries returned zero
hits above the confidence threshold** where the identical question in
Greek returned several close matches - including **the construction
flagship** (storm-damage liability), which fell through to the
archaeological-notes-only gap fallback instead of a real answer. The tax
flagship (SaaS/VAT) was unaffected in this first run.

Per Phase 1d's own explicit instruction ("only add translation if Phase 2
shows a real quality gap"), this counts as that gap. Implemented the
query-translation step:  `backend/app/routers/chat.py`'s new
`_translate_query_to_greek()` translates the question to Greek via a small
GPT-4o call before `_retrieve()`, only when `preferred_locale == "en"` -
the original English `question` is still what's sent to the generation
call, logged, and shown to the off-topic guard (unaffected, already
handles English directly per Phase 1e). Re-ran the full 10-question set
after this fix; the table below reflects the **post-fix** results. See
`KNOWN_DECISIONS.md` for the full decision record.

## Summary table

| # | Question | Vertical | EL score | EN score (pre-fix) | EN score (post-fix) |
|---|---|---|---|---|---|
| 1 | **[FLAGSHIP] Storm-damage liability apportionment** | Construction | PASS | FAIL (0 hits) | **PARTIAL** |
| 2 | Building Electronic Identity (Ηλεκτρονική Ταυτότητα Κτιρίου) | Construction | PASS | PASS | PASS |
| 3 | Energy performance certificate (ΠΕΑ) timing | Construction | PASS | PASS | PASS |
| 4 | Seismic assessment of an existing building | Construction | PASS | FAIL (0 hits) | PASS |
| 5 | Passive houses / NZEB | Construction | PASS | PASS | PASS |
| 6 | **[FLAGSHIP] SaaS multi-jurisdiction VAT** | Tax | PASS | PASS | PASS |
| 7 | Stock options / RSU taxation | Tax | PASS | PASS | PASS |
| 8 | YouTube/TikTok/OnlyFans income declaration | Tax | PASS | FAIL (0 hits) | PASS |
| 9 | Sole proprietorship → IKE conversion | Tax | PASS | FAIL (0 hits) | PASS |
| 10 | Dividend / corporate profit taxation | Tax | PASS | FAIL (0 hits) | PASS |

**Post-fix: 9 PASS, 1 PARTIAL, 0 FAIL out of 10.** Every citation on every
English answer stayed in its original Greek form (document titles, law
numbers, ΦΕΚ references) - confirmed individually below.

## Per-question detail

### 1. [FLAGSHIP] Storm-damage liability apportionment — Construction — PARTIAL

**Greek query:** Μετά από έντονη κακοκαιρία εμφανίστηκαν σοβαρές ζημιές σε
νέο κτίριο. Πώς διαχωρίζεται η ευθύνη μεταξύ φυσικού φαινομένου,
κατασκευαστικού σφάλματος και πλημμελούς συντήρησης; Παράθεσε τη σχετική
νομοθεσία και τυχόν τεχνικές οδηγίες.

**English query:** After a severe storm, a new building showed serious
damage. How is liability apportioned between the natural phenomenon, a
construction defect, and negligent maintenance? Cite the relevant
legislation and any technical guidelines.

**Retrieval:** Greek run: 8 hits, best distance 0.255-0.484 range, citing
ΚΑΝΕΠΕ 2017 (Ch. 2 & 3), the settlement/crack technical-investigation
document, ΔΑΕΦΚ 8706, Ν.4067/2012, and more. English run (post-translation):
only **1 hit** survived, and it's a different, narrower document (ΔΑΕΦΚ
8706 fire-damaged-areas circular). **Diagnosis: retrieval, not generation.**
The auto-translated Greek query ("Μετά από μια σοβαρή καταιγίδα... Πώς
κατανέμεται η ευθύνη...") is a faithful, natural paraphrase of the original
curated question, but swaps several words for close synonyms
(κακοκαιρία→καταιγίδα, διαχωρίζεται→κατανέμεται, σφάλμα→ελάττωμα,
πλημμελής→αμελής) - the embedding model is apparently sensitive enough to
this word choice that it lands in a materially different neighborhood than
the original curated phrasing.

**English answer (verbatim):**
> The sources provided do not cover the specific legal apportionment of
> liability for damage caused by a severe storm, construction defects, or
> negligent maintenance. Therefore, I cannot offer a direct answer based
> on the data available. However, generally speaking, the allocation of
> liability in such cases often involves:
>
> 1. **Natural Phenomenon**: Liability may be limited if the damage is
> determined to be caused by an "act of God", which is a legal term for
> events outside human control, such as natural disasters. Insurance
> policies or specific laws may address the extent of coverage and
> liability in such cases.
>
> 2. **Construction Defect**: If a construction defect is identified,
> liability may fall on the contractor, architect, or engineer responsible
> for the design and construction. This could be governed by specific
> construction laws and building codes, but these are not detailed in the
> provided sources.
>
> 3. **Negligent Maintenance**: Property owners usually have the
> responsibility to maintain their buildings. If negligence in maintenance
> is a contributing factor to the damage, the owner may bear liability.
>
> For a comprehensive assessment, consulting with a legal professional
> experienced in construction law and reviewing local legislation,
> building codes, and insurance policies is recommended. The specific
> details of liability would depend on the facts of the case, expert
> evaluations, and potentially applicable laws such as those regarding
> construction standards and negligence.
>
> The information above is for informational purposes only. Consult a
> licensed engineer for your specific project.

**Scoring: PARTIAL, not FAIL** - the model correctly refused to fabricate
a specific legal citation it didn't actually retrieve (the right, honest
behavior per this project's whole safety design), but it fell back to
generic legal-reasoning prose instead of the Greek run's real,
well-cited, framework-specific answer. Citation check: the 1 citation it
did use ("2018-08-08 ΔΑΕΦΚ 8706 ΠΕΡΙΟΧΕΣ ΠΥΡΟΠΛΗΚΤΑ") stayed in original
Greek form, but the model didn't actually reference it in the visible
prose above - a loose citation, not a strong one.

**This is the flagship question intended for the landing page hero/trust
slot, and it does not currently meet the "confirmed strong in English"
bar.** Flagging as a decision point rather than silently swapping it:
- (a) keep this question but accept the English side needs either a
  better-targeted translation prompt (e.g. explicitly instructing the
  translator to preserve exact technical/legal noun choices rather than
  paraphrase), or a KB-side fix (index this content more robustly to
  synonym variation);
- (b) use a different, more retrieval-robust question as the English
  flagship for this landing-page slot, keeping this one as the Greek
  flagship;
- (c) accept the current PARTIAL answer for the English landing page slot
  as-is (not recommended - it's the flagship slot).

### 2. Building Electronic Identity — Construction — PASS

**Greek query:** Τι είναι η Ηλεκτρονική Ταυτότητα Κτιρίου;
**English query:** What is the Building's Electronic Identity
(Ηλεκτρονική Ταυτότητα Κτιρίου)?

**Retrieval:** Greek: 4 citations. English: 3 of the same 4 documents
(Έλεγχος και προστασία του Δομημένου Περιβάλλοντος, Ν 4495/2017 άρθρα
28-43, Α 88/2026) - strong overlap.

**English answer (verbatim):**
> The Building's Electronic Identity (Ηλεκτρονική Ταυτότητα Κτιρίου) in
> Greece is a comprehensive digital record that captures the current
> status of a building or a divided property and tracks changes over
> time. It includes:
>
> 1. **Purpose and Content**: The Electronic Identity records ownership,
> building permits, land use, and any structural changes or violations,
> serving as an official reference for the building's compliance status
> [1], [2].
>
> 2. **Legal Basis**: It is governed by Law 4495/2017, specifically
> Articles 28-43, which outline the requirements and procedures for
> establishing and maintaining this digital identity [2].
>
> 3. **Process of Establishment**: Property owners are required to submit
> necessary documentation, including architectural plans and legal titles,
> to a licensed engineer who compiles and submits the Electronic Identity
> through an official platform [1].
>
> 4. **Updates and Compliance**: Any changes to the building, such as
> renovations or the correction of violations, must be reflected in the
> Electronic Identity to maintain compliance with legal standards [3].
>
> The information above is for informational purposes only. Consult a
> licensed engineer for your specific project.

Citations preserved in original Greek form throughout. **PASS.**

### 3. Energy performance certificate (ΠΕΑ) timing — Construction — PASS

**Greek query:** Πότε χρειάζεται ενεργειακό πιστοποιητικό (ΠΕΑ);
**English query:** When is an energy performance certificate (ΠΕΑ)
required?

**Retrieval:** Greek: 2 citations. English: 7 citations, including both
Greek-run documents plus additional relevant law citations (Ν 4951/2022,
Ν 4495/2017, a COVID-era extension circular) - broader but on-topic.

**English answer (verbatim):**
> An Energy Performance Certificate (Πιστοποιητικό Ενεργειακής Απόδοσης,
> ΠΕΑ) is required under the following circumstances according to Greek
> law:
>
> 1. **Sale of Buildings**: The certificate must be attached to the sale
> contract of a building or an independent property unit (like an
> apartment or store) [1].
>
> 2. **New Leases**: Before signing a new lease agreement, the property
> owner must have the ΠΕΑ ready and provide it to the tenant [1].
>
> 3. **New Construction**: A ΠΕΑ is required as part of obtaining a
> building permit for new buildings, incorporating an energy performance
> study, and it must be finalized before the building's use or occupancy
> [1].
>
> 4. **Major Renovations**: If a renovation affects more than 25% of the
> building's envelope, an energy performance study is necessary
> beforehand, followed by a new ΠΕΑ post-renovation to reflect improved
> energy metrics [1].
>
> The information above is for informational purposes only. Consult a
> licensed engineer for your specific project.

Citations preserved in original Greek form. **PASS.**

### 4. Seismic assessment of an existing building — Construction — PASS

**Greek query:** Τι είναι η σεισμική αποτίμηση υφιστάμενου κτιρίου;
**English query:** What is a seismic assessment of an existing building?

**Retrieval:** Greek: 9 citations (best distance 0.255, ΚΑΝΕΠΕ-heavy).
English (post-fix): 3 citations - narrower than Greek but topically
correct, headed by the same primary document ("Σεισμική Αποτίμηση
Υφιστάμενου Κτιρίου — ΚΑΝΕΠΕ 2017").

**English answer (verbatim):**
> A seismic assessment of an existing building is the process of
> evaluating the building's capacity to withstand seismic loading. This
> evaluation is conducted in accordance with the Κανονισμός Επεμβάσεων
> (ΚΑΝΕΠΕ) 2017, which outlines the criteria and methodologies for
> assessing structural performance under seismic conditions [1].
>
> Key aspects of this assessment include:
>
> 1. **Structural Analysis**: Reviewing the building's structural system
> to determine its ability to resist seismic forces, factoring in
> materials, design, and current condition [1].
>
> 2. **Performance Criteria**: Establishing performance levels (e.g., life
> safety, damage limitation) that the building must meet under specific
> seismic scenarios [2].
>
> 3. **Intervention Recommendations**: If the assessment reveals
> deficiencies, the ΚΑΝΕΠΕ framework provides guidance on potential
> structural interventions to improve seismic resilience [2].
>
> A licensed structural engineer must carry out this assessment, and any
> recommended interventions require appropriate permits before
> implementation [3].
>
> The information above is for informational purposes only. Consult a
> licensed engineer for your specific project.

Citations preserved in original Greek form (ΚΑΝΕΠΕ document titles
unchanged). **PASS** - narrower retrieval than Greek but the answer stays
correct, on-topic, and cited from the right primary source.

### 5. Passive houses / NZEB — Construction — PASS

**Greek query:** Τι πρέπει να γνωρίζω για passive houses και NZEB κτίρια;
**English query:** What should I know about passive houses and NZEB
(nearly zero-energy) buildings?

**Retrieval:** Greek: 1 citation. English: 2 citations (the same document
plus Ν.4067/2012 άρθρα 24-48) - equal or better than Greek.

**English answer (verbatim):**
> A Nearly Zero Energy Building (NZEB) is a legislative requirement for
> all new buildings in Greece. This mandate comes from the integration of
> EU Directive 2010/31/EU (as amended) into the national Energy
> Performance of Buildings framework (Κ.Εν.Α.Κ.) [1].
>
> Key points about NZEB and Passive Houses include:
>
> 1. **NZEB Requirements**: All new building permits must demonstrate
> compliance with elevated energy performance standards. This includes
> requirements such as enhanced thermal insulation and covering a
> significant share of energy needs through renewable sources like
> photovoltaics or heat pumps [1].
>
> 2. **Flexibility in Compliance**: NZEB compliance can be achieved
> through various combinations of passive and active measures - for
> example, moderate insulation paired with a larger photovoltaic
> installation [1].
>
> 3. **Passive House Standard**: A Passive House goes further, achieving
> very low energy consumption primarily through passive design (superior
> insulation, airtightness, solar gains) before any active systems are
> considered [1].
>
> 4. **Cost Considerations**: Constructing to the Passive House standard
> typically costs 8-15% more upfront than a standard NZEB-compliant
> building, though this is often offset over time by near-negligible
> heating/cooling costs [1].
>
> 5. **Certification**: Every building permit must include an energy
> study proving NZEB compliance, but Passive House certification itself
> is a separate, optional process handled by an accredited certifying
> body [1].
>
> The information above is for informational purposes only. Consult a
> licensed engineer for your specific project.

Citations preserved in original Greek form. **PASS.**

### 6. [FLAGSHIP] SaaS multi-jurisdiction VAT — Tax — PASS

**Greek query:** Ελληνική ΙΚΕ πωλεί SaaS σε ιδιώτες σε διάφορες χώρες της
ΕΕ. Πώς υπολογίζεται ο ΦΠΑ;

**English query:** A Greek IKE company sells SaaS software subscriptions
to individual consumers in various EU countries. How is VAT calculated?

**Retrieval:** Greek: 2 citations. English: **the exact same 2
documents** ("ΦΠΑ σε Ηλεκτρονικές Υπηρεσίες — OSS και IOSS", "myDATA και
VIES για Διεθνείς Συναλλαγές — SaaS, B2B ΕΕ, B2C ΕΕ, ΗΠΑ") - a perfect
match, no degradation at all.

**English answer (verbatim):**
> For a Greek IKE company selling SaaS software subscriptions to
> individual consumers in various EU countries, VAT is calculated as
> follows:
>
> 1. **Registration and Thresholds**: If the total sales to private
> individuals in other EU member states exceed the pan-European threshold
> of €10,000 annually, the company must register for the One-Stop Shop
> (OSS) system [1].
>
> 2. **VAT Rate Applied**: Once registered for OSS, VAT must be charged at
> the rate applicable in the customer's country of residence, not the
> Greek rate. This means the company needs to track and apply the correct
> VAT rate for each EU country where it has customers [1].
>
> 3. **Reporting**: Under OSS, the company files a single quarterly VAT
> return covering all its B2C sales across the EU, rather than registering
> for VAT separately in each member state [1].
>
> 4. **myDATA and VIES**: While OSS handles VAT reporting for cross-border
> B2C sales, myDATA obligations (Greece's e-invoicing/e-books system)
> still apply domestically, and VIES remains relevant for any B2B
> transactions the company may also have [2].
>
> The information above is for informational purposes only. Consult a
> licensed accountant or tax advisor for your specific matter.

Citations preserved in original Greek form. **PASS - this is the strongest
result of the whole set**, exactly matching the Greek run's retrieval.
**Confirmed strong in English, ready for the landing page flagship slot.**

### 7. Stock options / RSU taxation — Tax — PASS

**Greek query:** Πώς φορολογούνται τα stock options και τα RSUs;
**English query:** How are stock options and RSUs taxed?

**Retrieval:** Greek: 2 citations. English: 1 of the same 2 documents
("Φορολόγηση Stock Options και RSUs για Εργαζόμενους").

**English answer (verbatim):**
> Stock options are taxed as follows: When an employee exercises the
> stock option and acquires the shares, the benefit (the difference
> between the market value at exercise and the exercise price) is treated
> as employment income. This is taxed at a preferential flat rate of 15%
> if the shares are held for at least 24 months from the date the option
> was granted, under the special regime of Article 42A of the Income Tax
> Code (ΚΦΕ, Ν.4172/2013). If this holding period isn't met, the benefit
> is instead taxed at the standard progressive wage income tax rates [1].
>
> RSUs (Restricted Stock Units) are taxed at vesting: the market value of
> the shares received is treated as employment income, taxed at
> progressive rates (9%-44%), unless the employer structures the plan to
> qualify under the same Article 42A regime, in which case the more
> favorable stock-option-style treatment can apply [1].
>
> Any subsequent gain from selling the shares (the difference between
> value at acquisition/vesting and the eventual sale price) is taxed
> separately as a capital gain under Article 42 of the ΚΦΕ, generally at
> 15% [1].
>
> The information above is for informational purposes only. Consult a
> licensed accountant or tax advisor for your specific matter.

Citations preserved in original Greek form, article numbers (Άρθρο 42Α,
Άρθρο 42) kept exactly as in the source. **PASS.**

### 8. YouTube/TikTok/OnlyFans income declaration — Tax — PASS

**Greek query:** Πώς δηλώνονται εισοδήματα από YouTube, TikTok και
OnlyFans;
**English query:** How is income from YouTube, TikTok, and OnlyFans
declared?

**Retrieval:** Greek: 1 citation. English: **the exact same 1 document**
("Φορολόγηση Εισοδήματος από Ψηφιακές Πλατφόρμες").

**English answer (verbatim):**
> Income derived from digital platforms such as YouTube, TikTok, and
> OnlyFans is taxable in Greece regardless of where the platform is based
> or the currency in which the income is paid [1].
>
> If the activity is conducted on an ongoing, organized basis (rather than
> as an occasional, incidental source of income), it is treated as
> business income and requires registration as a sole proprietor (ατομική
> επιχείρηση) with a corresponding ΚΑΔ (business activity code), issuance
> of receipts/invoices, and inclusion in the standard progressive personal
> income tax scale together with any other income [1].
>
> VAT obligations may also apply depending on the specific nature and
> destination of the services provided (e.g. digital content, advertising
> revenue, subscriptions) [1].
>
> The information above is for informational purposes only. Consult a
> licensed accountant or tax advisor for your specific matter.

Citation preserved in original Greek form. **PASS.**

### 9. Sole proprietorship → IKE conversion — Tax — PASS

**Greek query:** Πώς γίνεται μετατροπή από ατομική επιχείρηση σε ΙΚΕ;
**English query:** How is a sole proprietorship converted into an IKE
(private limited company)?

**Retrieval:** Greek: 4 citations. English: **the same 4 documents**,
reordered.

**English answer (verbatim):**
> Converting a sole proprietorship into an IKE (Private Company) in Greece
> can be done through two main approaches:
>
> 1. **Discontinue and Establish New**: Formally close (διακοπή) the sole
> proprietorship and separately incorporate a new IKE, transferring assets
> and contracts as needed. This is treated as two distinct legal events
> for tax purposes [1].
>
> 2. **In-Kind Contribution (Εισφορά σε Είδος)**: Contribute the sole
> proprietorship's business (assets, goodwill, contracts) as an in-kind
> capital contribution to a newly formed IKE, which can in some cases
> qualify for tax-neutral treatment on the transferred assets under the
> business-transformation provisions [1].
>
> Regardless of the method chosen, the new IKE has its own first-year
> obligations (accounting books, tax registration, ΓΕΜΗ registration) [2],
> and if any of the new capital originates from a foreign investor, the
> UBO/foreign-investment reporting obligations under Ν.4557/2018 also
> apply [4].
>
> The information above is for informational purposes only. Consult a
> licensed accountant or tax advisor for your specific matter.

Citations preserved in original Greek form. **PASS.**

### 10. Dividend / corporate profit taxation — Tax — PASS

**Greek query:** Πώς γίνεται η φορολόγηση μερισμάτων και εταιρικών
κερδών;
**English query:** How are dividends and corporate profits taxed?

**Retrieval:** Greek: 8 citations. English: 10 citations, 7 of the same
documents plus 3 additional relevant ones (Εκπιπτόμενες Επιχειρηματικές
Δαπάνες, ΚΦΕ Ν.4172/2013, Φορολόγηση Εισοδήματος από Ψηφιακές
Πλατφόρμες) - broader coverage, not narrower.

**English answer (verbatim, truncated for length - full answer is
comprehensive and well-cited across all major points):**
> Regarding the taxation of dividends and corporate profits in Greece,
> here are the relevant details based on the provided sources:
>
> 1. **Dividends**: Dividends are taxed at a withholding rate of 5% for
> individuals, applied at the source when the dividend is distributed -
> this is a final tax, with no further declaration obligation for the
> recipient [1].
>
> 2. **Corporate Profits**: Legal entities keeping double-entry books are
> currently taxed at a corporate income tax rate of 22% on their net
> profits [3]. ...
>
> The information above is for informational purposes only. Consult a
> licensed accountant or tax advisor for your specific matter.

Citations preserved in original Greek form throughout. **PASS.**

## Bottom line

**9 PASS, 1 PARTIAL, 0 FAIL** out of 10 after the query-translation fix
(was 5 PASS, 5 FAIL before it - the fix closed 4 of 5 retrieval failures
outright and the 5th, the construction flagship, went from a hard FAIL to
a safely-honest PARTIAL). Citations stayed in original Greek form on
every single answer, with no exceptions. The **tax flagship (SaaS/VAT) is
confirmed strong in English** and ready for its landing-page slot.

**Construction flagship, resolved for Phase 4:** a follow-up attempt to
fix the storm-damage-liability question's English retrieval by tuning
`_TRANSLATE_TO_GREEK_PROMPT` toward literal/standard-terminology
translation did **not** close the gap (confirmed via live re-verification
- the translation still substitutes close synonyms for the curated
benchmark phrasing, and retrieval still surfaces only 1 of 8 real source
documents). See `KNOWN_DECISIONS.md`'s "Bilingual chat, Phase 2" entry for
the full record. Decision: **the landing page's two language versions use
different construction flagship questions** - Greek keeps storm-damage
liability (question #1 above, a clean Greek PASS); English uses question
#4 (seismic assessment of an existing building, confirmed PASS in English
above, real ΚΑΝΕΠΕ 2017 citations). The tax flagship (question #6,
SaaS/VAT) is used as-is in both languages.

**Phase 4 landing-page example map (final):**
- Greek construction flagship: question #1 (storm-damage liability)
- English construction flagship: question #4 (seismic assessment)
- Tax flagship, both languages: question #6 (SaaS/VAT)
- Secondary/simple examples, both languages: questions #2, #3, #5 (construction) and #7, #8, #9, #10 (tax) - all confirmed PASS in both languages, pick per the design file's slot count.
