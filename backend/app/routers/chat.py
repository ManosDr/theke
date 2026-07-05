import logging

from fastapi import APIRouter, Depends, HTTPException, status
from openai import OpenAIError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import ChatSession, Project
from app.schemas import (
    ChatCitation,
    ChatMessageCitation,
    ChatMessageRequest,
    ChatMessageResponse,
    ChatRequest,
    ChatResponse,
)
from app.services.rag import _retrieve, search_regulation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

GAP_RESPONSE = (
    "Δεν διαθέτω αρκετά αξιόπιστη πηγή στη βάση γνώσης για να απαντήσω σε αυτή την ερώτηση "
    "με βεβαιότητα. Δοκιμάστε να αναδιατυπώσετε την ερώτηση, ή δείτε την ενότητα Αναζήτηση.\n\n"
    "Αυτές οι πληροφορίες είναι για ενημέρωση μόνο. Συμβουλευτείτε αδειούχο μηχανικό για το "
    "συγκεκριμένο έργο σας."
)

ERROR_RESPONSE = (
    "Η υπηρεσία απαντήσεων δεν είναι διαθέσιμη αυτή τη στιγμή. Δοκιμάστε ξανά σε λίγο."
)

SYSTEM_PROMPT = """Είσαι ο βοηθός γνώσης της εφαρμογής theke, που απαντά ερωτήσεις για \
πολεοδομικές άδειες και κατασκευαστική συμμόρφωση στην Ελλάδα.

Κανόνες, χωρίς εξαίρεση:
1. Απάντησε ΜΟΝΟ με βάση τα αριθμημένα αποσπάσματα πηγών που σου δίνονται παρακάτω. Μην \
προσθέτεις γενικές γνώσεις που δεν εμφανίζονται σε αυτά τα αποσπάσματα.
2. Κάθε ισχυρισμό στην απάντησή σου να τον συνοδεύεις με την αναφορά πηγής σε αγκύλες, π.χ. [1], \
[2], δίπλα στην πρόταση που τον υποστηρίζει.
3. Αν τα αποσπάσματα δεν καλύπτουν επαρκώς την ερώτηση, πες το ξεκάθαρα αντί να μαντέψεις.
4. Αν κάποιο απόσπασμα αναφέρεται σε συντελεστή δόμησης, ποσοστό κάλυψης ή απόσταση \
(οπισθοχώρηση), ανέφερε ρητά: το όνομα της ζώνης όπως αναγράφεται στην πηγή, τον αριθμό ΦΕΚ αν \
υπάρχει, και ότι η αντιστοίχιση συγκεκριμένου οικοπέδου σε ζώνη χρειάζεται επιβεβαίωση από \
αδειούχο μηχανικό - μην υποθέσεις ποια ζώνη αφορά το οικόπεδο του χρήστη.
5. Τελείωνε πάντα την απάντησή σου με ακριβώς αυτή την πρόταση σε ξεχωριστή γραμμή: \
"Αυτές οι πληροφορίες είναι για ενημέρωση μόνο. Συμβουλευτείτε αδειούχο μηχανικό για το \
συγκεκριμένο έργο σας."
"""


CHAT_MESSAGE_GAP_RESPONSE = (
    "Δεν διαθέτω αρκετά αξιόπιστη πηγή στη βάση γνώσης για να απαντήσω σε αυτή την ερώτηση "
    "με βεβαιότητα. Δοκιμάστε να αναδιατυπώσετε την ερώτηση, ή δείτε την ενότητα Αναζήτηση."
)

# Appended in code, never asked of the model - guarantees the exact wording
# every time regardless of how the completion behaves, the same way
# CHAT_MESSAGE_GAP_RESPONSE bypasses the model entirely on zero retrieval.
CHAT_MESSAGE_CLOSING_LINE = (
    "Οι παραπάνω πληροφορίες είναι για ενημέρωση μόνο. Συμβουλευτείτε αδειούχο μηχανικό για το "
    "συγκεκριμένο έργο σας."
)

CHAT_MESSAGE_SYSTEM_PROMPT = """Είσαι ο βοηθός γνώσης της εφαρμογής theke, που απαντά ερωτήσεις για \
πολεοδομικές άδειες και κατασκευαστική συμμόρφωση στην Ελλάδα.

Κανόνες, χωρίς εξαίρεση:
1. Απάντησε ΜΟΝΟ με βάση τα αριθμημένα αποσπάσματα πηγών που σου δίνονται παρακάτω. Μην \
χρησιμοποιείς γενικές γνώσεις που δεν εμφανίζονται σε αυτά τα αποσπάσματα, ακόμα κι αν τις γνωρίζεις.
2. Κάθε ισχυρισμός στην απάντησή σου πρέπει να συνοδεύεται από αναφορά σε συγκεκριμένο απόσπασμα \
πηγής σε αγκύλες, π.χ. [1], [2], δίπλα στην πρόταση που τον υποστηρίζει - κάθε αριθμός αντιστοιχεί \
σε έναν συγκεκριμένο τίτλο και πηγή από τη λίστα αποσπασμάτων παρακάτω.
3. Αν κανένα απόσπασμα δεν υποστηρίζει έναν ισχυρισμό, μην τον διατυπώσεις· πες ρητά ότι τα \
αποσπάσματα δεν καλύπτουν αυτό το σημείο, αντί να βασιστείς σε γενικές γνώσεις.
4. Αν κάποιο απόσπασμα αναφέρεται σε συντελεστή δόμησης, ποσοστό κάλυψης ή απόσταση \
(οπισθοχώρηση), ανέφερε ρητά το συγκεκριμένο ΦΕΚ (αριθμό/έτος όπως αναγράφεται στην πηγή) και το \
όνομα της ζώνης, και δήλωσε ρητά ότι η αντιστοίχιση συγκεκριμένου οικοπέδου σε ζώνη απαιτεί \
επιβεβαίωση από αδειούχο μηχανικό - μην υποθέσεις ποια ζώνη αφορά το οικόπεδο του χρήστη.
"""


def _resolve_project(db: Session, user: CurrentUser, project_id: int | None) -> Project | None:
    """Raises rather than silently ignoring a bad project_id: a 404 if it
    doesn't exist, a 403 if it exists but belongs to a different company.
    Previously this fell back to unscoped/national-only retrieval on either
    case, which meant a stale or foreign project_id silently narrowed a
    user's results without ever telling them why (see KNOWN_DECISIONS.md)."""
    if project_id is None:
        return None
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if project.company_id != user.company_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project belongs to a different company")
    return project


def _build_context_block(hits: list) -> str:
    parts = []
    for i, hit in enumerate(hits, start=1):
        meta = f"[{i}] Πηγή: {hit.title or 'άγνωστος τίτλος'}"
        if hit.authority:
            meta += f" ({hit.authority})"
        if hit.date:
            meta += f" - {hit.date}"
        parts.append(f"{meta}\n{hit.chunk_text}")
    return "\n\n".join(parts)


@router.post("", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ChatResponse:
    question = payload.message.strip()
    if not question:
        return ChatResponse(answer=GAP_RESPONSE, citations=[])

    project = _resolve_project(db, user, payload.project_id)

    hits = search_regulation(db, user, question)

    if not hits:
        _log_session(db, user, payload.project_id, question, GAP_RESPONSE, tool_used="none")
        return ChatResponse(answer=GAP_RESPONSE, citations=[])

    project_line = ""
    if project and project.municipality:
        project_line = f"\nΟ χρήστης εργάζεται σε έργο στον/στην {project.municipality}."

    user_prompt = (
        f"Ερώτηση: {question}\n{project_line}\n\nΑποσπάσματα πηγών:\n{_build_context_block(hits)}"
    )

    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.openai_api_key)
        completion = client.chat.completions.create(
            model=settings.chat_model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        )
        answer = completion.choices[0].message.content or GAP_RESPONSE
    except OpenAIError as exc:
        logger.error("OpenAI completion failed: %s", exc)
        _log_session(db, user, payload.project_id, question, ERROR_RESPONSE, tool_used="rag_error")
        return ChatResponse(answer=ERROR_RESPONSE, citations=[])

    # Cite every source actually handed to the model as context - this is
    # deliberately "what grounded the answer," not an attempt to prove the
    # model quoted each one word-for-word; every citable document is
    # full_text (embeddings only exist for those - see embeddings.py), so
    # there's no reference_only/manual_entry_pending citation case to caveat.
    seen_ids: set[int] = set()
    citations = []
    for hit in hits:
        if hit.document_id in seen_ids:
            continue
        seen_ids.add(hit.document_id)
        citations.append(
            ChatCitation(
                document_id=hit.document_id,
                title=hit.title,
                authority=hit.authority,
                content_type=hit.content_type,
                source=hit.source,
                date=hit.date,
            )
        )

    _log_session(db, user, payload.project_id, question, answer, tool_used="rag")
    return ChatResponse(answer=answer, citations=citations)


@router.post("/message", response_model=ChatMessageResponse)
async def chat_message(
    payload: ChatMessageRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ChatMessageResponse:
    """Like POST /chat, but with region scope derived from the caller's
    project (not a raw region_id) and a `gap` confidence flag that can be
    true even when a real answer was generated - see ChatMessageResponse.
    Retrieval goes straight through rag._retrieve() (the same core /search
    uses), not an HTTP call to /search, so this never depends on the API
    being reachable from itself.
    """
    question = payload.query.strip()
    if not question:
        return ChatMessageResponse(answer=CHAT_MESSAGE_GAP_RESPONSE, citations=[], gap=True)

    project = _resolve_project(db, user, payload.project_id)
    region_id = project.region_id if project else None

    raw_hits = _retrieve(db, user, question, settings.rag_top_k, region_id=region_id)
    hits = [h for h in raw_hits if h.distance <= settings.rag_max_distance]

    if not hits:
        _log_session(db, user, payload.project_id, question, CHAT_MESSAGE_GAP_RESPONSE, tool_used="none")
        return ChatMessageResponse(answer=CHAT_MESSAGE_GAP_RESPONSE, citations=[], gap=True)

    # A real answer is still generated from these hits - "gap" here flags
    # low confidence (thinner or weaker-than-usual support), not absence.
    is_low_confidence = len(hits) < settings.rag_top_k or any(h.distance > settings.rag_warn_distance for h in hits)

    messages: list[dict] = [{"role": "system", "content": CHAT_MESSAGE_SYSTEM_PROMPT}]
    for turn in payload.conversation_history:
        if turn.role in ("user", "assistant"):
            messages.append({"role": turn.role, "content": turn.content})
    messages.append(
        {
            "role": "user",
            "content": f"Ερώτηση: {question}\n\nΑποσπάσματα πηγών:\n{_build_context_block(hits)}",
        }
    )

    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.openai_api_key)
        completion = client.chat.completions.create(model=settings.chat_model, messages=messages)
        raw_answer = (completion.choices[0].message.content or "").strip()
    except OpenAIError as exc:
        logger.error("OpenAI completion failed: %s", exc)
        _log_session(db, user, payload.project_id, question, ERROR_RESPONSE, tool_used="rag_error")
        return ChatMessageResponse(answer=ERROR_RESPONSE, citations=[], gap=True)

    if not raw_answer:
        _log_session(db, user, payload.project_id, question, CHAT_MESSAGE_GAP_RESPONSE, tool_used="none")
        return ChatMessageResponse(answer=CHAT_MESSAGE_GAP_RESPONSE, citations=[], gap=True)

    answer = f"{raw_answer}\n\n{CHAT_MESSAGE_CLOSING_LINE}"

    seen_ids: set[int] = set()
    citations: list[ChatMessageCitation] = []
    for hit in hits:
        if hit.document_id in seen_ids:
            continue
        seen_ids.add(hit.document_id)
        citations.append(
            ChatMessageCitation(
                document_id=hit.document_id,
                title=hit.title,
                authority=hit.authority,
                source_url=hit.source,
            )
        )

    _log_session(
        db,
        user,
        payload.project_id,
        question,
        answer,
        tool_used="rag",
        citations=[c.model_dump() for c in citations],
    )
    return ChatMessageResponse(answer=answer, citations=citations, gap=is_low_confidence)


def _log_session(
    db: Session,
    user: CurrentUser,
    project_id: int | None,
    message: str,
    response: str,
    tool_used: str,
    citations: list[dict] | None = None,
) -> None:
    db.add(
        ChatSession(
            company_id=user.company_id,
            user_id=user.user_id,
            project_id=project_id,
            message=message,
            response=response,
            tool_used=tool_used,
            citations=citations,
        )
    )
    db.commit()
