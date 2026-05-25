"""Node advisor - suggests improvements for flow nodes.

Ported from the legacy flow runtime playbook_node_advisor.
Adapted for iteration awareness.
"""

from typing import Any, Dict, List, Optional


async def analyze_node(
    node_id: str,
    node_config: Dict[str, Any],
    flow_context: Dict[str, Any],
    iteration: int = 0,
) -> List[Dict[str, Any]]:
    """Analyze a flow node and suggest improvements.

    Args:
        node_id: The node identifier.
        node_config: Node configuration dict.
        flow_context: Full flow context (nodes, edges, bindings).
        iteration: Current iteration number for context.

    Returns:
        List of suggestion dicts with type, title, summary, confidence.
    """
    suggestions: List[Dict[str, Any]] = []

    title = node_config.get("label") or node_config.get("title") or node_id
    if not node_config.get("label") and not node_config.get("title"):
        suggestions.append({
            "id": f"adv-{node_id}-title",
            "type": "task_title",
            "title": "Add descriptive label",
            "summary": f"Node '{node_id}' has no label.",
            "rationale": "Descriptive labels improve readability and debugging.",
            "confidence": 0.8,
        })

    input_ports = node_config.get("input", {}).get("ports") or []
    if not input_ports:
        suggestions.append({
            "id": f"adv-{node_id}-ports",
            "type": "input_contract",
            "title": "Define input ports",
            "summary": f"Node '{title}' has no input ports defined.",
            "rationale": "Explicit input ports make data flow visible and debuggable.",
            "confidence": 0.7,
        })

    return suggestions
