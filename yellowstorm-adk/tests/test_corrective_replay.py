import json

from src.corrective_replay import CORRECTIVE_REPLAY_PROMPT_VERSION, build_corrective_replay_user_message
from src.schema.chatbot_schema import CorrectionReplayContext
from src.grpc_generated import chatbot_pb2
from src.grpc_server.chatbot_servicer import (
    ChatbotServicer,
    _grpc_in_log_message,
    _json_log_payload,
)


def test_builds_request_scoped_transient_user_message():
    context = CorrectionReplayContext(
        original_answer="Old answer",
        findings=[{"claim": "Claim", "status": "unsupported", "importance": "major", "explanation": "Missing evidence"}],
        attempt_number=2,
        instructions="Re-answer from scratch using normal tools.",
    )
    message = build_corrective_replay_user_message("Original question", context)
    assert CORRECTIVE_REPLAY_PROMPT_VERSION == "corrective-replay-v2"
    assert "<original_user_request>\nOriginal question\n</original_user_request>" in message
    assert "Old answer" in message
    assert "attempt 2" in message
    assert "unsupported" in message
    assert "untrusted diagnostic data" in message


def test_absent_context_does_not_inject_instructions():
    assert build_corrective_replay_user_message("Original question", None) == "Original question"


def test_proto_carries_replay_context_for_single_and_team_requests():
    context = chatbot_pb2.CorrectionReplayContext(
        original_answer="Old",
        findings=[chatbot_pb2.CorrectionReplayFinding(claim="Claim", status="unsupported", importance="major", explanation="Missing")],
        attempt_number=1,
        instructions="Retry",
    )
    single = chatbot_pb2.RunSingleAgentRequest(correction_replay_context=context)
    team = chatbot_pb2.RunAgentTeamRequest(correction_replay_context=context)
    assert single.correction_replay_context.original_answer == "Old"
    assert team.correction_replay_context.findings[0].status == "unsupported"


def test_team_request_log_payload_redacts_replay_content():
    request = chatbot_pb2.RunAgentTeamRequest(
        query="Question",
        correction_replay_context=chatbot_pb2.CorrectionReplayContext(
            original_answer="Sensitive prior answer",
            findings=[chatbot_pb2.CorrectionReplayFinding(claim="Sensitive claim", status="unsupported")],
            attempt_number=2,
            instructions="Internal instructions",
        ),
    )
    payload = ChatbotServicer._serialize_run_agent_team_request(request)
    assert payload["correction_replay_context"] == {
        "present": True,
        "attempt_number": 2,
        "finding_count": 1,
    }
    assert "Sensitive prior answer" not in str(payload)
    assert "Sensitive claim" not in str(payload)


def test_grpc_request_log_payload_is_valid_json():
    payload = ChatbotServicer._serialize_run_agent_team_request(
        chatbot_pb2.RunAgentTeamRequest(query="Question", agent_mode="mono")
    )

    request_json = _json_log_payload(payload)

    assert json.loads(request_json) == payload
    assert "'Question'" not in request_json


def test_grpc_in_log_message_never_serializes_secret_payloads():
    """Regression: the gRPC IN log must stay allow-listed.

    Before the allow-list fix this emitted the full protobuf dict as
    ``request_json=``, leaking platform tokens, agent params, guardrail
    config, and connector credentials into logs.
    """
    payload = {
        "query": "DO_NOT_LOG_SECRET question",
        "platform_api_token": "DO_NOT_LOG_PLATFORM_TOKEN",
        "user_context": {"user_id": "u1", "platform_api_token": "DO_NOT_LOG_PLATFORM_TOKEN"},
        "agent_params": {"api_key": "DO_NOT_LOG_SECRET"},
        "workspace_context": [{"credentials": "DO_NOT_LOG_SECRET"}],
        "attached_files": [{"name": "file.txt", "url": "https://example.com/DO_NOT_LOG_SECRET"}],
        "guardrail": {"api_key": "DO_NOT_LOG_SECRET"},
    }

    message = _grpc_in_log_message("RunAgentTeam request received", payload)

    assert "DO_NOT_LOG_PLATFORM_TOKEN" not in message
    assert "DO_NOT_LOG_SECRET" not in message
    assert "request_json=" not in message

    summary = json.loads(message.split("request_summary=", 1)[1])
    assert summary["query_length"] == len("DO_NOT_LOG_SECRET question")
    assert summary["workspace_count"] == 1
    assert summary["attached_file_count"] == 1
    assert set(summary) == {
        "query_length",
        "workspace_count",
        "agent_count",
        "has_agent",
        "attached_file_count",
    }
