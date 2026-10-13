"""A conversation's concurrent ROOT turns own separate native workflow sessions."""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.grpc_generated import chatbot_pb2
from src.grpc_server.chatbot_servicer import ChatbotServicer
from src.smart_rag.engines.multi_agent import workflow_processor


@pytest.fixture
def servicer():
    service = ChatbotServicer(MagicMock())
    service._build_brain_and_file_context = AsyncMock(return_value={
        key: [] for key in (
            "image_input", "attached_documents", "attached_images_metadata",
            "previous_attached", "workspace_names", "workspace_ids", "brain_documents",
        )
    })
    return service


def request(session_id=None, *, resume=False):
    result = chatbot_pb2.RunSingleAgentRequest(
        user_context=chatbot_pb2.UserContext(user_id="user-1"),
        conversation_id="canonical-conversation",
        query="question",
        agent=chatbot_pb2.Agent(id="agent", name="Agent", agent_type="normal",
            chatbot=chatbot_pb2.Chatbot(model="configured-model")),
    )
    if session_id is not None:
        result.execution_scope.CopyFrom(chatbot_pb2.ExecutionScope(
            execution_role=chatbot_pb2.EXECUTION_ROLE_ROOT,
            execution_id="execution-" + session_id,
            native_session_id=session_id,
            resume_intent="resume" if resume else "start",
            native_invocation_id="invocation" if resume else "",
        ))
    return result


@pytest.mark.asyncio
@pytest.mark.parametrize("session_id", [None, ""])
async def test_legacy_or_empty_native_session_keeps_conversation_session(servicer, session_id):
    converted = await servicer._convert_single_agent_request(request(session_id))
    assert converted.session_id == "canonical-conversation"


@pytest.mark.asyncio
async def test_resume_retains_own_session_and_external_conversation(servicer):
    original = request("turn-first", resume=True)
    converted = await servicer._convert_single_agent_request(original)
    assert original.conversation_id == "canonical-conversation"
    assert converted.session_id == "turn-first"
    assert converted.execution_scope.native_session_id == "turn-first"
    assert converted.execution_scope.native_invocation_id == "invocation"
    assert converted.execution_scope.resume_intent == "resume"


@pytest.mark.asyncio
async def test_completion_cleans_only_its_native_temporary_child_summary(servicer, monkeypatch):
    async def complete(converted, queue):
        await queue.put(None)

    servicer.agent_team_service.process_team_request = AsyncMock(side_effect=complete)
    cleanup = MagicMock()
    monkeypatch.setattr(servicer, "_log_temporary_child_summary", cleanup)
    chunks = [chunk async for chunk in servicer.RunSingleAgent(request("turn-first"), MagicMock())]
    cleanup.assert_called_once_with("turn-first", "RunSingleAgent")
    assert not any(chunk.action == "error" for chunk in chunks)


@pytest.mark.asyncio
async def test_same_conversation_turns_enter_workflow_concurrently(servicer, monkeypatch):
    entered = {key: asyncio.Event() for key in ("turn-first", "turn-second")}

    async def workflow(converted, queue):
        entered[converted.session_id].set()
        await asyncio.wait_for(asyncio.gather(*(event.wait() for event in entered.values())), 1)

    monkeypatch.setattr(workflow_processor, "_run_agent_team_logic", workflow)
    requests = [request(key) for key in entered]
    converted = [await servicer._convert_single_agent_request(item) for item in requests]
    assert {item.conversation_id for item in requests} == {"canonical-conversation"}
    await asyncio.gather(*(workflow_processor.run_agent_team_logic(item, asyncio.Queue())
                           for item in converted))


@pytest.mark.asyncio
async def test_same_native_session_still_serializes_workflow(servicer, monkeypatch):
    first_entered, release_first, second_entered = (asyncio.Event() for _ in range(3))

    async def workflow(converted, queue):
        if not first_entered.is_set():
            first_entered.set()
            await release_first.wait()
        else:
            second_entered.set()

    monkeypatch.setattr(workflow_processor, "_run_agent_team_logic", workflow)
    converted = await servicer._convert_single_agent_request(request("turn-same"))
    first = asyncio.create_task(workflow_processor.run_agent_team_logic(converted, asyncio.Queue()))
    await first_entered.wait()
    second = asyncio.create_task(workflow_processor.run_agent_team_logic(converted, asyncio.Queue()))
    await asyncio.sleep(0)
    assert not second_entered.is_set()
    release_first.set()
    await asyncio.gather(first, second)
    assert second_entered.is_set()
