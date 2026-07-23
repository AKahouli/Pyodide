"""Step node implementation.

A step node executes a single task (LLM call + tool invocations).
Uses LangGraph's ``get_stream_writer()`` for lifecycle events and
token-level streaming via ``litellm.acompletion(stream=True)``.
Agent config is read from ``metadata.agent`` (resolved by the backend).

Output is stored into task_outputs[(node_id, iteration)].
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import litellm
from pydantic import BaseModel, Field
from structlog import get_logger
from langgraph.config import get_stream_writer
from langgraph.errors import GraphInterrupt

from src.config.settings import get_settings
from src.flow_engine.nodes.step_prompt import build_step_prompt
from src.flow_engine.nodes.step_tool_scope import (
    build_prompt_input_context,
    build_sandbox_prompt_note,
    build_step_tool_scope,
)
from src.flow_engine.observability import TraceCollector, extract_usage
from src.flow_engine.nodes.step_hitl import StepHitlResult, needs_hitl
from src.flow_engine.nodes.step_hitl_handlers import (
    handle_clarification_after,
    handle_clarification_before,
    handle_interrupt_after,
    handle_interrupt_before,
)
from src.flow_engine.nodes.step_hitl_blockers import (
    evaluate_hitl_blocker,
    handle_llm_judge_blocker,
    handle_smart_hitl_blocker,
)
from src.flow_engine.nodes.step_result import finalize_step_result, requires_structured_response
from src.flow_engine.nodes.step_tools import (
    ToolHitlApprovalContext,
    build_agent_config,
    parse_connector_bindings,
    run_step_with_tools,
)
from src.flow_engine.nodes.deterministic_script import run_deterministic_script
from src.flow_engine.state import ExecutionState
from src.smart_rag.infrastructure.model_parameters import normalize_temperature_for_model
from src.temporary_child_summary import (
    record_temporary_child_result,
    record_temporary_child_start,
)
from src.skills.runtime import inject_skill_catalog

logger = get_logger(__name__)
settings = get_settings()

DEFAULT_MODEL = "gpt-4o-mini"

TEMP_CHILD_PARENT_INSTRUCTION = """
Temporary child-agent rule:
Temporary child agents are enabled, and the required first temporary child result
has already been provided in your task context. Call
`create_temporary_child_agent` again only when you decide more evidence or
verification is needed, until the evidence is sufficient or the child limit is
reached. You may provide one task for a sequential child, or multiple `tasks`
with `execution_mode="parallel"` when independent work should run concurrently.
The configured child limit is a hard total limit across the required child and
all additional sequential or parallel children.

Your role is only to evaluate, compare, and synthesize the temporary child
results. Do not use skills, MCP connector tools, retrieval tools, code tools, or
other operational tools directly. The temporary children inherit and use those
tools. If more tool work is needed, create another temporary child with a focused
task. Evaluate all child results and return the best final answer.
""".strip()


class _TemporaryChildAgentInput(BaseModel):
    task_description: str = Field(
        "",
        description="One focused subtask for a sequential temporary child.",
    )
    expected_output: str = Field(
        "",
        description="Optional description of the evidence or answer format needed.",
    )
    tasks: list[dict[str, str]] = Field(
        default_factory=list,
        description=(
            "Optional additional child tasks. Each item has task_description and "
            "optional expected_output. Use this when creating several children."
        ),
    )
    execution_mode: str = Field(
        "sequential",
        description="Run multiple tasks sequentially or in parallel.",
    )


def _first_workspace_id(value: Any) -> str:
    if isinstance(value, list) and value:
        return str(value[0] or "")
    return ""


def _resolve_output_workspace_id(
    metadata: dict[str, Any],
    input_context: dict[str, Any],
    state: ExecutionState,
) -> str:
    brain_context = metadata.get("brain_context", [])
    if isinstance(brain_context, list) and brain_context:
        first_ctx = brain_context[0]
        if isinstance(first_ctx, dict):
            workspace_id = str(first_ctx.get("workspace_id") or "")
            if workspace_id:
                return workspace_id

    workspace_id = _first_workspace_id(input_context.get("__playbook_workspace_ids"))
    if workspace_id:
        return workspace_id

    default_ws = str(input_context.get("__playbook_default_workspace_id") or "")
    if default_ws:
        return default_ws

    state_inputs = state.get("inputs", {})
    if isinstance(state_inputs, dict):
        workspace_id = _first_workspace_id(state_inputs.get("__playbook_workspace_ids"))
        if workspace_id:
            return workspace_id
        default_ws = str(state_inputs.get("__playbook_default_workspace_id") or "")
        if default_ws:
            return default_ws
    return ""


def _temporary_child_enabled(agent_params: dict[str, Any]) -> bool:
    has_connector_bindings = bool(agent_params.get("connector_bindings_json"))
    flag = str(agent_params.get("enable_temporary_child_agents", "false")).lower()
    enabled = flag == "true"
    logger.info(
        "[TEMP CHILD] Flow eligibility",
        has_connector_bindings_json=has_connector_bindings,
        enable_temporary_child_agents=agent_params.get("enable_temporary_child_agents"),
        max_temporary_child_agents=agent_params.get("max_temporary_child_agents"),
        enabled=enabled,
    )
    return enabled


def _temporary_child_limit(agent_params: dict[str, Any]) -> int:
    try:
        return max(1, min(8, int(agent_params.get("max_temporary_child_agents", 4))))
    except (TypeError, ValueError):
        logger.warning("[TEMP CHILD] Invalid max_temporary_child_agents; using default")
        return 4


class _TemporaryChildAgentTool:
    name = "create_temporary_child_agent"
    description = (
        "Create temporary cloned child agents for focused subtasks. Provide one "
        "task_description for a sequential child, or provide tasks and choose "
        "sequential/parallel execution. "
        "The child inherits this agent's tools/connectors/skills but cannot "
        "create more child agents. The child receives the same file names, "
        "workspace IDs, connector context, headers, and fixed params available "
        "to this parent. The hard total child limit includes the required first "
        "child. Call this only when more evidence or verification is needed."
    )
    args_schema = _TemporaryChildAgentInput

    def __init__(
        self,
        model_id: str,
        system_prompt: str,
        child_tools: list[Any],
        max_children: int,
        session_id: str,
        parent_name: str,
        inherited_context: str,
        trace_collector: TraceCollector | None = None,
        on_trace_update: Any = None,
    ):
        self._model_id = model_id
        self._system_prompt = system_prompt
        self._child_tools = child_tools
        self._max_children = max_children
        self._session_id = session_id
        self._parent_name = parent_name
        self._inherited_context = inherited_context
        self._trace_collector = trace_collector
        self._on_trace_update = on_trace_update
        self._count = 0

    async def ainvoke(self, args: dict[str, Any]) -> str:
        raw_tasks = args.get("tasks")
        tasks = (
            [
                item
                for item in raw_tasks
                if isinstance(item, dict)
                and str(item.get("task_description") or "").strip()
            ]
            if isinstance(raw_tasks, list)
            else []
        )
        if not tasks:
            task_description = str(args.get("task_description") or "").strip()
            if not task_description:
                return "At least one temporary child task is required."
            tasks = [
                {
                    "task_description": task_description,
                    "expected_output": str(
                        args.get("expected_output") or ""
                    ).strip(),
                }
            ]

        remaining = self._max_children - self._count
        if remaining <= 0:
            logger.info("[TEMP CHILD] Flow child limit reached", max=self._max_children)
            return f"Temporary child-agent limit reached ({self._max_children})."
        accepted_tasks = tasks[:remaining]
        rejected_count = len(tasks) - len(accepted_tasks)
        start_index = self._count + 1
        self._count += len(accepted_tasks)
        indexed_tasks = [
            (start_index + offset, task)
            for offset, task in enumerate(accepted_tasks)
        ]
        execution_mode = (
            str(args.get("execution_mode") or "sequential").strip().lower()
        )
        if execution_mode == "parallel" and len(indexed_tasks) > 1:
            results = await asyncio.gather(
                *[
                    self._run_child(child_index, task, "parallel")
                    for child_index, task in indexed_tasks
                ],
                return_exceptions=True,
            )
        else:
            results = []
            for child_index, task in indexed_tasks:
                try:
                    results.append(
                        await self._run_child(child_index, task, "sequential")
                    )
                except Exception as exc:
                    results.append(exc)

        formatted_results = []
        for (child_index, _), result in zip(indexed_tasks, results):
            if isinstance(result, Exception):
                formatted_results.append(f"Child {child_index} failed: {result}")
            else:
                formatted_results.append(f"Child {child_index} result:\n{result}")
        if rejected_count:
            formatted_results.append(
                f"Skipped {rejected_count} requested child task(s) because the hard "
                f"limit is {self._max_children}."
            )
        return "\n\n".join(formatted_results)

    async def _run_child(
        self,
        child_index: int,
        args: dict[str, Any],
        execution_mode: str,
    ) -> str:
        task_description = str(args.get("task_description") or "").strip()
        expected_output = str(args.get("expected_output") or "").strip()
        child_prompt = (
            f"Focused child task:\n{task_description}\n\n"
            f"Expected output:\n{expected_output or 'Return concise findings with evidence.'}\n\n"
            f"{self._inherited_context}"
        )
        child_system_prompt = (
            f"{self._system_prompt}\n\n"
            "You are a temporary child agent. Complete only the focused task. "
            "Use the inherited skills, MCP connector tools, retrieval tools, "
            "code tools, and workspace context when needed. Return concise "
            "findings with evidence so the parent can evaluate your result."
        )
        logger.info(
            "[TEMP CHILD] Flow creating temporary child",
            child_index=child_index,
            max=self._max_children,
        )
        child_id = f"{self._parent_name}:flow_tmp_{child_index}"
        record_temporary_child_start(
            session_id=self._session_id,
            parent=self._parent_name,
            child=child_id,
            task_description=task_description,
            expected_output=expected_output,
            execution_mode=f"model_tool_call_{execution_mode}",
        )
        result = await run_step_with_tools(
            model_id=self._model_id,
            system_prompt=child_system_prompt,
            user_msg=child_prompt,
            tools=self._child_tools,
            agent_role="temporary_child",
            agent_name=child_id,
            summary_session_id=self._session_id,
            trace_collector=self._trace_collector,
            on_trace_update=self._on_trace_update,
        )
        logger.info("[TEMP CHILD] Flow child completed", child_index=child_index)
        record_temporary_child_result(
            session_id=self._session_id,
            child=child_id,
            result=result,
        )
        return result


def _build_temporary_child_inherited_context(
    tool_scope: Any,
    tools: list[Any],
    agent_config: dict[str, Any],
    output_workspace_id: str,
    file_names: list[str] | None = None,
) -> str:
    payload = {
        "available_tool_names": [str(getattr(tool, "name", "")) for tool in tools],
        "file_names": list(file_names if file_names is not None else tool_scope.file_names),
        "workspace_ids": tool_scope.binding_workspace_ids,
        "documents_by_port": tool_scope.documents_by_port,
        "workspace_context": tool_scope.workspace_context,
        "output_workspace_id": output_workspace_id,
        "agent_params_keys": sorted((agent_config.get("agent_params") or {}).keys()),
    }
    return (
        "<inherited_parent_context>\n"
        "You are a clone of the parent agent. Use these exact inherited context "
        "values when calling connector/MCP tools. Do not ask the user for "
        "workspace_id, file_name, headers, or document identifiers if they appear here.\n"
        f"{json.dumps(payload, ensure_ascii=False, default=str)}\n"
        "</inherited_parent_context>"
    )


def _build_available_file_context(file_names: list[str]) -> str:
    payload = {"file_names": list(file_names)}
    return (
        "<available_mcp_file_names>\n"
        f"{json.dumps(payload, ensure_ascii=False)}\n"
        "These are the exact workspace filenames available for MCP tool calls. Decide whether to use them from the selected tool's schema, preprompt, skill instructions, and MCP docstring. Only send file_name or file_names when that tool declares the parameter. Preserve filenames exactly and choose the relevant file or files for the call. If the list is empty, do not send a filename parameter. Sandbox-local filenames, when applicable, are listed separately under Sandbox Files.\n"
        "</available_mcp_file_names>"
    )


def _collect_workspace_ceph_paths(
    input_context: dict[str, Any],
    state: ExecutionState,
    document_paths: list[str],
) -> list[str]:
    """Merge Ceph workspace paths from wired documents and playbook-level context.

    Returns a deduplicated list of "user_id/workspace_name" paths to mount into the
    sandbox VM (sent to MCP connectors via the x-workspace-paths header).
    """
    paths: list[str] = []
    seen: set[str] = set()

    def _add(raw: Any) -> None:
        path = str(raw or "").strip().strip("/")
        if "/" not in path or path in seen:
            return
        seen.add(path)
        paths.append(path)

    # Document-derived paths first (most specific to this node's inputs).
    for path in document_paths or []:
        _add(path)

    # Playbook-level workspace paths: dict {workspace_id: "user_id/workspace_name"}.
    state_inputs = state.get("inputs", {})
    for source in (input_context, state_inputs):
        if not isinstance(source, dict):
            continue
        playbook_paths = source.get("__playbook_workspace_paths")
        if isinstance(playbook_paths, dict):
            for value in playbook_paths.values():
                _add(value)

    return paths


def _build_prompt(
    label: str,
    node_id: str,
    input_context: dict[str, Any],
    node_description: str = "",
    output_contract: dict[str, Any] | None = None,
    iteration: int = 0,
    trigger_context: dict[str, Any] | None = None,
    hitl_policy: dict[str, Any] | None = None,
    hitl_blockers: list[dict[str, Any]] | None = None,
    human_context: list[dict[str, Any]] | None = None,
    hitl_memory: list[dict[str, Any]] | None = None,
) -> str:
    return build_step_prompt(
        label=label,
        node_id=node_id,
        input_context=input_context,
        node_description=node_description,
        output_contract=output_contract,
        iteration=iteration,
        trigger_context=trigger_context,
        require_structured_output=requires_structured_response(output_contract),
        hitl_policy=hitl_policy,
        hitl_blockers=hitl_blockers,
        human_context=human_context,
        hitl_memory=hitl_memory,
    )


def _skip_result(node_id: str, iteration: int) -> dict[str, Any]:
    return {
        "task_outputs": {(node_id, iteration): {"status": "skipped", "output": ""}},
        "iterations": {node_id: iteration + 1},
    }


def _fail_result(node_id: str, iteration: int, error_msg: str, code: str = "HITL_REJECTED") -> dict[str, Any]:
    return {
        "errors": [{"node_id": node_id, "iteration": iteration, "message": error_msg, "code": code}],
        "iterations": {node_id: iteration + 1},
    }


def _apply_hitl_result(
    hitl: StepHitlResult,
    node_id: str,
    iteration: int,
    writer: Any,
    node_description: str,
) -> tuple[dict[str, Any] | None, str, list[dict[str, Any]]]:
    if hitl.skipped:
        writer({"type": "NodeSkipped", "node_id": node_id, "iteration": iteration, "payload": {}})
        return _skip_result(node_id, iteration), node_description, hitl.human_context
    if hitl.failed:
        writer({"type": "NodeFailed", "node_id": node_id, "iteration": iteration, "payload": {"error": hitl.error_msg}})
        return _fail_result(node_id, iteration, hitl.error_msg), node_description, hitl.human_context
    desc = hitl.updated_description if hitl.updated_description else node_description
    return None, desc, hitl.human_context


def _with_human_context(result: dict[str, Any], human_context: list[dict[str, Any]]) -> dict[str, Any]:
    if human_context:
        return {**result, "human_context": human_context}
    return result


def _as_record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_record_list(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _merge_human_context(state: ExecutionState, new_human_context: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [*_as_record_list(state.get("human_context")), *new_human_context]


def _next_clarification_round(node_id: str, *contexts: list[dict[str, Any]]) -> int:
    count = 0
    for context in contexts:
        count += sum(
            1
            for entry in context
            if entry.get("node_id") == node_id and entry.get("interrupt_type") == "clarification"
        )
    return count + 1


def _resolve_hitl_policy(metadata: dict[str, Any], state: ExecutionState) -> dict[str, Any]:
    # Node metadata overrides the workflow-level policy carried in graph state.
    policy = _as_record(state.get("hitl_policy"))
    node_policy = metadata.get("hitl_policy") or metadata.get("hitlPolicy")
    if isinstance(node_policy, dict):
        policy = {**policy, **node_policy}
    return policy


def _resolve_hitl_blockers(metadata: dict[str, Any], state: ExecutionState, node_id: str) -> list[dict[str, Any]]:
    blockers = _as_record_list(state.get("hitl_blockers"))
    metadata_blockers = metadata.get("hitl_blockers") or metadata.get("hitlBlockers")
    blockers.extend(_as_record_list(metadata_blockers))
    return [
        blocker for blocker in blockers
        if blocker.get("enabled", True)
        and str(blocker.get("createdBy") or blocker.get("created_by") or "") == "user"
        and (
            blocker.get("scope") == "workflow"
            or str(blocker.get("nodeId") or blocker.get("node_id") or "") == node_id
        )
    ]


async def run_step(
    node_id: str,
    node_config: dict[str, Any],
    state: ExecutionState,
    node_inputs: dict[str, Any] | None = None,
) -> dict[str, Any]:
    iteration = state["iterations"].get(node_id, 0)
    label = str(node_config.get("label") or node_id)
    metadata = node_config.get("metadata", {})
    if not isinstance(metadata, dict):
        metadata = {}

    deep_search = bool(metadata.get("deep_search", False))
    agent_name = str(metadata.get("agent_name") or "")
    agent_description = str(metadata.get("agent_description") or "")
    agent_model = metadata.get("agent_model") or node_config.get("model_id")
    agent_prompt = str(metadata.get("agent_prompt") or "")
    agent_config = build_agent_config(metadata)
    connector_bindings = parse_connector_bindings(metadata, agent_config["agent_params"])
    node_description = str(
        node_config.get("description")
        or metadata.get("description")
        or ""
    )
    output_contract = node_config.get("output") or None
    structured_output = requires_structured_response(
        output_contract if isinstance(output_contract, dict) else None
    )

    model_id = str(agent_model or DEFAULT_MODEL)
    fallback_system_prompt = f"You are executing the step: {label}. Respond concisely."
    if agent_description:
        fallback_system_prompt = f"{agent_description}\n\n{fallback_system_prompt}"
    system_prompt = str(agent_prompt or metadata.get("system_prompt", "") or fallback_system_prompt)
    if deep_search:
        system_prompt += (
            "\n\n<deep_search_mode>\n"
            "The runtime performs relevant-document discovery before normal MCP or "
            "retrieval work. It merges those selected filenames with user-provided "
            "files and supplies the combined scope to the normal tools. Do not call "
            "deep search again. Gather detailed evidence from the scoped documents "
            "and cross-reference them when relevant.\n"
            "</deep_search_mode>"
        )
    system_prompt = inject_skill_catalog(system_prompt, agent_config.get("skills", []))
    has_agent = bool(agent_name)

    logger.info(
        "[step] Running step node",
        node_id=node_id,
        iteration=iteration,
        model=model_id,
        has_agent=has_agent,
        agent_name=agent_name,
        agent_model=agent_model,
        node_model_id=node_config.get("model_id"),
        deep_search=deep_search,
    )

    try:
        writer = get_stream_writer()
    except RuntimeError:
        writer = lambda _: None
    writer({
        "type": "NodeStarted",
        "node_id": node_id,
        "iteration": iteration,
        "payload": {"label": label},
    })

    input_context = node_inputs if node_inputs is not None else state.get("inputs", {})
    hitl_policy = _resolve_hitl_policy(metadata, state)
    hitl_blockers = _resolve_hitl_blockers(metadata, state, node_id)
    hitl_active = needs_hitl(metadata) and hitl_policy.get("mode") != "off"

    checkpoint = state.get("hitl_checkpoint")
    has_checkpoint = isinstance(checkpoint, dict) and checkpoint.get("node_id") == node_id and checkpoint.get("phase") == "post_exec"
    checkpoint_needs_reexec = False
    if has_checkpoint:
        checkpoint_needs_reexec = bool(checkpoint.get("needs_reexec", False))
        if checkpoint.get("updated_description"):
            node_description = checkpoint["updated_description"]

    new_human_context: list[dict[str, Any]] = []
    suppress_follow_up_clarification = bool(
        checkpoint.get("suppress_follow_up_clarification", False)
    ) if has_checkpoint else False
    if not has_checkpoint:
        blocker_decision = evaluate_hitl_blocker(
            node_config,
            input_context if isinstance(input_context, dict) else {},
            hitl_policy,
            hitl_blockers,
        )
        hitl = handle_smart_hitl_blocker(
            blocker_decision, node_id, label, node_description, iteration, writer, hitl_policy,
        )
        early, node_description, context_updates = _apply_hitl_result(hitl, node_id, iteration, writer, node_description)
        new_human_context.extend(context_updates)
        suppress_follow_up_clarification = (
            suppress_follow_up_clarification
            or hitl.suppress_follow_up_clarification
        )
        if early:
            return _with_human_context(early, new_human_context)

        hitl = await handle_llm_judge_blocker(
            node_config,
            input_context if isinstance(input_context, dict) else {},
            hitl_policy,
            hitl_blockers,
            model_id,
            node_id,
            label,
            node_description,
            iteration,
            writer,
        )
        early, node_description, context_updates = _apply_hitl_result(hitl, node_id, iteration, writer, node_description)
        new_human_context.extend(context_updates)
        suppress_follow_up_clarification = (
            suppress_follow_up_clarification
            or hitl.suppress_follow_up_clarification
        )
        if early:
            return _with_human_context(early, new_human_context)

    if hitl_active and not has_checkpoint:
        hitl = await handle_clarification_before(
            node_id, label, node_description, metadata, model_id, writer,
            user_query=str(input_context) if isinstance(input_context, dict) else "",
        )
        early, node_description, context_updates = _apply_hitl_result(hitl, node_id, iteration, writer, node_description)
        new_human_context.extend(context_updates)
        if early:
            return _with_human_context(early, new_human_context)

        hitl = await handle_interrupt_before(
            node_id, label, node_description, metadata, writer,
        )
        early, node_description, context_updates = _apply_hitl_result(hitl, node_id, iteration, writer, node_description)
        new_human_context.extend(context_updates)
        if early:
            return _with_human_context(early, new_human_context)

    should_execute = not has_checkpoint or checkpoint_needs_reexec

    if should_execute:
        try:
            deterministic_payload: dict[str, Any] | None = None
            if metadata.get("executionStrategy") == "deterministic_script":
                deterministic_payload = _execute_deterministic_step(
                    metadata,
                    input_context if isinstance(input_context, dict) else {},
                    node_id,
                    iteration,
                )
                full_output = str(deterministic_payload.get("output") or "")
                components = []
                trace_collector = None
            else:
                full_output, components, trace_collector = await _execute_step(
                    node_id, node_config, state, metadata, input_context,
                    node_description, output_contract, model_id, system_prompt,
                    structured_output, agent_config, connector_bindings,
                    iteration, label, writer, hitl_policy, hitl_blockers,
                    _merge_human_context(state, new_human_context),
                    deep_search=deep_search,
                )
        except GraphInterrupt:
            raise
        except Exception as exc:
            logger.error("[step] Step execution failed", node_id=node_id, error=str(exc))
            writer({
                "type": "NodeFailed",
                "node_id": node_id,
                "iteration": iteration,
                "payload": {"error": str(exc)},
            })
            return {
                "errors": [{"node_id": node_id, "iteration": iteration, "message": f"Step execution error: {exc}"}],
                "iterations": {node_id: iteration + 1},
            }

    else:
        full_output = checkpoint.get("llm_output", "")
        components = checkpoint.get("components", [])
        trace_collector = None
        deterministic_payload = None

    result_payload = deterministic_payload or _build_result_payload(
        output_contract, full_output, components, node_id, iteration, trace_collector,
    )

    if hitl_active and not suppress_follow_up_clarification:
        clarification_round = _next_clarification_round(
            node_id,
            _as_record_list(state.get("human_context")),
            new_human_context,
        )
        hitl = await handle_clarification_after(
            node_id, label, node_description, metadata, full_output, writer,
            round_number=clarification_round,
        )
        early, node_description, context_updates = _apply_hitl_result(hitl, node_id, iteration, writer, node_description)
        new_human_context.extend(context_updates)
        suppress_follow_up_clarification = (
            suppress_follow_up_clarification
            or hitl.suppress_follow_up_clarification
        )
        if early:
            return _with_human_context(early, new_human_context)
        if hitl.needs_reexec:
            return _with_human_context({"hitl_checkpoint": {
                "node_id": node_id,
                "llm_output": full_output,
                "components": components,
                "updated_description": node_description,
                "needs_reexec": True,
                "suppress_follow_up_clarification": suppress_follow_up_clarification,
                "phase": "post_exec",
            }}, new_human_context)

    if hitl_active:
        hitl = await handle_interrupt_after(
            node_id, label, node_description, metadata, full_output, writer,
        )
        early, node_description, context_updates = _apply_hitl_result(hitl, node_id, iteration, writer, node_description)
        new_human_context.extend(context_updates)
        if early:
            return _with_human_context(early, new_human_context)
        if hitl.needs_reexec:
            return _with_human_context({"hitl_checkpoint": {
                "node_id": node_id,
                "llm_output": full_output,
                "components": components,
                "updated_description": node_description,
                "needs_reexec": True,
                "phase": "post_exec",
            }}, new_human_context)

    writer({
        "type": "NodeCompleted",
        "node_id": node_id,
        "iteration": iteration,
        "payload": result_payload,
    })

    return _with_human_context({
        "task_outputs": {(node_id, iteration): result_payload},
        "iterations": {node_id: iteration + 1},
        "hitl_checkpoint": None,
    }, new_human_context)


async def _execute_step(
    node_id: str,
    node_config: dict[str, Any],
    state: ExecutionState,
    metadata: dict[str, Any],
    input_context: Any,
    node_description: str,
    output_contract: dict[str, Any] | None,
    model_id: str,
    system_prompt: str,
    structured_output: bool,
    agent_config: dict[str, Any],
    connector_bindings: list[Any],
    iteration: int,
    label: str,
    writer: Any,
    hitl_policy: dict[str, Any],
    hitl_blockers: list[dict[str, Any]],
    human_context: list[dict[str, Any]],
    deep_search: bool = False,
) -> str:
    trigger_context = state.get("inputs", {})
    prompt_input_context = build_prompt_input_context(
        input_context if isinstance(input_context, dict) else {}
    )
    tool_scope = build_step_tool_scope(
        input_context if isinstance(input_context, dict) else {},
        metadata,
    )
    workspace_ceph_paths = _collect_workspace_ceph_paths(
        input_context if isinstance(input_context, dict) else {},
        state,
        tool_scope.workspace_ceph_paths,
    )
    tool_names = {
        str(tool.get("name") or "")
        for tool in agent_config.get("tools", [])
        if isinstance(tool, dict)
    }
    user_msg = _build_prompt(
        label=label,
        node_id=node_id,
        input_context=prompt_input_context,
        node_description=node_description,
        output_contract=output_contract if isinstance(output_contract, dict) else None,
        iteration=iteration,
        trigger_context=trigger_context if isinstance(trigger_context, dict) else None,
        hitl_policy=hitl_policy,
        hitl_blockers=hitl_blockers,
        human_context=human_context,
        hitl_memory=_as_record_list(state.get("hitl_memory")),
    )
    sandbox_prompt_note = build_sandbox_prompt_note(tool_scope, tool_names)
    if sandbox_prompt_note:
        user_msg = f"{user_msg}\n\nSandbox Files:\n{sandbox_prompt_note}"
    replay_instructions = str(metadata.get("replay_instructions") or "")
    execution_mode = str(metadata.get("execution_mode") or "live")
    if replay_instructions and execution_mode in ("replay_strict", "replay_flex", "replay_adaptive"):
        user_msg = f"{user_msg}\n\n{replay_instructions}"

    trace_collector = TraceCollector()
    trace_collector.record_prompt("initial_request", model_id, f"[system] {system_prompt}\n\n[user] {user_msg}")

    def emit_trace_update() -> None:
        writer({
            "type": "NodeTraceUpdate",
            "node_id": node_id,
            "iteration": iteration,
            "payload": trace_collector.build_payload(log_empty=False),
        })

    emit_trace_update()

    litellm.api_base = settings.LITELLM_API_BASE_URL
    litellm.api_key = settings.LITELLM_API_SECRET_KEY
    litellm.drop_params = True

    from src.flow_engine.tools import create_langchain_tools

    output_workspace_id = _resolve_output_workspace_id(
        metadata,
        input_context if isinstance(input_context, dict) else {},
        state,
    )

    effective_file_names = list(tool_scope.file_names)
    deep_search_result: dict[str, Any] | None = None
    if deep_search:
        from src.flow_engine.deep_search import (
            merge_file_names,
            search_relevant_documents,
        )

        deep_search_workspace_id = (
            next((wid for wid in tool_scope.binding_workspace_ids if wid), "")
            or output_workspace_id
        )
        deep_search_query = str(node_description or "").strip()
        if prompt_input_context:
            input_query = json.dumps(prompt_input_context, ensure_ascii=False, default=str)
            deep_search_query = f"{deep_search_query}\n\n{input_query}".strip()
        if not deep_search_query:
            deep_search_query = user_msg

        started_at = time.perf_counter()
        try:
            deep_search_result = await search_relevant_documents(
                deep_search_query,
                deep_search_workspace_id,
            )
            deep_search_file_names = [
                str(item.get("file_name") or "")
                for item in deep_search_result.get("results", [])
                if isinstance(item, dict)
            ]
            effective_file_names = merge_file_names(
                tool_scope.file_names,
                deep_search_file_names,
            )
            duration_ms = int((time.perf_counter() - started_at) * 1000)
            trace_collector.record_tool_call(
                tool_name="search_relevant_documents",
                args={
                    "query": deep_search_query,
                    "workspace_id": deep_search_workspace_id,
                },
                output_summary=json.dumps(deep_search_result, ensure_ascii=False, default=str),
                status="completed",
                duration_ms=duration_ms,
                agent_name=agent_config.get("name") or node_id,
                agent_role="preflight",
            )
            emit_trace_update()
        except Exception as exc:
            duration_ms = int((time.perf_counter() - started_at) * 1000)
            trace_collector.record_tool_call(
                tool_name="search_relevant_documents",
                args={
                    "query": deep_search_query,
                    "workspace_id": deep_search_workspace_id,
                },
                output_summary=None,
                status="failed",
                duration_ms=duration_ms,
                error=str(exc),
                agent_name=agent_config.get("name") or node_id,
                agent_role="preflight",
            )
            emit_trace_update()
            raise

        user_msg = (
            f"{user_msg}\n\n<deep_search_preflight>\n"
            "Relevant-document discovery is complete. The returned filenames were "
            "merged with user-provided files and exposed to the agent below.\n"
            f"{json.dumps(deep_search_result, ensure_ascii=False, default=str)}\n"
            "</deep_search_preflight>"
        )

    user_msg = f"{user_msg}\n\n{_build_available_file_context(effective_file_names)}"

    tools, collector = create_langchain_tools(
        agent_config=agent_config,
        workspace_context=tool_scope.workspace_context,
        input_files=effective_file_names,
        documents_by_port=tool_scope.documents_by_port,
        code_interpreter_files=tool_scope.code_interpreter_files,
        output_ports=(output_contract or {}).get("ports") if isinstance(output_contract, dict) else None,
        step_connector_bindings=connector_bindings,
        output_workspace_id=output_workspace_id,
        workspace_context_mode=tool_scope.workspace_context_mode,
        user_id=str(state.get("evaluation_user_id") or ""),
        workspace_ceph_paths=workspace_ceph_paths,
        deep_search=False,
        binding_workspace_ids=tool_scope.binding_workspace_ids,
    )
    if _temporary_child_enabled(agent_config["agent_params"]):
        temporary_child_tool = _TemporaryChildAgentTool(
            model_id=model_id,
            system_prompt=system_prompt,
            child_tools=list(tools),
            max_children=_temporary_child_limit(agent_config["agent_params"]),
            session_id=str(state.get("execution_id") or ""),
            parent_name=agent_config.get("name") or node_id,
            inherited_context=_build_temporary_child_inherited_context(
                tool_scope=tool_scope,
                tools=tools,
                agent_config=agent_config,
                output_workspace_id=output_workspace_id,
                file_names=effective_file_names,
            ),
            trace_collector=trace_collector,
            on_trace_update=emit_trace_update,
        )
        tools = [temporary_child_tool]
        system_prompt = f"{system_prompt}\n\n{TEMP_CHILD_PARENT_INSTRUCTION}"
        logger.info(
            "[TEMP CHILD] Flow tool attached",
            node_id=node_id,
            max_temporary_child_agents=_temporary_child_limit(agent_config["agent_params"]),
        )
        required_child_result = await temporary_child_tool.ainvoke({
            "task_description": (
                "Run the required first temporary-child pass for this parent "
                f"task. Gather or verify the key evidence the parent should consider.\n\n{user_msg}"
            ),
            "expected_output": "Return concise findings with evidence for the parent.",
        })
        user_msg = (
            f"{user_msg}\n\n"
            "<required_temporary_child_result>\n"
            f"{required_child_result}\n"
            "</required_temporary_child_result>"
        )

    components: list[dict[str, Any]] = []
    should_stream_tokens = (
        not structured_output
        and str(agent_config.get("type") or "").strip().lower() != "visualizer"
    )
    on_progress = None
    if should_stream_tokens:
        on_progress = lambda token: writer({
            "type": "NodeToken",
            "node_id": node_id,
            "iteration": iteration,
            "token": token,
        })

    if tools:
        logger.info(
            "[step] Running step node with tools",
            node_id=node_id,
            tool_count=len(tools),
            tool_names=[tool.name for tool in tools],
        )
        full_output = await run_step_with_tools(
            model_id=model_id,
            system_prompt=system_prompt,
            user_msg=user_msg,
            tools=tools,
            on_progress=on_progress,
            on_trace_update=emit_trace_update,
            trace_collector=trace_collector,
            hitl_approval=ToolHitlApprovalContext(
                hitl_policy=hitl_policy,
                hitl_blockers=hitl_blockers,
                node_id=node_id,
                label=label,
                iteration=iteration,
                writer=writer,
            ),
            agent_role="parent",
            agent_name=agent_config.get("name") or node_id,
            summary_session_id=str(state.get("execution_id") or ""),
        )
        if full_output and should_stream_tokens:
            writer({
                "type": "NodeToken",
                "node_id": node_id,
                "iteration": iteration,
                "token": full_output,
            })
        if collector is not None:
            components = collector.get_and_clear()
    else:
        response = await litellm.acompletion(
            model=model_id,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg},
            ],
            temperature=normalize_temperature_for_model(model_id, 0.7),
            max_tokens=32000,
            stream=True,
        )

        full_output = ""
        async for chunk in response:
            delta = chunk.choices[0].delta
            token = delta.content or ""
            if token:
                full_output += token
                if should_stream_tokens:
                    writer({
                        "type": "NodeToken",
                        "node_id": node_id,
                        "iteration": iteration,
                        "token": token,
                    })

            if (
                should_stream_tokens
                and hasattr(delta, "model_extra")
                and delta.model_extra
                and "tool_calls" in (delta.model_extra or {})
            ):
                writer({
                    "type": "NodeToken",
                    "node_id": node_id,
                    "iteration": iteration,
                    "token": str(delta.model_extra.get("tool_calls", "")),
                })

        trace_collector.record_usage(extract_usage(response, model_id))
        trace_collector.record_prompt_output(full_output)
        emit_trace_update()

    logger.info("[step] Step completed", node_id=node_id, streamed_chars=len(full_output))
    return full_output, components, trace_collector


def _execute_deterministic_step(
    metadata: dict[str, Any],
    input_context: dict[str, Any],
    node_id: str,
    iteration: int,
) -> dict[str, Any]:
    source = metadata.get("scriptSource")
    if not isinstance(source, dict):
        source = metadata.get("script_source")
    if not isinstance(source, dict):
        raise ValueError("Deterministic script metadata is missing scriptSource")
    validation = metadata.get("scriptValidation")
    if not isinstance(validation, dict):
        validation = metadata.get("script_validation")
    if not isinstance(validation, dict) or validation.get("status") != "passed":
        raise ValueError("Deterministic script requires passed validation metadata")
    script = str(source.get("code") or "")
    script_hash = str(source.get("sha256") or "")
    actual_hash = _script_hash(script)
    if script_hash != actual_hash:
        raise ValueError("Deterministic script hash does not match script source")
    if source.get("kind") != "advisor_generated":
        logger.warning("[step] Running deterministic script from non-advisor source", node_id=node_id)
    output = run_deterministic_script(script, input_context)
    trace_metadata = {
        "executionStrategy": "deterministic_script",
        "scriptHash": script_hash,
        "llmInferenceSkipped": True,
    }
    logger.info("[step] Deterministic script completed", node_id=node_id, iteration=iteration)
    return {
        "output": output,
        "display_text": str(output),
        "components": [],
        "artifacts": [],
        "node_id": node_id,
        "iteration": iteration,
        "raw_llm_output": "",
        "traceMetadata": trace_metadata,
    }


def _script_hash(script: str) -> str:
    import hashlib

    return f"sha256:{hashlib.sha256(script.encode('utf-8')).hexdigest()}"


def _build_result_payload(
    output_contract: dict[str, Any] | None,
    full_output: str,
    components: list[dict[str, Any]],
    node_id: str,
    iteration: int,
    trace_collector: TraceCollector | None = None,
) -> dict[str, Any]:
    result_payload = finalize_step_result(
        output_contract if isinstance(output_contract, dict) else None,
        full_output,
        components,
    )
    result_payload.update({
        "node_id": node_id,
        "iteration": iteration,
        "raw_llm_output": full_output,
    })
    if trace_collector is not None:
        result_payload.update(trace_collector.build_payload())
    return result_payload
