from fastapi import APIRouter

from app.schemas import ChatRequest, ChatResponse

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
async def chat(payload: ChatRequest) -> ChatResponse:
    # TODO(Phase 1, Week 4): wire into the RAG pipeline (retrieval -> tool
    # selection -> GPT generation with citations). See app/services/rag.py.
    return ChatResponse(
        answer="RAG pipeline not yet implemented.",
        citations=[],
    )
