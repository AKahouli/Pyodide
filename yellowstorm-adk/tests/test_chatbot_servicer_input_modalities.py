from unittest.mock import MagicMock

from src.grpc_generated import chatbot_pb2
from src.grpc_server.chatbot_servicer import ChatbotServicer


def _agent(*modalities: str) -> chatbot_pb2.Agent:
    return chatbot_pb2.Agent(
        id="agent-1",
        name="Agent",
        description="Agent description",
        prompt="Agent prompt",
        agent_type="normal",
        chatbot=chatbot_pb2.Chatbot(
            model="configured-model",
            input_modalities=list(modalities),
        ),
    )


def test_convert_agent_preserves_configured_input_modalities():
    converted = ChatbotServicer(MagicMock())._convert_agent(_agent("text", "image"))

    assert converted.chatbot_name == {
        "provider": "configured-model",
        "input_modalities": ["text", "image"],
    }


def test_convert_agent_defaults_legacy_requests_to_text_only():
    converted = ChatbotServicer(MagicMock())._convert_agent(_agent())

    assert converted.chatbot_name == {
        "provider": "configured-model",
        "input_modalities": ["text"],
    }
