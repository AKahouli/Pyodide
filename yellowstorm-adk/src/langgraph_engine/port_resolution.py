"""Shared port resolution helpers for LangGraph execution."""

from __future__ import annotations

import json
from copy import deepcopy
from typing import Any, Dict, Iterable, List, Optional

from structlog import get_logger

logger = get_logger(__name__)


def load_prompt_registry(prompt_overrides: Optional[Dict[str, str]]) -> Dict[str, Dict[str, Any]]:
    registry: Dict[str, Dict[str, Any]] = {}
    for key, value in (prompt_overrides or {}).items():
        if not key:
            continue
        if isinstance(value, dict):
            registry[key] = value
            continue
        if not value:
            continue
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                registry[key] = parsed
                continue
        except Exception:
            pass
        registry[key] = {"systemTemplate": str(value)}
    return registry


def resolve_prompt_template(
    prompt_registry: Optional[Dict[str, Dict[str, Any]]],
    key: str,
    *,
    field: str = "systemTemplate",
    fallback: str = "",
) -> str:
    entry = (prompt_registry or {}).get(key) or {}
    value = str(entry.get(field) or "").strip()
    return value or fallback

_DOCUMENT_EXTENSION_PRIORITY = {
    ".pdf": 100,
    ".docx": 95,
    ".pptx": 90,
    ".xlsx": 85,
    ".doc": 80,
    ".ppt": 75,
    ".xls": 70,
    ".rtf": 60,
    ".md": 40,
    ".html": 35,
    ".json": 20,
    ".csv": 15,
    ".tsv": 14,
    ".xml": 12,
    ".txt": 1,
}


def _as_list(value: Any) -> List[Any]:
    if isinstance(value, list):
        return value
    if value is None:
        return []
    return [value]


def _unique_strings(values: Iterable[Any]) -> List[str]:
    result: List[str] = []
    seen = set()
    for value in values:
        text = str(value).strip()
        if text and text not in seen:
            result.append(text)
            seen.add(text)
    return result


def _resolve_document_metadata(
    document_id: str,
    *,
    workspace_context: List[Dict[str, Any]],
    brain_documents: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    for workspace in workspace_context:
        for doc in workspace.get("documents", []):
            if str(doc.get("id") or doc.get("_id") or "").strip() == document_id:
                return {
                    "document_id": document_id,
                    "filename": str(doc.get("filename") or "").strip(),
                    "filepath": str(doc.get("filepath") or "").strip(),
                    "workspace_id": str(doc.get("workspace_id") or workspace.get("workspace_id") or "").strip(),
                }

    for doc in brain_documents:
        if str(doc.get("_id") or doc.get("id") or "").strip() == document_id:
            return {
                "document_id": document_id,
                "filename": str(doc.get("filename") or "").strip(),
                "filepath": str(doc.get("filepath") or "").strip(),
                "workspace_id": str(doc.get("workspace_id") or "").strip(),
            }

    return None


def _port_map(port_defs: Optional[List[Dict[str, Any]]]) -> Dict[str, Dict[str, Any]]:
    result: Dict[str, Dict[str, Any]] = {}
    for port in port_defs or []:
        if not isinstance(port, dict) or not port.get("id"):
            continue
        port_id = str(port.get("id")).strip()
        if not port_id:
            continue
        result[port_id] = port
        result.setdefault(_normalize_port_id(port_id), port)
    return result


def _artifact_list(value: Any) -> List[Dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        return [value]
    return []


def _normalize_port_id(value: Any) -> str:
    raw = str(value or "default").strip() or "default"
    if raw.startswith("in-") or raw.startswith("out-"):
        return raw.split("-", 1)[1] or "default"
    return raw


def _artifact_kind(artifact: Dict[str, Any]) -> str:
    return str(
        artifact.get("artifact_kind")
        or artifact.get("artifactKind")
        or artifact.get("kind")
        or artifact.get("type")
        or "text"
    )


def _artifact_filename(artifact: Dict[str, Any]) -> str:
    return str(
        artifact.get("filename")
        or artifact.get("name")
        or artifact.get("url")
        or artifact.get("filepath")
        or ""
    ).strip()


def _document_artifact_score(artifact: Dict[str, Any]) -> int:
    filename = _artifact_filename(artifact).lower()
    for extension, score in _DOCUMENT_EXTENSION_PRIORITY.items():
        if filename.endswith(extension):
            return score
    return 10


def _sort_artifacts_for_port(artifacts: List[Dict[str, Any]], expected_kind: str) -> List[Dict[str, Any]]:
    if expected_kind != "document":
        return list(artifacts)

    return sorted(
        artifacts,
        key=lambda artifact: (
            0 if _artifact_kind(artifact) == "document" else 1,
            -_document_artifact_score(artifact),
            _artifact_filename(artifact).lower(),
        ),
    )


def _select_artifact(artifacts: List[Dict[str, Any]], expected_kind: str) -> Optional[Dict[str, Any]]:
    if not artifacts:
        return None

    expected_kind = str(expected_kind or "").strip()
    if expected_kind:
        for artifact in artifacts:
            if _artifact_kind(artifact) == expected_kind:
                return artifact

    return artifacts[0]


def _artifact_content(artifact: Dict[str, Any]) -> str:
    for key in ("content", "output", "text", "value"):
        value = artifact.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return str(artifact.get("content") or artifact.get("output") or "")


def _is_sandbox_local_path(path: str) -> bool:
    normalized = str(path or "").strip().lower()
    return normalized.startswith("/box/") or normalized.startswith("sandbox:/box/")


def _artifact_file_ref(artifact: Dict[str, Any], port_id: str) -> Optional[Dict[str, Any]]:
    filepath = str(
        artifact.get("filepath")
        or artifact.get("file_path")
        or artifact.get("url")
        or ""
    ).strip()
    filename = str(artifact.get("filename") or artifact.get("name") or "").strip()
    if not filepath or not filename:
        return None
    if _is_sandbox_local_path(filepath):
        return None

    return {
        "document_id": str(artifact.get("document_id") or artifact.get("id") or "").strip(),
        "filename": filename,
        "filepath": filepath,
        "workspace_id": str(artifact.get("workspace_id") or artifact.get("brain_id") or "").strip(),
        "port_id": port_id,
    }


def _find_input_bindings(edges: List[Dict[str, Any]], task_id: str, port_id: str) -> List[Dict[str, Any]]:
    return [
        edge for edge in edges
        if edge.get("target_id") == task_id and _normalize_port_id(edge.get("target_input_port_id")) == _normalize_port_id(port_id)
    ]


def validate_port_routing(tasks: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> None:
    """Validate that edges reference existing tasks and ports."""

    tasks_by_id = {str(task.get("id")): task for task in tasks if isinstance(task, dict) and task.get("id")}

    for edge in edges or []:
        if not isinstance(edge, dict):
            continue

        target_id = str(edge.get("target_id") or "").strip()
        source_id = str(edge.get("source_id") or "").strip()
        if not target_id:
            raise ValueError("Encountered edge without a target task id")
        if not source_id:
            raise ValueError(f"Task '{target_id}' has an edge without a source task id")

        target_task = tasks_by_id.get(target_id)
        if target_task is None:
            raise ValueError(f"Task '{target_id}' is referenced by an edge but is not defined")

        source_task = tasks_by_id.get(source_id)
        if source_task is None:
            raise ValueError(f"Task '{target_id}' references unknown source task '{source_id}'")

        target_ports = _port_map(target_task.get("input_ports") or [])
        target_port_id = _normalize_port_id(edge.get("target_input_port_id"))
        if target_ports and target_port_id not in target_ports:
            raise ValueError(
                f"Task '{target_id}' references unknown input port '{target_port_id}'"
            )

        source_ports = _port_map(source_task.get("output_ports") or [])
        source_port_id = _normalize_port_id(edge.get("source_output_port_id"))
        if source_ports and source_port_id not in source_ports:
            raise ValueError(
                f"Task '{target_id}' references unknown source output port '{source_port_id}' on task '{source_id}'"
            )

def resolve_task_inputs(
    task_id: str,
    task_config: Dict[str, Any],
    state: Dict[str, Any],
) -> Dict[str, Any]:
    """Resolve the effective inputs for a task execution.

    The returned structure is intentionally generic so prompt builders and tool
    factories can consume the same normalized model.
    """

    task_id = str(task_id)
    input_ports = _port_map(task_config.get("input_ports") or [])
    edges = state.get("edges") or []
    artifacts_by_port = state.get("artifacts_by_port") or {}
    task_results = state.get("results") or {}
    workspace_context = list(state.get("workspace_context") or [])
    brain_documents = list(state.get("brain_documents") or [])

    port_ids = list(input_ports.keys())
    for port_binding in task_config.get("input_files_by_port") or []:
        if isinstance(port_binding, dict):
            port_id = _normalize_port_id(port_binding.get("port_id"))
            if port_id not in port_ids:
                port_ids.append(port_id)

    if not port_ids:
        has_incoming_edges = any(
            isinstance(edge, dict) and str(edge.get("target_id") or "") == task_id
            for edge in edges
        )
        if has_incoming_edges or task_config.get("input_files_by_port"):
            port_ids = ["default"]

    resolved_ports: Dict[str, Dict[str, Any]] = {}
    has_port_sources = False

    for port_id in port_ids:
        input_port = deepcopy(input_ports.get(port_id) or {"id": port_id, "name": port_id})
        bindings = _find_input_bindings(edges, task_id, port_id)
        upstream_bindings: List[Dict[str, Any]] = []
        workspace_artifacts: List[Dict[str, Any]] = []
        resolved_documents: List[Dict[str, Any]] = []
        staged_files: List[Dict[str, Any]] = []

        expected_kind = str(input_port.get("artifact_kind") or "").strip()

        for binding in bindings:
            source_task_id = str(binding.get("source_id") or "")
            source_output_port_id = _normalize_port_id(binding.get("source_output_port_id"))
            artifact_key = f"{source_task_id}:{source_output_port_id}"
            artifacts = _artifact_list(artifacts_by_port.get(artifact_key))

            if not artifacts and expected_kind in {"", "text", "code"}:
                fallback_result = task_results.get(source_task_id) or {}
                fallback_output = fallback_result.get("output")
                if isinstance(fallback_output, str) and fallback_output.strip():
                    artifacts = [{
                        "artifact_kind": "text",
                        "content": fallback_output,
                        "source_task_id": source_task_id,
                        "source_output_port_id": source_output_port_id,
                    }]

            if not artifacts:
                raise ValueError(
                    f"Task '{task_id}' input port '{port_id}' expects upstream source '{source_task_id}:{source_output_port_id}' but no artifact was produced"
                )

            artifacts = _sort_artifacts_for_port(artifacts, expected_kind)
            selected_artifact = _select_artifact(artifacts, expected_kind)
            actual_kind = _artifact_kind(selected_artifact) if selected_artifact else ""
            if expected_kind and actual_kind and expected_kind != actual_kind:
                raise ValueError(
                    f"Task '{task_id}' input port '{port_id}' expects artifact kind '{expected_kind}' but received '{actual_kind}'"
                )

            upstream_bindings.append({
                "source_task_id": source_task_id,
                "source_output_port_id": source_output_port_id,
                "artifact_kind": actual_kind,
                "artifacts": artifacts,
            })
            has_port_sources = True

            for artifact in artifacts:
                artifact_kind = _artifact_kind(artifact)
                if artifact_kind in {"text", "code"}:
                    continue
                workspace_artifacts.append(artifact)
                file_ref = _artifact_file_ref(artifact, port_id)
                if file_ref is not None:
                    staged_files.append(file_ref)

        upstream_binding = upstream_bindings[0] if upstream_bindings else None

        document_bindings = []
        for port_binding in task_config.get("input_files_by_port") or []:
            if not isinstance(port_binding, dict):
                continue
            binding_port_id = str(port_binding.get("port_id") or "default").strip() or "default"
            if binding_port_id != port_id:
                continue
            document_ids = _unique_strings(port_binding.get("document_ids") or [])
            if document_ids:
                has_port_sources = True
            document_bindings.extend(document_ids)
            for document_id in document_ids:
                metadata = _resolve_document_metadata(
                    document_id,
                    workspace_context=workspace_context,
                    brain_documents=brain_documents,
                )
                if metadata is None:
                    continue
                if not metadata.get("filename") or not metadata.get("filepath"):
                    raise ValueError(
                        f"Task '{task_id}' input port '{port_id}' references document '{document_id}' without resolvable filename/filepath"
                    )
                resolved_documents.append(metadata)

        document_bindings = _unique_strings(document_bindings)
        resolved_ports[port_id] = {
            "input_port": input_port,
            "upstream_binding": upstream_binding,
            "upstream_bindings": upstream_bindings,
            "document_bindings": {
                "document_ids": document_bindings,
            },
            "resolved_documents": resolved_documents,
            "staged_files": staged_files,
            "workspace_artifacts": workspace_artifacts,
        }

    fallback_workspace_context = [] if has_port_sources else list(workspace_context)

    return {
        "task_id": task_id,
        "ports": resolved_ports,
        "playbook_workspace_context": list(workspace_context),
        "fallback_workspace_context": fallback_workspace_context,
        "workspace_context_mode": "fallback_playbook" if fallback_workspace_context else "resolved_inputs_only",
        "has_port_sources": has_port_sources,
    }


def build_tool_scope(resolved_inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Derive a normalized tool scope from resolved inputs."""

    all_document_ids: List[str] = []
    documents_by_port: Dict[str, List[str]] = {}
    files_by_port: Dict[str, List[Dict[str, Any]]] = {}
    all_files: List[Dict[str, Any]] = []
    fallback_files: List[Dict[str, Any]] = []

    for port_id, port_state in (resolved_inputs.get("ports") or {}).items():
        document_ids = _unique_strings((port_state.get("document_bindings") or {}).get("document_ids") or [])
        resolved_documents = list(port_state.get("resolved_documents") or [])
        staged_files = list(port_state.get("staged_files") or [])
        documents_by_port[port_id] = document_ids
        files_by_port[port_id] = [*resolved_documents, *staged_files]
        all_document_ids.extend(document_ids)
        all_files.extend(resolved_documents)
        all_files.extend(staged_files)

    for workspace in resolved_inputs.get("fallback_workspace_context") or []:
        for doc in workspace.get("documents", []):
            filepath = str(doc.get("filepath") or "").strip()
            filename = str(doc.get("filename") or "").strip()
            if not filepath or not filename:
                continue
            fallback_files.append({
                "document_id": str(doc.get("id") or doc.get("_id") or "").strip(),
                "filename": filename,
                "filepath": filepath,
                "workspace_id": str(doc.get("workspace_id") or workspace.get("workspace_id") or "").strip(),
            })

    return {
        "all_document_ids": _unique_strings(all_document_ids),
        "documents_by_port": documents_by_port,
        "files_by_port": files_by_port,
        "all_files": all_files,
        "fallback_files": fallback_files,
        "workspace_context_mode": resolved_inputs.get("workspace_context_mode", "resolved_inputs_only"),
        "fallback_workspace_context": list(resolved_inputs.get("fallback_workspace_context") or []),
    }


def select_output_workspace_id(resolved_inputs: Dict[str, Any]) -> str:
    playbook_workspace_context = list(resolved_inputs.get("playbook_workspace_context") or [])
    if playbook_workspace_context:
        workspace_id = str(playbook_workspace_context[0].get("workspace_id") or "").strip()
        if workspace_id:
            return workspace_id
    return ""


def format_workspace_file_hint(workspace_context: Optional[list], max_files: int = 12) -> str:
    filenames: List[str] = []
    seen = set()
    for workspace in workspace_context or []:
        for doc in workspace.get("documents", []):
            filename = str(doc.get("filename", "")).strip()
            if filename and filename not in seen:
                filenames.append(filename)
                seen.add(filename)

    if not filenames:
        return ""

    visible = filenames[:max_files]
    suffix = ""
    if len(filenames) > max_files:
        suffix = f" (+{len(filenames) - max_files} more)"
    return ", ".join(visible) + suffix


def build_task_prompt(
    task_config: Dict[str, Any],
    resolved_inputs: Dict[str, Any],
    *,
    context_from_dependencies: str = "",
    user_query: str = "",
    workspace_file_hint: str = "",
    prompt_overrides: Optional[Dict[str, str]] = None,
) -> str:
    """Build a consistent task prompt from resolved inputs."""

    prompt_registry = load_prompt_registry(prompt_overrides)

    lines = [
        f"Task: {task_config.get('title', '')}\n\nDescription:\n{task_config.get('description', '')}",
    ]

    ports = resolved_inputs.get("ports") or {}
    output_ports = list(task_config.get("output_ports") or [])
    structured_blocks: List[str] = []

    for port_id, port_state in ports.items():
        input_port = port_state.get("input_port") or {}
        upstream_bindings = list(port_state.get("upstream_bindings") or ([] if not port_state.get("upstream_binding") else [port_state.get("upstream_binding")]))
        document_ids = (port_state.get("document_bindings") or {}).get("document_ids") or []
        workspace_artifacts = port_state.get("workspace_artifacts") or []

        block_lines = [f"Input port: {input_port.get('name') or port_id}"]
        artifact_kind = input_port.get("artifact_kind")
        if artifact_kind:
            block_lines.append(f"Expected type: {artifact_kind}")

        if upstream_bindings:
            for upstream_binding in upstream_bindings:
                block_lines.append(
                    f"Upstream source: {upstream_binding.get('source_task_id', '')}.{upstream_binding.get('source_output_port_id', '')}"
                )
                artifacts = upstream_binding.get("artifacts") or []
                for artifact in artifacts:
                    kind = _artifact_kind(artifact)
                    if kind in {"text", "code"}:
                        block_lines.append("Content:\n" + _artifact_content(artifact))
                    else:
                        artifact_name = artifact.get("filename") or artifact.get("name") or artifact.get("url") or artifact.get("filepath") or "artifact"
                        if _is_sandbox_local_path(str(artifact_name)):
                            artifact_name = artifact.get("filename") or artifact.get("name") or "artifact"
                        block_lines.append(f"Artifact: {artifact_name}")
        else:
            block_lines.append("Upstream source: none")

        if document_ids:
            block_lines.append(f"Bound documents: {len(document_ids)}")
            block_lines.append(f"Document IDs: {', '.join(document_ids[:6])}{'...' if len(document_ids) > 6 else ''}")

        if workspace_artifacts:
            block_lines.append(f"Workspace artifacts: {len(workspace_artifacts)}")

        structured_blocks.append("\n".join(block_lines))

    if structured_blocks:
        lines.append("Structured inputs for this task:\n\n" + "\n\n".join(structured_blocks))

    if output_ports:
        output_lines = []
        output_ports_intro = resolve_prompt_template(
            prompt_registry,
            'task.output_ports.note',
            field='userTemplate',
            fallback='Declared output ports are semantic targets. When multiple ports share a kind, use the port name and description to decide the right target. If you produce structured outputs, set `output_port_id` to a declared id.',
        )
        for output_port in output_ports:
            port_id = str(output_port.get("id") or "default").strip() or "default"
            port_name = str(output_port.get("name") or port_id).strip() or port_id
            port_kind = str(output_port.get("artifact_kind") or "").strip()
            description = str(output_port.get("description") or "").strip()
            output_lines.append(f"- `{port_id}` ({port_kind or 'unknown'}): {port_name}")
            if description:
                output_lines.append(f"  Description: {description}")

        lines.append(
            "Declared output ports:\n"
            + "\n".join(output_lines)
            + f"\n\n{output_ports_intro}"
        )

    if not resolved_inputs.get("has_port_sources"):
        lines.append(
            "No port-bound inputs were resolved. You may use the default playbook workspace context selected for this playbook."
        )

    if context_from_dependencies:
        lines.append(f"Context from previous tasks:\n{context_from_dependencies}")

    if user_query:
        lines.append(f"User query: {user_query}")

    if workspace_file_hint:
        lines.append(
            "Workspace files already available in the sandbox:\n"
            f"{workspace_file_hint}\n"
            "Do not ask the user to upload these files again."
        )

    lines.append(
        resolve_prompt_template(
            prompt_registry,
            'task.user.footer',
            field='userTemplate',
            fallback='Please complete this task and provide a clear output.',
        )
    )
    return "\n\n".join(lines)
