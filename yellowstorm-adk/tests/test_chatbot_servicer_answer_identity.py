from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.grpc_generated import chatbot_pb2
from src.grpc_server.chatbot_servicer import ChatbotServicer


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["single", "manager", "hierarchy", "replay"])
async def test_initial_activity_keeps_configured_answer_producer(monkeypatch, kind):
    producer = chatbot_pb2.Agent(id="producer", name="Configured Guide", agent_type="manager")
    context = chatbot_pb2.UserContext(user_id="user", username="User")
    servicer = ChatbotServicer(MagicMock())
    if kind in ("single", "replay"):
        request = chatbot_pb2.RunSingleAgentRequest(
            user_context=context, conversation_id="conversation", agent=producer,
        )
        converter = "_convert_single_agent_request"
        rpc = servicer.RunSingleAgent
    else:
        # The child appears first so order cannot accidentally select it.
        child = chatbot_pb2.Agent(id="child", name="Worker", agent_type="manager")
        request = chatbot_pb2.RunAgentTeamRequest(
            user_context=context, conversation_id="conversation", agents=[child, producer],
        )
        if kind == "hierarchy":
            producer.agent_type = "simple"
            request.agents[1].agent_type = "simple"
            request.team_definition.nodes.add(agent_id="producer")
            request.team_definition.nodes.add(agent_id="child", parent_agent_id="producer")
        else:
            request.agents[0].agent_type = "simple"
        converter = "_convert_agent_team_request_v2"
        rpc = servicer.RunAgentTeam
    monkeypatch.setattr(servicer, converter, AsyncMock(return_value=SimpleNamespace(
        correction_replay_context={"replay": True} if kind == "replay" else None,
        attached_files=[],
    )))
    stream = rpc(request, MagicMock())
    try:
        chunk = await anext(stream)
        if kind == "replay":
            assert chunk.action == "replay_started"
            chunk = await anext(stream)
        decoded = chatbot_pb2.StreamChunk.FromString(chunk.SerializeToString())
        assert decoded.metadata.agent_id == "producer"
        assert decoded.component.agent_activity.actor_id == "producer"
        assert decoded.component.agent_activity.actor_name == "Configured Guide"
        assert decoded.component.agent_activity.summary == ""
    finally:
        await stream.aclose()
