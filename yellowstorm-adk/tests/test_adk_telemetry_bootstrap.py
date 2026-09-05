"""Regression tests for process-wide ADK telemetry configuration."""

import ast
from pathlib import Path


def test_main_disables_adk_message_content_capture_before_application_imports():
    tree = ast.parse(Path("main.py").read_text(encoding="utf-8"))
    standard_library = {"asyncio", "contextlib", "importlib", "os"}
    assignment = next(
        node
        for node in tree.body
        if isinstance(node, ast.Assign)
        and isinstance(node.targets[0], ast.Subscript)
        and ast.unparse(node.targets[0])
        == "os.environ['ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS']"
    )
    runtime_import_lines = []
    for node in tree.body:
        if isinstance(node, ast.Import):
            roots = {alias.name.split(".", 1)[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            roots = {node.module.split(".", 1)[0]}
        else:
            continue
        if roots - standard_library:
            runtime_import_lines.append(node.lineno)

    assert isinstance(assignment.value, ast.Constant)
    assert assignment.value.value == "false"
    assert assignment.lineno < min(runtime_import_lines)


def test_adk_legacy_spans_omit_message_content(monkeypatch):
    from google.adk.telemetry.context import TelemetryConfig

    monkeypatch.setenv("ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS", "false")

    assert TelemetryConfig().should_add_content_to_legacy_spans is False
