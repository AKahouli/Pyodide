"""Runtime-only temporary child-agent tool for delegated agents."""

import copy
import json
import uuid
from typing import Any, Dict, Optional

from src.logger.logging import get_logger
from src.temporary_child_summary import (
    record_temporary_child_result,
    record_temporary_child_start,
)
from src.smart_rag.engines.multi_agent.config import langfuse_client

logger = get_logger("api.smart_rag.temporary_child_agent")

TEMPORARY_CHILD_AGENT_PARENT_INSTRUCTION = """
Temporary child-agent rule:
You are the evaluator/orchestrator for this delegated task. Temporary child
agents are enabled, and the required first temporary child result has already
been provided in your task context. Call `create_temporary_child_agent` again
only when you decide more evidence or verification is needed, until the evidence
is sufficient or the child limit is reached. You may create additional children
sequentially, or in parallel if supported.

Your role is only to evaluate, compare, and synthesize the temporary child
results. Do not use skills, MCP connector tools, retrieval tools, code tools, or
other operational tools directly. The temporary children inherit and use those
tools. If more tool work is needed, create another temporary child with a focused
task. Evaluate all child results and return the best final answer.
""".strip()


_CHILD_RESULT_COMPONENT_TYPES = {
    "artifact",
    "chart",
    "citation",
    "sandbox",
    "sources",
    "web_preview",
}


class _ChildResultQueue:
    def __init__(self, activity_queue: Any = None) -> None:
        self._text_chunks: list[str] = []
        self._components: list[dict[str, Any]] = []
        self._activity_queue = activity_queue

    async def put(self, item: Any) -> None:
        if not isinstance(item, dict):
            return
        component = item.get("component")
        if isinstance(component, dict):
            if component.get("type") == "tool_info" and self._activity_queue is not None:
                await self._activity_queue.put(item)
            self._collect_component(component)
            return
        chunk = str(item.get("chunk") or "")
        content_type = str(item.get("content_type") or "")
        if content_type in {"chunk", "final_response", "source"} and chunk.strip():
            self._text_chunks.append(chunk)

    def to_parent_result(self, result: Any) -> str:
        final_text = str(result or "").strip() or "".join(self._text_chunks).strip()
        if not self._components:
            return final_text
        payload = json.dumps(self._components, ensure_ascii=False, default=str)
        return (
            f"{final_text}\n\n"
            "<child_visible_output_components>\n"
            f"{payload}\n"
            "</child_visible_output_components>"
        )

    def _collect_component(self, component: dict[str, Any]) -> None:
        component_type = str(component.get("type") or "")
        component_data = component.get("data")
        if component_type == "text" and isinstance(component_data, dict):
            content = str(component_data.get("content") or "")
            if content.strip():
                self._text_chunks.append(content)
            return
        if component_type in _CHILD_RESULT_COMPONENT_TYPES:
            self._components.append(
                {
                    "type": component_type,
                    "data": component_data if isinstance(component_data, dict) else {},
                }
            )


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

        Call this for an additional focused subtask when more evidence or
        verification is needed. The child inherits your tools, skills,
        connectors, MCP config, workspace context, and model settings, but it
        cannot create more temporary children.
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
        record_temporary_child_start(
            session_id=team.config.session_id,
            parent=str(parent_agent_config.get("id") or parent_agent_config.get("name") or ""),
            child=str(child_config.get("id") or child_name),
            task_description=task_description,
            expected_output=expected_output,
            execution_mode="model_tool_call_sequential",
        )
        child_config["agent_params"]["temporary_child_summary_session_id"] = team.config.session_id
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
            record_temporary_child_result(
                session_id=team.config.session_id,
                child=str(child_config.get("id") or child_name),
                result="Temporary child agent could not be created.",
                status="failed",
            )
            return "Temporary child agent could not be created."

        child_queue = _ChildResultQueue(getattr(team, "current_queue", None))
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
        parent_result = child_queue.to_parent_result(result)
        if not parent_result:
            record_temporary_child_result(
                session_id=team.config.session_id,
                child=str(child_config.get("id") or child_name),
                result="Temporary child agent returned no result.",
                status="empty",
            )
            return "Temporary child agent returned no result."
        logger.info(
            "[TEMP CHILD] Child completed parent=%s child=%s",
            parent_agent_config.get("id"),
            child_config.get("id"),
        )
        record_temporary_child_result(
            session_id=team.config.session_id,
            child=str(child_config.get("id") or child_name),
            result=parent_result,
        )
        return parent_result

    return create_temporary_child_agent


def build_required_temporary_child_task(task_description: str) -> str:
    return (
        "Run the required first temporary-child pass for this parent task. "
        "Gather or verify the key evidence the parent should consider.\n\n"
        f"{task_description}"
    )


def append_required_temporary_child_context(task_description: str, child_result: Any) -> str:
    return (
        f"{task_description}\n\n"
        "<required_temporary_child_result>\n"
        f"{str(child_result or '')}\n"
        "</required_temporary_child_result>"
    )


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
        "assigned to you. Use the inherited skills, MCP connector tools, "
        "retrieval tools, code tools, and workspace context when needed. Return "
        "concise findings with citations or evidence details so the parent "
        "agent can synthesize the final answer.\n\n"
        f"{_build_inherited_context(parent_config)}"
    )
    agent_params = child_config.setdefault("agent_params", {})
    agent_params["session_id"] = f"{parent_id}:temporary_child:{child_id}"
    agent_params["enable_temporary_child_agents"] = "false"
    return child_config


def _build_inherited_context(parent_config: Dict[str, Any]) -> str:
    agent_params = parent_config.get("agent_params") or {}
    payload = {
        "tool_names": [
            tool.get("name") if isinstance(tool, dict) else str(tool)
            for tool in parent_config.get("tools", [])
        ],
        "skill_names": [
            skill.get("name") if isinstance(skill, dict) else str(skill)
            for skill in parent_config.get("skills", [])
        ],
        "agent_params_keys": sorted(agent_params.keys()),
        "has_connector_bindings_json": bool(agent_params.get("connector_bindings_json")),
        "brain_ids": parent_config.get("brain_ids", []),
        "brain_documents": parent_config.get("brain_documents", []),
    }
    return (
        "<inherited_parent_context>\n"
        "You are a clone of the parent agent. Use the inherited tools, skills, "
        "connectors, headers, workspace/document context, and fixed params. "
        "Do not ask the user for identifiers that are available in this context "
        "or in tool fixed params.\n"
        f"{json.dumps(payload, ensure_ascii=False, default=str)}\n"
        "</inherited_parent_context>"
    )
