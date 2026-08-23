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


def test_tool_info_serializes_semantic_identity_start_time_and_result() -> None:
    field = chatbot_pb2.ToolInfoComponent.DESCRIPTOR.fields_by_name["started_at"]
    assert field.number == 5

    component = ChatbotServicer(agent_team_service=None)._build_component(
        "tool-1",
        "tool_info",
        {
            "tool_name": "search_documents",
            "display_key": "searchKnowledge",
            "status": "completed",
            "params_json": '{"query":"contract"}',
            "result_json": '{"matches":2}',
            "started_at": "2026-07-21T10:13:42Z",
        },
    )

    decoded = chatbot_pb2.Component.FromString(component.SerializeToString())
    assert decoded.tool_info.tool_name == "search_documents"
    assert decoded.tool_info.display_key == "searchKnowledge"
    assert decoded.tool_info.params_json == '{"query":"contract"}'
    assert decoded.tool_info.result_json == '{"matches":2}'
    assert decoded.tool_info.started_at == "2026-07-21T10:13:42Z"


def test_artifact_component_serializes_opaque_identity_and_linkage() -> None:
    component = ChatbotServicer(agent_team_service=None)._build_component(
        "artifact-1",
        "artifact",
        {
            "filename": "hello_world.py",
            "artifact_id": "opaque-1",
            "producer_tool_id": "tool-1",
            "availability": "ready",
            "object_key": "user/session/hello_world.py",
        },
    )

    decoded = chatbot_pb2.Component.FromString(component.SerializeToString())
    assert decoded.artifact.artifact_id == "opaque-1"
    assert decoded.artifact.producer_tool_id == "tool-1"
    assert decoded.artifact.file_path == "user/session/hello_world.py"


def test_initial_reasoning_chunk_is_display_safe_progress_only() -> None:
    chunk = ChatbotServicer(agent_team_service=None)._build_initial_reasoning_chunk("conversation-1")

    assert chunk.action == "add"
    assert chunk.metadata.message_id == "conversation-1"
    assert chunk.component.WhichOneof("data") == "reasoning"
    assert chunk.component.reasoning.summary == ""
    assert chunk.component.reasoning.status == "completed"
    assert not hasattr(chunk.component.reasoning, "detail")
