from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ChatSession, User
from app.schemas import TokenUsageByUser, TokenUsageSummary


def company_token_usage(db: Session, company_id: int, since_30d: datetime, users: list[User]) -> TokenUsageSummary:
    """Token/cost totals for the last 30 days - NULL columns on gap rows
    (no GPT call made, see chat.py's _log_session) are excluded by every
    aggregate here rather than coerced to 0, so a company that only ever
    hit the off-topic-guard path shows 0 real usage instead of a
    misleadingly precise-looking 0.0 cost average. Shared by the
    super-admin company detail view and the company-admin-scoped self-serve
    endpoint - same numbers, gated by different roles."""
    totals = db.execute(
        select(
            func.coalesce(func.sum(ChatSession.prompt_tokens), 0),
            func.coalesce(func.sum(ChatSession.completion_tokens), 0),
            func.coalesce(func.sum(ChatSession.total_tokens), 0),
            func.coalesce(func.sum(ChatSession.estimated_cost_eur), 0),
            func.count(ChatSession.total_tokens),
        ).where(ChatSession.company_id == company_id, ChatSession.created_at >= since_30d)
    ).one()
    prompt_tokens, completion_tokens, total_tokens, estimated_cost_eur, priced_message_count = totals

    # message_count is every REAL user message (ChatSession.is_real_user_message()
    # - same definition the company-level headline stat uses, see admin.py's
    # get_company_detail/companies.py's company_overview), not just the ones
    # that happened to trigger a priced GPT completion. Was previously
    # scoped to total_tokens IS NOT NULL - looked plausible ("messages that
    # contributed to this token total") but silently produced a smaller,
    # differently-defined number than the company-level count directly
    # above it in the same modal (e.g. off-topic-guard replies never call
    # the model, so they were dropped from message_count but still counted
    # as real activity everywhere else) - a single-user company could show
    # "3 messages (30d)" at the top and "1" in this table for its only user,
    # reading as a bug even though neither query was wrong in isolation. Two
    # separate WHERE scopes below deliberately: tokens/cost still sum only
    # priced rows (coalesce(sum(...)) already ignores NULL total_tokens on
    # its own), while message_count now counts against the full company
    # window via a FILTER clause, so a user with zero priced messages but
    # real (unpriced) activity still shows up here instead of vanishing.
    by_user_rows = db.execute(
        select(
            ChatSession.user_id,
            func.coalesce(func.sum(ChatSession.total_tokens), 0),
            func.coalesce(func.sum(ChatSession.estimated_cost_eur), 0),
            func.count().filter(ChatSession.is_real_user_message()),
        )
        .where(
            ChatSession.company_id == company_id,
            ChatSession.created_at >= since_30d,
        )
        .group_by(ChatSession.user_id)
    ).all()
    user_names = {u.id: u.display_name for u in users}

    return TokenUsageSummary(
        prompt_tokens_30d=int(prompt_tokens),
        completion_tokens_30d=int(completion_tokens),
        total_tokens_30d=int(total_tokens),
        estimated_cost_eur_30d=round(float(estimated_cost_eur), 4),
        avg_tokens_per_message=round(total_tokens / priced_message_count) if priced_message_count else 0,
        by_user=[
            TokenUsageByUser(
                user_id=user_id,
                name=user_names.get(user_id, "—"),
                total_tokens_30d=int(user_total_tokens),
                estimated_cost_eur_30d=round(float(user_cost), 4),
                message_count=message_count,
            )
            for user_id, user_total_tokens, user_cost, message_count in by_user_rows
            if user_id is not None
        ],
    )
