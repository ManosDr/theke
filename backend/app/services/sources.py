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
}


def group_label(source_name: str | None) -> str:
    if source_name is None:
        return "Άγνωστη πηγή"
    return SOURCE_GROUPS.get(source_name, source_name)


def source_names_for_group(group: str) -> list[str]:
    return [name for name, label in SOURCE_GROUPS.items() if label == group]
