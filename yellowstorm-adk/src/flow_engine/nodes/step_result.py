from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def requires_structured_response(output_contract: dict[str, Any] | None) -> bool:
    output_ports = _get_output_ports(output_contract)
    if len(output_ports) > 1:
        return True
    return any(_output_port_kind(port) != "text" for port in output_ports)


def finalize_step_result(
    output_contract: dict[str, Any] | None,
    response_text: str,
    components: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    normalized_components = [item for item in (components or []) if isinstance(item, dict)]
    output_ports = _get_output_ports(output_contract)
    generated_artifacts = _collect_generated_artifacts(normalized_components)

    if requires_structured_response(output_contract):
        parsed = _parse_structured_final_response(response_text)
        port_map = {str(port.get("id") or "default").strip() or "default": port for port in output_ports}
        outputs_by_port: dict[str, dict[str, Any]] = {}
        artifacts: list[dict[str, Any]] = []

        for output_spec in parsed["outputs"]:
            port_id = _extract_output_port_id(output_spec)
            if not port_id or port_id not in port_map:
                raise ValueError(f"Structured output references unknown output port '{port_id}'")

            declared_kind = _output_port_kind(port_map[port_id])
            selected_kind = str(
                output_spec.get("artifact_kind") or output_spec.get("artifactKind") or declared_kind or "text"
            ).strip() or "text"
            structured_output, artifact = _build_structured_output_entry(
                port_id,
                declared_kind or selected_kind,
                output_spec.get("content"),
                generated_artifacts,
                explicit_filename=str(output_spec.get("filename") or "").strip(),
                explicit_filepath=str(output_spec.get("filepath") or output_spec.get("file_path") or "").strip(),
            )
            outputs_by_port[port_id] = structured_output
            if artifact is not None:
                artifacts.append(artifact)

        result: dict[str, Any] = {
            "output": parsed["display_text"],
            "display_text": parsed["display_text"],
            "outputs": outputs_by_port,
            "artifacts": artifacts,
            "components": normalized_components,
        }
        if parsed.get("reasoning_trace"):
            result["reasoning_trace"] = parsed["reasoning_trace"]
        return result

    text_output = str(response_text or "")
    artifacts: list[dict[str, Any]] = []
    text_port = _single_text_output_port(output_ports)
    if text_port and text_output.strip():
        artifacts.append(
            {
                "port_id": text_port,
                "artifact_kind": "text",
                "content": text_output,
            }
        )

    result: dict[str, Any] = {
        "output": text_output,
        "display_text": text_output,
        "artifacts": artifacts,
        "components": normalized_components,
    }

    if text_port and text_output.strip():
        result["outputs"] = {
            text_port: {
                "output_port_id": text_port,
                "artifact_kind": "text",
                "content": text_output,
            }
        }

    return result


def _get_output_ports(output_contract: dict[str, Any] | None) -> list[dict[str, Any]]:
    ports = output_contract.get("ports") if isinstance(output_contract, dict) else None
    if not isinstance(ports, list):
        return []
    return [port for port in ports if isinstance(port, dict)]


def _output_port_kind(port: dict[str, Any]) -> str:
    return str(port.get("type") or port.get("artifact_kind") or port.get("artifactKind") or "text").strip() or "text"


def _single_text_output_port(output_ports: list[dict[str, Any]]) -> str | None:
    text_ports = [port for port in output_ports if _output_port_kind(port) == "text"]
    if len(text_ports) != 1:
        return None
    return str(text_ports[0].get("id") or "default").strip() or "default"


def _extract_json_objects(text: str) -> list[dict[str, Any]]:
    normalized = str(text or "").strip()
    if not normalized:
        return []
    if normalized.startswith("```"):
        lines = [
            line for line in normalized.splitlines() if not line.strip().startswith("```")
        ]
        normalized = "\n".join(lines).strip()

    decoder = json.JSONDecoder()
    pos = 0
    found: list[dict[str, Any]] = []
    while pos < len(normalized):
        idx = normalized.find("{", pos)
        if idx == -1:
            break
        try:
            obj, end = decoder.raw_decode(normalized, idx)
            if isinstance(obj, dict):
                found.append(obj)
            pos = end
        except json.JSONDecodeError:
            pos = idx + 1

    return found


def _extract_json_object(text: str) -> dict[str, Any]:
    objects = _extract_json_objects(text)
    if objects:
        return objects[-1]
    raise ValueError("Step did not return a JSON object")


def _parse_structured_final_response(response_text: str) -> dict[str, Any]:
    candidates = _extract_json_objects(response_text)
    for payload in reversed(candidates):
        display_text = str(payload.get("display_text") or payload.get("displayText") or "").strip()
        outputs = payload.get("outputs")
        if display_text and isinstance(outputs, list):
            result: dict[str, Any] = {
                "display_text": display_text,
                "outputs": [item for item in outputs if isinstance(item, dict)],
            }
            raw_trace = payload.get("reasoning_trace") or payload.get("reasoningTrace")
            if isinstance(raw_trace, list):
                result["reasoning_trace"] = raw_trace
            return result
    if candidates:
        raise ValueError("Structured final response must include display_text and an outputs list")
    raise ValueError("Step did not return a JSON object")


def _extract_output_port_id(output_spec: dict[str, Any]) -> str:
    return str(
        output_spec.get("output_port_id")
        or output_spec.get("outputPortId")
        or output_spec.get("port_id")
        or output_spec.get("portId")
        or output_spec.get("id")
        or ""
    ).strip()


def _collect_generated_artifacts(components: list[dict[str, Any]]) -> list[dict[str, Any]]:
    generated: list[dict[str, Any]] = []
    for component in components:
        if component.get("type") != "artifact":
            continue
        data = component.get("data") or {}
        if not isinstance(data, dict):
            continue
        generated.append(
            {
                "file_path": str(data.get("file_path") or data.get("filePath") or data.get("url") or "").strip(),
                "filename": str(data.get("filename") or "").strip(),
                "artifact_kind": str(data.get("artifact_kind") or data.get("artifactKind") or "").strip(),
                "mime_type": str(data.get("mime_type") or data.get("mimeType") or "").strip(),
            }
        )
    return generated


def _find_generated_artifact_match(
    output_spec: dict[str, Any], generated_artifacts: list[dict[str, Any]]
) -> dict[str, Any] | None:
    content = output_spec.get("content")
    metadata = content if isinstance(content, dict) else {}
    requested_filename = str(metadata.get("filename") or "").strip().lower()
    requested_file_path = str(metadata.get("file_path") or metadata.get("url") or "").strip().lower()

    for artifact in generated_artifacts:
        filename = str(artifact.get("filename") or "").strip().lower()
        file_path = str(artifact.get("file_path") or "").strip().lower()
        if requested_filename and filename == requested_filename:
            return artifact
        if requested_file_path and file_path == requested_file_path:
            return artifact

    if requested_filename:
        requested_stem = Path(requested_filename).stem
        for artifact in generated_artifacts:
            filename = str(artifact.get("filename") or "").strip().lower()
            if filename and Path(filename).stem == requested_stem:
                return artifact

    return None


def _build_structured_output_entry(
    port_id: str,
    artifact_kind: str,
    content: Any,
    generated_artifacts: list[dict[str, Any]],
    *,
    explicit_filename: str = "",
    explicit_filepath: str = "",
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    normalized_kind = artifact_kind or "text"
    if normalized_kind in {"text", "code"}:
        text_content = str(content or "").strip()
        entry = {
            "output_port_id": port_id,
            "artifact_kind": normalized_kind,
            "content": text_content,
        }
        artifact = {
            "port_id": port_id,
            "artifact_kind": normalized_kind,
            "content": text_content,
        }
        return entry, artifact if text_content else None

    if normalized_kind == "data":
        entry = {
            "output_port_id": port_id,
            "artifact_kind": normalized_kind,
            "content": content,
        }
        artifact = {
            "port_id": port_id,
            "artifact_kind": normalized_kind,
            "data": content,
        }
        return entry, artifact

    metadata = content if isinstance(content, dict) else {}
    generated = _find_generated_artifact_match({"content": metadata}, generated_artifacts)
    url = str(
        (generated or {}).get("file_path")
        or metadata.get("url")
        or metadata.get("file_path")
        or metadata.get("filePath")
        or explicit_filepath
        or ""
    ).strip()
    filename = str(
        (generated or {}).get("filename")
        or metadata.get("filename")
        or explicit_filename
    ).strip()
    mime_type = str(
        (generated or {}).get("mime_type")
        or metadata.get("mime_type")
        or metadata.get("mimeType")
        or ""
    ).strip()

    entry: dict[str, Any] = {
        "output_port_id": port_id,
        "artifact_kind": normalized_kind,
    }
    if url:
        entry["ref"] = url
    elif metadata:
        entry["ref"] = metadata
    if filename:
        entry["filename"] = filename
    if url:
        entry["filepath"] = url
    if mime_type:
        entry["mime_type"] = mime_type

    artifact = {
        "port_id": port_id,
        "artifact_kind": normalized_kind,
        "url": url,
        "filename": filename,
        "filepath": url,
        "mime_type": mime_type,
    }
    return entry, artifact if url or filename else None
