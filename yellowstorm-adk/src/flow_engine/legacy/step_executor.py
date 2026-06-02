"""Single-step task executor utilities for LangChain agent execution.

Shared helpers used by graph_builder.py (full workflow) and by the
legacy RunStep / ResumeStep gRPC RPCs.  HITL logic is consolidated
in workflow_service.py / graph_builder.py — this module no longer
creates its own mini StateGraph.
"""

import asyncio
import json
import re
import time
import uuid
from pathlib import Path
from typing import Awaitable, Callable, Dict, Any, Optional, List

from structlog import get_logger
from src.middleware.correlation import get_user

from src.flow_engine.legacy.port_resolution import (
    resolve_task_inputs,
    build_task_prompt,
    build_tool_scope,
    format_workspace_file_hint,
    select_output_workspace_id,
    load_prompt_registry,
    resolve_prompt_template,
)
from src.flow_engine.runtime.artifact_routing import normalize_port_id as _normalize_port_id
from src.skills.runtime import inject_skill_catalog

logger = get_logger(__name__)

MAX_TOOL_ITERATIONS = 10
SKIP_STEP_REASON = "__SKIP_STEP__"
StepProgressCallback = Callable[[Dict[str, Any]], Awaitable[None]]


def _get_output_ports(task: Dict[str, Any]) -> List[Dict[str, Any]]:
    return list(task.get("output_ports") or task.get("outputPorts") or [])


def _get_declared_output_ports(task: Dict[str, Any]) -> List[str]:
    return [
        str(port_id).strip()
        for port_id in (task.get("declared_output_ports") or [])
        if str(port_id).strip()
    ]


def _output_port_kind(port: Dict[str, Any]) -> str:
    return str(port.get("artifact_kind") or port.get("artifactKind") or "").strip()


def _task_requires_structured_output_synthesis(task: Dict[str, Any]) -> bool:
    output_ports = _get_output_ports(task)
    if not output_ports:
        return False

    # Plain mode is reserved for text-only tasks; any non-text port needs
    # structured routing so the model can bind outputs explicitly.
    return any(_output_port_kind(port) != "text" for port in output_ports)


def _determine_output_mode(task: Dict[str, Any]) -> str:
    if _task_requires_structured_output_synthesis(task):
        return "structured_final_response"
    return "plain"


def _collect_generated_artifacts(
    components: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    generated: List[Dict[str, Any]] = []
    for comp in components or []:
        if not isinstance(comp, dict) or comp.get("type") != "artifact":
            continue
        data = comp.get("data") or {}
        artifact = {
            "file_path": str(
                data.get("file_path") or data.get("filePath") or ""
            ).strip(),
            "filename": str(data.get("filename") or "").strip(),
            "artifact_kind": str(
                data.get("artifact_kind") or data.get("artifactKind") or ""
            ).strip(),
            "output_port_id": str(
                data.get("output_port_id") or data.get("outputPortId") or ""
            ).strip(),
            "mime_type": str(
                data.get("mime_type") or data.get("mimeType") or ""
            ).strip(),
        }
        object_key = str(
            data.get("object_key") or data.get("objectKey") or ""
        ).strip()
        if object_key:
            artifact["object_key"] = object_key
        generated.append(artifact)
    return generated


def _attach_result_text_for_citations(
    response_text: str,
    components: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    normalized_response = str(response_text or "").strip()
    if not normalized_response or not components:
        return components

    citation_components = [
        dict(component)
        for component in components
        if isinstance(component, dict) and component.get("type") == "citation"
    ]
    if not citation_components:
        return components

    regular_components: List[Dict[str, Any]] = [
        dict(component)
        for component in components
        if isinstance(component, dict) and component.get("type") != "citation"
    ]

    target_text_component: Optional[Dict[str, Any]] = None
    for component in reversed(regular_components):
        if component.get("type") != "text":
            continue
        data = component.get("data") or {}
        if str(data.get("content") or "").strip() != normalized_response:
            continue
        target_text_component = component
        break

    if target_text_component is None:
        target_text_component = {
            "id": f"playbook-final-text-{uuid.uuid4().hex}",
            "type": "text",
            "data": {"content": response_text},
        }
        regular_components.append(target_text_component)
    elif not target_text_component.get("id"):
        target_text_component["id"] = f"playbook-final-text-{uuid.uuid4().hex}"

    target_text_id = str(target_text_component.get("id") or "").strip()
    updated_citations: List[Dict[str, Any]] = []
    for component in citation_components:
        data = dict(component.get("data") or {})
        if not str(data.get("parent_id") or "").strip() and target_text_id:
            data["parent_id"] = target_text_id
        updated_component = dict(component)
        updated_component["data"] = data
        updated_citations.append(updated_component)

    return regular_components + updated_citations


def _find_generated_artifact_match(
    output_spec: Dict[str, Any],
    generated_artifacts: List[Dict[str, Any]],
    used_indexes: set[int],
) -> Optional[Dict[str, Any]]:
    content = output_spec.get("content")
    metadata = content if isinstance(content, dict) else {}
    requested_filename = str(metadata.get("filename") or "").strip().lower()
    requested_file_path = str(metadata.get("file_path") or "").strip().lower()

    for index, artifact in enumerate(generated_artifacts):
        if index in used_indexes:
            continue
        filename = str(artifact.get("filename") or "").strip().lower()
        file_path = str(artifact.get("file_path") or "").strip().lower()
        if requested_filename and filename == requested_filename:
            used_indexes.add(index)
            return artifact
        if requested_file_path and file_path == requested_file_path:
            used_indexes.add(index)
            return artifact

    if requested_filename:
        requested_stem = Path(requested_filename).stem
        for index, artifact in enumerate(generated_artifacts):
            if index in used_indexes:
                continue
            artifact_filename = str(artifact.get("filename") or "").strip().lower()
            if artifact_filename and Path(artifact_filename).stem == requested_stem:
                used_indexes.add(index)
                return artifact

    return None


def _build_task_artifacts_from_structured_outputs(
    task: Dict[str, Any],
    structured_outputs: List[Dict[str, Any]],
    generated_artifacts: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    output_ports = _get_output_ports(task)
    port_by_id = {_normalize_port_id(port.get("id")): port for port in output_ports}
    used_generated_indexes: set[int] = set()
    artifacts: List[Dict[str, Any]] = []

    for output_spec in structured_outputs:
        if not isinstance(output_spec, dict):
            continue

        output_port_id = _normalize_port_id(
            output_spec.get("output_port_id") or output_spec.get("outputPortId")
        )
        port = port_by_id.get(output_port_id)
        if port is None:
            raise ValueError(
                f"Structured output references unknown output port '{output_port_id}'"
            )

        port_kind = _output_port_kind(port)
        model_output_kind = str(
            output_spec.get("artifact_kind") or output_spec.get("artifactKind") or ""
        ).strip()
        if not model_output_kind:
            raise ValueError(
                f"Structured output for port '{output_port_id}' must include artifact_kind"
            )
        # The declared port contract is canonical once the model selects a port.
        output_kind = port_kind or model_output_kind
        if port_kind and model_output_kind and port_kind != model_output_kind:
            logger.warning(
                "Structured output kind does not match declared port kind; using declared port kind",
                output_port_id=output_port_id,
                model_artifact_kind=model_output_kind,
                declared_artifact_kind=port_kind,
            )

        content = output_spec.get("content")

        # The model-facing schema always uses `content`; the runtime converts
        # it back into the existing internal artifact shape for each kind.
        if output_kind in {"text", "code"}:
            text_content = str(content or "").strip()
            if not text_content:
                continue
            artifacts.append(
                {
                    "port_id": str(port.get("id") or output_port_id),
                    "artifact_kind": output_kind,
                    "content": text_content,
                }
            )
            continue

        if output_kind == "data":
            if content is None:
                raise ValueError(
                    f"Structured output for port '{output_port_id}' must include content"
                )
            artifacts.append(
                {
                    "port_id": str(port.get("id") or output_port_id),
                    "artifact_kind": output_kind,
                    "data": content,
                }
            )
            continue

        matched_artifact = _find_generated_artifact_match(
            output_spec, generated_artifacts, used_generated_indexes
        )
        if matched_artifact is None:
            metadata = content if isinstance(content, dict) else {}
            requested_name = (
                metadata.get("filename")
                or metadata.get("file_path")
                or output_port_id
            )
            logger.warning(
                "Structured output references unknown generated artifact; skipping output",
                output_port_id=output_port_id,
                requested_artifact=str(requested_name),
                artifact_kind=output_kind,
            )
            continue

        artifact = {
            "port_id": str(port.get("id") or output_port_id),
            "artifact_kind": output_kind
            or str(matched_artifact.get("artifact_kind") or "document"),
            "url": str(matched_artifact.get("file_path") or ""),
            "filename": str(matched_artifact.get("filename") or ""),
            "mime_type": str(matched_artifact.get("mime_type") or ""),
        }
        object_key = str(matched_artifact.get("object_key") or "").strip()
        if object_key:
            artifact["object_key"] = object_key
        artifacts.append(artifact)

    return artifacts


def _validate_declared_output_ports(
    task: Dict[str, Any], structured_outputs: List[Dict[str, Any]]
) -> None:
    declared_output_ports = {
        _normalize_port_id(port_id) for port_id in _get_declared_output_ports(task)
    }
    if not declared_output_ports:
        return

    for output_spec in structured_outputs:
        raw_output_port_id = output_spec.get("output_port_id") or output_spec.get(
            "outputPortId"
        )
        if not str(raw_output_port_id or "").strip():
            raise ValueError(
                "Structured output must include output_port_id when declared_output_ports is present"
            )
        output_port_id = _normalize_port_id(raw_output_port_id)
        if output_port_id not in declared_output_ports:
            raise ValueError(
                f"Structured output references undeclared output port '{output_port_id}'"
            )


def _extract_json_objects(text: str) -> list[Dict[str, Any]]:
    normalized = (text or "").strip()
    if not normalized:
        return []
    if normalized.startswith("```"):
        lines = [
            line for line in normalized.splitlines() if not line.strip().startswith("```")
        ]
        normalized = "\n".join(lines).strip()
    decoder = json.JSONDecoder()
    pos = 0
    found: list[Dict[str, Any]] = []
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


def _extract_json_object(text: str) -> Dict[str, Any]:
    objects = _extract_json_objects(text)
    if objects:
        return objects[-1]
    raise ValueError("Adaptive replay did not return a JSON object")


def _parse_structured_final_response(response_text: str) -> Dict[str, Any]:
    candidates = _extract_json_objects(response_text)
    for payload in reversed(candidates):
        display_text = str(payload.get("display_text") or payload.get("displayText") or "").strip()
        outputs, recovered_trace = _normalize_structured_outputs(
            payload.get("outputs") if payload.get("outputs") is not None else payload.get("ports")
        )
        if display_text and outputs is not None:
            result = {
                "display_text": display_text,
                "outputs": outputs,
            }
            raw_trace = payload.get("reasoning_trace") or payload.get("reasoningTrace")
            reasoning_trace = [item for item in raw_trace if isinstance(item, dict)] if isinstance(raw_trace, list) else []
            reasoning_trace.extend(recovered_trace)
            if reasoning_trace:
                result["reasoning_trace"] = reasoning_trace
            return result
    if candidates:
        raise ValueError("Structured final response must include display_text and outputs")
    raise ValueError("Step did not return a JSON object")


def _normalize_structured_output_entry(
    item: Dict[str, Any], *, fallback_port_id: str = ""
) -> Dict[str, Any]:
    entry = dict(item)
    if not (
        entry.get("output_port_id")
        or entry.get("outputPortId")
        or entry.get("port_id")
        or entry.get("portId")
        or entry.get("id")
    ):
        normalized_port_id = str(fallback_port_id).strip()
        if normalized_port_id:
            entry["output_port_id"] = normalized_port_id
    if not (entry.get("artifact_kind") or entry.get("artifactKind")):
        legacy_kind = str(entry.get("type") or "").strip()
        if legacy_kind:
            entry["artifact_kind"] = legacy_kind
    if "content" not in entry and "value" in entry:
        entry["content"] = entry.get("value")
    return entry


def _normalize_structured_outputs(outputs: Any) -> tuple[Optional[List[Dict[str, Any]]], List[Dict[str, Any]]]:
    if isinstance(outputs, list):
        normalized: List[Dict[str, Any]] = []
        recovered_trace: List[Dict[str, Any]] = []
        for item in outputs:
            if not isinstance(item, dict):
                continue
            if _is_reasoning_trace_entry(item):
                recovered_trace.append(dict(item))
                continue
            normalized.append(_normalize_structured_output_entry(item))
        return normalized, recovered_trace
    if isinstance(outputs, dict):
        normalized: List[Dict[str, Any]] = []
        recovered_trace: List[Dict[str, Any]] = []
        for port_id, value in outputs.items():
            if not isinstance(value, dict):
                continue
            if _is_reasoning_trace_entry(value):
                recovered_trace.append(dict(value))
                continue
            normalized.append(
                _normalize_structured_output_entry(value, fallback_port_id=str(port_id))
            )
        return normalized, recovered_trace
    return None, []


def _is_reasoning_trace_entry(item: Dict[str, Any]) -> bool:
    if any(
        key in item
        for key in (
            "output_port_id",
            "outputPortId",
            "port_id",
            "portId",
            "artifact_kind",
            "artifactKind",
            "content",
            "filename",
            "filepath",
            "file_path",
            "ref",
            "url",
        )
    ):
        return False
    return all(str(item.get(key) or "").strip() for key in ("id", "type", "label", "description"))


def _build_plain_text_artifact(
    task: Dict[str, Any], response_text: str
) -> Optional[Dict[str, Any]]:
    content = str(response_text or "").strip()
    if not content:
        return None

    text_ports = [
        port for port in _get_output_ports(task) if _output_port_kind(port) == "text"
    ]
    if len(text_ports) != 1:
        return None

    port = text_ports[0]
    return {
        "port_id": str(port.get("id") or "default").strip() or "default",
        "artifact_kind": _output_port_kind(port) or "text",
        "content": content,
    }


def _finalize_task_outputs(
    task: Dict[str, Any],
    response_text: str,
    components: List[Dict[str, Any]],
    output_mode: str,
) -> tuple[str, List[Dict[str, Any]]]:
    generated_artifacts = _collect_generated_artifacts(components)
    if output_mode == "structured_final_response":
        parsed = _parse_structured_final_response(response_text)
        _validate_declared_output_ports(task, parsed["outputs"])
        return (
            parsed["display_text"],
            _build_task_artifacts_from_structured_outputs(
                task,
                parsed["outputs"],
                generated_artifacts,
            ),
        )

    # Plain mode is text-only; non-text outputs are routed through structured mode.
    artifacts: List[Dict[str, Any]] = []
    text_artifact = _build_plain_text_artifact(task, response_text)
    if text_artifact is not None:
        artifacts.insert(0, text_artifact)
    return response_text, artifacts


def _build_evaluation_artifact(
    task: Dict[str, Any],
    payload: Dict[str, Any],
) -> List[Dict[str, Any]]:
    output_ports = _get_output_ports(task)
    target_port = "evaluation"
    for port in output_ports:
        if _output_port_kind(port) == "data":
            target_port = str(port.get("id") or "evaluation").strip() or "evaluation"
            break
    return [{"port_id": target_port, "artifact_kind": "data", "data": payload}]


async def _execute_evaluation_task(
    task: Dict[str, Any],
    resolved_inputs: Dict[str, Any],
    prompt_registry: Dict[str, Dict[str, Any]],
    settings: Any,
    model_name: str,
    temperature: float,
    evaluator_name: Optional[str] = None,
    evaluator_instructions: Optional[str] = None,
    on_progress: Optional[StepProgressCallback] = None,
) -> Dict[str, Any]:
    config = task.get("evaluation_config") or {}
    expectation = str(config.get("expectation") or "").strip()
    baseline_id = str(config.get("reference_baseline_id") or "").strip()
    mode = "hybrid" if expectation and baseline_id else "reference" if baseline_id else "semantic"
    llm_prompt_trace: List[Dict[str, Any]] = []
    system_prompt = resolve_prompt_template(
        prompt_registry,
        "evaluation.task.system",
        field="systemTemplate",
        fallback="You are a strict playbook evaluation judge. Evaluate only the evidence provided through connected inputs and the configured expectation/baseline. Return strict JSON only.",
    )
    if evaluator_name:
        system_prompt = system_prompt.replace("{{agentName}}", evaluator_name)
    if evaluator_instructions:
        system_prompt = system_prompt.replace(
            "{{agentInstructions}}", evaluator_instructions
        )
    system_prompt = system_prompt.replace("{{UserLanguage}}", "en")
    user_prompt = resolve_prompt_template(
        prompt_registry,
        "evaluation.task.user",
        field="userTemplate",
        fallback="Evaluation task title: {{taskTitle}}\nExpected result:\n{{expectation}}\n\nReference baseline:\n{{baselineSummary}}\n\nConnected inputs JSON:\n{{inputsJson}}\n\nRubric JSON:\n{{rubricJson}}",
    )
    user_prompt = (
        user_prompt.replace("{{taskTitle}}", str(task.get("title") or ""))
        .replace("{{taskDescription}}", str(task.get("description") or ""))
        .replace("{{expectation}}", expectation or "No semantic expectation configured.")
        .replace("{{baselineSummary}}", baseline_id or "No reference baseline configured.")
        .replace("{{UserLanguage}}", "en")
        .replace(
            "{{inputsJson}}",
            json.dumps(
                {
                    "resolvedInputs": resolved_inputs.get("resolved_inputs") or {},
                    "upstreamBindings": resolved_inputs.get("upstream_bindings") or {},
                    "artifactsByPort": resolved_inputs.get("artifacts_by_port") or {},
                },
                ensure_ascii=False,
                default=str,
            ),
        )
        .replace(
            "{{rubricJson}}",
            json.dumps(
                {
                    "mode": mode,
                    "passThreshold": config.get("pass_threshold", 80),
                    "warningThreshold": config.get("warning_threshold", 60),
                    "weights": config.get("weights") or {},
                },
                ensure_ascii=False,
                default=str,
            ),
        )
    )
    response, usage = await _llm_call(
        settings,
        model_name,
        system_prompt,
        user_prompt,
        temperature=temperature,
        prompt_trace=llm_prompt_trace,
        stage="evaluation_task",
        on_progress=on_progress,
    )
    parsed = json.loads(response)
    if not isinstance(parsed, dict):
        raise ValueError("Evaluation task returned a non-object JSON payload")
    payload = {
        "type": "playbook_evaluation_result",
        "mode": mode,
        "score": float(parsed.get("score") or 0),
        "verdict": str(parsed.get("verdict") or "fail"),
        "summary": str(parsed.get("summary") or ""),
        "semanticScore": parsed.get("semanticScore"),
        "referenceScore": parsed.get("referenceScore"),
        "artifactScore": parsed.get("artifactScore"),
        "formatScore": parsed.get("formatScore"),
        "evidenceScore": parsed.get("evidenceScore"),
        "executionHealthScore": parsed.get("executionHealthScore"),
        "findings": parsed.get("findings") if isinstance(parsed.get("findings"), list) else [],
        "expectation": expectation,
        "referenceBaselineId": baseline_id or None,
    }
    return {
        "output": payload["summary"],
        "components": [
            {
                "type": "task",
                "data": {
                    "title": str(task.get("title") or "Evaluation"),
                    "items": [
                        {"text": f"Verdict: {payload['verdict']}"},
                        {"text": f"Score: {payload['score']}"},
                        {"text": payload["summary"] or "No summary provided."},
                    ],
                    "status": str(payload["verdict"]),
                },
            }
        ],
        "usage": usage,
        "llm_prompt_trace": llm_prompt_trace,
        "artifacts": _build_evaluation_artifact(task, payload),
    }


def _serialize_prompt_messages(messages: List[Dict[str, str]]) -> str:
    blocks: List[str] = []
    for message in messages:
        role = str(message.get("role", "unknown")).upper()
        content = str(message.get("content", ""))
        blocks.append(f"[{role}]\n{content}")
    return "\n\n".join(blocks)


def _append_prompt_trace(
    prompt_trace: Optional[List[Dict[str, Any]]],
    *,
    stage: str,
    model: str,
    messages: List[Dict[str, str]],
) -> None:
    if prompt_trace is None:
        return
    prompt_trace.append(
        {
            "stage": stage,
            "model": model,
            "prompt": _serialize_prompt_messages(messages),
        }
    )


def _summarize_tool_args(args: Any, max_length: int = 500) -> str:
    text = str(args)
    if len(text) <= max_length:
        return text
    return f"{text[:max_length]}...[truncated]"


def _summarize_tool_result(result: Any, max_length: int = 2000) -> str:
    text = str(result)
    if len(text) <= max_length:
        return text
    return f"{text[:max_length]}...[truncated]"





def _parse_tool_result(result: Any) -> Any:
    """Try to parse a tool result as JSON if it's a string, otherwise return as-is.

    MCP tools often return serialized JSON strings rather than Python objects.
    """
    if isinstance(result, str):
        try:
            return json.loads(result)
        except (json.JSONDecodeError, ValueError):
            return result
    return result


def _extract_images_from_result(result: Any) -> List[str]:
    """Recursively collect all image_base64 values from a tool result."""
    images = []
    if isinstance(result, dict):
        for k, v in result.items():
            if k == "image_base64" and isinstance(v, str) and v:
                images.append(v)
            else:
                images.extend(_extract_images_from_result(v))
    elif isinstance(result, list):
        for item in result:
            images.extend(_extract_images_from_result(item))
    return images


def _strip_images_from_tool_result(result: Any) -> Any:
    """Recursively remove image_base64 fields to keep text content lean."""
    if isinstance(result, dict):
        return {k: _strip_images_from_tool_result(v) for k, v in result.items() if k != "image_base64"}
    if isinstance(result, list):
        return [_strip_images_from_tool_result(item) for item in result]
    return result


def _compress_tool_json(data: Any) -> Any:
    """Remove redundant verbose block arrays when a summary content string is already present.

    Many search tools return both:
      - "blocks": [{block_id, block_type, content, page_number, ...}, ...]  (verbose)
      - "content": "all block text concatenated"                              (compact)

    Keeping both sends the same text twice. Drop "blocks" when "content" exists.
    Also drops "page_section_id" from top-level dicts as it is already in section IDs.
    """
    if isinstance(data, dict):
        # Drop redundant blocks array when content summary is present
        if isinstance(data.get("blocks"), list) and isinstance(data.get("content"), str):
            data = {k: v for k, v in data.items() if k != "blocks"}
        return {k: _compress_tool_json(v) for k, v in data.items()}
    if isinstance(data, list):
        return [_compress_tool_json(item) for item in data]
    return data


def _build_tool_text_content(result: Any) -> str:
    """Build text-only content for a ToolMessage.

    Images are extracted separately and injected as HumanMessage vision content
    so Azure counts them as ~1,105 tokens each instead of ~33k when embedded
    as base64 text inside a ToolMessage JSON blob.
    """
    parsed = _parse_tool_result(result)
    compressed = _compress_tool_json(_strip_images_from_tool_result(parsed))
    text = str(compressed)
    logger.info("Tool text content built", text_length=len(text))
    return text


def _cap_images_in_messages(messages: List, max_images: int = 50) -> List:
    """Enforce a global image cap across all messages, keeping the most recent images.

    Walks messages newest-to-oldest, allocating the image budget to recent messages first.
    Images in older messages that exceed the cap are replaced with a text note.
    """
    # Count images per message
    def _count_images(msg) -> int:
        content = getattr(msg, "content", None)
        if isinstance(content, list):
            return sum(1 for b in content if isinstance(b, dict) and b.get("type") == "image_url")
        return 0

    counts = [_count_images(m) for m in messages]
    total = sum(counts)
    if total <= max_images:
        return messages

    # Allocate budget newest-first
    budget = max_images
    keep = []
    for count in reversed(counts):
        if budget >= count:
            keep.append(True)
            budget -= count
        else:
            keep.append(False)
    keep.reverse()

    result = list(messages)
    dropped = 0
    for i, (msg, should_keep, count) in enumerate(zip(messages, keep, counts)):
        if should_keep or count == 0:
            continue
        content = getattr(msg, "content", None)
        if isinstance(content, list):
            text_blocks = [b for b in content if isinstance(b, dict) and b.get("type") == "text"]
            text_blocks.append({"type": "text", "text": f"[{count} image(s) removed — global 50-image limit reached]"})
            result[i] = msg.copy(update={"content": text_blocks})
        dropped += count

    logger.warning("Global image cap applied", total=total, kept=total - dropped, dropped=dropped)
    return result



def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    return str(content or "")


async def _stream_chat_response(
    runnable,
    messages,
    on_progress: Optional[StepProgressCallback] = None,
):
    aggregated = None
    latest_text = ""

    async for chunk in runnable.astream(messages):
        aggregated = chunk if aggregated is None else aggregated + chunk
        if on_progress is None:
            continue
        current_text = _content_to_text(getattr(aggregated, "content", ""))
        if current_text == latest_text:
            continue
        latest_text = current_text
        await on_progress({"output": current_text})

    return aggregated


def _extract_interrupt_from_snapshot(
    state_snapshot, task_id: str, thread_id: str
) -> Optional[Dict[str, Any]]:
    for pregel_task in state_snapshot.tasks:
        if hasattr(pregel_task, "interrupts") and pregel_task.interrupts:
            iv = pregel_task.interrupts[0].value
            if isinstance(iv, dict):
                return {
                    "type": iv.get("type", ""),
                    "task_id": iv.get("task_id", task_id),
                    "task_title": iv.get("task_title", ""),
                    "message": iv.get("message", ""),
                    "thread_id": thread_id,
                    "task_description": iv.get("task_description", ""),
                    "result": iv.get("result", ""),
                    "interrupt_id": iv.get("interrupt_id", ""),
                    "round": iv.get("round", 0),
                    "conversation_json": iv.get("conversation_json", ""),
                    "resumable_actions": iv.get("resumable_actions", []),
                }
    return None


def _extract_usage(response) -> Dict[str, Any]:
    usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "model": ""}

    if hasattr(response, "usage_metadata") and response.usage_metadata:
        um = response.usage_metadata
        usage["input_tokens"] = um.get("input_tokens", 0)
        usage["output_tokens"] = um.get("output_tokens", 0)
        usage["total_tokens"] = um.get("total_tokens", 0)
    elif hasattr(response, "response_metadata") and response.response_metadata:
        tu = response.response_metadata.get("token_usage", {})
        usage["input_tokens"] = tu.get("prompt_tokens", 0)
        usage["output_tokens"] = tu.get("completion_tokens", 0)
        usage["total_tokens"] = tu.get("total_tokens", 0)

    if hasattr(response, "response_metadata") and response.response_metadata:
        usage["model"] = response.response_metadata.get("model_name", "")

    return usage


def is_skip_step_response(response: Any) -> bool:
    return (
        isinstance(response, dict)
        and response.get("approved") is False
        and response.get("reason") == SKIP_STEP_REASON
    )


def normalize_interrupt_action(response: Any, interrupt_type: str) -> str:
    if is_skip_step_response(response):
        return "skip"
    if isinstance(response, dict):
        action = str(response.get("action") or "").strip().lower()
        if action in {"reply", "approve", "reject", "skip"}:
            return action
        if response.get("approved") is True:
            return "approve"
        if response.get("approved") is False:
            if interrupt_type == "review_request" and (
                response.get("feedback") or response.get("message")
            ):
                return "reply"
            return "reject"
    return "reply" if interrupt_type == "clarification" else "approve"


def extract_interrupt_message(response: Any) -> str:
    if isinstance(response, str):
        return response.strip()
    if isinstance(response, dict):
        for key in ("message", "feedback", "input", "reason"):
            value = response.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def extract_follow_up_question(text: Any) -> str:
    if not isinstance(text, str):
        return ""
    normalized = text.strip()
    if not normalized or "?" not in normalized:
        return ""

    lines = [line.strip(" -*\t") for line in normalized.splitlines() if line.strip()]
    for line in reversed(lines):
        if "?" in line:
            return line[-500:]

    match = re.search(r"([^?.!\n][^?\n]{0,400}\?)\s*$", normalized)
    if match:
        return match.group(1).strip()
    return ""


async def execute_step(
    task: Dict[str, Any],
    agent: Dict[str, Any],
    context_from_dependencies: str = "",
    workspace_context: Optional[list] = None,
    trigger_context: Optional[Dict[str, Any]] = None,
    edges: Optional[List[Dict[str, Any]]] = None,
    upstream_results: Optional[List[Dict[str, Any]]] = None,
    artifacts_by_port: Optional[Dict[str, List[Dict[str, Any]]]] = None,
    node_inputs_by_port: Optional[Dict[str, List[Dict[str, Any]]]] = None,
    execution_mode: str = "live",
    validated_replay: Optional[Dict[str, Any]] = None,
    evaluation_user_id: str = "unknown",
    on_progress: Optional[StepProgressCallback] = None,
    prompt_overrides: Optional[Dict[str, str]] = None,
    user_language: Optional[str] = None,
) -> Dict[str, Any]:
    """Execute a single task.

    Delegates to :func:`_execute_step_direct` for simple tasks.  For
    tasks requiring HITL (interrupt_before / interrupt_after /
    allow_clarification), wraps in a thin LangGraph via
    :func:`workflow_service.run_single_step_graph` so that the same
    interrupt / resume machinery used by full-playbook workflows is
    reused — no duplicated HITL code.
    """
    needs_hitl = (
        task.get("interrupt_before", False)
        or task.get("interrupt_after", False)
        or task.get("allow_clarification", False)
    )

    if needs_hitl:
        from src.flow_engine.legacy.workflow_service import run_single_step_graph

        return await run_single_step_graph(
            task=task,
            agent=agent,
            context_from_dependencies=context_from_dependencies,
            workspace_context=workspace_context,
            trigger_context=trigger_context,
            edges=edges,
            upstream_results=upstream_results,
            artifacts_by_port=artifacts_by_port,
            node_inputs_by_port=node_inputs_by_port,
            execution_mode=execution_mode,
            validated_replay=validated_replay,
            evaluation_user_id=evaluation_user_id,
            on_progress=on_progress,
            prompt_overrides=prompt_overrides,
            user_language=user_language,
        )

    return await _execute_step_direct(
        task=task,
        agent=agent,
        context_from_dependencies=context_from_dependencies,
        workspace_context=workspace_context,
        trigger_context=trigger_context,
        edges=edges,
        upstream_results=upstream_results,
        artifacts_by_port=artifacts_by_port,
        node_inputs_by_port=node_inputs_by_port,
        execution_mode=execution_mode,
        validated_replay=validated_replay,
        evaluation_user_id=evaluation_user_id,
        on_progress=on_progress,
        prompt_overrides=prompt_overrides,
        user_language=user_language,
    )


async def _execute_step_direct(
    task: Dict[str, Any],
    agent: Dict[str, Any],
    context_from_dependencies: str = "",
    workspace_context: Optional[list] = None,
    trigger_context: Optional[Dict[str, Any]] = None,
    edges: Optional[List[Dict[str, Any]]] = None,
    upstream_results: Optional[List[Dict[str, Any]]] = None,
    artifacts_by_port: Optional[Dict[str, List[Dict[str, Any]]]] = None,
    node_inputs_by_port: Optional[Dict[str, List[Dict[str, Any]]]] = None,
    execution_mode: str = "live",
    validated_replay: Optional[Dict[str, Any]] = None,
    evaluation_user_id: str = "unknown",
    on_progress: Optional[StepProgressCallback] = None,
    prompt_overrides: Optional[Dict[str, str]] = None,
    user_language: Optional[str] = None,
) -> Dict[str, Any]:
    from src.config.settings import get_settings

    settings = get_settings()
    task_id = task.get("id", "unknown")
    start_time = time.time()

    agent_instructions = agent.get("instructions") or agent.get("prompt", "")
    model_name = agent.get("model") or "gpt-5.4-mini"
    agent_instructions = inject_skill_catalog(
        agent.get("instructions") or agent.get("prompt", ""),
        agent.get("skills") or [],
    )
    agent_params = agent.get("agent_params") or {}
    temperature = float(agent_params.get("temperature", 0.7))
    output_mode = _determine_output_mode(task)

    upstream_results_map = {
        str(item.get("task_id") or "").strip(): item
        for item in (upstream_results or [])
        if isinstance(item, dict) and str(item.get("task_id") or "").strip()
    }
    resolved_artifacts_by_port: Dict[str, List[Dict[str, Any]]] = dict(
        artifacts_by_port or {}
    )
    if not resolved_artifacts_by_port:
        for upstream_task_id, upstream_result in upstream_results_map.items():
            for artifact in upstream_result.get("artifacts") or []:
                if not isinstance(artifact, dict):
                    continue
                port_id = (
                    str(
                        artifact.get("port_id") or artifact.get("portId") or "default"
                    ).strip()
                    or "default"
                )
                resolved_artifacts_by_port.setdefault(
                    f"{upstream_task_id}:{port_id}", []
                ).append(artifact)

    resolved_inputs = resolve_task_inputs(
        task_id,
        task,
        {
            "edges": edges or [],
            "results": upstream_results_map,
            "task_outputs": {},
            "artifacts_by_port": resolved_artifacts_by_port,
            "node_inputs_by_port": node_inputs_by_port or {},
            "workspace_context": workspace_context,
            "trigger_context": trigger_context,
        },
    )
    prompt_registry = load_prompt_registry(
        prompt_overrides or (task or {}).get("prompt_overrides") or {}
    )
    workspace_file_hint = format_workspace_file_hint(
        workspace_context if not resolved_inputs.get("has_port_sources") else None
    )

    system_prompt = resolve_prompt_template(
        prompt_registry,
        "task.system",
        field="systemTemplate",
        fallback=(
            f"You are {agent['name']}.\n\n"
            f"Your instructions:\n{agent_instructions}\n\n"
            f"You are working on a task as part of a playbook execution."
        ),
    )
    system_prompt = system_prompt.replace("{{agentName}}", agent["name"]).replace(
        "{{agentInstructions}}", agent_instructions
    ).replace("{{UserLanguage}}", user_language or "en")

    user_prompt = build_task_prompt(
        task,
        resolved_inputs,
        context_from_dependencies=context_from_dependencies,
        workspace_file_hint=workspace_file_hint,
        trigger_context=trigger_context,
        prompt_overrides=prompt_overrides or (task or {}).get("prompt_overrides") or {},
        output_mode=output_mode,
    )
    user_prompt = user_prompt.replace("{{UserLanguage}}", user_language or "en")
    llm_prompt_trace: List[Dict[str, Any]] = []

    if str(task.get("task_type") or "") == "evaluation":
        evaluation_result = await _execute_evaluation_task(
            task,
            resolved_inputs,
            prompt_registry,
            settings,
            model_name,
            temperature,
            evaluator_name=agent.get("name"),
            evaluator_instructions=agent_instructions,
            on_progress=on_progress,
        )
        duration_ms = int((time.time() - start_time) * 1000)
        return {
            "status": "completed",
            "result": {
                "task_id": task_id,
                "status": "completed",
                "output": evaluation_result["output"],
                "error": "",
                "duration_ms": duration_ms,
                "components": evaluation_result["components"],
                "usage": evaluation_result["usage"],
                "tool_trace": [],
                "llm_prompt_trace": evaluation_result["llm_prompt_trace"],
                "semantic_match": None,
                "artifacts": evaluation_result["artifacts"],
            },
            "interrupt": None,
            "thread_id": "",
        }

    try:
        from src.flow_engine.tools.langchain_factory import create_langchain_tools

        tool_scope = build_tool_scope(resolved_inputs)
        output_workspace_id = select_output_workspace_id(resolved_inputs)
        code_interpreter_files = tool_scope["all_files"] or tool_scope["fallback_files"]
        input_files = list(task.get("input_files") or [])
        for doc_id in tool_scope["all_document_ids"]:
            if doc_id not in input_files:
                input_files.append(doc_id)

        logger.info(
            f"[{task_id}] INPUT_FILES_DEBUG",
            has_input_files=bool(input_files),
            input_files_count=len(input_files),
            input_files_by_port_count=len(tool_scope["documents_by_port"]),
            workspace_context_mode=tool_scope["workspace_context_mode"],
        )

        lc_tools, collector = create_langchain_tools(
            agent,
            workspace_context=workspace_context,
            input_files=input_files,
            documents_by_port=tool_scope["documents_by_port"],
            code_interpreter_files=code_interpreter_files,
            output_ports=task.get("output_ports"),
            output_workspace_id=output_workspace_id,
            workspace_context_mode=tool_scope["workspace_context_mode"],
            step_connector_bindings=task.get("tool_bindings"),
        )

        if (
            execution_mode in ("replay_strict", "replay_flex", "replay_adaptive")
            and validated_replay
        ):
            logger.info(
                "[%s] REPLAY_PATH_SELECTED",
                task_id,
                execution_mode=execution_mode,
                replay_id=validated_replay.get("replay_id"),
                replay_task_id=validated_replay.get("task_id"),
                replay_tool_calls=len(validated_replay.get("tool_calls", []) or []),
                available_tools=[tool.name for tool in lc_tools],
            )
            if not lc_tools:
                raise ValueError(
                    f"Validated replay for task {task_id} cannot run because no tools are configured"
                )
            (
                strict_response,
                components,
                tool_trace,
                synthesis_context,
            ) = await _execute_replay_tool_calls(
                lc_tools,
                collector,
                validated_replay,
                prompt_trace=llm_prompt_trace,
                adaptive=execution_mode == "replay_adaptive",
                adaptation_context={
                    "task_id": task_id,
                    "task_title": task.get("title", ""),
                    "task_description": task.get("description", ""),
                    "current_query": "",
                    "dependency_context": context_from_dependencies,
                    "reference_task_title": validated_replay.get("task_title", ""),
                    "reference_task_description": validated_replay.get(
                        "reference_task_description", ""
                    ),
                },
                settings=settings,
                model_name=model_name,
                on_progress=on_progress,
                prompt_overrides=prompt_overrides,
            )
            if execution_mode in ("replay_flex", "replay_adaptive"):
                logger.info("[%s] REPLAY_FLEX_FINAL_SYNTHESIS", task_id)
                format_guide = (
                    validated_replay.get("output_format_guide") or ""
                ).strip()
                replay_system_prompt = resolve_prompt_template(
                    prompt_registry,
                    "replay.final_synthesis",
                    field="systemTemplate",
                    fallback=system_prompt,
                )
                replay_user_prefix = resolve_prompt_template(
                    prompt_registry,
                    "replay.final_synthesis",
                    field="userTemplate",
                    fallback="Use the following replayed tool execution results to produce the final answer.",
                )
                replay_user_prefix = replay_user_prefix.replace(
                    "{{synthesisContext}}", synthesis_context
                )
                format_instruction = ""
                if validated_replay.get("preserve_output_format") and format_guide:
                    format_instruction = (
                        "\n\n#Output Furmat guidelines\n"
                        f"{format_guide}\n\n"
                        "Keep the structure and presentation style, but refresh the content from the current replay evidence only."
                    )
                replay_user_prompt = (
                    f"{user_prompt}\n\n{replay_user_prefix}{format_instruction}"
                )
                response, usage = await _llm_call(
                    settings,
                    model_name,
                    replay_system_prompt,
                    replay_user_prompt,
                    temperature=temperature,
                    prompt_trace=llm_prompt_trace,
                    stage="replay_final_synthesis",
                    on_progress=on_progress if output_mode == "plain" else None,
                )
            else:
                response = strict_response
                usage = {
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "total_tokens": 0,
                    "model": "",
                }
        elif lc_tools:
            logger.info(
                f"[{task_id}] Executing with real tools",
                count=len(lc_tools),
                tools=[t.name for t in lc_tools],
            )
            (
                response,
                components,
                usage,
                tool_trace,
                llm_prompt_trace,
            ) = await _execute_with_tools(
                settings,
                model_name,
                system_prompt,
                user_prompt,
                lc_tools,
                task_id=task_id,
                collector=collector,
                temperature=temperature,
                on_progress=on_progress,
                stream_final_output=output_mode == "plain",
            )
        else:
            response, usage = await _llm_call(
                settings,
                model_name,
                system_prompt,
                user_prompt,
                temperature=temperature,
                prompt_trace=llm_prompt_trace,
                stage="task_direct_completion",
                on_progress=on_progress if output_mode == "plain" else None,
            )
            components = []
            tool_trace = []

        is_visualizer = (
            agent.get("agent_type") == "visualizer"
            or agent.get("name") == "Visualizer Agent"
            or "visualizer_agent" in (agent.get("name") or "").lower()
        )
        if not is_visualizer:
            components = _attach_result_text_for_citations(response, components)
        if is_visualizer and response:
            components.insert(
                0,
                {
                    "type": "web_preview",
                    "data": {"content": response},
                },
            )

        response, artifacts = _finalize_task_outputs(
            task,
            response,
            components,
            output_mode,
        )
        if output_mode == "structured_final_response" and on_progress is not None:
            await on_progress({"output": response, "components": list(components)})

        duration_ms = int((time.time() - start_time) * 1000)
        semantic_match = None

        return {
            "status": "completed",
            "result": {
                "task_id": task_id,
                "status": "completed",
                "output": "" if is_visualizer else response,
                "error": "",
                "duration_ms": duration_ms,
                "components": components,
                "usage": usage,
                "tool_trace": tool_trace,
                "llm_prompt_trace": llm_prompt_trace,
                "semantic_match": semantic_match,
                "artifacts": artifacts,
            },
            "interrupt": None,
            "thread_id": "",
        }

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)
        logger.error(f"[{task_id}] Step execution failed", error=error_msg)

        return {
            "status": "failed",
            "result": {
                "task_id": task_id,
                "status": "failed",
                "output": "",
                "error": error_msg,
                "duration_ms": duration_ms,
                "llm_prompt_trace": llm_prompt_trace,
            },
            "interrupt": None,
            "thread_id": "",
        }


async def resume_step(
    thread_id: str,
    human_response: dict,
    task_id: str = "",
) -> Dict[str, Any]:
    """Resume an interrupted step with the human response.

    Uses the same graph cache and resume machinery as full-playbook
    workflows instead of maintaining a separate per-step graph.
    """
    from src.flow_engine.legacy.workflow_service import resume_single_step

    return await resume_single_step(
        thread_id=thread_id,
        human_response=human_response,
        task_id=task_id,
    )


async def _execute_with_tools(
    settings,
    model_name: str,
    system_prompt: str,
    user_prompt: str,
    tools: List,
    task_id: str = "",
    collector=None,
    temperature: float = 0.7,
    on_progress: Optional[StepProgressCallback] = None,
    stream_final_output: bool = True,
) -> tuple:
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import SystemMessage, HumanMessage, ToolMessage

    llm = ChatOpenAI(
        base_url=settings.LITELLM_API_BASE_URL,
        api_key=settings.LITELLM_API_SECRET_KEY,
        model=model_name,
        temperature=temperature,
        model_kwargs={"user": get_user(), "parallel_tool_calls": True},
    )
    llm_with_tools = llm.bind_tools(tools)

    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ]

    tool_map = {t.name: t for t in tools}
    all_components = []
    total_usage = {
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
        "model": "",
    }
    tool_trace = []
    prompt_trace: List[Dict[str, Any]] = []

    for iteration in range(MAX_TOOL_ITERATIONS):
        _append_prompt_trace(
            prompt_trace,
            stage=f"tool_loop_iteration_{iteration + 1}",
            model=model_name,
            messages=[
                {
                    "role": getattr(message, "type", message.__class__.__name__),
                    "content": str(getattr(message, "content", "")),
                }
                for message in messages
            ],
        )
        messages = _cap_images_in_messages(messages)
        _est = sum(len(str(getattr(m, "content", ""))) for m in messages) // 4
        logger.info("Pre-LLM token estimate", estimated_tokens=_est, message_count=len(messages))
        if on_progress is not None and stream_final_output:
            response = await _stream_chat_response(
                llm_with_tools, messages, on_progress
            )
            if response is None:
                response = await llm_with_tools.ainvoke(messages)
        else:
            response = await llm_with_tools.ainvoke(messages)
        messages.append(response)

        iter_usage = _extract_usage(response)
        total_usage["input_tokens"] += iter_usage["input_tokens"]
        total_usage["output_tokens"] += iter_usage["output_tokens"]
        total_usage["total_tokens"] += iter_usage["total_tokens"]
        total_usage["model"] = iter_usage["model"] or total_usage["model"]

        if not response.tool_calls:
            return (
                response.content or "",
                all_components,
                total_usage,
                tool_trace,
                prompt_trace,
            )

        logger.info(
            "Tool calls in iteration",
            iteration=iteration,
            calls=[tc["name"] for tc in response.tool_calls],
            parallel=len(response.tool_calls) > 1,
        )

        async def _execute_single_tool(call_index: int, tool_call):
            tool = tool_map.get(tool_call["name"])
            if tool:
                try:
                    result = await tool.ainvoke(tool_call["args"])
                except Exception as e:
                    result = f"Error executing tool '{tool_call['name']}': {e}"
                    logger.error(
                        "Tool execution error", tool=tool_call["name"], error=str(e)
                    )
            else:
                result = f"Unknown tool: {tool_call['name']}"
                logger.warning("Unknown tool called", tool=tool_call["name"])
            return call_index, tool_call, result

        def _snapshot_tool_trace(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
            return [dict(entry) for entry in entries]

        current_tool_entries = [
            {
                "call_index": len(tool_trace) + idx + 1,
                "tool_name": tc["name"],
                "args": tc.get("args", {}),
                "output_summary": "Running...",
            }
            for idx, tc in enumerate(response.tool_calls)
        ]
        if on_progress is not None:
            await on_progress(
                {
                    "tool_trace": _snapshot_tool_trace(tool_trace)
                    + _snapshot_tool_trace(current_tool_entries),
                    "components": list(all_components),
                }
            )

        results_by_index: Dict[int, tuple[Dict[str, Any], Any]] = {}
        tasks = [
            asyncio.create_task(_execute_single_tool(idx, tc))
            for idx, tc in enumerate(response.tool_calls)
        ]

        for completed in asyncio.as_completed(tasks):
            idx, tool_call, result = await completed
            results_by_index[idx] = (tool_call, result)
            current_tool_entries[idx]["output_summary"] = _summarize_tool_result(result)

            if collector:
                new_components = collector.get_and_clear()
                all_components.extend(new_components)
                citation_components = [
                    component
                    for component in new_components
                    if isinstance(component, dict)
                    and component.get("type") == "citation"
                ]
                if citation_components:
                    logger.warning(
                        "[%s] PLAYBOOK_MCP_CITATION_DRAINED tool=%s citation_count=%s citations=%s",
                        task_id or "unknown_task",
                        tool_call["name"],
                        len(citation_components),
                        citation_components,
                    )

            if on_progress is not None:
                await on_progress(
                    {
                        "tool_trace": _snapshot_tool_trace(tool_trace)
                        + _snapshot_tool_trace(current_tool_entries),
                        "components": list(all_components),
                    }
                )

        iteration_images: List[str] = []
        for idx in range(len(response.tool_calls)):
            tool_call, result = results_by_index[idx]
            messages.append(
                ToolMessage(
                    content=_build_tool_text_content(result),
                    tool_call_id=tool_call["id"],
                )
            )
            parsed = _parse_tool_result(result)
            iteration_images.extend(_extract_images_from_result(parsed))

        if iteration_images:
            capped = iteration_images[:50]
            if len(iteration_images) > 50:
                logger.warning("Images capped per iteration", total=len(iteration_images), kept=50)
            vision_blocks: List[Dict[str, Any]] = [
                {"type": "text", "text": f"Images from tool results ({len(capped)} image(s)):"}
            ]
            for b64 in capped:
                vision_blocks.append(
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}
                )
            messages.append(HumanMessage(content=vision_blocks))
            logger.info("Vision images injected as HumanMessage", image_count=len(capped))

        tool_trace.extend(_snapshot_tool_trace(current_tool_entries))

    logger.warning("Max tool iterations reached", max=MAX_TOOL_ITERATIONS)
    last_content = messages[-1].content if hasattr(messages[-1], "content") else ""
    return (
        last_content or "Max tool iterations reached without a final response.",
        all_components,
        total_usage,
        tool_trace,
        prompt_trace,
    )


async def _execute_replay_tool_calls(
    tools: List,
    collector,
    validated_replay: Dict[str, Any],
    prompt_trace: Optional[List[Dict[str, Any]]] = None,
    adaptive: bool = False,
    adaptation_context: Optional[Dict[str, Any]] = None,
    settings=None,
    model_name: Optional[str] = None,
    on_progress: Optional[StepProgressCallback] = None,
    prompt_overrides: Optional[Dict[str, str]] = None,
) -> tuple[str, List[Dict[str, Any]], List[Dict[str, Any]], str]:
    tool_map = {tool.name: tool for tool in tools}
    all_components: List[Dict[str, Any]] = []
    tool_trace: List[Dict[str, Any]] = []
    synthesis_entries: List[str] = []
    replay_id = validated_replay.get("replay_id", "")
    replay_task_id = validated_replay.get("task_id", "")

    logger.info(
        "[replay_executor] EXECUTE_REPLAY_TOOL_CALLS_START",
        replay_id=replay_id,
        replay_task_id=replay_task_id,
        tool_call_count=len(validated_replay.get("tool_calls", []) or []),
        available_tools=list(tool_map.keys()),
        adaptive=adaptive,
    )

    for recorded_call in validated_replay.get("tool_calls", []) or []:
        tool_name = recorded_call.get("tool_name") or ""
        tool_args = recorded_call.get("args") or {}
        call_index = int(recorded_call.get("call_index", len(tool_trace) + 1))
        tool = _resolve_replay_tool(tool_name, tool_args, tool_map)
        if tool is None:
            logger.error(
                "[replay_executor] EXECUTE_REPLAY_TOOL_CALLS_UNKNOWN_TOOL",
                replay_id=replay_id,
                replay_task_id=replay_task_id,
                call_index=call_index,
                tool_name=tool_name,
            )
            raise ValueError(f"Validated replay references unknown tool '{tool_name}'")

        if adaptive:
            tool_args = await _adapt_replay_tool_args(
                settings=settings,
                model_name=model_name or "gpt-5.4-mini",
                recorded_call=recorded_call,
                adaptation_context=adaptation_context or {},
                previous_outputs=synthesis_entries,
                prompt_trace=prompt_trace,
                prompt_overrides=prompt_overrides,
            )

        logger.info(
            "[replay_executor] EXECUTE_REPLAY_TOOL_CALL",
            replay_id=replay_id,
            replay_task_id=replay_task_id,
            call_index=call_index,
            tool_name=tool_name,
            tool_args_preview=_summarize_tool_args(tool_args),
        )
        if on_progress is not None:
            await on_progress(
                {
                    "tool_trace": tool_trace
                    + [
                        {
                            "call_index": call_index,
                            "tool_name": tool_name,
                            "args": tool_args,
                            "output_summary": "Running...",
                        }
                    ],
                    "components": list(all_components),
                }
            )
        result = await tool.ainvoke(tool_args)
        tool_trace.append(
            {
                "call_index": call_index,
                "tool_name": tool_name,
                "args": tool_args,
                "output_summary": _summarize_tool_result(result),
            }
        )
        logger.info(
            "[replay_executor] EXECUTE_REPLAY_TOOL_CALL_DONE",
            replay_id=replay_id,
            replay_task_id=replay_task_id,
            call_index=call_index,
            tool_name=tool_name,
            output_summary=_summarize_tool_result(result, max_length=300),
        )
        synthesis_entries.append(
            f"Tool call {tool_trace[-1]['call_index']}: {tool_name}\n"
            f"Args: {tool_args}\n"
            f"Output:\n{_summarize_tool_result(result, max_length=6000)}"
        )

        if collector:
            all_components.extend(collector.get_and_clear())
        if on_progress is not None:
            await on_progress(
                {
                    "tool_trace": list(tool_trace),
                    "components": list(all_components),
                }
            )

    return (
        validated_replay.get("reference_output", "") or "",
        all_components,
        tool_trace,
        "\n\n".join(synthesis_entries),
    )


def _resolve_replay_tool(
    recorded_tool_name: str,
    recorded_tool_args: Dict[str, Any],
    tool_map: Dict[str, Any],
):
    exact = tool_map.get(recorded_tool_name)
    if exact is not None:
        return exact

    # Backward-compatible aliases for native search tools whose availability can
    # vary with current input scoping but still represent the same replay intent.
    if recorded_tool_name in {
        "perform_filtered_search",
        "perform_document_search",
        "perform_standard_search",
    }:
        query_value = recorded_tool_args.get("query")
        for alias in (
            "perform_filtered_search",
            "perform_document_search",
            "perform_standard_search",
        ):
            tool = tool_map.get(alias)
            if tool is not None and isinstance(query_value, str):
                return tool

    # Connector MCP tools are generated dynamically as {connector_slug}_{action_key}.
    # Allow replay records that stored only the action key to resolve the current tool.
    suffix = f"_{recorded_tool_name}"
    matches = [tool for name, tool in tool_map.items() if name.endswith(suffix)]
    if len(matches) == 1:
        return matches[0]

    return None


async def _adapt_replay_tool_args(
    settings,
    model_name: str,
    recorded_call: Dict[str, Any],
    adaptation_context: Dict[str, Any],
    previous_outputs: List[str],
    prompt_trace: Optional[List[Dict[str, Any]]] = None,
    prompt_overrides: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    if settings is None:
        raise ValueError("Adaptive replay requires settings")

    original_args = recorded_call.get("args") or {}
    tool_name = recorded_call.get("tool_name", "")
    prompt_registry = load_prompt_registry(prompt_overrides)
    system_prompt = resolve_prompt_template(
        prompt_registry,
        "replay.adaptive_tool_args",
        field="systemTemplate",
        fallback=(
            "You rewrite tool arguments for adaptive replay.\n"
            "Keep the same tool intent and the same JSON shape.\n"
            "Only change values that are necessary to align with the current task context.\n"
            "Return JSON only."
        ),
    )
    user_prompt_template = resolve_prompt_template(
        prompt_registry,
        "replay.adaptive_tool_args",
        field="userTemplate",
        fallback=(
            "Tool name: {{toolName}}\nOriginal args JSON:\n{{originalArgsJson}}\n\n"
            "Reference task title: {{referenceTaskTitle}}\nReference task description: {{referenceTaskDescription}}\n\n"
            "Current task title: {{taskTitle}}\nCurrent task description: {{taskDescription}}\nCurrent user query: {{currentQuery}}\nDependency context: {{dependencyContext}}\n\n"
            "Previous replay tool outputs:\n{{previousOutputs}}\n\n"
            "Return the adapted args as JSON with the same top-level keys as the original args."
        ),
    )
    user_prompt = (
        user_prompt_template.replace("{{toolName}}", str(tool_name))
        .replace(
            "{{originalArgsJson}}",
            json.dumps(original_args, ensure_ascii=True, indent=2),
        )
        .replace(
            "{{referenceTaskTitle}}",
            str(adaptation_context.get("reference_task_title", "")),
        )
        .replace(
            "{{referenceTaskDescription}}",
            str(adaptation_context.get("reference_task_description", "")),
        )
        .replace("{{taskTitle}}", str(adaptation_context.get("task_title", "")))
        .replace(
            "{{taskDescription}}", str(adaptation_context.get("task_description", ""))
        )
        .replace("{{currentQuery}}", str(adaptation_context.get("current_query", "")))
        .replace(
            "{{dependencyContext}}",
            str(adaptation_context.get("dependency_context", "")),
        )
        .replace(
            "{{previousOutputs}}",
            chr(10).join(previous_outputs[-2:]) if previous_outputs else "None",
        )
    )
    response_text, _usage = await _llm_call(
        settings,
        model_name,
        system_prompt,
        user_prompt,
        temperature=0.2,
        prompt_trace=prompt_trace,
        stage=f"adaptive_rewrite_{tool_name or 'tool'}",
    )
    adapted_args = _extract_json_object(response_text)
    if not isinstance(adapted_args, dict):
        raise ValueError("Adaptive replay returned invalid args payload")
    logger.info(
        "[replay_executor] ADAPT_REPLAY_TOOL_ARGS",
        tool_name=tool_name,
        original_args_preview=_summarize_tool_args(original_args),
        adapted_args_preview=_summarize_tool_args(adapted_args),
    )
    return adapted_args


async def _llm_call(
    settings,
    model_name: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.7,
    prompt_trace: Optional[List[Dict[str, Any]]] = None,
    stage: str = "llm_call",
    on_progress: Optional[StepProgressCallback] = None,
) -> tuple:
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import SystemMessage, HumanMessage

    llm = ChatOpenAI(
        base_url=settings.LITELLM_API_BASE_URL,
        api_key=settings.LITELLM_API_SECRET_KEY,
        model=model_name,
        temperature=temperature,
        model_kwargs={"user": get_user()},
    )
    _append_prompt_trace(
        prompt_trace,
        stage=stage,
        model=model_name,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ]
    if on_progress is not None:
        result = await _stream_chat_response(llm, messages, on_progress)
        if result is None:
            result = await llm.ainvoke(messages)
    else:
        result = await llm.ainvoke(messages)
    return _content_to_text(result.content), _extract_usage(result)
