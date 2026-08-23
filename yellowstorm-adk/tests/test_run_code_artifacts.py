import json

from src.smart_rag.run_code_artifacts import build_run_code_artifacts


def _agent_config() -> dict:
    return {
        "agent_params": {
            "params": {
                "run_code_context_json": json.dumps({
                    "userId": "user-1",
                    "runId": "conversation-1",
                    "mounts": [{
                        "virtualPath": "/workspace/run",
                        "cephPrefix": "user-1/system_conversation-1",
                        "mode": "rw",
                    }],
                })
            }
        }
    }


def test_builds_opaque_linked_artifact_from_reported_run_file() -> None:
    artifacts = build_run_code_artifacts({
        "written_files": [{
            "name": "report.json", "path": "/workspace/run/report.json",
            "sizeBytes": 42, "contentType": "application/json", "createdBy": "run_code",
        }]
    }, _agent_config(), "tool-agent-call")

    assert len(artifacts) == 1
    assert artifacts[0]["producer_tool_id"] == "tool-agent-call"
    assert artifacts[0]["artifact_id"]
    assert artifacts[0]["file_path"].endswith("/report.json")
    assert artifacts[0]["availability"] == "ready"


def test_rejects_traversal_and_non_run_paths() -> None:
    result = {"written_files": [
        {"name": "secret", "path": "/workspace/run/../secret", "sizeBytes": 1},
        {"name": "source.txt", "path": "/workspace/sources/source.txt", "sizeBytes": 1},
    ]}
    assert build_run_code_artifacts(result, _agent_config(), "tool-1") == []
