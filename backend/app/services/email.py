import html
import logging
import re

import resend
from sqlalchemy.orm import Session

from app.config import settings
from app.services.email_templates import get_template, render

logger = logging.getLogger(__name__)

# Same hex values as frontend/app/globals.css's design tokens - kept as
# literal hex here rather than imported, since email HTML can't reference
# CSS custom properties (Outlook/Gmail strip var() entirely).
_COLOR_BG = "#f7f9fc"
_COLOR_SURFACE = "#ffffff"
_COLOR_SURFACE_ALT = "#eef1f6"
_COLOR_BORDER = "#e4e9f2"
_COLOR_TEXT = "#151d48"
_COLOR_TEXT_MUTED = "#737791"
_COLOR_PRIMARY = "#1b2a4a"
_COLOR_TEXT_ON_PRIMARY = "#ffffff"

_FONT_STACK = "Georgia, 'Times New Roman', serif"

# Real wordmark PNG (rasterized from frontend/app/components/Logo.tsx's SVG
# paths, navy fill) - served from the frontend's own public/ directory, so
# no separate asset host is needed. Email clients don't reliably render
# inline/linked SVG, hence PNG. alt text still carries "theke" for the
# image-blocked case.
#
# Previously swapped to a white-fill variant under a dark-mode media query/
# [data-ogsc] toggle, mirroring the in-app Logo.tsx light/dark behavior -
# dropped after a report that Outlook Web (OWA) showed no logo at all in
# its default (non-dark) view: OWA's own automatic dark-mode reprocessing
# doesn't reliably key off `prefers-color-scheme`/`[data-ogsc]` the way the
# toggle assumed, so the two <img>s could both end up hidden depending on
# how OWA classified the message. One logo, always shown, is more robust
# than a toggle that depends on correctly detecting client dark mode - see
# the `<meta name="color-scheme">` tags below, which now do that detection
# instead by telling every client this email is light-only.
_LOGO_URL = f"{settings.frontend_url}/theke-logo-email.png"

# Every send carries this - a technical header for inbox-provider sender
# reputation (Gmail/Outlook expect it), not a visible unsubscribe link in
# the body. None of these three sends are marketing mail under GDPR/Ν.3471
# (confirmed separately), so a mailto target is sufficient - there's no
# preference-center page to link to and none is required here.
_LIST_UNSUBSCRIBE_HEADER = f"<mailto:{settings.email_from}>"

_ROLE_LABEL = {
    "el": {"admin": "Διαχειριστής", "member": "Μέλος"},
    "en": {"admin": "Admin", "member": "Member"},
}

_VERTICAL_NAME = {
    "el": {"construction": "Κατασκευαστικές", "tax_accounting": "Λογιστική"},
    "en": {"construction": "Construction", "tax_accounting": "Tax & Accounting"},
}

# Copy block content is final-draft per the transactional-email spec this
# was built from - not placeholder text to be revised casually.
_VERTICAL_AUDIENCE = {
    "el": {
        "construction": "μηχανικούς και αρχιτέκτονες",
        "tax_accounting": "λογιστές και φοροτεχνικούς",
    },
    "en": {
        "construction": "engineers and architects",
        "tax_accounting": "accountants and tax professionals",
    },
}
_VERTICAL_EXAMPLES_EL = {
    "construction": "αδειοδότηση, πολεοδομικούς κανονισμούς και διαδικασίες ΥΔΟΜ",
    "tax_accounting": "ΦΠΑ, φορολογικές υποχρεώσεις και διαδικασίες ΑΑΔΕ",
}
_VERTICAL_EXAMPLES_EN = {
    "construction": "permitting, planning regulations, and ΥΔΟΜ procedures",
    "tax_accounting": "VAT, tax obligations, and ΑΑΔΕ procedures",
}
_VERTICAL_QUESTIONS_EL = {
    "construction": [
        "Ποια δικαιολογητικά χρειάζομαι για άδεια δόμησης;",
        "Ποιοι συντελεστές δόμησης ισχύουν στον Δήμο μου;",
        "Τι ισχύει αν το οικόπεδο είναι εντός αρχαιολογικής ζώνης;",
    ],
    "tax_accounting": [
        "Ποιες είναι οι προθεσμίες υποβολής ΦΠΑ αυτό το τρίμηνο;",
        "Ποιες είναι οι υποχρεώσεις ΕΦΚΑ για νέα πρόσληψη;",
        "Τι ισχύει για την υποβολή μέσω myDATA;",
    ],
}
_VERTICAL_QUESTIONS_EN = {
    "construction": [
        "What documents do I need for a building permit?",
        "What building coefficients apply in my municipality?",
        "What applies if the plot is within an archaeological zone?",
    ],
    "tax_accounting": [
        "What are the VAT filing deadlines this quarter?",
        "What are the ΕΦΚΑ obligations for a new hire?",
        "What applies for submission through myDATA?",
    ],
}


def _questions_html(questions: list[str]) -> str:
    return (
        f'<div style="border:1px solid {_COLOR_BORDER}; border-radius:6px; background:{_COLOR_SURFACE_ALT}; padding:16px; margin: 12px 0;">'
        f'<ul style="margin:0; padding-left:20px;">' + "".join(f"<li style='margin-bottom:6px;'>{q}</li>" for q in questions) + "</ul></div>"
    )


def _base_html(title: str, preheader: str, body_html: str, locale: str = "el") -> str:
    """Shared branded skeleton: a navy top accent bar, a header band with
    the real "theke" wordmark image (rasterized from the app's own Logo.tsx
    SVG, alt-texted for the image-blocked case), single-column 600px
    container, and the shared footer. body_html is inserted as-is; callers
    own their own heading/paragraph markup.

    Always the single navy wordmark on an explicitly-white header, rather
    than swapping to a white-on-dark variant for dark-mode clients (the
    previous approach) - a report of Outlook Web (OWA) showing no logo at
    all in its default view traced back to that toggle: OWA's automatic
    dark-mode reprocessing doesn't reliably key off `prefers-color-scheme`/
    `[data-ogsc]` the way a CSS-class swap assumes, so the two <img>s could
    both end up hidden. The `<meta name="color-scheme">`/
    `<meta name="supported-color-schemes">` pair below is the standard,
    client-supported way to opt an email OUT of automatic dark-mode
    reprocessing entirely (Outlook, Apple Mail, and others honor it) -
    telling the client "render this exactly as authored, don't auto-invert
    it" is more robust than trying to detect and match every client's dark
    mode ourselves. `bgcolor` is set alongside the CSS `background` on the
    header cell for the same reason table-based email markup always
    duplicates color as both an HTML attribute and inline style: Outlook's
    rendering engine (Word-based, including many OWA code paths) is known
    to honor `bgcolor` more reliably than CSS `background` in table cells."""
    return f"""\
<!doctype html>
<html lang="{locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0; padding:0; background:{_COLOR_BG};">
<div style="display:none; max-height:0; overflow:hidden; opacity:0;">{preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_COLOR_BG};">
<tr><td align="center" style="padding: 24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background:{_COLOR_SURFACE};">
<tr><td style="height:4px; line-height:4px; font-size:0; background:{_COLOR_PRIMARY};">&nbsp;</td></tr>
<tr><td bgcolor="{_COLOR_SURFACE}" style="height:64px; background:{_COLOR_SURFACE}; border-bottom:1px solid {_COLOR_BORDER}; padding:0 32px;">
<table role="presentation" width="100%" height="64" cellpadding="0" cellspacing="0"><tr><td>
<img src="{_LOGO_URL}" alt="theke" height="26" style="height:26px; width:auto; display:block; border:0;">
</td></tr></table>
</td></tr>
<tr><td style="padding: 32px 32px 8px 32px; font-family:{_FONT_STACK}; color:{_COLOR_TEXT}; font-size:15px; line-height:1.5; text-align:left;">
{body_html}
</td></tr>
{_footer_html(locale)}
</table>
</td></tr>
</table>
</body>
</html>
"""


def _footer_html(locale: str) -> str:
    if locale == "el":
        privacy_label, terms_label = "Πολιτική Απορρήτου", "Όροι Χρήσης"
        disclaimer = "Αυτό είναι μήνυμα συστήματος και δεν αποτελεί διαφημιστικό υλικό."
    else:
        privacy_label, terms_label = "Privacy Policy", "Terms of Service"
        disclaimer = "This is a system message, not marketing material."
    return f"""\
<tr><td style="padding: 24px 32px 32px 32px; border-top:1px solid {_COLOR_BORDER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font-family:{_FONT_STACK}; font-size:12px; line-height:1.6; color:{_COLOR_TEXT_MUTED};">
theke &middot; <a href="{settings.frontend_url}/privacy" style="color:{_COLOR_TEXT_MUTED};">{privacy_label}</a> &middot; <a href="{settings.frontend_url}/terms" style="color:{_COLOR_TEXT_MUTED};">{terms_label}</a> &middot; {settings.email_from}<br>
{disclaimer}
</td></tr>
</table>
</td></tr>"""


def _button_html(url: str, label: str) -> str:
    # Bulletproof table-based button (not a plain <a> styled with CSS
    # padding) for Outlook compatibility - Outlook's Word rendering engine
    # ignores padding on inline elements.
    return f"""\
<table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px auto;"><tr><td style="background:{_COLOR_PRIMARY}; border-radius:6px;">
<a href="{url}" style="display:inline-block; padding:14px 28px; font-family:{_FONT_STACK}; font-size:14px; font-weight:bold; color:{_COLOR_TEXT_ON_PRIMARY}; text-decoration:none; border-radius:6px;">{label}</a>
</td></tr></table>
<p style="text-align:center; font-family:{_FONT_STACK}; font-size:12px; color:{_COLOR_TEXT_MUTED}; margin: 0 0 16px 0;">{url}</p>"""


def _send(to_email: str, subject: str, html: str, text: str) -> bool:
    """Shared send path for all three transactional emails - never raises,
    so callers can proceed (and fall back to logging/DB state) regardless
    of whether delivery actually succeeded."""
    if not settings.email_enabled or not settings.resend_api_key:
        return False

    resend.api_key = settings.resend_api_key
    try:
        resend.Emails.send(
            {
                "from": f"Theke <{settings.email_from}>",
                "to": to_email,
                "subject": subject,
                "html": html,
                "text": text,
                "headers": {"List-Unsubscribe": _LIST_UNSUBSCRIBE_HEADER},
            }
        )
        return True
    except Exception:
        logger.exception("Email send failed for %s: %s", to_email, subject)
        return False


_TAG_RE = re.compile(r"<[^>]+>")


def _html_to_text(html_content: str) -> str:
    """Best-effort plain-text alternative, derived from the (admin-edited)
    HTML body rather than hand-written separately - once the body is
    admin-editable, a hand-written text twin would silently drift from
    whatever the admin last saved. Good enough for an email client's plain-
    text fallback; not a general HTML-to-Markdown converter."""
    text = re.sub(r"<br\s*/?>", "\n", html_content, flags=re.IGNORECASE)
    text = re.sub(r"</p>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<li[^>]*>", "- ", text, flags=re.IGNORECASE)
    text = re.sub(r"</li>", "\n", text, flags=re.IGNORECASE)
    text = _TAG_RE.sub("", text)
    text = html.unescape(text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _derive_preheader(html_content: str, limit: int = 150) -> str:
    text = _html_to_text(html_content).replace("\n", " ")
    text = re.sub(r"\s{2,}", " ", text).strip()
    return text[:limit]


# Every transactional email below sends BOTH languages in one message -
# subject as "{el} · {en}", body as the Greek section followed by an <hr>
# divider then the English section - never one-or-the-other based on a
# stored preference. Originally only the invite emails worked this way
# (there's no account/preferred_locale yet at send time for those), while
# welcome/password_reset/email_verification picked a single language via
# the recipient's preferred_locale. Unified to always-bilingual for all
# five templates: a stored locale preference isn't a reliable signal the
# recipient actually reads only that language, and showing both costs
# nothing but a bit of email length. Each template's *_en variable is the
# English half of the same content its non-suffixed counterpart renders in
# Greek (see ALLOWED_VARIABLES in email_templates.py for the exact pairs
# per template) - both halves are built into one variables dict per send,
# not selected between.
def _invite_variables(
    inviter_name: str, company_name: str, vertical_slug: str, role: str, accept_url: str, expiry_days: int
) -> dict[str, str]:
    expiry_label = f"{expiry_days} ημέρες" if expiry_days != 1 else "1 ημέρα"
    expiry_label_en = f"{expiry_days} days" if expiry_days != 1 else "1 day"
    return {
        "inviter_name": inviter_name,
        "company_name": company_name,
        "vertical_name": _VERTICAL_NAME["el"][vertical_slug],
        "vertical_name_en": _VERTICAL_NAME["en"][vertical_slug],
        "audience": _VERTICAL_AUDIENCE["el"][vertical_slug],
        "audience_en": _VERTICAL_AUDIENCE["en"][vertical_slug],
        "examples": _VERTICAL_EXAMPLES_EL[vertical_slug],
        "examples_en": _VERTICAL_EXAMPLES_EN[vertical_slug],
        "role_label": _ROLE_LABEL["el"][role],
        "role_label_en": _ROLE_LABEL["en"][role],
        "expiry_label": expiry_label,
        "expiry_label_en": expiry_label_en,
        "email_from": settings.email_from,
        "accept_button_html": _button_html(accept_url, "Αποδοχή πρόσκλησης"),
        "accept_button_html_en": _button_html(accept_url, "Accept invite"),
    }


def send_invite_email(
    db: Session,
    to_email: str,
    inviter_name: str,
    company_name: str,
    vertical_slug: str,
    role: str,
    accept_url: str,
    expiry_days: int,
) -> bool:
    """Invite email - always bilingual (see the module-level comment above
    _invite_variables). Content comes from the admin-editable
    email_templates row ('invite')."""
    row = get_template(db, "invite")
    if row is None:
        logger.error("Email template 'invite' missing from email_templates - skipping send")
        return False

    variables = _invite_variables(inviter_name, company_name, vertical_slug, role, accept_url, expiry_days)
    subject_el = render(row.subject_el, variables)
    subject_en = render(row.subject_en, variables)
    body_el = render(row.body_el, variables)
    body_en = render(row.body_en, variables)

    subject = f"{subject_el} · {subject_en}"
    body_html = f"{body_el}\n<hr style=\"border:none; border-top:1px solid {_COLOR_BORDER}; margin: 24px 0;\">\n{body_en}"
    preheader = _derive_preheader(body_el)
    html_content = _base_html(subject, preheader, body_html, "el")
    text = f"{_html_to_text(body_el)}\n\n---\n\n{_html_to_text(body_en)}"
    return _send(to_email, subject, html_content, text)


def _invite_no_company_variables(vertical_slug: str, accept_url: str, expiry_days: int) -> dict[str, str]:
    expiry_label = f"{expiry_days} ημέρες" if expiry_days != 1 else "1 ημέρα"
    expiry_label_en = f"{expiry_days} days" if expiry_days != 1 else "1 day"
    return {
        "vertical_name": _VERTICAL_NAME["el"][vertical_slug],
        "vertical_name_en": _VERTICAL_NAME["en"][vertical_slug],
        "audience": _VERTICAL_AUDIENCE["el"][vertical_slug],
        "audience_en": _VERTICAL_AUDIENCE["en"][vertical_slug],
        "examples": _VERTICAL_EXAMPLES_EL[vertical_slug],
        "expiry_label": expiry_label,
        "expiry_label_en": expiry_label_en,
        "email_from": settings.email_from,
        "accept_button_html": _button_html(accept_url, "Αποδοχή πρόσκλησης"),
        "accept_button_html_en": _button_html(accept_url, "Accept invite"),
    }


def send_company_less_invite_email(db: Session, to_email: str, vertical_slug: str, accept_url: str, expiry_days: int) -> bool:
    """Company-less invite (see admin.py's create_super_admin_invite) - same
    structure as send_invite_email, but with no inviter_name/company_name/
    role_label variables, since none of those exist yet at send time.
    Content comes from the admin-editable email_templates row
    ('invite_no_company'). Always bilingual, see the module-level comment
    above _invite_variables."""
    row = get_template(db, "invite_no_company")
    if row is None:
        logger.error("Email template 'invite_no_company' missing from email_templates - skipping send")
        return False

    variables = _invite_no_company_variables(vertical_slug, accept_url, expiry_days)
    subject_el = render(row.subject_el, variables)
    subject_en = render(row.subject_en, variables)
    body_el = render(row.body_el, variables)
    body_en = render(row.body_en, variables)

    subject = f"{subject_el} · {subject_en}"
    body_html = f"{body_el}\n<hr style=\"border:none; border-top:1px solid {_COLOR_BORDER}; margin: 24px 0;\">\n{body_en}"
    preheader = _derive_preheader(body_el)
    html_content = _base_html(subject, preheader, body_html, "el")
    text = f"{_html_to_text(body_el)}\n\n---\n\n{_html_to_text(body_en)}"
    return _send(to_email, subject, html_content, text)


def send_welcome_email(db: Session, to_email: str, vertical_slug: str) -> bool:
    """Fires once, right after registration completes (invite-accepted or
    self-serve) - a deliberate lever against the most common first-session
    failure mode (leading with a hard edge-case question before seeing the
    product succeed at anything), by steering toward a concrete first
    question. Content comes from the admin-editable email_templates row
    ('welcome'). Always bilingual, see the module-level comment above
    _invite_variables."""
    row = get_template(db, "welcome")
    if row is None:
        logger.error("Email template 'welcome' missing from email_templates - skipping send")
        return False

    chat_url = f"{settings.frontend_url}/chat"
    variables = {
        "vertical_name": _VERTICAL_NAME["el"][vertical_slug],
        "vertical_name_en": _VERTICAL_NAME["en"][vertical_slug],
        "chat_button_html": _button_html(chat_url, "Κάντε την πρώτη σας ερώτηση"),
        "chat_button_html_en": _button_html(chat_url, "Ask your first question"),
        "questions_html": _questions_html(_VERTICAL_QUESTIONS_EL[vertical_slug]),
        "questions_html_en": _questions_html(_VERTICAL_QUESTIONS_EN[vertical_slug]),
    }

    subject_el = render(row.subject_el, variables)
    subject_en = render(row.subject_en, variables)
    body_el = render(row.body_el, variables)
    body_en = render(row.body_en, variables)

    subject = f"{subject_el} · {subject_en}"
    body_html = f"{body_el}\n<hr style=\"border:none; border-top:1px solid {_COLOR_BORDER}; margin: 24px 0;\">\n{body_en}"
    preheader = _derive_preheader(body_el)
    html_content = _base_html(subject, preheader, body_html, "el")
    text = f"{_html_to_text(body_el)}\n\n---\n\n{_html_to_text(body_en)}"
    return _send(to_email, subject, html_content, text)


def send_password_reset_email(db: Session, to_email: str, reset_url: str) -> bool:
    """Sends a password-reset email via Resend. Returns True on success,
    False if email is disabled or the send fails - never raises, so the
    caller can fall back to logging the link either way without a
    try/except of its own. Content comes from the admin-editable
    email_templates row ('password_reset'). Always bilingual, see the
    module-level comment above _invite_variables.

    Deliberately the plainest of the sends - no hero band, no card block,
    no bulleted content, per the transactional-email spec: an
    over-branded, image-heavy security email reads as more suspicious to a
    security-conscious professional than a plain one does. No sign-off
    block either, for the same reason."""
    row = get_template(db, "password_reset")
    if row is None:
        logger.error("Email template 'password_reset' missing from email_templates - skipping send")
        return False

    expiry_minutes = settings.password_reset_token_expire_minutes
    expiry_label = f"{expiry_minutes} λεπτά" if expiry_minutes != 60 else "1 ώρα"
    expiry_label_en = f"{expiry_minutes} minutes" if expiry_minutes != 60 else "1 hour"
    variables = {
        "reset_button_html": _button_html(reset_url, "Επαναφορά κωδικού"),
        "reset_button_html_en": _button_html(reset_url, "Reset password"),
        "expiry_label": expiry_label,
        "expiry_label_en": expiry_label_en,
    }

    subject_el = render(row.subject_el, variables)
    subject_en = render(row.subject_en, variables)
    body_el = render(row.body_el, variables)
    body_en = render(row.body_en, variables)

    subject = f"{subject_el} · {subject_en}"
    body_html = f"{body_el}\n<hr style=\"border:none; border-top:1px solid {_COLOR_BORDER}; margin: 24px 0;\">\n{body_en}"
    preheader = _derive_preheader(body_el)
    html_content = _base_html(subject, preheader, body_html, "el")
    text = f"{_html_to_text(body_el)}\n\n---\n\n{_html_to_text(body_en)}"
    return _send(to_email, subject, html_content, text)


def send_verification_email(db: Session, to_email: str, verify_url: str) -> bool:
    """Sent once from /auth/register's self-serve branch (and again from
    POST /auth/resend-verification on request) - never for invite-completions,
    which skip verification entirely since the inviting admin already vouched
    for that email (see KNOWN_DECISIONS.md). Same plain, no-hero-band
    treatment as send_password_reset_email, for the same reason: a single
    actionable security/account link reads as more trustworthy without
    marketing-style chrome. Content comes from the admin-editable
    email_templates row ('email_verification'). Always bilingual, see the
    module-level comment above _invite_variables."""
    row = get_template(db, "email_verification")
    if row is None:
        logger.error("Email template 'email_verification' missing from email_templates - skipping send")
        return False

    expiry_minutes = settings.email_verification_token_expire_minutes
    expiry_days = expiry_minutes // 1440
    expiry_label = f"{expiry_days} ημέρες" if expiry_days != 1 else "1 ημέρα"
    expiry_label_en = f"{expiry_days} days" if expiry_days != 1 else "1 day"
    variables = {
        "verify_button_html": _button_html(verify_url, "Επιβεβαίωση email"),
        "verify_button_html_en": _button_html(verify_url, "Verify email address"),
        "expiry_label": expiry_label,
        "expiry_label_en": expiry_label_en,
    }

    subject_el = render(row.subject_el, variables)
    subject_en = render(row.subject_en, variables)
    body_el = render(row.body_el, variables)
    body_en = render(row.body_en, variables)

    subject = f"{subject_el} · {subject_en}"
    body_html = f"{body_el}\n<hr style=\"border:none; border-top:1px solid {_COLOR_BORDER}; margin: 24px 0;\">\n{body_en}"
    preheader = _derive_preheader(body_el)
    html_content = _base_html(subject, preheader, body_html, "el")
    text = f"{_html_to_text(body_el)}\n\n---\n\n{_html_to_text(body_en)}"
    return _send(to_email, subject, html_content, text)


def _test_send_variables(template_key: str) -> dict[str, str]:
    """Realistic-but-fake substitution values for the admin test-send
    button, so a preview looks like a real email rather than a page full of
    literal placeholders. Deliberately not real data - no lookup of an
    actual user/company happens for a test send."""
    if template_key == "invite":
        return _invite_variables(
            inviter_name="Νίκος Δοκιμαστικός",
            company_name="Δοκιμαστική Εταιρεία ΑΕ",
            vertical_slug="construction",
            role="member",
            accept_url=f"{settings.frontend_url}/register?invite_token=sample-test-token",
            expiry_days=7,
        )
    if template_key == "invite_no_company":
        return _invite_no_company_variables(
            vertical_slug="construction",
            accept_url=f"{settings.frontend_url}/register?invite_token=sample-test-token",
            expiry_days=7,
        )
    if template_key == "welcome":
        return {
            "vertical_name": _VERTICAL_NAME["el"]["construction"],
            "vertical_name_en": _VERTICAL_NAME["en"]["construction"],
            "questions_html": _questions_html(_VERTICAL_QUESTIONS_EL["construction"]),
            "questions_html_en": _questions_html(_VERTICAL_QUESTIONS_EN["construction"]),
            "chat_button_html": _button_html(f"{settings.frontend_url}/chat", "Κάντε την πρώτη σας ερώτηση"),
            "chat_button_html_en": _button_html(f"{settings.frontend_url}/chat", "Ask your first question"),
        }
    if template_key == "email_verification":
        expiry_days = settings.email_verification_token_expire_minutes // 1440
        return {
            "verify_button_html": _button_html(f"{settings.frontend_url}/verify-email?token=sample-test-token", "Επιβεβαίωση email"),
            "verify_button_html_en": _button_html(f"{settings.frontend_url}/verify-email?token=sample-test-token", "Verify email address"),
            "expiry_label": f"{expiry_days} ημέρες" if expiry_days != 1 else "1 ημέρα",
            "expiry_label_en": f"{expiry_days} days" if expiry_days != 1 else "1 day",
        }
    # password_reset
    expiry_minutes = settings.password_reset_token_expire_minutes
    return {
        "reset_button_html": _button_html(f"{settings.frontend_url}/reset-password?token=sample-test-token", "Επαναφορά κωδικού"),
        "reset_button_html_en": _button_html(f"{settings.frontend_url}/reset-password?token=sample-test-token", "Reset password"),
        "expiry_label": f"{expiry_minutes} λεπτά" if expiry_minutes != 60 else "1 ώρα",
        "expiry_label_en": f"{expiry_minutes} minutes" if expiry_minutes != 60 else "1 hour",
    }


def send_test_email(
    template_key: str, to_email: str, subject_el: str, subject_en: str, body_el: str, body_en: str
) -> bool:
    """Renders the given (possibly unsaved, in-editor) template content with
    realistic sample data and sends it for real to the admin-configured test
    address - lets an admin preview a change without saving it first. Every
    template is always bilingual now (see the module-level comment above
    _invite_variables), so this always combines el+en the same way the real
    sends do - no per-template branching needed."""
    variables = _test_send_variables(template_key)
    subject = f"{render(subject_el, variables)} · {render(subject_en, variables)}"
    body_html = (
        f"{render(body_el, variables)}\n"
        f'<hr style="border:none; border-top:1px solid {_COLOR_BORDER}; margin: 24px 0;">\n'
        f"{render(body_en, variables)}"
    )
    preheader = _derive_preheader(body_html)
    html_content = _base_html(subject, preheader, body_html, "el")
    text = _html_to_text(body_html)
    return _send(to_email, subject, html_content, text)
