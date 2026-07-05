import logging

from fastapi import APIRouter, Depends
from openai import OpenAIError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import ChatSession, Project
from app.schemas import ChatCitation, ChatRequest, ChatResponse
from app.services.rag import search_regulation

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

    hits = search_regulation(db, user, question)

    if not hits:
        _log_session(db, user, payload.project_id, question, GAP_RESPONSE, tool_used="none")
        return ChatResponse(answer=GAP_RESPONSE, citations=[])

    project_line = ""
    if payload.project_id is not None:
        project = db.get(Project, payload.project_id)
        if project and project.company_id == user.company_id and project.municipality:
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


def _log_session(
    db: Session, user: CurrentUser, project_id: int | None, message: str, response: str, tool_used: str
) -> None:
    db.add(
        ChatSession(
            company_id=user.company_id,
            user_id=user.user_id,
            project_id=project_id,
            message=message,
            response=response,
            tool_used=tool_used,
        )
    )
    db.commit()
