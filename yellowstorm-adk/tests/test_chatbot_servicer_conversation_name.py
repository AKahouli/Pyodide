from types import SimpleNamespace

import grpc
import pytest

pytest.importorskip("src.grpc_generated.chatbot_pb2")

from src.grpc_generated import chatbot_pb2
from src.grpc_server import chatbot_servicer as servicer_module
from src.grpc_server.chatbot_servicer import ChatbotServicer


class _AbortedError(Exception):
    pass


class _Context:
    def __init__(self) -> None:
        self.code = None

    async def abort(self, code, details):
        self.code = code
        raise _AbortedError(details)


def _completion(content):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


@pytest.mark.asyncio
async def test_generate_conversation_name_leaves_room_for_reasoning_tokens(monkeypatch) -> None:
    captured = {}

    async def fake_completion(**kwargs):
        captured.update(kwargs)
        return _completion('  "2025 Tech Giants vs S&P 500"  ')

    monkeypatch.setattr(servicer_module.litellm, "acompletion", fake_completion)
    servicer = ChatbotServicer(agent_team_service=None)

    result = await servicer.GenerateConversationName(
        chatbot_pb2.GenerateConversationNameRequest(query="Compare Meta and Google", model="litellm_proxy/m"),
        _Context(),
    )

    assert result.conversation_name == "2025 Tech Giants vs S&P 500"
    # A 50-token cap let reasoning models burn the whole budget on hidden
    # reasoning and return empty content.
    assert captured["max_tokens"] >= 512


@pytest.mark.asyncio
@pytest.mark.parametrize("content", [None, "", '  ""  '])
async def test_generate_conversation_name_aborts_on_empty_name(monkeypatch, content) -> None:
    async def fake_completion(**kwargs):
        return _completion(content)

    monkeypatch.setattr(servicer_module.litellm, "acompletion", fake_completion)
    servicer = ChatbotServicer(agent_team_service=None)
    context = _Context()

    with pytest.raises(_AbortedError):
        await servicer.GenerateConversationName(
            chatbot_pb2.GenerateConversationNameRequest(query="hello", model="litellm_proxy/m"),
            context,
        )

    assert context.code == grpc.StatusCode.INTERNAL
