"""Design-time playbook node advisor helpers."""

from __future__ import annotations

from typing import Any


def advise_playbook_node(request: dict[str, Any]) -> dict[str, Any]:
    """Return structured node-level advisor suggestions.

    The first version keeps logic deterministic and lightweight so the backend
    contract is stable before richer model-backed suggestions are added.
    """

    task = request.get("target_task") or {}
    task_id = str(request.get("task_id") or task.get("id") or "")
    playbook_id = str(request.get("playbook_id") or "")
    suggestion_types = set(request.get("suggestion_types") or [])

    suggestions: list[dict[str, Any]] = []

    title = str(task.get("title") or "").strip()
    description = str(task.get("description") or "").strip()
    assigned_agent_id = str(task.get("assigned_agent_id") or "").strip()
    input_ports = task.get("input_ports") or []

    if not suggestion_types or "task_title" in suggestion_types:
        if title and len(title) > 72:
            suggestions.append(
                {
                    "id": f"{task_id}-task-title",
                    "type": "task_title",
                    "title": "Tighten the task title",
                    "summary": "The task title is long and can be made more scannable on the canvas.",
                    "rationale": "Shorter task titles are easier to scan inside dense workflows.",
                    "confidence": 0.81,
                    "patch": {"task_title": title[:72].rstrip()},
                }
            )

    if not suggestion_types or "task_description" in suggestion_types:
        if description and len(description) < 24:
            suggestions.append(
                {
                    "id": f"{task_id}-task-description",
                    "type": "task_description",
                    "title": "Clarify the task description",
                    "summary": "This node would benefit from a more explicit instruction for the assigned agent.",
                    "rationale": "Short descriptions often leave execution intent ambiguous.",
                    "confidence": 0.77,
                    "patch": {"task_description": f"{description}\n\nSpecify the expected outcome, constraints, and output format.".strip()},
                }
            )

    if not suggestion_types or "agent_selection" in suggestion_types:
        if not assigned_agent_id:
            suggestions.append(
                {
                    "id": f"{task_id}-agent-selection",
                    "type": "agent_selection",
                    "title": "Assign an agent",
                    "summary": "This node has no assigned agent yet.",
                    "rationale": "Agent-backed nodes need an explicit owner before they can be executed safely.",
                    "confidence": 0.92,
                    "warnings": ["No automatic agent patch is provided because the available agent catalog is not passed to ADK yet."],
                }
            )

    if not suggestion_types or "datasource_connection" in suggestion_types:
        unbound_required_ports = [port for port in input_ports if port.get("required") is True]
        if unbound_required_ports:
            suggestions.append(
                {
                    "id": f"{task_id}-datasource-connection",
                    "type": "datasource_connection",
                    "title": "Review datasource connections",
                    "summary": "This task has required input ports that should be reviewed for datasource bindings.",
                    "rationale": "Required inputs should be mapped before execution to avoid incomplete node runs.",
                    "confidence": 0.7,
                    "patch": {
                        "input_ports": [
                            {
                                "id": str(port.get("id") or ""),
                                "name": str(port.get("name") or ""),
                                "artifact_kind": str(port.get("artifact_kind") or ""),
                                "description": str(port.get("description") or ""),
                            }
                            for port in unbound_required_ports
                        ],
                        "datasource_suggestions": [],
                    },
                    "warnings": ["Datasource auto-mapping requires frontend apply logic and workspace context ranking."],
                }
            )

    if not suggestions:
        suggestions.append(
            {
                "id": f"{task_id or 'node'}-general",
                "type": "general",
                "title": "Node looks structurally ready",
                "summary": "No immediate low-risk edits were detected for this node.",
                "rationale": (
                    "The current advisor only flags a small set of deterministic heuristics: long titles, "
                    "short descriptions, missing agent assignment, and required input ports that need review."
                ),
                "confidence": 0.58,
                "warnings": [
                    "This is a fallback review result. Richer suggestions require the planned LLM-backed advisor logic.",
                ],
            }
        )

    return {
        "playbook_id": playbook_id,
        "task_id": task_id,
        "suggestions": suggestions,
    }
