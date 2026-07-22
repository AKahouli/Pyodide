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


def test_tool_info_serializes_start_time_and_result() -> None:
    field = chatbot_pb2.ToolInfoComponent.DESCRIPTOR.fields_by_name["started_at"]
    assert field.number == 5

    component = ChatbotServicer(agent_team_service=None)._build_component(
        "tool-1",
        "tool_info",
        {
            "title": "search_documents",
            "status": "completed",
            "params": '{"query":"contract"}',
            "result_json": '{"matches":2}',
            "started_at": "2026-07-21T10:13:42Z",
        },
    )

    decoded = chatbot_pb2.Component.FromString(component.SerializeToString())
    assert decoded.tool_info.params == '{"query":"contract"}'
    assert decoded.tool_info.result_json == '{"matches":2}'
    assert decoded.tool_info.started_at == "2026-07-21T10:13:42Z"
