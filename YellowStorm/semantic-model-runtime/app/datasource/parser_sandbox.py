"""Killable subprocess boundary for untrusted tabular parser inputs."""

from __future__ import annotations

import json
import os
import signal
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import shutil
from typing import Any

from .discovery import is_email_archive, max_source_bytes
from .extraction_limits import EXTRACTION_LIMITS

MAX_RESULT_BYTES = 10 * 1024 * 1024
_STOP_GRACE_SECONDS = 2


class ParserStopped(RuntimeError):
    """The parser was asked to stop from outside (lease lost or run cancelled);
    its process tree was terminated and nothing it wrote may be used. Never a
    deterministic content failure: the run may still be retried fresh."""


# What an admin's run limits change in the parser child: e-mails per archive, archive size, what is read of
# each mail and attachment, memory, time.
READ_LIMIT_VARIABLES = {"maxArchiveEmails": "SEMANTIC_EMAIL_MAX_ARCHIVE_EMAILS",
                        "maxArchiveMb": "SEMANTIC_EMAIL_MAX_ARCHIVE_MB",
                        **{key: spec.env for key, spec in EXTRACTION_LIMITS.items()}}
ARCHIVE_LIMIT_VARIABLES = {**READ_LIMIT_VARIABLES,
                           "parserMemoryMb": "SEMANTIC_PARSER_MEMORY_MB",
                           "archiveTimeoutSeconds": "SEMANTIC_EMAIL_PARSER_TIMEOUT_SECONDS"}


def limit_environment(limits: dict[str, Any] | None) -> dict[str, str]:
    """The environment variables a run's limits set, for the parser child and its bounds."""
    return {variable: str(limits[key]) for key, variable in ARCHIVE_LIMIT_VARIABLES.items()
            if limits and isinstance(limits.get(key), int)}


def parser_timeout_seconds(email_archive: bool = False, environment: dict[str, str] | None = None) -> int:
    """Seconds a parse may run. Reading a whole e-mail archive gets its own, larger budget."""
    env = {**os.environ, **(environment or {})}
    if email_archive:
        try:
            value = int(env.get("SEMANTIC_EMAIL_PARSER_TIMEOUT_SECONDS", "900"))
        except ValueError:
            return 900
        return value if 1 <= value <= 7200 else 900
    try:
        value = int(os.environ.get("SEMANTIC_PARSER_TIMEOUT_SECONDS", "30"))
    except ValueError:
        return 30
    return value if 1 <= value <= 300 else 30


def _parser_command() -> list[str]:
    return [sys.executable, "-m", "app.datasource.parser_worker"]


def _child_environment(email_archive: bool = False, limits: dict[str, str] | None = None) -> dict[str, str]:
    allowed = {"PATH", "PYTHONPATH", "PYTHONHOME", "SYSTEMROOT", "WINDIR",
               "TEMP", "TMP", "LANG", "LC_ALL"}
    configured = {**os.environ, **(limits or {})}
    environment = {key: value for key, value in os.environ.items() if key in allowed}
    environment["SEMANTIC_PARSER_MEMORY_MB"] = configured.get("SEMANTIC_PARSER_MEMORY_MB", "512")
    environment["SEMANTIC_PARSER_TIMEOUT_SECONDS"] = str(parser_timeout_seconds(email_archive, limits))
    for variable in READ_LIMIT_VARIABLES.values():
        if variable in configured:
            environment[variable] = configured[variable]
    return environment


def _stop_process(process: subprocess.Popen[Any]) -> None:
    """Terminate the child and its whole process tree, bounded, then hard-kill.

    ``asyncio.to_thread`` cancellation never reaches an OS child, so every
    caller that abandons a parse goes through here and waits for confirmed
    exit before its temporary files are released or reused."""
    if os.name == "nt":
        # taskkill /T ends the tree; terminate() alone could leave grandchildren.
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                       capture_output=True, timeout=_STOP_GRACE_SECONDS)
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)  # the child started its own group
        except (ProcessLookupError, PermissionError):
            process.terminate()
    try:
        process.wait(timeout=_STOP_GRACE_SECONDS)
    except subprocess.TimeoutExpired:
        if os.name != "nt":
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
        process.kill()
        process.wait(timeout=_STOP_GRACE_SECONDS)


def _cleanup_temp(directory: Path) -> None:
    """Remove a parse's temporary directory, tolerating the Windows race where a
    just-killed child's inherited handles clear slightly after ``wait()``."""
    for attempt in range(6):
        try:
            shutil.rmtree(directory)
            return
        except PermissionError:
            if attempt == 5:
                shutil.rmtree(directory, ignore_errors=True)
                return
            time.sleep(0.1)
        except FileNotFoundError:
            return


def run_preview_subprocess(source: dict[str, Any], options: dict[str, Any] | None,
                           data: bytes | Path, *,
                           stop_event: threading.Event | None = None) -> dict[str, Any]:
    """Run ``preview_source`` outside the Celery process and kill on timeout."""
    return _run_subprocess("preview", source, options, data, stop_event=stop_event)


def prepare_dataset_subprocess(source: dict[str, Any], options: dict[str, Any] | None,
                               data: bytes | Path, output: Path, *,
                               limits: dict[str, Any] | None = None,
                               stop_event: threading.Event | None = None) -> dict[str, Any]:
    result = _run_subprocess("prepare", source, options, data, output, limits=limits,
                             stop_event=stop_event)
    return result


def prepare_email_tables_subprocess(source: dict[str, Any], data: bytes | Path, output_dir: Path, *,
                                    limits: dict[str, Any] | None = None,
                                    stop_event: threading.Event | None = None) -> dict[str, dict[str, Any]]:
    """The three tables of an e-mail archive from one read, as ``<sheet>.parquet`` in ``output_dir``;
    returns each table's shape (``rowCount``, ``columns``, ``sizeBytes``, ``contentHash``, ``path``)."""
    result = _run_subprocess("prepare_tables", source, None, data, output_dir, limits=limits,
                             stop_event=stop_event)
    tables = result.get("tables")
    if not isinstance(tables, dict):
        raise RuntimeError("parser_runtime_failed")
    return {sheet: {**table, "path": output_dir / str(table.get("file"))} for sheet, table in tables.items()}


def derive_files_subprocess(source: dict[str, Any], data: bytes | Path, output_dir: Path, *,
                            limits: dict[str, Any] | None = None,
                            stop_event: threading.Event | None = None) -> list[dict[str, Any]]:
    """Message texts and readable attachments of an e-mail archive, written into ``output_dir``."""
    result = _run_subprocess("derive", source, None, data, output_dir, limits=limits,
                             stop_event=stop_event)
    files = result.get("files")
    if files is None and isinstance(result.get("manifest"), str):
        from .parser_worker import DERIVED_MANIFEST

        manifest = output_dir / DERIVED_MANIFEST
        try:
            files = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise RuntimeError("parser_runtime_failed") from exc
        manifest.unlink(missing_ok=True)
    if not isinstance(files, list):
        raise RuntimeError("parser_runtime_failed")
    return files


def _run_subprocess(operation: str, source: dict[str, Any], options: dict[str, Any] | None,
                    data: bytes | Path, artifact_target: Path | None = None, *,
                    limits: dict[str, Any] | None = None,
                    stop_event: threading.Event | None = None) -> dict[str, Any]:
    """``data`` is the source bytes, or a file already on disk (large e-mail archives). ``limits``
    are the run's (an admin's), applied to this parse."""
    # Only a full read of an e-mail archive needs the long budget; its preview stops after a few hundred e-mails.
    email_archive = is_email_archive(source.get("mimeType")) and operation in ("prepare", "derive", "prepare_tables")
    limit_env = limit_environment(limits)
    size = data.stat().st_size if isinstance(data, Path) else len(data)
    if size > max_source_bytes(source.get("mimeType"), limit_env.get("SEMANTIC_EMAIL_MAX_ARCHIVE_MB")):
        raise ValueError("source_too_large")
    root = Path(__file__).resolve().parents[2]
    configured_temp = os.environ.get("SEMANTIC_TASK_TEMP_DIR")
    temp_parent = Path(configured_temp).resolve() if configured_temp else None
    if temp_parent is not None and not temp_parent.is_dir():
        raise RuntimeError("semantic_task_temp_dir_unavailable")
    work = Path(tempfile.mkdtemp(prefix="semantic-parser-", dir=temp_parent))
    try:
        source_path = work / "source.bin"
        request_path = work / "request.json"
        result_path = work / "result.json"
        artifact_path = work / ("derived" if operation == "derive" else "tables" if operation == "prepare_tables"
                                else "dataset.parquet")
        if isinstance(data, Path):
            try:
                os.link(data, source_path)
            except OSError:
                shutil.copyfile(data, source_path)
        else:
            source_path.write_bytes(data)
        request_path.write_text(json.dumps({"operation": operation, "source": source,
                                            "options": options}), encoding="utf-8")
        deadline = time.monotonic() + parser_timeout_seconds(email_archive, limit_env)
        stopped = ""
        with result_path.open("wb") as output_file:
            process = subprocess.Popen(
                [*_parser_command(), str(request_path), str(source_path), str(artifact_path)],
                cwd=root, env=_child_environment(email_archive, limit_env), stdin=subprocess.DEVNULL,
                stdout=output_file, stderr=subprocess.DEVNULL,
                # Its own process group on POSIX, so a stop ends the whole tree.
                start_new_session=(os.name == "posix"),
            )
            try:
                while process.poll() is None:
                    if stop_event is not None and stop_event.is_set():
                        stopped = "parser_stopped"
                        break
                    if result_path.stat().st_size > MAX_RESULT_BYTES:
                        stopped = "parser_result_too_large"
                        break
                    if time.monotonic() >= deadline:
                        stopped = "parser_timeout"
                        break
                    time.sleep(0.02)
            except BaseException:
                # Never leave a child behind, whatever unwinds (a lease loss
                # raises through this frame too).
                if process.poll() is None:
                    _stop_process(process)
                raise
            if stopped:
                _stop_process(process)
        # Raised after the output handle is closed, so nothing holds the
        # temporary directory when the attempt unwinds.
        if stopped == "parser_stopped":
            raise ParserStopped("parser_stopped")
        if stopped == "parser_result_too_large":
            raise ValueError("parser_result_too_large")
        if stopped == "parser_timeout":
            raise ValueError("parser_timeout")
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
        if operation in ("derive", "prepare_tables"):
            if artifact_target is None or not artifact_path.is_dir():
                raise ValueError("derivation_failed" if operation == "derive" else "dataset_preparation_failed")
            artifact_target.mkdir(parents=True, exist_ok=True)
            for item in artifact_path.iterdir():
                shutil.move(str(item), artifact_target / item.name)
        if operation == "prepare":
            if artifact_target is None or not artifact_path.is_file():
                raise ValueError("dataset_preparation_failed")
            artifact_target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(artifact_path), artifact_target)
        return result
    finally:
        _cleanup_temp(work)
