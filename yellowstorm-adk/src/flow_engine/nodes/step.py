"""Step node implementation.

A step node executes a single task (LLM call + tool invocations).
Uses LangGraph's ``get_stream_writer()`` for lifecycle events and
token-level streaming via ``litellm.acompletion(stream=True)``.
Agent config is read from ``metadata.agent`` (resolved by the backend).

Output is stored into task_outputs[(node_id, iteration)].
"""

from __future__ import annotations

from typing import Any

import litellm
from structlog import get_logger
from langgraph.config import get_stream_writer

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
    handle_smart_hitl_blocker,
)
from src.flow_engine.nodes.step_result import finalize_step_result, requires_structured_response
from src.flow_engine.nodes.step_tools import (
    ToolHitlApprovalContext,
    build_agent_config,
    parse_connector_bindings,
    run_step_with_tools,
)
from src.flow_engine.state import ExecutionState

logger = get_logger(__name__)
settings = get_settings()

DEFAULT_MODEL = "gpt-4o-mini"


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

    logger.info(
        "[step] node metadata received",
        node_id=node_id,
        metadata_keys=sorted(metadata.keys()),
        brain_context=metadata.get("brain_context"),
        full_metadata=metadata,
    )

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
    _state_inputs = state.get("inputs", {})
    logger.info(
        "[step] input_context received",
        node_id=node_id,
        source="node_inputs" if node_inputs is not None else "state.inputs",
        input_context_keys=sorted(input_context.keys()) if isinstance(input_context, dict) else None,
        playbook_workspace_ids=input_context.get("__playbook_workspace_ids") if isinstance(input_context, dict) else None,
        playbook_default_workspace_id=input_context.get("__playbook_default_workspace_id") if isinstance(input_context, dict) else None,
        full_input_context=input_context,
        state_inputs_keys=sorted(_state_inputs.keys()) if isinstance(_state_inputs, dict) else None,
        state_playbook_workspace_ids=_state_inputs.get("__playbook_workspace_ids") if isinstance(_state_inputs, dict) else None,
        state_playbook_default_workspace_id=_state_inputs.get("__playbook_default_workspace_id") if isinstance(_state_inputs, dict) else None,
        full_state_inputs=_state_inputs,
    )
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
            full_output, components, trace_collector = await _execute_step(
                node_id, node_config, state, metadata, input_context,
                node_description, output_contract, model_id, system_prompt,
                structured_output, agent_config, connector_bindings,
                iteration, label, writer, hitl_policy, hitl_blockers,
            )
        except Exception as exc:
            logger.error("[step] LLM call failed", node_id=node_id, error=str(exc))
            writer({
                "type": "NodeFailed",
                "node_id": node_id,
                "iteration": iteration,
                "payload": {"error": str(exc)},
            })
            return {
                "errors": [{"node_id": node_id, "iteration": iteration, "message": f"LLM error: {exc}"}],
                "iterations": {node_id: iteration + 1},
            }

        if hitl_active:
            return _with_human_context({"hitl_checkpoint": {
                "node_id": node_id,
                "llm_output": full_output,
                "components": components,
                "updated_description": node_description,
                "needs_reexec": False,
                "suppress_follow_up_clarification": suppress_follow_up_clarification,
                "phase": "post_exec",
            }}, new_human_context)

    else:
        full_output = checkpoint.get("llm_output", "")
        components = checkpoint.get("components", [])
        trace_collector = None

    result_payload = _build_result_payload(
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
) -> str:
    trigger_context = state.get("inputs", {})
    prompt_input_context = build_prompt_input_context(
        input_context if isinstance(input_context, dict) else {}
    )
    tool_scope = build_step_tool_scope(
        input_context if isinstance(input_context, dict) else {},
        metadata,
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
        human_context=_as_record_list(state.get("human_context")),
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

    litellm.api_base = settings.LITELLM_API_BASE_URL
    litellm.api_key = settings.LITELLM_API_SECRET_KEY
    litellm.drop_params = True

    from src.flow_engine.tools import create_langchain_tools
    from src.flow_engine.tools.langchain_factory import _resolve_workspace_names, _looks_like_object_id

    output_workspace_id = _resolve_output_workspace_id(
        metadata,
        input_context if isinstance(input_context, dict) else {},
        state,
    )

    # Resolve ObjectId brain_ids → real workspace names before tool creation
    raw_brain_ids = agent_config.get("brain_ids") or []
    ids_to_resolve = [i for i in raw_brain_ids if _looks_like_object_id(str(i))]
    # Also resolve output_workspace_id so connector tools get a real name as fallback
    if output_workspace_id and _looks_like_object_id(output_workspace_id) and output_workspace_id not in ids_to_resolve:
        ids_to_resolve.append(output_workspace_id)
    logger.info(
        "[step] workspace_name_resolution brain_ids=%s output_workspace_id=%s ids_to_resolve=%s",
        raw_brain_ids,
        output_workspace_id,
        ids_to_resolve,
    )
    resolved_workspace_names = await _resolve_workspace_names(ids_to_resolve) if ids_to_resolve else {}
    logger.info(
        "[step] workspace_name_resolution_result resolved=%s",
        resolved_workspace_names,
    )

    tools, collector = create_langchain_tools(
        agent_config=agent_config,
        workspace_context=tool_scope.workspace_context,
        input_files=tool_scope.file_names,
        documents_by_port=tool_scope.documents_by_port,
        code_interpreter_files=tool_scope.code_interpreter_files,
        output_ports=(output_contract or {}).get("ports") if isinstance(output_contract, dict) else None,
        step_connector_bindings=connector_bindings,
        output_workspace_id=output_workspace_id,
        workspace_context_mode=tool_scope.workspace_context_mode,
        user_id=str(state.get("evaluation_user_id") or ""),
        resolved_workspace_names=resolved_workspace_names,
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
            trace_collector=trace_collector,
            hitl_approval=ToolHitlApprovalContext(
                hitl_policy=hitl_policy,
                hitl_blockers=hitl_blockers,
                node_id=node_id,
                label=label,
                iteration=iteration,
                writer=writer,
            ),
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
            temperature=0.7,
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

    logger.info("[step] Step completed", node_id=node_id, streamed_chars=len(full_output))
    return full_output, components, trace_collector


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
