from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class StepToolScope:
    workspace_context: list[dict[str, Any]]
    file_names: list[str]
    documents_by_port: dict[str, list[str]]
    code_interpreter_files: list[dict[str, str]]
    workspace_context_mode: str
    mounted_filenames: list[str]
    # Ceph workspace paths ("user_id/workspace_name") that must be mounted into the
    # sandbox VM. Derived from wired input documents' workspacePath plus any
    # playbook-level __playbook_workspace_paths present in the input context.
    workspace_ceph_paths: list[str]


def build_step_tool_scope(
    input_context: dict[str, Any],
    metadata: dict[str, Any],
) -> StepToolScope:
    workspace_context = _normalize_workspace_context(metadata.get("brain_context"))
    documents_by_port: dict[str, list[str]] = {}
    file_names: list[str] = []
    code_interpreter_files: list[dict[str, str]] = []
    mounted_filenames: list[str] = []
    workspace_ceph_paths: list[str] = []
    seen_ceph_paths: set[str] = set()
    seen_doc_ids: set[str] = set()
    seen_files: set[tuple[str, str]] = set()
    seen_names: set[str] = set()
    has_port_sources = False

    def _add_ceph_path(raw: Any) -> None:
        path = str(raw or "").strip().strip("/")
        # The mount script requires "user_id/workspace_name"; skip anything that
        # is not a real two-segment Ceph path (e.g. bare names or empty values).
        if "/" not in path or path in seen_ceph_paths:
            return
        seen_ceph_paths.add(path)
        workspace_ceph_paths.append(path)

    # Playbook-level workspace paths: dict {workspace_id: "user_id/workspace_name"}.
    playbook_paths = input_context.get("__playbook_workspace_paths")
    if isinstance(playbook_paths, dict):
        for value in playbook_paths.values():
            _add_ceph_path(value)

    for port_id, port_value in input_context.items():
        if str(port_id).startswith("__"):
            continue

        refs = _extract_file_refs(port_value)
        if not refs:
            continue
        has_port_sources = True

        port_doc_ids: list[str] = []
        port_seen_doc_ids: set[str] = set()
        for ref in refs:
            ref = _hydrate_file_ref(ref, workspace_context)
            _add_ceph_path(ref.get("workspace_path"))
            document_id = ref.get("document_id", "")
            file_name = ref.get("file_name") or ref.get("filename", "")
            search_file_name = file_name or document_id
            if search_file_name:
                port_key = document_id or search_file_name
                if port_key not in port_seen_doc_ids:
                    port_doc_ids.append(search_file_name)
                    port_seen_doc_ids.add(port_key)
                if search_file_name and search_file_name not in seen_doc_ids:
                    file_names.append(search_file_name)
                    seen_doc_ids.add(search_file_name)

            filename = ref.get("filename", "")
            filepath = ref.get("filepath", "")
            file_identity = document_id or filepath
            file_key = (file_identity, filepath)
            if filename and filepath and file_key not in seen_files:
                code_interpreter_files.append(ref)
                seen_files.add(file_key)
                if filename not in seen_names:
                    mounted_filenames.append(filename)
                    seen_names.add(filename)

        if port_doc_ids:
            documents_by_port[str(port_id)] = port_doc_ids

    workspace_context_mode = "resolved_inputs_only"
    if not has_port_sources and workspace_context:
        workspace_context_mode = "fallback_playbook"

    return StepToolScope(
        workspace_context=[] if has_port_sources else workspace_context,
        file_names=file_names,
        documents_by_port=documents_by_port,
        code_interpreter_files=code_interpreter_files,
        workspace_context_mode=workspace_context_mode,
        mounted_filenames=mounted_filenames,
        workspace_ceph_paths=workspace_ceph_paths,
    )


def build_sandbox_prompt_note(
    tool_scope: StepToolScope,
    tool_names: set[str],
) -> str:
    if "code interpreter" not in tool_names or not tool_scope.mounted_filenames:
        return ""

    filenames = ", ".join(tool_scope.mounted_filenames)
    return (
        "Python sandbox files are mounted by these exact local filenames only: "
        f"{filenames}. Use those exact filenames in code. Do not use internal IDs, "
        "blob paths, or metadata storage filenames as local file paths."
    )


def build_prompt_input_context(input_context: dict[str, Any]) -> dict[str, Any]:
    sanitized = _sanitize_for_prompt(input_context)
    return sanitized if isinstance(sanitized, dict) else {}


def _normalize_workspace_context(raw_context: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_context, list):
        return []

    normalized: list[dict[str, Any]] = []
    for workspace in raw_context:
        if not isinstance(workspace, dict):
            continue

        workspace_id = str(workspace.get("workspace_id") or "").strip()
        workspace_name = str(
            workspace.get("workspace_name") or workspace_id
        ).strip()
        raw_documents = workspace.get("documents")
        if not isinstance(raw_documents, list):
            raw_documents = workspace.get("workspace_documents")
        if not isinstance(raw_documents, list):
            raw_documents = []

        documents: list[dict[str, Any]] = []
        for document in raw_documents:
            if not isinstance(document, dict):
                continue
            filename = _display_filename(document)
            filepath = _storage_filepath(document)
            if not filename or not filepath:
                continue
            documents.append(
                {
                    "id": _document_id(document),
                    "_id": _document_id(document),
                    "filename": filename,
                    "file_name": _file_name(document) or filename,
                    "filepath": filepath,
                    "workspace_id": str(
                        document.get("workspace_id") or workspace_id
                    ).strip(),
                    "workspace_name": str(
                        document.get("workspace_name") or workspace_name
                    ).strip(),
                }
            )

        normalized.append(
            {
                "workspace_id": workspace_id,
                "workspace_name": workspace_name,
                "documents": documents,
            }
        )

    return normalized


def _sanitize_for_prompt(value: Any) -> Any:
    if isinstance(value, dict):
        sanitized = {key: _sanitize_for_prompt(item) for key, item in value.items()}
        display_name = _display_filename(sanitized)
        metadata = sanitized.get("metadata")
        if display_name and isinstance(metadata, dict):
            storage_filename = str(metadata.get("filename") or "").strip()
            if storage_filename and storage_filename != display_name:
                metadata["filename"] = display_name
        return sanitized

    if isinstance(value, list):
        return [_sanitize_for_prompt(item) for item in value]

    return value


def _extract_file_refs(value: Any) -> list[dict[str, str]]:
    refs: list[dict[str, str]] = []
    _walk_value(value, refs)
    return refs


def _walk_value(value: Any, refs: list[dict[str, str]]) -> None:
    if isinstance(value, dict):
        ref = _file_ref_from_dict(value)
        if ref is not None:
            refs.append(ref)
        for child in value.values():
            _walk_value(child, refs)
        return

    if isinstance(value, list):
        for item in value:
            _walk_value(item, refs)


def _file_ref_from_dict(value: dict[str, Any]) -> dict[str, str] | None:
    filepath = _storage_filepath(value)
    filename = _display_filename(value)
    document_id = _document_id(value)
    if not document_id and not filepath:
        return None

    return {
        "document_id": document_id,
        "filename": filename,
        "file_name": _file_name(value) or filename,
        "filepath": filepath,
        "workspace_id": _workspace_id(value),
        "workspace_name": _workspace_name(value),
        "workspace_path": _workspace_path(value),
    }


def _hydrate_file_ref(
    ref: dict[str, str],
    workspace_context: list[dict[str, Any]],
) -> dict[str, str]:
    if ref.get("filepath") and ref.get("filename"):
        return ref

    document_id = ref.get("document_id", "")
    if not document_id:
        return ref

    for workspace in workspace_context:
        for document in workspace.get("documents", []):
            candidate_id = str(
                document.get("document_id")
                or document.get("id")
                or document.get("_id")
                or ""
            ).strip()
            if candidate_id != document_id:
                continue

            return {
                "document_id": document_id,
                "filename": str(document.get("filename") or "").strip() or ref.get("filename") or "",
                "file_name": str(document.get("file_name") or document.get("filename") or "").strip() or ref.get("file_name") or ref.get("filename") or "",
                "filepath": ref.get("filepath") or str(document.get("filepath") or "").strip(),
                "workspace_id": ref.get("workspace_id") or str(document.get("workspace_id") or workspace.get("workspace_id") or "").strip(),
                "workspace_name": ref.get("workspace_name") or str(document.get("workspace_name") or workspace.get("workspace_name") or "").strip(),
                "workspace_path": ref.get("workspace_path") or _workspace_path(document),
            }

    return ref


def _storage_filepath(value: dict[str, Any]) -> str:
    metadata = value.get("metadata") if isinstance(value.get("metadata"), dict) else {}
    for candidate in (
        value.get("filepath"),
        value.get("file_path"),
        value.get("path"),
        metadata.get("filepath"),
        metadata.get("file_path"),
        metadata.get("path"),
    ):
        normalized = str(candidate or "").strip()
        if normalized:
            return normalized
    return ""


def _display_filename(value: dict[str, Any]) -> str:
    metadata = value.get("metadata") if isinstance(value.get("metadata"), dict) else {}
    for candidate in (
        value.get("name"),
        value.get("originalName"),
        metadata.get("originalName"),
        metadata.get("name"),
        value.get("filename"),
    ):
        normalized = str(candidate or "").strip()
        if normalized:
            return normalized

    filepath = _storage_filepath(value)
    return Path(filepath).name if filepath else ""


def _file_name(value: dict[str, Any]) -> str:
    metadata = value.get("metadata") if isinstance(value.get("metadata"), dict) else {}
    for candidate in (
        value.get("file_name"),
        value.get("fileName"),
        metadata.get("file_name"),
        metadata.get("fileName"),
        value.get("filename"),
        metadata.get("filename"),
    ):
        normalized = str(candidate or "").strip()
        if normalized:
            return normalized
    filepath = _storage_filepath(value)
    return Path(filepath).name if filepath else ""


def _document_id(value: dict[str, Any]) -> str:
    metadata = value.get("metadata") if isinstance(value.get("metadata"), dict) else {}
    for candidate in (
        value.get("document_id"),
        value.get("documentId"),
        metadata.get("document_id"),
        metadata.get("documentId"),
        value.get("external_id"),
        value.get("externalId"),
        value.get("id"),
        value.get("_id"),
        metadata.get("id"),
        metadata.get("_id"),
    ):
        normalized = str(candidate or "").strip()
        if normalized:
            return normalized
    return ""


def _workspace_path(value: dict[str, Any]) -> str:
    """Resolve the Ceph workspace directory ("user_id/workspace_name") for a document.

    Prefers the explicit ``workspacePath`` field provided by the backend; otherwise
    falls back to the directory portion of the document's storage path.
    """
    metadata = value.get("metadata") if isinstance(value.get("metadata"), dict) else {}
    for candidate in (
        value.get("workspacePath"),
        value.get("workspace_path"),
        metadata.get("workspacePath"),
        metadata.get("workspace_path"),
    ):
        normalized = str(candidate or "").strip().strip("/")
        if normalized:
            return normalized

    # Fallback: strip the filename off the storage path ("uid/name/file" -> "uid/name").
    for candidate in (value.get("path"), _storage_filepath(value)):
        normalized = str(candidate or "").strip().strip("/")
        if "/" in normalized:
            return normalized.rsplit("/", 1)[0]
    return ""


def _workspace_id(value: dict[str, Any]) -> str:
    metadata = value.get("metadata") if isinstance(value.get("metadata"), dict) else {}
    for candidate in (
        value.get("workspace_id"),
        value.get("workspaceId"),
        metadata.get("workspace_id"),
        metadata.get("workspaceId"),
    ):
        normalized = str(candidate or "").strip()
        if normalized:
            return normalized
    return ""


def _workspace_name(value: dict[str, Any]) -> str:
    metadata = value.get("metadata") if isinstance(value.get("metadata"), dict) else {}
    for candidate in (
        value.get("workspace_name"),
        value.get("workspaceName"),
        metadata.get("workspace_name"),
        metadata.get("workspaceName"),
        _workspace_id(value),
    ):
        normalized = str(candidate or "").strip()
        if normalized:
            return normalized
    return ""
