"""Shared port resolution helpers for LangGraph execution."""

from __future__ import annotations

import json
from copy import deepcopy
from typing import Any, Dict, Iterable, List, Optional

from structlog import get_logger

logger = get_logger(__name__)


def _fmt_participant(p: Any) -> str:
    if not p or not isinstance(p, dict):
        return ""
    name = p.get("name")
    addr = p.get("address", "")
    return f"{name} <{addr}>" if name else addr


def load_prompt_registry(
    prompt_overrides: Optional[Dict[str, str]],
) -> Dict[str, Dict[str, Any]]:
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
                    "workspace_id": str(
                        doc.get("workspace_id") or workspace.get("workspace_id") or ""
                    ).strip(),
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


def _sort_artifacts_for_port(
    artifacts: List[Dict[str, Any]], expected_kind: str
) -> List[Dict[str, Any]]:
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


def _select_artifact(
    artifacts: List[Dict[str, Any]], expected_kind: str
) -> Optional[Dict[str, Any]]:
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


def _artifact_prompt_payload(artifact: Dict[str, Any]) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "artifact_kind": _artifact_kind(artifact),
    }

    for source_key, target_key in (
        ("source_task_id", "source_task_id"),
        ("source_output_port_id", "source_output_port_id"),
        ("document_id", "document_id"),
        ("filename", "filename"),
        ("name", "name"),
        ("filepath", "filepath"),
        ("file_path", "file_path"),
        ("url", "url"),
        ("mime_type", "mime_type"),
    ):
        value = artifact.get(source_key)
        if value not in (None, "", []):
            payload[target_key] = value

    kind = payload["artifact_kind"]
    if kind == "data" and artifact.get("data") is not None:
        payload["data"] = artifact.get("data")
    elif kind in {"text", "code"}:
        content = _artifact_content(artifact)
        if content:
            payload["content"] = content
    else:
        content = _artifact_content(artifact)
        if content:
            payload["content"] = content

    return payload


def _is_sandbox_local_path(path: str) -> bool:
    normalized = str(path or "").strip().lower()
    return normalized.startswith("/box/") or normalized.startswith("sandbox:/box/")


def _artifact_file_ref(
    artifact: Dict[str, Any], port_id: str
) -> Optional[Dict[str, Any]]:
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
        "document_id": str(
            artifact.get("document_id") or artifact.get("id") or ""
        ).strip(),
        "filename": filename,
        "filepath": filepath,
        "workspace_id": str(
            artifact.get("workspace_id") or artifact.get("brain_id") or ""
        ).strip(),
        "port_id": port_id,
    }


def _find_input_bindings(
    edges: List[Dict[str, Any]], task_id: str, port_id: str
) -> List[Dict[str, Any]]:
    return [
        edge
        for edge in edges
        if (edge.get("target_id") or edge.get("targetId")) == task_id
        and _normalize_port_id(
            edge.get("target_input_port_id") or edge.get("targetInputPortId")
        )
        == _normalize_port_id(port_id)
    ]


def _infer_mail_trigger_binding(
    task_config: Dict[str, Any],
    port_id: str,
    input_port: Dict[str, Any],
    trigger_context: Optional[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    if not isinstance(trigger_context, dict) or trigger_context.get("type") != "mail":
        return []

    artifact_kind = str(input_port.get("artifact_kind") or "").strip()
    trigger_port_id = ""
    if artifact_kind == "data":
        trigger_port_id = "mail_data"
    elif artifact_kind == "document":
        trigger_port_id = "mail_attachments"

    if not trigger_port_id:
        return []
    if not _trigger_artifacts_for_port(trigger_context, trigger_port_id):
        return []

    input_ports = [
        port
        for port in (task_config.get("input_ports") or [])
        if isinstance(port, dict)
    ]
    compatible_ports = [
        port
        for port in input_ports
        if str(port.get("artifact_kind") or "").strip() == artifact_kind
    ]
    if len(compatible_ports) != 1:
        return []
    if _normalize_port_id(compatible_ports[0].get("id")) != _normalize_port_id(port_id):
        return []

    logger.warning(
        "Inferring missing mail trigger binding from trigger context",
        task_id=str(task_config.get("id") or ""),
        port_id=port_id,
        inferred_source_port_id=trigger_port_id,
    )
    return [
        {
            "source_id": "__trigger__",
            "target_id": str(task_config.get("id") or ""),
            "source_output_port_id": trigger_port_id,
            "target_input_port_id": port_id,
        }
    ]


def _trigger_port_map(
    trigger_context: Optional[Dict[str, Any]],
) -> Dict[str, Dict[str, Any]]:
    ports = (trigger_context or {}).get("ports") or {}
    return {
        str(port_id): port_value
        for port_id, port_value in ports.items()
        if isinstance(port_id, str) and isinstance(port_value, dict)
    }


def _trigger_artifacts_for_port(
    trigger_context: Optional[Dict[str, Any]],
    port_id: str,
) -> List[Dict[str, Any]]:
    port_map = _trigger_port_map(trigger_context)
    port_value = port_map.get(str(port_id)) or {}
    kind = str(port_value.get("kind") or "").strip()

    if kind == "data":
        value = port_value.get("value")
        if value is None:
            return []
        return [
            {
                "artifact_kind": "data",
                "content": json.dumps(value, ensure_ascii=True, indent=2),
                "data": value,
                "source_task_id": "__trigger__",
                "source_output_port_id": port_id,
            }
        ]

    if kind == "document":
        document_ids = _unique_strings(port_value.get("documentIds") or [])
        explicit_documents = [
            item
            for item in (port_value.get("documents") or [])
            if isinstance(item, dict)
        ]
        explicit_artifacts = []
        for item in explicit_documents:
            document_id = str(
                item.get("documentId") or item.get("document_id") or ""
            ).strip()
            if not document_id:
                continue
            artifact = {
                "artifact_kind": "document",
                "document_id": document_id,
                "source_task_id": "__trigger__",
                "source_output_port_id": port_id,
            }
            filename = str(item.get("filename") or item.get("name") or "").strip()
            filepath = str(item.get("filepath") or item.get("file_path") or "").strip()
            workspace_id = str(
                item.get("workspaceId") or item.get("workspace_id") or ""
            ).strip()
            mime_type = str(item.get("mimeType") or item.get("mime_type") or "").strip()
            if filename:
                artifact["filename"] = filename
            if filepath:
                artifact["filepath"] = filepath
            if workspace_id:
                artifact["workspace_id"] = workspace_id
            if mime_type:
                artifact["mime_type"] = mime_type
            explicit_artifacts.append(artifact)

        if explicit_artifacts:
            return explicit_artifacts

        return [
            {
                "artifact_kind": "document",
                "document_id": document_id,
                "source_task_id": "__trigger__",
                "source_output_port_id": port_id,
            }
            for document_id in document_ids
        ]

    return []


def validate_port_routing(
    tasks: List[Dict[str, Any]], edges: List[Dict[str, Any]]
) -> None:
    """Validate that edges reference existing tasks and ports."""

    tasks_by_id = {
        str(task.get("id")): task
        for task in tasks
        if isinstance(task, dict) and task.get("id")
    }
    trigger_port_ids = set(_trigger_port_map(None).keys())
    trigger_port_ids.update({"mail_data", "mail_attachments"})

    for edge in edges or []:
        if not isinstance(edge, dict):
            continue

        target_id = str(edge.get("target_id") or edge.get("targetId") or "").strip()
        source_id = str(edge.get("source_id") or edge.get("sourceId") or "").strip()
        if not target_id:
            raise ValueError("Encountered edge without a target task id")
        if not source_id:
            raise ValueError(f"Task '{target_id}' has an edge without a source task id")

        target_task = tasks_by_id.get(target_id)
        if target_task is None:
            raise ValueError(
                f"Task '{target_id}' is referenced by an edge but is not defined"
            )

        source_task = tasks_by_id.get(source_id)
        if source_task is None and source_id != "__trigger__":
            raise ValueError(
                f"Task '{target_id}' references unknown source task '{source_id}'"
            )

        target_ports = _port_map(target_task.get("input_ports") or [])
        target_port_id = _normalize_port_id(
            edge.get("target_input_port_id") or edge.get("targetInputPortId")
        )
        if target_ports and target_port_id not in target_ports:
            raise ValueError(
                f"Task '{target_id}' references unknown input port '{target_port_id}'"
            )

        source_port_id = _normalize_port_id(
            edge.get("source_output_port_id") or edge.get("sourceOutputPortId")
        )
        if source_id == "__trigger__":
            if source_port_id not in trigger_port_ids:
                raise ValueError(
                    f"Task '{target_id}' references unknown trigger output port '{source_port_id}'"
                )
        else:
            source_ports = _port_map(source_task.get("output_ports") or [])
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
    node_inputs_by_port = state.get("node_inputs_by_port") or {}
    task_results = state.get("results") or {}
    workspace_context = list(state.get("workspace_context") or [])
    brain_documents = list(state.get("brain_documents") or [])
    trigger_context = state.get("trigger_context") or {}

    port_ids = list(input_ports.keys())
    for port_binding in task_config.get("input_files_by_port") or []:
        if isinstance(port_binding, dict):
            port_id = _normalize_port_id(port_binding.get("port_id"))
            if port_id not in port_ids:
                port_ids.append(port_id)

    if not port_ids:
        has_incoming_edges = any(
            isinstance(edge, dict)
            and str(edge.get("target_id") or edge.get("targetId") or "") == task_id
            for edge in edges
        )
        if has_incoming_edges or task_config.get("input_files_by_port"):
            port_ids = ["default"]

    resolved_ports: Dict[str, Dict[str, Any]] = {}
    has_port_sources = False

    for port_id in port_ids:
        input_port = deepcopy(
            input_ports.get(port_id) or {"id": port_id, "name": port_id}
        )
        bindings = _find_input_bindings(edges, task_id, port_id)
        if not bindings:
            bindings = _infer_mail_trigger_binding(
                task_config,
                port_id,
                input_port,
                trigger_context,
            )
        upstream_bindings: List[Dict[str, Any]] = []
        workspace_artifacts: List[Dict[str, Any]] = []
        resolved_documents: List[Dict[str, Any]] = []
        staged_files: List[Dict[str, Any]] = []

        expected_kind = str(input_port.get("artifact_kind") or "").strip()

        for binding in bindings:
            source_task_id = str(
                binding.get("source_id") or binding.get("sourceId") or ""
            )
            source_output_port_id = _normalize_port_id(
                binding.get("source_output_port_id")
                or binding.get("sourceOutputPortId")
            )
            if source_task_id == "__trigger__":
                artifacts = _trigger_artifacts_for_port(
                    trigger_context, source_output_port_id
                )
                if not artifacts:
                    # No trigger context available (e.g. manual execution) or
                    # the requested port has no data — skip silently.
                    logger.info(
                        "Trigger port binding skipped: no data for port",
                        task_id=task_id,
                        port_id=port_id,
                        source_port=source_output_port_id,
                        has_trigger_context=bool(trigger_context),
                        trigger_ports=list(
                            (trigger_context or {}).get("ports", {}).keys()
                        ),
                    )
                    continue
            else:
                artifacts = [
                    artifact
                    for artifact in _artifact_list(node_inputs_by_port.get(port_id))
                    if str(artifact.get("source_task_id") or "").strip() == source_task_id
                    and _normalize_port_id(
                        artifact.get("source_output_port_id")
                        or artifact.get("source_port_id")
                    )
                    == source_output_port_id
                ]
                if not artifacts:
                    artifact_key = f"{source_task_id}:{source_output_port_id}"
                    artifacts = _artifact_list(artifacts_by_port.get(artifact_key))

            if not artifacts and expected_kind in {"", "text", "code"}:
                fallback_result = task_results.get(source_task_id) or {}
                fallback_output = fallback_result.get("output")
                if isinstance(fallback_output, str) and fallback_output.strip():
                    artifacts = [
                        {
                            "artifact_kind": "text",
                            "content": fallback_output,
                            "source_task_id": source_task_id,
                            "source_output_port_id": source_output_port_id,
                        }
                    ]

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

            upstream_bindings.append(
                {
                    "source_task_id": source_task_id,
                    "source_output_port_id": source_output_port_id,
                    "artifact_kind": actual_kind,
                    "artifacts": artifacts,
                }
            )
            has_port_sources = True

            for artifact in artifacts:
                artifact_kind = _artifact_kind(artifact)
                if artifact_kind in {"text", "code"}:
                    continue
                if artifact_kind == "document":
                    document_id = str(artifact.get("document_id") or "").strip()
                    if document_id:
                        has_port_sources = True
                        metadata = _resolve_document_metadata(
                            document_id,
                            workspace_context=workspace_context,
                            brain_documents=brain_documents,
                        )
                        if metadata is not None:
                            resolved_documents.append(metadata)
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
            binding_port_id = (
                str(port_binding.get("port_id") or "default").strip() or "default"
            )
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

    resolved_inputs = {
        "task_id": task_id,
        "ports": resolved_ports,
        "playbook_workspace_context": list(workspace_context),
        "fallback_workspace_context": fallback_workspace_context,
        "workspace_context_mode": "fallback_playbook"
        if fallback_workspace_context
        else "resolved_inputs_only",
        "has_port_sources": has_port_sources,
    }

    return resolved_inputs


def build_tool_scope(resolved_inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Derive a normalized tool scope from resolved inputs."""

    all_document_ids: List[str] = []
    documents_by_port: Dict[str, List[str]] = {}
    files_by_port: Dict[str, List[Dict[str, Any]]] = {}
    all_files: List[Dict[str, Any]] = []
    fallback_files: List[Dict[str, Any]] = []

    for port_id, port_state in (resolved_inputs.get("ports") or {}).items():
        resolved_documents = list(port_state.get("resolved_documents") or [])
        staged_files = list(port_state.get("staged_files") or [])
        document_ids = _unique_strings(
            [
                *(
                    (port_state.get("document_bindings") or {}).get("document_ids")
                    or []
                ),
                *[
                    doc.get("document_id")
                    for doc in resolved_documents
                    if isinstance(doc, dict) and doc.get("document_id")
                ],
                *[
                    file_ref.get("document_id")
                    for file_ref in staged_files
                    if isinstance(file_ref, dict) and file_ref.get("document_id")
                ],
            ]
        )
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
            fallback_files.append(
                {
                    "document_id": str(doc.get("id") or doc.get("_id") or "").strip(),
                    "filename": filename,
                    "filepath": filepath,
                    "workspace_id": str(
                        doc.get("workspace_id") or workspace.get("workspace_id") or ""
                    ).strip(),
                }
            )

    return {
        "all_document_ids": _unique_strings(all_document_ids),
        "documents_by_port": documents_by_port,
        "files_by_port": files_by_port,
        "all_files": all_files,
        "fallback_files": fallback_files,
        "workspace_context_mode": resolved_inputs.get(
            "workspace_context_mode", "resolved_inputs_only"
        ),
        "fallback_workspace_context": list(
            resolved_inputs.get("fallback_workspace_context") or []
        ),
    }


def select_output_workspace_id(resolved_inputs: Dict[str, Any]) -> str:
    playbook_workspace_context = list(
        resolved_inputs.get("playbook_workspace_context") or []
    )
    if playbook_workspace_context:
        workspace_id = str(
            playbook_workspace_context[0].get("workspace_id") or ""
        ).strip()
        if workspace_id:
            return workspace_id
    return ""


def format_workspace_file_hint(
    workspace_context: Optional[list], max_files: int = 12
) -> str:
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


def task_has_trigger_port_inputs(resolved_inputs: Dict[str, Any]) -> bool:
    for port_state in (resolved_inputs.get("ports") or {}).values():
        for upstream_binding in port_state.get("upstream_bindings") or []:
            if str(upstream_binding.get("source_task_id") or "") == "__trigger__":
                return True
    return False


def build_task_prompt_context(
    task_config: Dict[str, Any],
    resolved_inputs: Dict[str, Any],
    *,
    context_from_dependencies: str = "",
    user_query: str = "",
    workspace_file_hint: str = "",
    trigger_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    ports = resolved_inputs.get("ports") or {}
    output_ports = list(task_config.get("output_ports") or [])

    prompt_inputs: List[Dict[str, Any]] = []
    for port_id, port_state in ports.items():
        input_port = port_state.get("input_port") or {}
        upstream_bindings = list(
            port_state.get("upstream_bindings")
            or (
                []
                if not port_state.get("upstream_binding")
                else [port_state.get("upstream_binding")]
            )
        )
        resolved_documents = list(port_state.get("resolved_documents") or [])
        staged_files = list(port_state.get("staged_files") or [])
        workspace_artifacts = list(port_state.get("workspace_artifacts") or [])

        prompt_inputs.append(
            {
                "input_port_id": port_id,
                "name": str(input_port.get("name") or port_id),
                "expected_kind": str(input_port.get("artifact_kind") or ""),
                "sources": [
                    {
                        "source_task_id": str(
                            upstream_binding.get("source_task_id") or ""
                        ),
                        "source_output_port_id": str(
                            upstream_binding.get("source_output_port_id") or ""
                        ),
                        "artifact_kind": str(
                            upstream_binding.get("artifact_kind") or ""
                        ),
                        "artifacts": [
                            _artifact_prompt_payload(artifact)
                            for artifact in (upstream_binding.get("artifacts") or [])
                            if isinstance(artifact, dict)
                        ],
                    }
                    for upstream_binding in upstream_bindings
                ],
                "documents": [
                    {
                        "document_id": str(doc.get("document_id") or ""),
                        "filename": str(doc.get("filename") or ""),
                        "filepath": str(doc.get("filepath") or ""),
                        "workspace_id": str(doc.get("workspace_id") or ""),
                    }
                    for doc in resolved_documents
                    if isinstance(doc, dict)
                ],
                "files": [
                    {
                        "document_id": str(file_ref.get("document_id") or ""),
                        "filename": str(file_ref.get("filename") or ""),
                        "filepath": str(file_ref.get("filepath") or ""),
                        "workspace_id": str(file_ref.get("workspace_id") or ""),
                    }
                    for file_ref in staged_files
                    if isinstance(file_ref, dict)
                ],
                "workspace_artifacts": [
                    _artifact_prompt_payload(artifact)
                    for artifact in workspace_artifacts
                    if isinstance(artifact, dict)
                ],
                "bound_document_ids": _unique_strings(
                    (port_state.get("document_bindings") or {}).get("document_ids")
                    or []
                ),
            }
        )

    return {
        "task": {
            "id": str(task_config.get("id") or resolved_inputs.get("task_id") or ""),
            "title": str(task_config.get("title") or ""),
            "description": str(task_config.get("description") or ""),
        },
        "resolved_inputs": prompt_inputs,
        "declared_output_ports": [
            {
                "id": str(output_port.get("id") or "default").strip() or "default",
                "name": str(
                    output_port.get("name") or output_port.get("id") or "default"
                ).strip()
                or "default",
                "artifact_kind": str(output_port.get("artifact_kind") or "").strip(),
                "description": str(output_port.get("description") or "").strip(),
            }
            for output_port in output_ports
        ],
        "workspace_context_mode": str(
            resolved_inputs.get("workspace_context_mode") or "resolved_inputs_only"
        ),
        "fallback_workspace_context": list(
            resolved_inputs.get("fallback_workspace_context") or []
        ),
        "has_port_sources": bool(resolved_inputs.get("has_port_sources")),
        "context_from_dependencies": str(context_from_dependencies or ""),
        "user_query": str(user_query or ""),
        "workspace_file_hint": str(workspace_file_hint or ""),
        "trigger_context": trigger_context
        if isinstance(trigger_context, dict)
        else None,
        "has_trigger_port_inputs": task_has_trigger_port_inputs(resolved_inputs),
    }


def build_task_prompt(
    task_config: Dict[str, Any],
    resolved_inputs: Dict[str, Any],
    *,
    context_from_dependencies: str = "",
    user_query: str = "",
    workspace_file_hint: str = "",
    trigger_context: Optional[Dict[str, Any]] = None,
    prompt_overrides: Optional[Dict[str, str]] = None,
) -> str:
    """Build a consistent task prompt from resolved inputs."""

    prompt_registry = load_prompt_registry(prompt_overrides)
    prompt_context = build_task_prompt_context(
        task_config,
        resolved_inputs,
        context_from_dependencies=context_from_dependencies,
        user_query=user_query,
        workspace_file_hint=workspace_file_hint,
        trigger_context=trigger_context,
    )

    lines = [
        f"Task: {task_config.get('title', '')}\n\nDescription:\n{task_config.get('description', '')}",
    ]

    if prompt_context.get("resolved_inputs"):
        lines.append(
            "Structured inputs for this task JSON:\n"
            + json.dumps(
                prompt_context.get("resolved_inputs") or [],
                ensure_ascii=True,
                indent=2,
            )
        )

    output_ports = list(task_config.get("output_ports") or [])
    if output_ports:
        output_lines = []
        output_ports_intro = resolve_prompt_template(
            prompt_registry,
            "task.output_ports.note",
            field="userTemplate",
            fallback="Declared output ports are semantic targets. When multiple ports share a kind, use the port name and description to decide the right target. If you produce structured outputs, set `output_port_id` to a declared id.",
        )
        for output_port in output_ports:
            port_id = str(output_port.get("id") or "default").strip() or "default"
            port_name = str(output_port.get("name") or port_id).strip() or port_id
            port_kind = str(output_port.get("artifact_kind") or "").strip()
            description = str(output_port.get("description") or "").strip()
            output_lines.append(
                f"- `{port_id}` ({port_kind or 'unknown'}): {port_name}"
            )
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

    if prompt_context.get("context_from_dependencies") and not prompt_context.get("has_port_sources"):
        lines.append(f"Context from previous tasks:\n{context_from_dependencies}")

    if prompt_context.get("user_query"):
        lines.append(f"User query: {user_query}")

    if trigger_context and not prompt_context.get("has_trigger_port_inputs"):
        tc_type = trigger_context.get("type")
        if tc_type == "mail":
            payload = trigger_context.get("payload", {})
            msg = payload.get("message", {})
            trigger_meta = payload.get("trigger", {})
            mail_lines = [
                "This playbook was triggered by an incoming email:",
                f"- Subject: {msg.get('subject', '(no subject)')}",
                f"- From: {_fmt_participant(msg.get('from'))}",
                f"- To: {', '.join(_fmt_participant(r) for r in msg.get('to', []))}",
            ]
            cc = msg.get("cc", [])
            if cc:
                mail_lines.append(f"- Cc: {', '.join(_fmt_participant(r) for r in cc)}")
            if msg.get("hasAttachments"):
                mail_lines.append("- Has attachments: yes")
            if msg.get("receivedAt"):
                mail_lines.append(f"- Received at: {msg['receivedAt']}")
            body_text = msg.get("bodyText") or msg.get("bodyHtml") or ""
            if body_text:
                mail_lines.append(f"\nEmail body:\n{body_text[:4000]}")
            lines.append("\n".join(mail_lines))
        else:
            lines.append(
                "Trigger context:\n"
                + json.dumps(trigger_context, ensure_ascii=True, indent=2)
            )

    if workspace_file_hint:
        lines.append(
            "Workspace files already available in the sandbox:\n"
            f"{workspace_file_hint}\n"
            "Do not ask the user to upload these files again."
        )

    lines.append(
        resolve_prompt_template(
            prompt_registry,
            "task.user.footer",
            field="userTemplate",
            fallback="Please complete this task and provide a clear output.",
        )
    )
    return "\n\n".join(lines)
