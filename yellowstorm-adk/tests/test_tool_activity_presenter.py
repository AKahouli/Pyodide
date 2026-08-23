import json

from src.smart_rag.tool_activity_presenter import present_tool_call, serialize_tool_value


def test_presents_known_tools_with_safe_invocation_purpose() -> None:
    run_code = present_tool_call("run_code", {"description": "Compare selected files", "code": "return 1"})
    search = present_tool_call("perform_document_search", {"query": "FY26 revenue forecast"})

    assert (run_code.display_key, run_code.render_kind, run_code.summary) == (
        "runCode", "run_code", "Compare selected files"
    )
    assert (search.display_key, search.render_kind, search.summary) == (
        "searchKnowledge", "search", "FY26 revenue forecast"
    )


def test_unknown_tools_do_not_use_arbitrary_string_arguments() -> None:
    presentation = present_tool_call("custom_tool", {"payload": "private arbitrary value"})
    assert presentation.fallback_display_name == "Custom Tool"
    assert presentation.summary == ""


def test_summaries_hide_code_paths_storage_keys_and_attachment_sentinels() -> None:
    assert present_tool_call("run_code", {"description": "const secret = token;"}).summary == ""
    assert present_tool_call("run_code", {"description": "Read /tmp/private/customer.csv"}).summary == ""
    assert present_tool_call("custom_tool", {"description": "users/12345678/runs/run-1/private.json"}).summary == ""
    assert present_tool_call("custom_tool", {"description": "YELLOWSTORM_ATTACHMENT_SENTINEL_42"}).summary == ""
    assert present_tool_call("custom_tool", {"description": "file=/tmp/private/customer.csv"}).summary == ""
    assert present_tool_call("custom_tool", {"description": "path=C:\\private\\customer.csv"}).summary == ""
    assert present_tool_call("custom_tool", {"description": "uri=s3://private-bucket/customer.csv"}).summary == ""


def test_file_tools_show_only_a_safe_filename() -> None:
    read = present_tool_call("read_file", {"path": "/tmp/private/customer.csv"})
    write = present_tool_call("write_file", {"file_path": "users/12345678/runs/run-1/report.pdf"})

    assert read.summary == "customer.csv"
    assert write.summary == "report.pdf"


def test_serialization_redacts_secrets_and_physical_paths_but_preserves_code() -> None:
    encoded = serialize_tool_value({
        "authorization": "Bearer private",
        "code": "const source = '/workspace/run/report.json';\nreturn source;",
        "result": "users/12345678/runs/run-1/private.json",
    })
    decoded = json.loads(encoded)
    assert decoded["authorization"] == "[REDACTED]"
    assert "/workspace/run/report.json" in decoded["code"]
    assert "12345678" not in decoded["result"]


def test_serialization_bounds_oversized_values() -> None:
    encoded = serialize_tool_value({"value": "x" * (64 * 1024)})
    assert len(encoded.encode("utf-8")) <= 64 * 1024
    assert "[truncated]" in encoded
