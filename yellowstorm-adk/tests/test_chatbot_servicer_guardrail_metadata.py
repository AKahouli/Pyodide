import json

from src.grpc_generated import chatbot_pb2
from src.grpc_server.chatbot_servicer import ChatbotServicer


def test_guardrail_metadata_is_serialized_in_stream_chunk() -> None:
    field = chatbot_pb2.Metadata.DESCRIPTOR.fields_by_name["guardrail_decision_json"]

    assert field.number == 3
    assert field.type == field.TYPE_STRING

    decision = {"phase": "output", "action": "sanitize"}
    chunk = ChatbotServicer(agent_team_service=None)._dict_to_stream_chunk(
        {
            "action": "add",
            "component": {"id": "component-1", "type": "text", "data": {"content": "Safe text"}},
            "metadata": {
                "message_id": "message-1",
                "agent_id": "agent-1",
                "guardrail_decision": decision,
            },
        }
    )

    decoded = chatbot_pb2.StreamChunk.FromString(chunk.SerializeToString())

    assert json.loads(decoded.metadata.guardrail_decision_json) == decision


def test_stream_chunk_allows_missing_guardrail_metadata() -> None:
    chunk = ChatbotServicer(agent_team_service=None)._dict_to_stream_chunk(
        {
            "action": "add",
            "component": {"id": "component-1", "type": "text", "data": {"content": "Safe text"}},
            "metadata": {"message_id": "message-1", "agent_id": "agent-1"},
        }
    )

    assert chunk.metadata.guardrail_decision_json == ""
