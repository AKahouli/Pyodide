"""Plan Generator Tool Module"""

import json
from typing import List, Dict
from src.logger.logging import get_logger

logger = get_logger("api.smart_rag.tools.plan_generator")


async def generate_execution_plan(
    title: str,
    steps: str
) -> str:
    """Generate an execution plan with task-agent assignments.

    Args:
        title: Title of the execution plan
        steps: JSON string containing array of step objects with 'task', 'agent', and 'status' fields
            Example: '[{"task": "Search documents", "agent": "search_agent", "status": "pending"}, ...]'

    Returns:
        str: JSON string with plan data
    """
    try:
        steps_list = json.loads(steps)

        if not isinstance(steps_list, list):
            raise ValueError("Steps must be an array")

        for idx, step in enumerate(steps_list):
            if not isinstance(step, dict):
                raise ValueError(f"Step {idx} must be an object")
            if "task" not in step or "agent" not in step:
                raise ValueError(f"Step {idx} missing required fields 'task' or 'agent'")
            if "status" not in step:
                step["status"] = "pending"

        plan_data = {
            "title": title,
            "steps": steps_list,
            "status": "active"
        }

        logger.info(f"[PlanTool] Generated plan: {title} with {len(steps_list)} steps")

        return json.dumps(plan_data)

    except Exception as e:
        error_msg = f"Failed to generate execution plan: {str(e)}"
        logger.error(error_msg)
        return json.dumps({"error": error_msg})
