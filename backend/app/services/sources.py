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
    "efka_oikodomotechnika_koina": "e-ΕΦΚΑ",
    "efka_oikodomotechnika_apografi": "e-ΕΦΚΑ",
    "ktimatologio_thesmiko_plaisio": "Κτηματολόγιο",
}


def group_label(source_name: str | None) -> str:
    if source_name is None:
        return "Άγνωστη πηγή"
    return SOURCE_GROUPS.get(source_name, source_name)


def source_names_for_group(group: str) -> list[str]:
    return [name for name, label in SOURCE_GROUPS.items() if label == group]
