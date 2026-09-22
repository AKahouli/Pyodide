from __future__ import annotations

import sys

import pytest

import app.datasource.parser_sandbox as sandbox

SOURCE = {
    "workspaceId": "6512f0a1c9e77a001234aaa1",
    "assetId": "6512f0a1c9e77a001234bbb2",
    "mimeType": "text/csv",
    "sizeBytes": 16,
    "contentHash": "0123456789abcdef0123456789abcdef",
    "uploadedAt": "2026-09-20T12:00:00.000Z",
    "indexingStatus": "ready",
}


def test_parser_runs_in_sanitized_subprocess(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DATABASE_URL", "must-not-reach-parser")
    result = sandbox.run_preview_subprocess(SOURCE, None, b"id,name\n001,Ada\n")
    assert result["profile"]["samples"][0] == {"__sheetRow": 2, "id": "001", "name": "Ada"}
    assert result["fieldProfiles"][0]["name"] == "id"


def test_parser_timeout_terminates_child(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SEMANTIC_PARSER_TIMEOUT_SECONDS", "1")
    monkeypatch.setattr(
        sandbox, "_parser_command",
        lambda: [sys.executable, "-c", "import time; time.sleep(10)"],
    )
    with pytest.raises(ValueError, match="parser_timeout"):
        sandbox.run_preview_subprocess(SOURCE, None, b"id\n1\n")


def test_parser_result_is_stopped_at_cap(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(sandbox, "MAX_RESULT_BYTES", 100)
    monkeypatch.setattr(
        sandbox, "_parser_command",
        lambda: [sys.executable, "-c", "import sys; sys.stdout.write('x' * 101)"],
    )
    with pytest.raises(ValueError, match="parser_result_too_large"):
        sandbox.run_preview_subprocess(SOURCE, None, b"id\n1\n")


def test_bootstrap_failure_remains_infrastructure(monkeypatch: pytest.MonkeyPatch):
    command = ("import sys; sys.stdout.write(" 
               "'{\"ok\":false,\"infrastructureError\":\"parser_bootstrap_failed\"}'); sys.exit(3)")
    monkeypatch.setattr(sandbox, "_parser_command", lambda: [sys.executable, "-c", command])
    with pytest.raises(RuntimeError, match="parser_bootstrap_failed"):
        sandbox.run_preview_subprocess(SOURCE, None, b"id\n1\n")


def test_unexpected_child_failure_remains_infrastructure(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        sandbox, "_parser_command",
        lambda: [sys.executable, "-c", "import sys; sys.stdout.write('not-json'); sys.exit(1)"],
    )
    with pytest.raises(RuntimeError, match="parser_runtime_failed"):
        sandbox.run_preview_subprocess(SOURCE, None, b"id\n1\n")


def test_invalid_temp_root_fails_before_start(monkeypatch: pytest.MonkeyPatch, tmp_path):
    monkeypatch.setenv("SEMANTIC_TASK_TEMP_DIR", str(tmp_path / "missing"))
    with pytest.raises(RuntimeError, match="semantic_task_temp_dir_unavailable"):
        sandbox.run_preview_subprocess(SOURCE, None, b"id\n1\n")
