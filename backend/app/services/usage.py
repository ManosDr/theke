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

    # message_count here is "messages that contributed to this token total"
    # (total_tokens IS NOT NULL), not every chat_sessions row for the user -
    # a row with no GPT call (off-topic-guard) has nothing to attribute a
    # token/cost figure to, so it's excluded rather than diluting the
    # per-user average with a message that cost nothing to answer.
    by_user_rows = db.execute(
        select(
            ChatSession.user_id,
            func.coalesce(func.sum(ChatSession.total_tokens), 0),
            func.coalesce(func.sum(ChatSession.estimated_cost_eur), 0),
            func.count(ChatSession.id),
        )
        .where(
            ChatSession.company_id == company_id,
            ChatSession.created_at >= since_30d,
            ChatSession.total_tokens.isnot(None),
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
