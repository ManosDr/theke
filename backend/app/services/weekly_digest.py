"""Backend-side counterpart to crawler/crawler/weekly_digest.py (Section 6a) -
computes and sends the same Monday usage digest, but from POST
/admin/digests/resend for an on-demand super-admin trigger, independent of
the crawler's cron cadence. Deliberately its own copy of the stat queries
and Resend send call rather than importing the crawler module (the two
services don't share a Python environment - see the crawler script's own
docstring for why it can't import backend.app.* either); every figure below
mirrors the same already-established definition the crawler's version cites.
"""

import resend
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.models import ChatSession, Company, Document, MessageFeedback, User, WeeklyDigest


def _compute_stats(db: Session) -> dict:
    # See backend/app/routers/admin.py's _solo_super_admin_user_ids() docstring
    # for why this exists: a company-less super_admin's own chat activity has
    # ChatSession.company_id IS NULL, which used to satisfy the is_test_account
    # exclusion's Company.id.is_(None) branch and get counted as real usage.
    # Query-level filter only - nothing is deleted, see GET /admin/internal-activity.
    not_solo_super_admin = ChatSession.user_id.not_in(
        select(User.id).where(User.role == "super_admin", User.company_id.is_(None)).scalar_subquery()
    )
    total_messages = db.scalar(
        select(func.count())
        .select_from(ChatSession)
        .outerjoin(Company, Company.id == ChatSession.company_id)
        .where(
            ChatSession.created_at >= text("now() - interval '7 days'"),
            (Company.id.is_(None)) | (Company.is_test_account.is_(False)),
            not_solo_super_admin,
        )
    ) or 0

    gap_count = db.scalar(
        select(func.count())
        .select_from(ChatSession)
        .outerjoin(Company, Company.id == ChatSession.company_id)
        .where(
            ChatSession.gap.is_(True),
            ChatSession.created_at >= text("now() - interval '7 days'"),
            (Company.id.is_(None)) | (Company.is_test_account.is_(False)),
            not_solo_super_admin,
        )
    ) or 0
    gap_rate = round(gap_count / total_messages * 100, 1) if total_messages else 0.0

    spend_7d = float(
        db.scalar(
            select(func.coalesce(func.sum(ChatSession.estimated_cost_eur), 0))
            .outerjoin(Company, Company.id == ChatSession.company_id)
            .where(
                ChatSession.created_at >= text("now() - interval '7 days'"),
                (Company.id.is_(None)) | (Company.is_test_account.is_(False)),
                not_solo_super_admin,
            )
        )
        or 0
    )

    active_companies = db.scalar(
        select(func.count())
        .select_from(Company)
        .where(Company.is_suspended.is_(False), Company.is_test_account.is_(False))
    ) or 0

    # MessageFeedback has no user_id/company_id of its own - reach the actor
    # and company through ChatSession the same way GET /admin/stats now does,
    # including the is_test_account exclusion (previously absent here too).
    open_feedback = db.scalar(
        select(func.count())
        .select_from(MessageFeedback)
        .join(ChatSession, ChatSession.id == MessageFeedback.session_id)
        .outerjoin(Company, Company.id == ChatSession.company_id)
        .where(
            MessageFeedback.rating == "negative",
            MessageFeedback.status == "pending",
            (Company.id.is_(None)) | (Company.is_test_account.is_(False)),
            not_solo_super_admin,
        )
    ) or 0

    needs_review = db.scalar(
        select(func.count())
        .select_from(Document)
        .where(Document.company_id.is_(None), Document.status == "active", Document.needs_review.is_(True))
    ) or 0

    return {
        "total_messages": total_messages,
        "gap_rate": gap_rate,
        "spend_7d_eur": spend_7d,
        "active_companies": active_companies,
        "open_feedback": open_feedback,
        "needs_review": needs_review,
    }


def _digest_html(stats: dict) -> str:
    return f"""
    <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <h2 style="color: #1B2A4A; margin-bottom: 8px;">Εβδομαδιαία σύνοψη πλατφόρμας</h2>
      <p style="color: #444; line-height: 1.6;">Τελευταίες 7 ημέρες:</p>
      <table style="width: 100%; border-collapse: collapse; color: #444;">
        <tr><td style="padding: 6px 0;">Συνολικά μηνύματα</td><td style="text-align: right; font-weight: 600;">{stats["total_messages"]:,}</td></tr>
        <tr><td style="padding: 6px 0;">Ποσοστό κενών απαντήσεων</td><td style="text-align: right; font-weight: 600;">{stats["gap_rate"]}%</td></tr>
        <tr><td style="padding: 6px 0;">Δαπάνη AI</td><td style="text-align: right; font-weight: 600;">{stats["spend_7d_eur"]:.2f}€</td></tr>
        <tr><td style="padding: 6px 0;">Ενεργές εταιρείες</td><td style="text-align: right; font-weight: 600;">{stats["active_companies"]}</td></tr>
        <tr><td style="padding: 6px 0;">Ανοιχτά σχόλια (αρνητικά, εκκρεμή)</td><td style="text-align: right; font-weight: 600;">{stats["open_feedback"]}</td></tr>
        <tr><td style="padding: 6px 0;">Ουρά επανελέγχου εγγράφων</td><td style="text-align: right; font-weight: 600;">{stats["needs_review"]}</td></tr>
      </table>
      <p style="color: #888; font-size: 13px; line-height: 1.5; margin-top: 24px;">
        Η ομάδα theke
      </p>
    </div>
    """


def _send_digest(to_email: str, stats: dict) -> bool:
    """Same no-op-when-disabled / never-raises contract as
    app/services/email.py's send_password_reset_email."""
    if not settings.email_enabled or not settings.resend_api_key:
        return False

    resend.api_key = settings.resend_api_key

    try:
        resend.Emails.send(
            {
                "from": settings.email_from,
                "to": to_email,
                "subject": "theke: Εβδομαδιαία σύνοψη πλατφόρμας",
                "html": _digest_html(stats),
            }
        )
        return True
    except Exception:
        return False


def run_weekly_digest(db: Session, *, triggered_manually: bool) -> WeeklyDigest:
    """Computes fresh stats, emails every active super admin, and persists a
    WeeklyDigest row regardless of send outcome - the same "write every
    run" contract as SpendAlertCheck/InfraHealthCheck, so a Resend outage
    still shows up in the history instead of silently vanishing."""
    stats = _compute_stats(db)
    emails = list(db.scalars(select(User.email).where(User.role == "super_admin", User.is_active.is_(True))))

    sent = sum(1 for email in emails if _send_digest(email, stats))

    row = WeeklyDigest(
        total_messages=stats["total_messages"],
        gap_rate=stats["gap_rate"],
        spend_7d_eur=stats["spend_7d_eur"],
        active_companies=stats["active_companies"],
        open_feedback=stats["open_feedback"],
        needs_review=stats["needs_review"],
        recipients_sent=sent,
        recipients_total=len(emails),
        triggered_manually=triggered_manually,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
