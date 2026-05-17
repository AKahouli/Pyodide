"""Pure prompt rendering for step nodes."""

from __future__ import annotations

import json
from typing import Any


def build_step_prompt(
    label: str,
    node_id: str,
    input_context: dict[str, Any],
    node_description: str = "",
    output_contract: dict[str, Any] | None = None,
    iteration: int = 0,
    trigger_context: dict[str, Any] | None = None,
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
        "Complete this node using only the resolved input data and declared output contract.",
    ])
    return "\n".join(lines)
