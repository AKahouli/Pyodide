import mimetypes
import posixpath
import uuid
from typing import Any

from src.infrastructure.run_code.context import parse_run_code_context


def build_run_code_artifacts(
    result: Any,
    agent_config: dict[str, Any] | None,
    producer_tool_id: str,
) -> list[dict[str, Any]]:
    if not isinstance(result, dict) or not isinstance(result.get("written_files"), list):
        return []
    params = agent_config.get("agent_params", {}).get("params", {}) if agent_config else {}
    context = parse_run_code_context(params)
    if context is None:
        return []
    writable = next((mount for mount in context.mounts if mount.mode == "rw"), None)
    if writable is None:
        return []

    artifacts: list[dict[str, Any]] = []
    for item in result["written_files"]:
        if not isinstance(item, dict):
            continue
        logical_path = item.get("path")
        filename = item.get("name")
        if not isinstance(logical_path, str) or not isinstance(filename, str):
            continue
        normalized = posixpath.normpath(logical_path)
        if not normalized.startswith("/workspace/run/") or posixpath.basename(normalized) != filename:
            continue
        relative = normalized.removeprefix("/workspace/run/")
        if not relative or relative.startswith("../"):
            continue
        artifacts.append({
            "file_path": f"{writable.cephPrefix.rstrip('/')}/{relative}",
            "filename": filename,
            "artifact_kind": "document",
            "mime_type": item.get("contentType") or mimetypes.guess_type(filename)[0] or "application/octet-stream",
            "artifact_id": str(uuid.uuid4()),
            "producer_tool_id": producer_tool_id,
            "size_bytes": item.get("sizeBytes") if isinstance(item.get("sizeBytes"), int) else 0,
            "availability": "ready",
            "output_port_id": "",
        })
    return artifacts
