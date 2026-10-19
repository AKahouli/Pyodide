import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.grpc_generated import chatbot_pb2
from src.grpc_server import chatbot_servicer
from src.grpc_server.chatbot_servicer import ChatbotServicer


async def _silent_stream(_request: object, queue: asyncio.Queue[dict | None]) -> None:
    await asyncio.sleep(0.025)
    await queue.put(None)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("rpc_name", "converter_name", "grpc_request"),
    [
        (
            "RunAgentTeam",
            "_convert_agent_team_request_v2",
            chatbot_pb2.RunAgentTeamRequest(
                agents=[chatbot_pb2.Agent(id="manager-1", name="Configured manager", agent_type="manager")],
                user_context=chatbot_pb2.UserContext(user_id="user-1", username="user"),
                conversation_id="conversation-1",
            ),
        ),
        (
            "RunSingleAgent",
            "_convert_single_agent_request",
            chatbot_pb2.RunSingleAgentRequest(
                agent=chatbot_pb2.Agent(id="single-1", name="Configured single"),
                user_context=chatbot_pb2.UserContext(user_id="user-1", username="user"),
                conversation_id="conversation-1",
            ),
        ),
    ],
)
async def test_streaming_rpcs_emit_heartbeats_while_processing_is_silent(
    monkeypatch: pytest.MonkeyPatch,
    native_dispatch_authority,
    rpc_name: str,
    converter_name: str,
    grpc_request: object,
) -> None:
    service = MagicMock()
    service.process_team_request = AsyncMock(side_effect=_silent_stream)
    servicer = ChatbotServicer(service)
    monkeypatch.setattr(
        servicer,
        converter_name,
        AsyncMock(return_value=SimpleNamespace(correction_replay_context=None, attached_files=[],
                                              session_id="conversation-1")),
    )
    monkeypatch.setattr(chatbot_servicer, "STREAM_HEARTBEAT_INTERVAL_SECONDS", 0.005)

    context = MagicMock()
    context.invocation_metadata.return_value = (
        ("x-yellowstorm-native-authority", native_dispatch_authority("conversation-1")),
    )
    chunks = [chunk async for chunk in getattr(servicer, rpc_name)(grpc_request, context)]

    heartbeats = [chunk for chunk in chunks if chunk.action == "heartbeat"]
    assert heartbeats
    assert all(chunk.metadata.message_id == "conversation-1" for chunk in heartbeats)
    assert all(not chunk.HasField("component") for chunk in heartbeats)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("rpc_name", "converter_name", "grpc_request"),
    [
        (
            "RunAgentTeam",
            "_convert_agent_team_request_v2",
            chatbot_pb2.RunAgentTeamRequest(
                agents=[chatbot_pb2.Agent(id="manager-1", name="Configured manager", agent_type="manager")],
                user_context=chatbot_pb2.UserContext(user_id="user-1", username="user"),
                conversation_id="conversation-1",
            ),
        ),
        (
            "RunSingleAgent",
            "_convert_single_agent_request",
            chatbot_pb2.RunSingleAgentRequest(
                agent=chatbot_pb2.Agent(id="single-1", name="Configured single"),
                user_context=chatbot_pb2.UserContext(user_id="user-1", username="user"),
                conversation_id="conversation-1",
            ),
        ),
    ],
)
async def test_stream_cancellation_stops_owned_tasks(
    monkeypatch: pytest.MonkeyPatch,
    native_dispatch_authority,
    rpc_name: str,
    converter_name: str,
    grpc_request: object,
) -> None:
    processing_started = asyncio.Event()
    processing_stopped = asyncio.Event()

    async def process_until_cancelled(
        _request: object,
        _queue: asyncio.Queue[dict | None],
    ) -> None:
        processing_started.set()
        try:
            await asyncio.Event().wait()
        finally:
            processing_stopped.set()

    service = MagicMock()
    service.process_team_request = AsyncMock(side_effect=process_until_cancelled)
    servicer = ChatbotServicer(service)
    monkeypatch.setattr(
        servicer,
        converter_name,
        AsyncMock(return_value=SimpleNamespace(correction_replay_context=None, attached_files=[],
                                              session_id="conversation-1")),
    )
    context = MagicMock()
    context.invocation_metadata.return_value = (
        ("x-yellowstorm-native-authority", native_dispatch_authority("conversation-1")),
    )
    stream = getattr(servicer, rpc_name)(grpc_request, context)
    baseline_tasks = set(asyncio.all_tasks())

    # Drive the whole stream from a single task, mirroring the real gRPC handler
    # task: the authority contextvar must be set and reset in the same context.
    driver_started = asyncio.Event()

    async def _drive() -> None:
        await anext(stream)  # first chunk; producer task starts
        driver_started.set()
        await anext(stream)  # stays pending while processing keeps running

    driver = asyncio.create_task(_drive())
    await driver_started.wait()
    await processing_started.wait()
    driver.cancel()

    with pytest.raises(asyncio.CancelledError):
        await driver
    await processing_stopped.wait()
    await asyncio.sleep(0)

    leaked_tasks = [
        task
        for task in asyncio.all_tasks()
        if task not in baseline_tasks and task is not asyncio.current_task() and not task.done()
    ]
    assert leaked_tasks == []
