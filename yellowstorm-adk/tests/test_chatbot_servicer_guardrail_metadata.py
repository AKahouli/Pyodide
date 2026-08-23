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


def test_tool_activity_serializes_semantic_identity_start_time_and_result() -> None:
    field = chatbot_pb2.ToolActivityComponent.DESCRIPTOR.fields_by_name["started_at"]
    assert field.number == 5

    component = ChatbotServicer(agent_team_service=None)._build_component(
        "tool-1",
        "tool_activity",
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
    assert decoded.tool_activity.tool_name == "search_documents"
    assert decoded.tool_activity.display_key == "searchKnowledge"
    assert decoded.tool_activity.params_json == '{"query":"contract"}'
    assert decoded.tool_activity.result_json == '{"matches":2}'
    assert decoded.tool_activity.started_at == "2026-07-21T10:13:42Z"


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


def test_initial_agent_activity_chunk_is_display_safe_progress_only() -> None:
    chunk = ChatbotServicer(agent_team_service=None)._build_initial_agent_activity_chunk("conversation-1")

    assert chunk.action == "add"
    assert chunk.metadata.message_id == "conversation-1"
    assert chunk.component.WhichOneof("data") == "agent_activity"
    assert chunk.component.agent_activity.summary == ""
    assert chunk.component.agent_activity.status == "completed"
    assert not hasattr(chunk.component.agent_activity, "detail")
