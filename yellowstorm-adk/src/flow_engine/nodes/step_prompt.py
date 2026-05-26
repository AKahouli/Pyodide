"""Pure prompt rendering for step nodes."""

from __future__ import annotations

import json
from typing import Any


def _port_schema_entry(port: dict[str, Any]) -> dict[str, Any]:
    port_id = str(port.get("id") or "default")
    kind = str(port.get("type") or "text")
    entry: dict[str, Any] = {
        "output_port_id": port_id,
        "artifact_kind": kind,
    }
    if kind == "document":
        entry["filename"] = "the generated file name including extension"
        entry["filepath"] = "the storage path of the generated file"
    else:
        entry["content"] = "return the value for this port"
    return entry


def build_step_prompt(
    label: str,
    node_id: str,
    input_context: dict[str, Any],
    node_description: str = "",
    output_contract: dict[str, Any] | None = None,
    iteration: int = 0,
    trigger_context: dict[str, Any] | None = None,
    require_structured_output: bool = False,
) -> str:
    lines = [
        "Task Title:",
        label,
        "",
        "Task Node ID:",
        node_id,
    ]
    if node_description:
        lines.extend(["", "Task Description:", node_description])
    lines.extend(["", "Iteration:", str(iteration)])
    lines.extend([
        "",
        "Resolved Inputs:",
        json.dumps(input_context or {}, indent=2, default=str),
    ])
    if trigger_context and trigger_context != input_context:
        lines.extend([
            "",
            "Trigger Context:",
            json.dumps(trigger_context, indent=2, default=str),
        ])
    if output_contract:
        lines.extend([
            "",
            "Output Contract:",
            json.dumps(output_contract, indent=2, default=str),
        ])
    lines.extend([
        "",
        "Instructions:",
        "Complete this node using only the resolved input data (if applicable/available) and declared output contract.",
    ])
    if require_structured_output:
        ports = output_contract.get("ports") if isinstance(output_contract, dict) else []
        response_schema = {
            "display_text": "user-visible final answer",
            "outputs": [
                _port_schema_entry(port)
                for port in ports
                if isinstance(port, dict)
            ],
            "reasoning_trace": [
                {"id": "step_1", "type": "observation", "label": "Step description", "description": "What you did and why.", "confidence": 0.9},
            ],
        }
        lines.extend([
            "",
            "Response Format:",
            "Return JSON only using the exact shape below.",
            json.dumps(response_schema, indent=2, default=str),
            "`display_text` is the final human-readable answer.",
            "Each item in `outputs` must target one declared output port.",
            "Do not put reasoning steps inside `outputs`; reasoning steps belong only in top-level `reasoning_trace`.",
            "For document outputs, use `filename` and `filepath` (not `content`).",
            "For text/code outputs, use `content` for the string payload.",
            "For data outputs, use `content` for the structured JSON payload.",
            "`reasoning_trace` is an array of objects describing your reasoning steps.",
            'Each item has: id (string), type (string), label (string), description (string), confidence (number 0-1, optional), it should respect strictly this JSON format : [{"id":"step_1","type":"observation","label":"Analyzed input","description":"Examined the resolved inputs for patterns.","confidence":0.9}]'
        ])
    else:
        lines.extend([
        "",
        "Reasoning Trace:",
        "After your final answer, **MUST ALWAYS append** a separate reasoning trace JSON block on a new line using this exact format:",
        "Example:",
        "---PUBLIC_REASONING_TRACE_JSON---",
        '[{"id":"step_1","type":"observation","label":"Analyzed input","description":"Examined the resolved inputs for patterns.","confidence":0.9}]',
        "where keys: id (string), type (string), label (string), description (string), confidence (number 0-1, optional). Each item represents one step of your reasoning process."  
        

    ])
    return "\n".join(lines)
