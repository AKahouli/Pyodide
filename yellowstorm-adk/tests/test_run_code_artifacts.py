import json

from src.smart_rag.run_code_artifacts import build_run_code_artifacts, build_tool_result_artifacts


def _agent_config() -> dict:
    return {
        "agent_params": {
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


def test_builds_artifact_from_code_interpreter_send_file_result() -> None:
    artifacts = build_tool_result_artifacts({
        "ceph_path": "owner/system_run/report.pdf",
        "path": "/home/ubuntu/report.pdf",
        "mime_type": "application/pdf",
        "size": 123,
    }, "tool-shell", "owner/system_run")

    assert len(artifacts) == 1
    artifact = {**artifacts[0], "artifact_id": "ignored"}
    assert artifact == {
        "file_path": "owner/system_run/report.pdf",
        "filename": "report.pdf",
        "artifact_kind": "document",
        "mime_type": "application/pdf",
        "artifact_id": "ignored",
        "producer_tool_id": "tool-shell",
        "size_bytes": 123,
        "availability": "ready",
        "output_port_id": "",
    }


def test_builds_artifact_from_json_encoded_send_file_result() -> None:
    artifacts = build_tool_result_artifacts({
        "result": json.dumps({
            "path": "/home/ubuntu/ai_two_sentences.pdf",
            "ceph_path": "owner/system_run/ai_two_sentences.pdf",
            "relative_path": "artifacts/main/ai_two_sentences.pdf",
        }),
        "text": "File sent",
    }, "tool-send", "owner/system_run")

    assert len(artifacts) == 1
    assert artifacts[0]["file_path"] == "owner/system_run/ai_two_sentences.pdf"
    assert artifacts[0]["filename"] == "ai_two_sentences.pdf"


def test_rejects_tool_artifact_outside_trusted_run_prefix() -> None:
    assert build_tool_result_artifacts({
        "ceph_path": "another-user/system_run/private.pdf",
        "path": "/home/ubuntu/private.pdf",
    }, "tool-shell", "owner/system_run") == []


def test_trusted_publication_receipt_is_required_and_idempotent():
    result={"ceph_path":"owner/system_run/report.docx", "filename":"report.docx",
        "_conversation_output_receipt":{"storagePrefix":"owner/system_run","invocationId":"turn"}}
    def capture(value, name="code-interpreort-aga_send_file_to_user", prefix="owner/system_run"):
        return build_tool_result_artifacts(value,"producer",prefix,require_receipt=True,producer_tool_name=name)
    first=capture(result)
    assert len(first)==1 and first==capture(result)
    assert not capture({"ceph_path":"owner/system_run/report.docx"})
    assert not capture(result,name="web_search")
    assert not capture(result,prefix="other/system_run")
    assert not capture({**result,"isError":True})
    assert not capture({**result,"ceph_path":"owner/system_run/../private.docx"})
    other={**result,"_conversation_output_receipt":{**result["_conversation_output_receipt"],"invocationId":"other-turn"}}
    assert capture(other)[0]["artifact_id"] != first[0]["artifact_id"]


def test_registered_shared_workspace_output_uses_only_exact_canonical_path():
    result={"ceph_path":"workspace-owner/shared/report.docx","filename":"report.docx",
        "_conversation_output_receipt":{"storagePrefix":"actor/system_c1","invocationId":"turn",
            "artifactId":"canonical-doc-id","storagePath":"workspace-owner/shared/report.docx"}}
    def capture(value):
        return build_tool_result_artifacts(value,"producer","actor/system_c1",require_receipt=True,
            producer_tool_name="code-interpreort-aga_send_file_to_user")
    assert capture(result)[0]["artifact_id"]=="canonical-doc-id"
    assert not capture({**result,"ceph_path":"workspace-owner/shared/other.docx"})
    assert not capture({**result,"ceph_path":"actor/system_c1/other.docx"})
    assert not capture({"result":json.dumps({**result,"status":"error"}),"_conversation_output_receipt":result["_conversation_output_receipt"]})
