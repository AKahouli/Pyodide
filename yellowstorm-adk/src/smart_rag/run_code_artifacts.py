import mimetypes
import posixpath
import uuid
from typing import Any

from src.infrastructure.run_code.context import parse_run_code_context


def _artifact_kind(filename: str, mime_type: str) -> str:
    if mime_type.startswith("image/"):
        return "image"
    if filename.lower().endswith((".csv", ".json", ".xlsx", ".xls")):
        return "data"
    return "document"


def build_tool_result_artifacts(
    result: Any,
    producer_tool_id: str,
    trusted_storage_prefix: str,
) -> list[dict[str, Any]]:
    """Project storage-backed MCP file results into conversation artifacts."""
    if not isinstance(result, dict):
        return []
    generated_files = result.get("generated_files")
    entries = [item for item in generated_files if isinstance(item, dict)] if isinstance(generated_files, list) else []
    if not entries and any(result.get(key) for key in ("ceph_path", "object_key", "azure_path")):
        entries = [result]

    artifacts: list[dict[str, Any]] = []
    seen_paths: set[str] = set()
    for item in entries:
        storage_path = next((item.get(key) for key in ("ceph_path", "object_key", "azure_path") if isinstance(item.get(key), str) and item.get(key).strip()), "")
        normalized_path = posixpath.normpath(storage_path).lstrip("/") if storage_path else ""
        normalized_prefix = posixpath.normpath(trusted_storage_prefix).strip("/")
        if (
            not normalized_path
            or not normalized_prefix
            or not normalized_path.startswith(f"{normalized_prefix}/")
            or normalized_path in seen_paths
        ):
            continue
        seen_paths.add(normalized_path)
        raw_filename = next((item.get(key) for key in ("filename", "name", "path") if isinstance(item.get(key), str) and item.get(key).strip()), storage_path)
        filename = raw_filename.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]
        if not filename:
            continue
        mime_type = next((item.get(key) for key in ("mime_type", "mimeType", "content_type") if isinstance(item.get(key), str) and item.get(key)), "")
        mime_type = mime_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        size = next((item.get(key) for key in ("size_bytes", "sizeBytes", "size") if isinstance(item.get(key), int) and item.get(key) >= 0), 0)
        artifacts.append({
            "file_path": normalized_path,
            "filename": filename,
            "artifact_kind": _artifact_kind(filename, mime_type),
            "mime_type": mime_type,
            "artifact_id": str(uuid.uuid4()),
            "producer_tool_id": producer_tool_id,
            "size_bytes": size,
            "availability": "ready",
            "output_port_id": "",
        })
    return artifacts


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
