"""Maps crawler source_name values (crawler/crawler/sources.py entry names)
to the human-facing group a user picks from on the Sources page - several
raw source_names can belong to the same body (e.g. e-ΕΦΚΑ has two).
"""

SOURCE_GROUPS: dict[str, str] = {
    "fek_search_api": "ΦΕΚ (Εθνικό Τυπογραφείο)",
    "tee_e_adeies": "ΤΕΕ",
    "tee_portal": "ΤΕΕ",
    "ypen_nomothesia": "ΥΠΕΝ",
    "aade_e9_enfia": "ΑΑΔΕ",
    "aade_property_transfer_tax": "ΑΑΔΕ",
    "efka_oikodomotechnika_koina": "e-ΕΦΚΑ",
    "efka_oikodomotechnika_apografi": "e-ΕΦΚΑ",
    "ktimatologio_thesmiko_plaisio": "Κτηματολόγιο",
    "eugo_e_adeies": "e-Άδειες (EUGO)",
    "deddie_new_connection": "ΔΕΔΔΗΕ",
    "deyakav_new_connection": "ΔΕΥΑ Καβάλας",
    "manual_entry_dasarcheio": "Δασαρχείο (εκκρεμεί χειροκίνητη καταχώριση)",
    "manual_entry_ktimatologio_post_construction": "Κτηματολόγιο (εκκρεμεί χειροκίνητη καταχώριση)",
    "manual_entry_ydom_kavala_coefficients": "ΥΔΟΜ Καβάλας (εκκρεμεί χειροκίνητη καταχώριση)",
    "dimospaggaiou_ydom": "ΥΔΟΜ Παγγαίου",
    "deyapaggaiou_new_connection": "ΔΕΥΑΑ Παγγαίου",
    "manual_entry_ydom_paggaio_coefficients": "ΥΔΟΜ Παγγαίου (εκκρεμεί χειροκίνητη καταχώριση)",
    "thassos_ydom": "ΥΔΟΜ Θάσου",
    "deyathassou_new_connection": "ΔΕΥΑ Θάσου",
    "manual_entry_ydom_thassos_coefficients": "ΥΔΟΜ Θάσου (εκκρεμεί χειροκίνητη καταχώριση)",
    "dimos_dramas_ydom": "ΥΔΟΜ Δράμας (εκκρεμεί έλεγχος περιεχομένου)",
    "deyad_new_connection": "ΔΕΥΑ Δράμας",
    "deyaxanthis_faq": "ΔΕΥΑ Ξάνθης",
    "manual_entry_ydom_xanthis": "ΥΔΟΜ Ξάνθης (εκκρεμεί χειροκίνητη καταχώριση)",
    "gps_fek_kavala": "ΓΠΣ Καβάλας (ΦΕΚ)",
    "gps_fek_xanthi": "ΓΠΣ Ξάνθης (ΦΕΚ)",
    "gps_fek_drama_scanned": "ΓΠΣ Δράμας (ΦΕΚ - σαρωμένο, εκκρεμεί χειροκίνητη καταχώριση)",
    "manual_entry_gps_fek_paggaio_not_located": "ΓΠΣ Παγγαίου (εκκρεμεί εντοπισμός ΦΕΚ)",
    "manual_entry_gps_fek_thassos_not_located": "ΓΠΣ Θάσου (εκκρεμεί εντοπισμός ΦΕΚ)",
    # These entries exist as live source_name values in the documents table
    # (added by the tax_accounting-vertical crawl work) but were never added
    # here, so group_label()'s fallback (see below) returned them as raw,
    # untranslated slugs on the Sources page and everywhere else
    # source_group is rendered. Labels were checked against each source's
    # actual crawled document titles/URLs, not guessed from the slug alone.
    "manual_entry": "Χειροκίνητη καταχώριση",
    "manual_entry_gis": "Χειροκίνητη καταχώριση (Πολεοδομικά στοιχεία)",
    "manual_entry_tax": "Χειροκίνητη καταχώριση (Φορολογικά)",
    "opengov_minenv_building_permit_reg": "ΥΠΕΝ (Άδειες Δόμησης)",
    "mitos_gov_gr_eadeies": "e-Άδειες (mitos.gov.gr)",
    "aade_circulars": "ΑΑΔΕ",
    "efka_employer_apd": "e-ΕΦΚΑ",
    "ded_faq": "ΔΕΔ (Συχνές Ερωτήσεις)",
    "fek_fpa": "ΦΕΚ (ΦΠΑ)",
    "fek_kfd": "ΦΕΚ (ΚΦΔ)",
    "lawspot_enfia": "Lawspot (ΕΝΦΙΑ)",
    "lawspot_kfe": "Lawspot (ΚΦΕ)",
    "myaade_guide": "myAADE (Οδηγός)",
}


def group_label(source_name: str | None) -> str:
    if source_name is None:
        return "Άγνωστη πηγή"
    return SOURCE_GROUPS.get(source_name, source_name)


def source_names_for_group(group: str) -> list[str]:
    return [name for name, label in SOURCE_GROUPS.items() if label == group]
