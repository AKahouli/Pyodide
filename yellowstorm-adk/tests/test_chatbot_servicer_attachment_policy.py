"""Attachment-policy handling in the gRPC servicer and mono prompt builder."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.grpc_server.chatbot_servicer import ChatbotServicer
from src.smart_rag.agents.core.helpers import AgentHelper

try:
    from src.grpc_generated import chatbot_pb2
except ImportError:  # pragma: no cover - generated code must exist
    chatbot_pb2 = None

pytestmark = pytest.mark.skipif(chatbot_pb2 is None, reason="grpc_generated unavailable")


def _make_servicer() -> ChatbotServicer:
    return ChatbotServicer(MagicMock())


def _request_with_attachment(processing_policy: str = "", document_id: str = "doc-1"):
    request = chatbot_pb2.RunSingleAgentRequest()
    request.user_context.user_id = "user-1"
    request.conversation_id = "conv-1"
    request.query = "summarize"
    document = request.attached_files.add()
    document.type = "document"
    document.document.filepath = "user-1/conv-1/report.pdf"
    document.document.filename = "report.pdf"
    document.document.workspace_name = "user-1/conv-1"
    document.document.workspace_id = "ws-1"
    document.document.document_id = document_id
    document.document.processing_policy = processing_policy
    return request


@pytest.mark.asyncio
async def test_searchable_attachment_enters_brain_documents():
    servicer = _make_servicer()
    request = _request_with_attachment("SEARCHABLE")

    context = await servicer._build_brain_and_file_context(request)

    assert len(context["attached_documents"]) == 1
    assert context["attached_documents"][0]["processing_policy"] == "SEARCHABLE"
    assert any(doc.get("filename") == "report.pdf" for doc in (context["brain_documents"] or []))


@pytest.mark.asyncio
async def test_code_only_attachment_excluded_from_search_tree():
    servicer = _make_servicer()
    request = _request_with_attachment("CODE_ONLY")

    context = await servicer._build_brain_and_file_context(request)

    # Present as an attached file (code tools can still reach it)...
    assert context["attached_documents"][0]["processing_policy"] == "CODE_ONLY"
    # ...but never enters the document/search tree.
    assert not any(doc.get("filename") == "report.pdf" for doc in (context["brain_documents"] or []))


@pytest.mark.asyncio
async def test_attachment_context_threaded_into_mono_request():
    servicer = _make_servicer()
    request = _request_with_attachment("SEARCHABLE")
    request.attachment_context.text = "<conversation_attachments version=\"1\"></conversation_attachments>"
    request.agent.chatbot.model = "test-model"

    servicer._convert_agent = MagicMock(
        return_value={"id": "agent-1", "name": "agent", "description": "d", "prompt": "p"}
    )
    servicer._convert_chatbot = MagicMock(return_value={"model": "test-model"})

    converted = await servicer._convert_single_agent_request(request)

    # The user query is never mutated; attachment text travels out-of-band.
    assert converted.message == "summarize"
    assert converted.attachment_context == request.attachment_context.text


@pytest.mark.asyncio
async def test_indexing_skipped_for_backend_prepared_documents(monkeypatch):
    _enable_vectorstores(monkeypatch)
    servicer = _make_servicer()

    documents = [
        {"filepath": "a.pdf", "workspace_id": "ws-1", "processing_policy": "SEARCHABLE"},
        {"filepath": "b.csv", "workspace_id": "ws-1", "processing_policy": "CODE_ONLY"},
    ]

    with patch("aiohttp.ClientSession") as session_cls:
        session_cls.side_effect = AssertionError("no indexing request may be sent")

        await servicer._index_attached_documents(documents, "conv-1")

    session_cls.assert_not_called()


@pytest.mark.asyncio
async def test_indexing_still_runs_for_unprepared_documents(monkeypatch):
    _enable_vectorstores(monkeypatch)
    servicer = _make_servicer()

    response = MagicMock()
    response.status = 200
    response.__aenter__ = AsyncMock(return_value=response)
    post = MagicMock(return_value=response)
    session = MagicMock()
    session.post = post
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)

    with patch("aiohttp.ClientSession") as session_cls:
        session_cls.return_value = session

        await servicer._index_attached_documents(
            [{"filepath": "a.pdf", "workspace_id": "ws-1"}], "conv-1"
        )

    assert post.called


def _enable_vectorstores(monkeypatch) -> None:
    from src.grpc_server import chatbot_servicer as module

    settings = SimpleNamespace(VECTORSTORES_API_URL="http://vs", VECTORSTORE_API_KEY="key")
    monkeypatch.setattr(module, "app_settings", settings, raising=False)




def test_mono_agent_prompt_receives_attachment_context():
    agent = {"name": "analyst", "prompt": "You analyse files.", "tools": [{"name": "calculator"}]}
    user_request = SimpleNamespace(attachment_context="<conversation_attachments>x</conversation_attachments>")

    agent_data = AgentHelper._prepare_agent_data(agent, user_request, team=None)

    assert agent_data["prompt"].startswith("You analyse files.")
    assert "<conversation_attachments>" in agent_data["prompt"]
