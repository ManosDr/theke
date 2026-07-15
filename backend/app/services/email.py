import logging

import resend

from app.config import settings

logger = logging.getLogger(__name__)


def send_password_reset_email(to_email: str, reset_url: str, user_name: str) -> bool:
    """Sends a password-reset email via Resend. Returns True on success,
    False if email is disabled or the send fails - never raises, so the
    caller can fall back to logging the link either way without a try/except
    of its own."""
    if not settings.email_enabled or not settings.resend_api_key:
        return False

    resend.api_key = settings.resend_api_key

    try:
        resend.Emails.send(
            {
                "from": settings.email_from,
                "to": to_email,
                "subject": "Επαναφορά κωδικού πρόσβασης — Theke",
                "html": f"""
            <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 32px;">
              <h2 style="color: #1B2A4A; margin-bottom: 8px;">Επαναφορά κωδικού πρόσβασης</h2>
              <p style="color: #444; line-height: 1.6;">
                Γεια σας {user_name},<br><br>
                Λάβαμε αίτημα επαναφοράς του κωδικού πρόσβασής σας στο Theke.
                Κάντε κλικ στον παρακάτω σύνδεσμο για να ορίσετε νέο κωδικό:
              </p>
              <a href="{reset_url}"
                 style="display:inline-block; margin: 24px 0; padding: 12px 24px;
                        background: #1B2A4A; color: white; text-decoration: none;
                        border-radius: 6px; font-family: Georgia, serif;">
                Επαναφορά κωδικού
              </a>
              <p style="color: #888; font-size: 13px; line-height: 1.5;">
                Ο σύνδεσμος ισχύει για 24 ώρες. Αν δεν ζητήσατε επαναφορά
                κωδικού, αγνοήστε αυτό το μήνυμα.<br><br>
                — Η ομάδα Theke
              </p>
            </div>
            """,
            }
        )
        return True
    except Exception:
        logger.exception("Password reset email send failed for %s", to_email)
        return False
