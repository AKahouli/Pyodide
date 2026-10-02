"""Killable subprocess boundary for untrusted tabular parser inputs."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import shutil
from typing import Any

from .discovery import is_email_archive, max_source_bytes

MAX_RESULT_BYTES = 10 * 1024 * 1024


def parser_timeout_seconds(email_archive: bool = False) -> int:
    """Seconds a parse may run. Reading a whole e-mail archive gets its own, larger budget."""
    if email_archive:
        try:
            value = int(os.environ.get("SEMANTIC_EMAIL_PARSER_TIMEOUT_SECONDS", "900"))
        except ValueError:
            return 900
        return value if 1 <= value <= 3600 else 900
    try:
        value = int(os.environ.get("SEMANTIC_PARSER_TIMEOUT_SECONDS", "30"))
    except ValueError:
        return 30
    return value if 1 <= value <= 300 else 30


def _parser_command() -> list[str]:
    return [sys.executable, "-m", "app.datasource.parser_worker"]


def _child_environment(email_archive: bool = False) -> dict[str, str]:
    allowed = {"PATH", "PYTHONPATH", "PYTHONHOME", "SYSTEMROOT", "WINDIR",
               "TEMP", "TMP", "LANG", "LC_ALL"}
    environment = {key: value for key, value in os.environ.items() if key in allowed}
    environment["SEMANTIC_PARSER_MEMORY_MB"] = os.environ.get("SEMANTIC_PARSER_MEMORY_MB", "512")
    environment["SEMANTIC_PARSER_TIMEOUT_SECONDS"] = str(parser_timeout_seconds(email_archive))
    return environment


def _stop_process(process: subprocess.Popen[Any]) -> None:
    process.terminate()
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=2)


def run_preview_subprocess(source: dict[str, Any], options: dict[str, Any] | None,
                           data: bytes | Path) -> dict[str, Any]:
    """Run ``preview_source`` outside the Celery process and kill on timeout."""
    return _run_subprocess("preview", source, options, data)


def prepare_dataset_subprocess(source: dict[str, Any], options: dict[str, Any] | None,
                               data: bytes | Path, output: Path) -> dict[str, Any]:
    result = _run_subprocess("prepare", source, options, data, output)
    return result


def derive_files_subprocess(source: dict[str, Any], data: bytes | Path, output_dir: Path) -> list[dict[str, Any]]:
    """Message texts and readable attachments of an e-mail archive, written into ``output_dir``."""
    result = _run_subprocess("derive", source, None, data, output_dir)
    files = result.get("files")
    if not isinstance(files, list):
        raise RuntimeError("parser_runtime_failed")
    return files


def _run_subprocess(operation: str, source: dict[str, Any], options: dict[str, Any] | None,
                    data: bytes | Path, artifact_target: Path | None = None) -> dict[str, Any]:
    """``data`` is the source bytes, or a file already on disk (large e-mail archives)."""
    # Only a full read of an e-mail archive needs the long budget; its preview stops after a few hundred e-mails.
    email_archive = is_email_archive(source.get("mimeType")) and operation in ("prepare", "derive")
    size = data.stat().st_size if isinstance(data, Path) else len(data)
    if size > max_source_bytes(source.get("mimeType")):
        raise ValueError("source_too_large")
    root = Path(__file__).resolve().parents[2]
    configured_temp = os.environ.get("SEMANTIC_TASK_TEMP_DIR")
    temp_parent = Path(configured_temp).resolve() if configured_temp else None
    if temp_parent is not None and not temp_parent.is_dir():
        raise RuntimeError("semantic_task_temp_dir_unavailable")
    with tempfile.TemporaryDirectory(prefix="semantic-parser-", dir=temp_parent) as directory:
        work = Path(directory)
        source_path = work / "source.bin"
        request_path = work / "request.json"
        result_path = work / "result.json"
        artifact_path = work / ("derived" if operation == "derive" else "dataset.parquet")
        if isinstance(data, Path):
            try:
                os.link(data, source_path)
            except OSError:
                shutil.copyfile(data, source_path)
        else:
            source_path.write_bytes(data)
        request_path.write_text(json.dumps({"operation": operation, "source": source,
                                            "options": options}), encoding="utf-8")
        deadline = time.monotonic() + parser_timeout_seconds(email_archive)
        with result_path.open("wb") as output_file:
            process = subprocess.Popen(
                [*_parser_command(), str(request_path), str(source_path), str(artifact_path)],
                cwd=root, env=_child_environment(email_archive), stdin=subprocess.DEVNULL,
                stdout=output_file, stderr=subprocess.DEVNULL,
            )
            while process.poll() is None:
                if result_path.stat().st_size > MAX_RESULT_BYTES:
                    _stop_process(process)
                    raise ValueError("parser_result_too_large")
                if time.monotonic() >= deadline:
                    _stop_process(process)
                    raise ValueError("parser_timeout")
                time.sleep(0.02)
        if result_path.stat().st_size > MAX_RESULT_BYTES:
            raise ValueError("parser_result_too_large")
        output = result_path.read_bytes()
        try:
            envelope = json.loads(output)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("parser_runtime_failed") from exc
        if isinstance(envelope, dict) and isinstance(envelope.get("infrastructureError"), str):
            raise RuntimeError(envelope["infrastructureError"])
        code = envelope.get("errorCode") if isinstance(envelope, dict) else None
        if isinstance(code, str) and code:
            raise ValueError(code)
        if process.returncode != 0 or not isinstance(envelope, dict) or envelope.get("ok") is not True:
            raise RuntimeError("parser_runtime_failed")
        result = envelope.get("result")
        if not isinstance(result, dict):
            raise RuntimeError("parser_runtime_failed")
        if operation == "derive":
            if artifact_target is None or not artifact_path.is_dir():
                raise ValueError("derivation_failed")
            artifact_target.mkdir(parents=True, exist_ok=True)
            for item in artifact_path.iterdir():
                shutil.move(str(item), artifact_target / item.name)
        if operation == "prepare":
            if artifact_target is None or not artifact_path.is_file():
                raise ValueError("dataset_preparation_failed")
            artifact_target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(artifact_path), artifact_target)
        return result
