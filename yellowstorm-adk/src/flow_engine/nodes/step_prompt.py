"""Pure prompt rendering for step nodes."""

from __future__ import annotations

import json
from typing import Any

from src.flow_engine.nodes.step_tool_scope import sanitize_trigger_context_for_prompt


_PLAYBOOK_WORKSPACE_METADATA_KEYS = {
    "__playbook_workspace_ids",
    "__playbook_workspace_paths",
    "__playbook_default_workspace_id",
    "__playbook_default_workspace_path",
}


def _without_playbook_workspace_metadata(context: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in context.items()
        if key not in _PLAYBOOK_WORKSPACE_METADATA_KEYS
    }


def _playbook_default_workspace(context: dict[str, Any]) -> dict[str, str]:
    workspace_id = str(context.get("__playbook_default_workspace_id") or "").strip()
    workspace_path = str(context.get("__playbook_default_workspace_path") or "").strip()
    workspace_paths = context.get("__playbook_workspace_paths")
    if not workspace_path and workspace_id and isinstance(workspace_paths, dict):
        workspace_path = str(workspace_paths.get(workspace_id) or "").strip()

    workspace: dict[str, str] = {}
    if workspace_id:
        workspace["workspace_id"] = workspace_id
    if workspace_path:
        workspace["workspace_path"] = workspace_path
    return workspace


def _port_schema_entry(port: dict[str, Any]) -> dict[str, Any]:
    port_id = str(port.get("id") or "default")
    kind = str(port.get("type") or "text")
    entry: dict[str, Any] = {
        "output_port_id": port_id,
        "output_port_label": str(port.get("label") or ""),
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
    hitl_policy: dict[str, Any] | None = None,
    hitl_blockers: list[dict[str, Any]] | None = None,
    human_context: list[dict[str, Any]] | None = None,
    hitl_memory: list[dict[str, Any]] | None = None,
) -> str:
    prompt_input_workspace_context = sanitize_trigger_context_for_prompt(input_context or {})
    prompt_input_context = _without_playbook_workspace_metadata(prompt_input_workspace_context)
    prompt_trigger_context = (
        sanitize_trigger_context_for_prompt(trigger_context)
        if trigger_context
        else None
    )
    playbook_default_workspace = _playbook_default_workspace(prompt_input_workspace_context)
    if not playbook_default_workspace and prompt_trigger_context:
        playbook_default_workspace = _playbook_default_workspace(prompt_trigger_context)
    if prompt_trigger_context:
        prompt_trigger_context = _without_playbook_workspace_metadata(prompt_trigger_context)

    lines = [
#        "Task Title:",
#        label,
        "Task Node ID:",
        node_id,
    ]
    if node_description:
        lines.extend(["", "Task Description:", node_description])
    lines.extend(["", "Iteration:", str(iteration)])
    lines.extend([
        "",
        "Resolved Inputs:",
        json.dumps(prompt_input_context, indent=2, default=str),
    ])
    if playbook_default_workspace:
        lines.extend([
            "",
            "Playbook Default Workspace:",
            json.dumps(playbook_default_workspace, indent=2, default=str),
        ])
    if prompt_trigger_context and prompt_trigger_context != prompt_input_context:
        lines.extend([
            "",
            "Trigger Context:",
            json.dumps(prompt_trigger_context, indent=2, default=str),
        ])
    if output_contract:
        lines.extend([
            "",
            "Below are the Output Contract:",
            json.dumps(output_contract, indent=2, default=str),
        ])
    if human_context or hitl_memory:
        lines.extend([
            "",
            "Human guidance from earlier workflow steps:",
            json.dumps(human_context or [], indent=2, default=str),
            "",
            "Reusable HITL memory:",
            json.dumps(hitl_memory or [], indent=2, default=str),
            "",
            "Human guidance instruction:",
            "Apply earlier human guidance when relevant; if it conflicts with current instructions, pause for clarification.",
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
            "Return JSON only using the **EXACT** shape below.",
            json.dumps(response_schema, indent=2, default=str),
            "All string values must always use \" for any double quote inside the value.",
            "`display_text` is the final human-readable answer and must always be plain markdown. Never embed a JSON object inside it.",  
            "Each item in `outputs` must target one declared output port.",
            "Do not put reasoning steps inside `outputs`; reasoning steps belong only in top-level `reasoning_trace`.",
            "For document outputs, use `filename` and `filepath` (not `content`).",
            "For text/code outputs, use `content` for the string payload.",
            "Must always generate markdown For text outputs ; Whenever the response includes numerical data, categories, comparisons, or structured lists, format the output as a Markdown table to maximize readability.",
            "For data outputs, use `content` for the structured JSON payload.; generate just the JSON noextra text.",
            "`reasoning_trace` is an array of objects describing your reasoning steps.",
            'Each item has: id (string), type (string), label (string), description (string), confidence (number 0-1, optional)'
        ])
    else:
      lines.extend([
        """Reasoning Trace:
After your final answer, you MUST ALWAYS append a separate reasoning trace JSON block on a new line using the exact format below.
CRITICAL CONSTRAINTS FOR TRACE CONTENT:
To prevent bias injection, your trace must be strictly abstract and process-oriented. 
1. DO NOT include specific facts, entity names, numbers, data values, or search results in the `label` or `description` fields.
2. Describe the *cognitive steps* you took (e.g., "extracted metrics", "identified entities"), NOT the *data* you found (e.g., "extracted $10M", "identified Agrial").

Format Requirements: 
Keys must be: id (string), type (string), label (string), description (string), confidence (number 0-1, optional).

Good Example (Abstract Process - DO THIS):
---PUBLIC_REASONING_TRACE_JSON---
[{"id":"step_1","type":"observation","label":"Identified candidate entities","description":"Selected entities from search results matching the geographical and sector criteria.","confidence":0.96}]

Bad Example (Contains Facts - DO NOT DO THIS):
---PUBLIC_REASONING_TRACE_JSON---
[{"id":"step_1","type":"observation","label":"Identified InVivo and Agrial","description":"Selected company A, company B, and  company C from French agro-sector cooperatives.","confidence":0.96}]
"""
    ])
    return "\n".join(lines)
