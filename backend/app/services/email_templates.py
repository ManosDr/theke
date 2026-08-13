"""Admin-editable transactional email content (invite/welcome/password_reset),
stored in the `email_templates` table. Mirrors legal_docs.py's split: this
module owns placeholder scanning/validation and {{variable}} substitution,
shared by both the admin CRUD endpoints (admin.py) and the actual send path
(email.py) - so "what counts as a known variable" is defined in exactly one
place, not duplicated between validation and rendering.

Structural HTML (the bulletproof button table, the base skeleton/header/
footer) stays code-owned, same boundary already established in email.py for
_base_html/_footer_html/_button_html - only wording is admin-editable here.
Button labels are part of that structural chrome (tied to the Outlook-safe
table markup), not admin-editable, and are computed into a single
{{..._button_html}} variable per template."""

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import EmailTemplate

TEMPLATE_KEYS = ("invite", "welcome", "password_reset", "email_verification")

# Union of variable names the send code may substitute into ANY of a
# template's four fields (subject_el/en, body_el/en) - not split per-field,
# since several variables (company_name, expiry_label) are legitimately
# reused across languages, and a single flat allow-list per template_key is
# simpler for an admin to reason about than four separate lists.
ALLOWED_VARIABLES: dict[str, set[str]] = {
    "invite": {
        "inviter_name",
        "company_name",
        "vertical_name",
        "audience",
        "examples",
        "role_label",
        "expiry_label",
        "email_from",
        "accept_button_html",
        "audience_en",
        "role_label_en",
        "expiry_label_en",
    },
    "welcome": {
        "vertical_name",
        "questions_html",
        "chat_button_html",
    },
    "password_reset": {
        "reset_button_html",
        "expiry_label",
    },
    "email_verification": {
        "verify_button_html",
        "expiry_label",
    },
}

_PLACEHOLDER_RE = re.compile(r"\{\{(\w+)\}\}")


def find_used_variables(text: str) -> set[str]:
    return set(_PLACEHOLDER_RE.findall(text))


def find_unknown_placeholders(template_key: str, subject_el: str, subject_en: str, body_el: str, body_en: str) -> list[str]:
    """Every `{{name}}` token across all four fields that ISN'T in this
    template's allow-list, in first-seen order - a typo'd or foreign
    variable name that render() would otherwise silently blank out. Used to
    hard-block Save, so a bad placeholder is caught immediately rather than
    discovered as a blank spot in a real email."""
    allowed = ALLOWED_VARIABLES.get(template_key, set())
    seen: list[str] = []
    for text in (subject_el, subject_en, body_el, body_en):
        for name in _PLACEHOLDER_RE.findall(text):
            token = f"{{{{{name}}}}}"
            if name not in allowed and token not in seen:
                seen.append(token)
    return seen


def render(text: str, variables: dict[str, str]) -> str:
    """Substitutes every known `{{name}}` with its value; any leftover
    placeholder (unknown to the caller, e.g. saved before a variable was
    removed from the allow-list) is stripped to an empty string rather than
    leaking raw `{{...}}` text into a real send - defense in depth on top of
    the save-time validation above, which should normally prevent this."""
    return _PLACEHOLDER_RE.sub(lambda m: variables.get(m.group(1), ""), text)


def get_template(db: Session, template_key: str) -> EmailTemplate | None:
    return db.scalar(select(EmailTemplate).where(EmailTemplate.template_key == template_key))
