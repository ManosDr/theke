import logging

import resend

from app.config import settings

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
# paths in the brand's navy, since email clients don't reliably render
# inline/linked SVG) - served from the frontend's own public/ directory, so
# no separate asset host is needed. alt text still carries "theke" for the
# image-blocked case.
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
    "el": {"construction": "Κατασκευές", "tax_accounting": "Λογιστική"},
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


def _base_html(title: str, preheader: str, body_html: str, locale: str = "el") -> str:
    """Shared branded skeleton: a navy top accent bar, a header band with
    the real "theke" wordmark image (rasterized from the app's own Logo.tsx
    SVG, alt-texted for the image-blocked case), single-column 600px
    container, and the shared footer. body_html is inserted as-is; callers
    own their own heading/paragraph markup."""
    return f"""\
<!doctype html>
<html lang="{locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0; padding:0; background:{_COLOR_BG};">
<div style="display:none; max-height:0; overflow:hidden; opacity:0;">{preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{_COLOR_BG};">
<tr><td align="center" style="padding: 24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background:{_COLOR_SURFACE};">
<tr><td style="height:4px; line-height:4px; font-size:0; background:{_COLOR_PRIMARY};">&nbsp;</td></tr>
<tr><td style="height:64px; background:{_COLOR_SURFACE}; border-bottom:1px solid {_COLOR_BORDER}; padding:0 32px;">
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


def send_invite_email(
    to_email: str,
    inviter_name: str,
    company_name: str,
    vertical_slug: str,
    role: str,
    accept_url: str,
    expiry_days: int,
) -> bool:
    """Invite email - always Greek-primary/English-secondary regardless of
    locale, since the invitee has no account (and thus no preferred_locale)
    yet at send time. Vertical-conditional per _VERTICAL_* dicts."""
    locale = "el"
    vertical_name = _VERTICAL_NAME[locale][vertical_slug]
    vertical_name_en = _VERTICAL_NAME["en"][vertical_slug]
    audience = _VERTICAL_AUDIENCE[locale][vertical_slug]
    audience_en = _VERTICAL_AUDIENCE["en"][vertical_slug]
    examples = _VERTICAL_EXAMPLES_EL[vertical_slug]
    role_label = _ROLE_LABEL[locale][role]
    role_label_en = _ROLE_LABEL["en"][role]
    expiry_label = f"{expiry_days} ημέρες" if expiry_days != 1 else "1 ημέρα"
    expiry_label_en = f"{expiry_days} days" if expiry_days != 1 else "1 day"

    subject = f"{company_name} σας προσκαλεί στο Theke · You've been invited to Theke"
    preheader = f"Ο/Η {inviter_name} σας προσκάλεσε να συμμετάσχετε ως {role_label} στο πλάνο {vertical_name}."

    body_html = f"""\
<p>Γεια σας,</p>
<p>Ο/Η <b>{inviter_name}</b> σας προσκαλεί να συμμετάσχετε στην ομάδα της <b>{company_name}</b> στο Theke, στον κλάδο <b>{vertical_name}</b>.</p>
<p>Το Theke είναι εργαλείο κανονιστικής πληροφόρησης για επαγγελματίες {audience} — απαντά σε ερωτήσεις για {examples}, με παραπομπή σε επίσημες πηγές.</p>
<p>Θα συμμετέχετε ως <b>{role_label}</b>.</p>
{_button_html(accept_url, "Αποδοχή πρόσκλησης")}
<p>Ο σύνδεσμος ισχύει για {expiry_label}.</p>
<p>Αν δεν αναγνωρίζετε αυτό το μήνυμα ή έχετε ερωτήσεις, επικοινωνήστε μαζί μας στο {settings.email_from}.</p>
<hr style="border:none; border-top:1px solid {_COLOR_BORDER}; margin: 24px 0;">
<p style="font-size:13px; color:{_COLOR_TEXT_MUTED};"><b>{inviter_name}</b> has invited you to join <b>{company_name}</b>'s team on Theke, a regulatory intelligence tool for {audience_en}. You'll join as <b>{role_label_en}</b>. Use the button above to accept — the link is valid for {expiry_label_en}.</p>
<p style="font-size:13px; color:{_COLOR_TEXT_MUTED};">Theke</p>
"""
    html = _base_html(subject, preheader, body_html, locale)

    text = (
        f"Γεια σας,\n\n"
        f"Ο/Η {inviter_name} σας προσκαλεί να συμμετάσχετε στην ομάδα της {company_name} στο Theke, στον κλάδο {vertical_name}.\n\n"
        f"Το Theke είναι εργαλείο κανονιστικής πληροφόρησης για επαγγελματίες {audience} — απαντά σε ερωτήσεις για {examples}, με παραπομπή σε επίσημες πηγές.\n\n"
        f"Θα συμμετέχετε ως {role_label}.\n\n"
        f"Αποδοχή πρόσκλησης: {accept_url}\n\n"
        f"Ο σύνδεσμος ισχύει για {expiry_label}.\n\n"
        f"Αν δεν αναγνωρίζετε αυτό το μήνυμα ή έχετε ερωτήσεις, επικοινωνήστε μαζί μας στο {settings.email_from}.\n\n"
        f"---\n\n"
        f"{inviter_name} has invited you to join {company_name}'s team on Theke, a regulatory intelligence tool for {audience_en}. "
        f"You'll join as {role_label_en}. Accept: {accept_url} (valid for {expiry_label_en}).\n\n"
        f"Theke"
    )
    return _send(to_email, subject, html, text)


def send_welcome_email(to_email: str, vertical_slug: str, locale: str = "el") -> bool:
    """Fires once, right after registration completes (invite-accepted or
    self-serve) - a deliberate lever against the most common first-session
    failure mode (leading with a hard edge-case question before seeing the
    product succeed at anything), by steering toward a concrete first
    question. locale is the real user's preferred_locale, known at this
    point (unlike the invite email, sent before an account exists)."""
    chat_url = f"{settings.frontend_url}/chat"

    if locale == "en":
        vertical_name = _VERTICAL_NAME["en"][vertical_slug]
        subject = "Welcome to Theke"
        preheader = "Your account is ready. See how to ask your first question."
        body_html = f"""\
<p>Hello,</p>
<p>Your Theke account is ready, with access to the {vertical_name} knowledge base. Use the button below to ask your first question — every answer is cited against official sources, and Theke states plainly when it doesn't have enough of one, rather than guessing.</p>
{_button_html(chat_url, "Ask your first question")}
<p>You can also create your first project whenever you're ready.</p>
<p>Theke</p>
"""
        text = (
            f"Hello,\n\nYour Theke account is ready, with access to the {vertical_name} knowledge base. "
            f"Use the link below to ask your first question — every answer is cited against official sources, "
            f"and Theke states plainly when it doesn't have enough of one, rather than guessing.\n\n"
            f"Ask your first question: {chat_url}\n\n"
            f"You can also create your first project whenever you're ready.\n\nTheke"
        )
        return _send(to_email, subject, _base_html(subject, preheader, body_html, "en"), text)

    vertical_name = _VERTICAL_NAME["el"][vertical_slug]
    questions = _VERTICAL_QUESTIONS_EL[vertical_slug]
    questions_html = "".join(f"<li style='margin-bottom:6px;'>{q}</li>" for q in questions)
    subject = "Καλώς ήρθατε στο Theke · Welcome to Theke"
    preheader = "Ο λογαριασμός σας είναι έτοιμος. Δείτε πώς να κάνετε την πρώτη σας ερώτηση."

    body_html = f"""\
<p>Γεια σας,</p>
<p>Ο λογαριασμός σας στο Theke είναι έτοιμος. Έχετε ήδη πρόσβαση στη γνωσιακή βάση <b>{vertical_name}</b> και μπορείτε να ξεκινήσετε αμέσως.</p>
<p><b>Δοκιμάστε μια από αυτές τις ερωτήσεις για να δείτε πώς λειτουργεί:</b></p>
<div style="border:1px solid {_COLOR_BORDER}; border-radius:6px; background:{_COLOR_SURFACE_ALT}; padding:16px; margin: 12px 0;">
<ul style="margin:0; padding-left:20px;">{questions_html}</ul>
</div>
{_button_html(chat_url, "Κάντε την πρώτη σας ερώτηση")}
<p>Κάθε απάντηση συνοδεύεται από παραπομπές σε επίσημες πηγές (ΦΕΚ, ΤΕΕ, ΑΑΔΕ κ.ά.). Όταν δεν υπάρχει επαρκής πηγή, το Theke το δηλώνει ρητά αντί να μαντεύει.</p>
<p>Μπορείτε επίσης να δημιουργήσετε το πρώτο σας έργο όποτε είστε έτοιμοι.</p>
<p>Με εκτίμηση,<br>Theke</p>
"""
    html = _base_html(subject, preheader, body_html, "el")

    text = (
        f"Γεια σας,\n\nΟ λογαριασμός σας στο Theke είναι έτοιμος. Έχετε ήδη πρόσβαση στη γνωσιακή βάση {vertical_name} "
        f"και μπορείτε να ξεκινήσετε αμέσως.\n\n"
        f"Δοκιμάστε μια από αυτές τις ερωτήσεις για να δείτε πώς λειτουργεί:\n"
        + "".join(f"- {q}\n" for q in questions)
        + f"\nΚάντε την πρώτη σας ερώτηση: {chat_url}\n\n"
        f"Κάθε απάντηση συνοδεύεται από παραπομπές σε επίσημες πηγές (ΦΕΚ, ΤΕΕ, ΑΑΔΕ κ.ά.). "
        f"Όταν δεν υπάρχει επαρκής πηγή, το Theke το δηλώνει ρητά αντί να μαντεύει.\n\n"
        f"Μπορείτε επίσης να δημιουργήσετε το πρώτο σας έργο όποτε είστε έτοιμοι.\n\n"
        f"Με εκτίμηση,\nTheke"
    )
    return _send(to_email, subject, html, text)


def send_password_reset_email(to_email: str, reset_url: str, locale: str = "el") -> bool:
    """Sends a password-reset email via Resend. Returns True on success,
    False if email is disabled or the send fails - never raises, so the
    caller can fall back to logging the link either way without a
    try/except of its own.

    Deliberately the plainest of the three sends - no hero band, no card
    block, no bulleted content, per the transactional-email spec: an
    over-branded, image-heavy security email reads as more suspicious to a
    security-conscious professional than a plain one does. No sign-off
    block either, for the same reason."""
    expiry_minutes = settings.password_reset_token_expire_minutes
    expiry_label_el = f"{expiry_minutes} λεπτά" if expiry_minutes != 60 else "1 ώρα"
    expiry_label_en = f"{expiry_minutes} minutes" if expiry_minutes != 60 else "1 hour"

    if locale == "en":
        subject = "Password reset — Theke"
        preheader = f"The link is valid for {expiry_label_en}."
        body_html = f"""\
<p>Hello,</p>
<p>We received a request to reset your Theke password.</p>
{_button_html(reset_url, "Reset password")}
<p>The link is valid for {expiry_label_en}. If you didn't request this, no action is needed — your password is unchanged.</p>
<p style="font-size:13px; color:{_COLOR_TEXT_MUTED};">For security reasons, don't forward this message to anyone else.</p>
"""
        text = (
            f"Hello,\n\nWe received a request to reset your Theke password.\n\n"
            f"Reset password: {reset_url}\n\n"
            f"The link is valid for {expiry_label_en}. If you didn't request this, no action is needed — your password is unchanged.\n\n"
            f"For security reasons, don't forward this message to anyone else."
        )
        return _send(to_email, subject, _base_html(subject, preheader, body_html, "en"), text)

    subject = "Επαναφορά κωδικού πρόσβασης — Theke"
    preheader = f"Ο σύνδεσμος ισχύει για {expiry_label_el}."
    body_html = f"""\
<p>Γεια σας,</p>
<p>Λάβαμε αίτημα επαναφοράς του κωδικού πρόσβασής σας στο Theke.</p>
{_button_html(reset_url, "Επαναφορά κωδικού")}
<p>Ο σύνδεσμος ισχύει για {expiry_label_el}. Αν δεν ζητήσατε εσείς αυτή την ενέργεια, αγνοήστε αυτό το μήνυμα — ο κωδικός σας παραμένει αμετάβλητος.</p>
<p style="font-size:13px; color:{_COLOR_TEXT_MUTED};">Για λόγους ασφαλείας, μην προωθήσετε αυτό το μήνυμα σε τρίτους.</p>
"""
    html = _base_html(subject, preheader, body_html, "el")
    text = (
        f"Γεια σας,\n\nΛάβαμε αίτημα επαναφοράς του κωδικού πρόσβασής σας στο Theke.\n\n"
        f"Επαναφορά κωδικού: {reset_url}\n\n"
        f"Ο σύνδεσμος ισχύει για {expiry_label_el}. Αν δεν ζητήσατε εσείς αυτή την ενέργεια, αγνοήστε αυτό το μήνυμα — "
        f"ο κωδικός σας παραμένει αμετάβλητος.\n\n"
        f"Για λόγους ασφαλείας, μην προωθήσετε αυτό το μήνυμα σε τρίτους."
    )
    return _send(to_email, subject, html, text)
