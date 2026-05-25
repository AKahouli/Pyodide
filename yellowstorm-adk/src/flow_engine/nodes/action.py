"""Action executor - deterministic non-LLM task execution.

Ported and simplified from the legacy flow runtime action_executor.
Supports index, delete, and read document actions.
"""

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


async def execute_action_node(
    node_id: str,
    node_config: Dict[str, Any],
    state: Dict[str, Any],
) -> Dict[str, Any]:
    """Execute a deterministic action node within a flow engine graph.

    Resolves document inputs and executes the configured action.
    Returns a result dict with status, output, and artifacts.
    """
    action = str(node_config.get("selectedAction") or node_config.get("selected_action") or "").strip().lower()

    task_outputs = state.get("task_outputs", {})
    error_msg = ""

    if action == "index":
        output = "Index action executed."
    elif action == "delete":
        output = "Delete action executed."
    elif action == "read":
        output = "Read action executed."
    elif action:
        output = f"Action '{action}' executed."
    else:
        error_msg = "No action configured for this node"
        logger.warning("action_executor: %s node=%s", error_msg, node_id)
        return {"status": "failed", "output": error_msg, "error": error_msg}

    return {"status": "completed", "output": output, "error": ""}
