"""Runtime-only temporary child-agent tool for delegated agents."""

import copy
import uuid
from typing import Any, Dict, Optional

from src.logger.logging import get_logger
from src.smart_rag.engines.multi_agent.config import langfuse_client

logger = get_logger("api.smart_rag.temporary_child_agent")

TEMPORARY_CHILD_AGENT_PARENT_INSTRUCTION = """
Temporary child-agent rule:
You are the evaluator/orchestrator for this delegated task. Because temporary
child agents are enabled, you must call `create_temporary_child_agent` at least
once before final answering. You may create more children with refined task
descriptions until the evidence is sufficient or the child limit is reached.
Evaluate all child results and return the best final answer.
""".strip()


class _DiscardingQueue:
    async def put(self, item: Any) -> None:
        return None


def should_enable_temporary_child_agent_tool(agent_config: Dict[str, Any]) -> bool:
    """Return whether a parent agent must receive the child-agent tool."""
    agent_params = agent_config.get("agent_params") or {}
    flag = str(agent_params.get("enable_temporary_child_agents", "false")).lower()
    is_child = bool(agent_config.get("_is_temporary_child_agent"))
    enabled = flag == "true" and not is_child
    logger.info(
        "[TEMP CHILD] Tool eligibility agent=%s enable_temporary_child_agents=%s "
        "max_temporary_child_agents=%s is_child=%s enabled=%s",
        agent_config.get("id") or agent_config.get("name"),
        agent_params.get("enable_temporary_child_agents"),
        agent_params.get("max_temporary_child_agents"),
        is_child,
        enabled,
    )
    return enabled


def make_temporary_child_agent_tool(
    team: Any,
    parent_agent_config: Dict[str, Any],
    parent_span: Any,
    image_input: Optional[list] = None,
) -> Any:
    """Build an ADK tool that lets a parent mono agent run temporary children."""
    agent_params = parent_agent_config.get("agent_params") or {}
    max_children = _parse_child_limit(agent_params.get("max_temporary_child_agents", 4))
    counter = {"count": 0}

    async def create_temporary_child_agent(
        task_description: str,
        expected_output: str = "",
        delegate_images: bool = False,
    ) -> str:
        """Create a temporary child agent for one focused subtask and return its result.

        Call this for one focused subtask before final answering. The child
        inherits your tools, skills, connectors, MCP config, workspace context,
        and model settings, but it cannot create more temporary children.
        """
        if counter["count"] >= max_children:
            logger.info(
                "[TEMP CHILD] Child limit reached parent=%s max=%s",
                parent_agent_config.get("id"),
                max_children,
            )
            return f"Temporary child-agent limit reached ({max_children})."
        counter["count"] += 1

        child_config = _build_child_config(parent_agent_config, task_description, counter["count"])
        child_name = child_config["name"]
        normalized_name = team.agent_helper.normalize_agent_name(child_name)
        child_span = langfuse_client.span(
            trace_id=team.config.session_id,
            parent_observation_id=parent_span.id if parent_span else None,
            name=f"temporary_child_{counter['count']}",
            input={"task_description": task_description, "parent_agent": parent_agent_config.get("name")},
        )

        logger.info(
            "[TEMP CHILD] Creating temporary child agent parent=%s child=%s count=%s/%s session=%s",
            parent_agent_config.get("id"),
            child_config.get("id"),
            counter["count"],
            max_children,
            team.config.session_id,
        )
        agent, toolkit = await team.delegation_factory._create_agent_with_error_handling(
            child_config,
            child_name,
            normalized_name,
            expected_output,
            child_span,
            False,
            team.citation_manager,
        )
        if agent is None:
            logger.warning("[TEMP CHILD] Child agent creation failed child=%s", child_config.get("id"))
            return "Temporary child agent could not be created."

        child_queue = _DiscardingQueue()
        resolved_images = image_input if delegate_images and image_input else None
        result = await team.delegation_factory._execute_agent_with_error_handling(
            agent,
            child_config,
            task_description,
            expected_output,
            expected_output,
            child_span,
            child_queue,
            child_name,
            child_config.get("id", "no_id"),
            toolkit,
            image_input=resolved_images,
        )
        if not result:
            return "Temporary child agent returned no result."
        logger.info(
            "[TEMP CHILD] Child completed parent=%s child=%s",
            parent_agent_config.get("id"),
            child_config.get("id"),
        )
        return str(result)

    return create_temporary_child_agent


def _parse_child_limit(raw_value: Any) -> int:
    try:
        return max(1, min(8, int(raw_value)))
    except (TypeError, ValueError):
        logger.warning("Invalid max_temporary_child_agents value %r; using default", raw_value)
        return 4


def _build_child_config(parent_config: Dict[str, Any], task_description: str, ordinal: int) -> Dict[str, Any]:
    child_config = copy.deepcopy(parent_config)
    parent_id = str(parent_config.get("id") or "agent")
    child_id = f"{parent_id}_tmp_{uuid.uuid4().hex[:8]}"
    child_config.update(
        {
            "id": child_id,
            "name": f"{parent_config.get('name', 'Agent')} Child {ordinal}",
            "description": task_description,
            "save_memory": False,
            "_is_temporary_child_agent": True,
        }
    )
    child_config["prompt"] = (
        f"{parent_config.get('prompt', '')}\n\n"
        "You are a temporary child agent. Complete only the focused subtask "
        "assigned to you. Use the inherited tools and connectors when retrieval "
        "is needed. Return concise findings with citations or evidence details "
        "so the parent agent can synthesize the final answer."
    )
    agent_params = child_config.setdefault("agent_params", {})
    agent_params["session_id"] = f"{parent_id}:temporary_child:{child_id}"
    agent_params["enable_temporary_child_agents"] = "false"
    return child_config
