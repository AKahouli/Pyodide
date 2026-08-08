import json
import time
from typing import Any

from langchain_core.messages import ToolMessage

from src.flow_engine.nodes.step_hitl import _build_interrupt_payload, extract_interrupt_message, normalize_interrupt_action
from src.flow_engine.agent_runtime.tool_results import with_mcp_vision
from src.flow_engine.agent_runtime.tool_context import last_mcp_actual_args
from src.guardrails.models import GuardrailContext
from src.guardrails.redaction import redact_sensitive
from src.guardrails.runtime import GuardrailRuntime
from src.guardrails.tool_registry import tool_policy
from src.temporary_child_summary import record_temporary_child_tool_call
from langgraph.types import interrupt


def _matches_any(text: str, patterns: Any) -> bool:
    return isinstance(patterns, list) and any(str(pattern or "").strip().lower() in text for pattern in patterns if str(pattern or "").strip())


def _matching_blocker(tool_name: str, args: dict[str, Any], blockers: list[dict[str, Any]]) -> dict[str, Any] | None:
    text = " ".join([tool_name, json.dumps(args, default=str)]).lower()
    for blocker in blockers:
        if blocker.get("enabled") is False or str(blocker.get("createdBy") or blocker.get("created_by") or "") != "user":
            continue
        if str(blocker.get("kind") or "") not in {"destructive_action", "external_send", "workspace_write"}:
            continue
        matcher = blocker.get("matcherConfig") or blocker.get("matcher_config") or {}
        if _matches_any(text, blocker.get("appliesToConnectorActions")) or _matches_any(text, matcher.get("verbs")):
            return blocker
    return None


def _review_hitl(tool_name: str, args: dict[str, Any], context: Any) -> str | None:
    policy = context.hitl_policy
    approval_enabled = policy.get("approvalEnabled", policy.get("approvalsEnabled")) is not False
    if policy.get("mode") != "auto" or not approval_enabled:
        return None
    blocker = _matching_blocker(tool_name, args, context.hitl_blockers)
    if blocker is None:
        return None
    payload = _build_interrupt_payload(
        "approval_request", str(blocker.get("message") or f"Tool '{tool_name}' needs approval before it runs."),
        node_id=context.node_id, label=context.label or context.node_id,
        node_description=f"Tool call: {tool_name}", round_number=context.iteration + 1,
        resumable_actions=["approve", "reject", "skip"],
        reason_code=str(blocker.get("reasonCode") or blocker.get("reason_code") or blocker.get("kind") or "tool_approval_required"),
        risk_level=str(blocker.get("riskLevel") or blocker.get("risk_level") or "critical"),
        feedback_scope_default="step_only", blocker_rule_id=str(blocker.get("id") or "") or None,
        blocker_kind=str(blocker.get("kind") or "tool_action"),
    )
    if context.writer is not None:
        context.writer({"type": "NodeSuspended", "node_id": context.node_id, "iteration": context.iteration, "payload": payload})
    response = interrupt(payload)
    action = normalize_interrupt_action(response, "approval_request")
    if action == "approve":
        return None
    if action == "skip":
        return json.dumps({"status": "skipped_by_human", "tool": tool_name})
    raise PermissionError(extract_interrupt_message(response) or f"Tool '{tool_name}' rejected by human")


def build_tool_wrapper():
    guardrails = GuardrailRuntime()

    async def wrap(request: Any, execute: Any) -> Any:
        context = request.runtime.context
        tool_call = request.tool_call
        tool_name = str(tool_call.get("name") or "")
        args = tool_call.get("args") if isinstance(tool_call.get("args"), dict) else {}
        metadata = tool_policy(tool_name, getattr(request.tool, "metadata", None))
        decision = await guardrails.review_tool_action(
            GuardrailContext(
                phase="tool_action", runtime_surface=context.runtime_surface,
                user_id=context.user_id, agent_id=context.agent_id, agent_name=context.agent_name,
                flow_id=context.flow_id, execution_id=context.execution_id, node_id=context.node_id,
                iteration=context.iteration, original_user_request=context.original_user_request,
                task_instruction=context.task_instruction, tool_name=tool_name, tool_args=args,
                tool_metadata=metadata,
            ),
            context.agent_config,
        )
        if decision.blocked:
            return ToolMessage(content=decision.block_message, tool_call_id=str(tool_call.get("id") or ""), name=tool_name, status="error")
        skipped = _review_hitl(tool_name, args, context)
        if skipped is not None:
            return ToolMessage(content=skipped, tool_call_id=str(tool_call.get("id") or ""), name=tool_name)

        started = time.perf_counter()
        safe_args = redact_sensitive(args)
        if context.agent_role == "temporary_child" and context.summary_session_id:
            record_temporary_child_tool_call(context.summary_session_id, context.agent_name, tool_name, safe_args, status="requested")
        try:
            result = await execute(request)
            duration_ms = int((time.perf_counter() - started) * 1000)
            actual_args = redact_sensitive(last_mcp_actual_args.get() or args)
            last_mcp_actual_args.set({})
            preview = str(getattr(result, "content", result))[:500]
            if context.trace_collector is not None:
                context.trace_collector.record_tool_call(tool_name=tool_name, args=actual_args, output_summary=preview, status="completed", duration_ms=duration_ms, agent_name=context.agent_name, agent_role=context.agent_role)
                if context.on_trace_update is not None:
                    context.on_trace_update()
            if context.agent_role == "temporary_child" and context.summary_session_id:
                record_temporary_child_tool_call(context.summary_session_id, context.agent_name, tool_name, actual_args, result_preview=preview)
            return with_mcp_vision(result, getattr(result, "content", result)) if isinstance(result, ToolMessage) else result
        except Exception as exc:
            duration_ms = int((time.perf_counter() - started) * 1000)
            if context.trace_collector is not None:
                context.trace_collector.record_tool_call(tool_name=tool_name, args=safe_args, output_summary=None, status="failed", duration_ms=duration_ms, error=str(exc), agent_name=context.agent_name, agent_role=context.agent_role)
                if context.on_trace_update is not None:
                    context.on_trace_update()
            raise

    return wrap
