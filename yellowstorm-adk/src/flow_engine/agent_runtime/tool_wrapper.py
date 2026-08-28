import hashlib
import json
import time
from typing import Any

from langchain_core.messages import ToolMessage
from langgraph.config import get_config

from src.flow_engine.nodes.step_hitl import _build_interrupt_payload, extract_interrupt_message, normalize_interrupt_action
from src.flow_engine.agent_runtime.tool_results import with_mcp_vision
from src.flow_engine.agent_runtime.tool_context import last_mcp_actual_args
from src.flow_engine.observability.redaction import redact_string
from src.guardrails.models import GuardrailContext
from src.guardrails.redaction import redact_sensitive
from src.guardrails.runtime import GuardrailRuntime
from src.guardrails.tool_registry import tool_policy
from src.guardrails.adapters.google_adk import guardrail_config_fingerprint
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


def tool_request_fingerprint(
    tool_call: dict[str, Any],
    metadata: dict[str, Any],
    context: Any,
) -> str:
    params = context.agent_config.get("agent_params") or {}
    blocker = _matching_blocker(
        str(tool_call.get("name") or ""),
        tool_call.get("args") if isinstance(tool_call.get("args"), dict) else {},
        context.hitl_blockers,
    )
    payload = {
        "tool_call_id": str(tool_call.get("id") or ""),
        "tool_name": str(tool_call.get("name") or ""),
        "args": tool_call.get("args") if isinstance(tool_call.get("args"), dict) else {},
        "safety": str(metadata.get("safety") or "unknown"),
        "agent_id": context.agent_id,
        "user_id": context.user_id,
        "execution_id": context.execution_id,
        "flow_id": context.flow_id,
        "node_id": context.node_id,
        "workspace_id": params.get("workspace_id") or params.get("workspace_ids") or params.get("brain_ids") or "",
        "tenant_id": params.get("tenant_id") or params.get("organization_id") or "",
        "guardrail_policy": guardrail_config_fingerprint(context.agent_config),
        "hitl_policy": {
            "mode": context.hitl_policy.get("mode"),
            "approval_enabled": context.hitl_policy.get("approvalEnabled", context.hitl_policy.get("approvalsEnabled")),
            "blocker_rule_id": str((blocker or {}).get("id") or ""),
            "policy_hash": hashlib.sha256(json.dumps(
                {"policy": context.hitl_policy, "blockers": context.hitl_blockers},
                sort_keys=True, separators=(",", ":"), default=str,
            ).encode("utf-8")).hexdigest(),
        },
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _response_fingerprint(response: Any) -> str:
    if not isinstance(response, dict):
        return ""
    return str(response.get("request_fingerprint") or response.get("requestFingerprint") or "")


def _normalize_tool_args(tool: Any, args: dict[str, Any]) -> dict[str, Any]:
    nested = args.get("params")
    if set(args) != {"params"} or not isinstance(nested, dict):
        return args
    schema = getattr(tool, "args_schema", None)
    fields = getattr(schema, "model_fields", None) or getattr(schema, "__fields__", None)
    if not isinstance(fields, dict) or "params" in fields:
        return args
    return nested if set(nested).issubset(fields) else args


def _is_resuming() -> bool:
    try:
        return bool(get_config()["configurable"].get("__pregel_resuming"))
    except RuntimeError:
        return False


def _review_hitl(
    tool_name: str,
    args: dict[str, Any],
    tool_call_id: str,
    request_fingerprint: str,
    policy_fingerprint: str,
    context: Any,
) -> tuple[str | None, bool]:
    policy = context.hitl_policy
    approval_enabled = policy.get("approvalEnabled", policy.get("approvalsEnabled")) is not False
    blocker = _matching_blocker(tool_name, args, context.hitl_blockers)
    approval_required = policy.get("mode") == "auto" and approval_enabled and blocker is not None
    if not approval_required and not _is_resuming():
        return None, False
    blocker = blocker or {}
    interrupt_id = f"{context.node_id}:approval_request:{context.iteration + 1}:{tool_call_id or tool_name}:{request_fingerprint[:16]}"
    payload = _build_interrupt_payload(
        "approval_request", str(blocker.get("message") or (
            f"Tool '{tool_name}' changed after approval was requested. Review the current request again."
            if not approval_required
            else f"Tool '{tool_name}' needs approval before it runs."
        )),
        node_id=context.node_id, label=context.label or context.node_id,
        node_description=f"Tool call: {tool_name}", round_number=context.iteration + 1,
        resumable_actions=["approve", "reject", "skip"],
        reason_code=str(blocker.get("reasonCode") or blocker.get("reason_code") or blocker.get("kind") or (
            "approval_request_changed" if not approval_required else "tool_approval_required"
        )),
        risk_level=str(blocker.get("riskLevel") or blocker.get("risk_level") or "critical"),
        feedback_scope_default="step_only", blocker_rule_id=str(blocker.get("id") or "") or None,
        blocker_kind=str(blocker.get("kind") or "tool_action"),
        interrupt_id=interrupt_id,
        request_fingerprint=request_fingerprint,
        policy_fingerprint=policy_fingerprint,
    )
    recheck_count = 0
    while True:
        if context.writer is not None:
            context.writer({"type": "NodeSuspended", "node_id": context.node_id, "iteration": context.iteration, "payload": payload})
        response = interrupt(payload)
        action = normalize_interrupt_action(response, "approval_request")
        if action == "approve":
            if _response_fingerprint(response) == request_fingerprint:
                return None, True
            recheck_count += 1
            payload = {
                **payload,
                "interrupt_id": f"{interrupt_id}:recheck:{recheck_count}",
                "message": f"Tool '{tool_name}' changed after approval was requested. Review the current request again.",
                "reason_code": "approval_request_changed",
            }
            continue
        if action == "skip":
            return json.dumps({"status": "skipped_by_human", "tool": tool_name}), False
        raise PermissionError(extract_interrupt_message(response) or f"Tool '{tool_name}' rejected by human")


def build_tool_wrapper():
    guardrails = GuardrailRuntime()

    async def wrap(request: Any, execute: Any) -> Any:
        context = request.runtime.context
        tool_call = request.tool_call
        tool_name = str(tool_call.get("name") or "")
        args = tool_call.get("args") if isinstance(tool_call.get("args"), dict) else {}
        args = _normalize_tool_args(request.tool, args)
        tool_call["args"] = args
        metadata = tool_policy(tool_name, getattr(request.tool, "metadata", None))
        request_fingerprint = tool_request_fingerprint(tool_call, metadata, context)
        policy_fingerprint = guardrail_config_fingerprint(context.agent_config)
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
        skipped, approved = _review_hitl(
            tool_name,
            args,
            str(tool_call.get("id") or ""),
            request_fingerprint,
            policy_fingerprint,
            context,
        )
        if skipped is not None:
            return ToolMessage(content=skipped, tool_call_id=str(tool_call.get("id") or ""), name=tool_name)
        if approved:
            metadata = tool_policy(tool_name, getattr(request.tool, "metadata", None))
            current_fingerprint = tool_request_fingerprint(tool_call, metadata, context)
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
            if current_fingerprint != request_fingerprint:
                return ToolMessage(content="Tool approval was invalidated because the effective request changed.", tool_call_id=str(tool_call.get("id") or ""), name=tool_name, status="error")

        started = time.perf_counter()
        safe_args = redact_sensitive(args)
        if context.agent_role == "temporary_child" and context.summary_session_id:
            record_temporary_child_tool_call(context.summary_session_id, context.agent_name, tool_name, safe_args, status="requested")
        try:
            result = await execute(request)
            duration_ms = int((time.perf_counter() - started) * 1000)
            actual_args = last_mcp_actual_args.get() or args
            last_mcp_actual_args.set({})
            preview = str(getattr(result, "content", result))[:500]
            if context.trace_collector is not None:
                context.trace_collector.record_tool_call(tool_name=tool_name, args=actual_args, output_summary=preview, status="completed", duration_ms=duration_ms, agent_name=context.agent_name, agent_role=context.agent_role)
                if context.on_trace_update is not None:
                    context.on_trace_update()
            if context.agent_role == "temporary_child" and context.summary_session_id:
                record_temporary_child_tool_call(
                    context.summary_session_id,
                    context.agent_name,
                    tool_name,
                    redact_sensitive(actual_args),
                    result_preview=redact_string(preview),
                )
            return with_mcp_vision(result, getattr(result, "content", result)) if isinstance(result, ToolMessage) else result
        except Exception as exc:
            duration_ms = int((time.perf_counter() - started) * 1000)
            actual_args = last_mcp_actual_args.get() or args
            last_mcp_actual_args.set({})
            if context.trace_collector is not None:
                context.trace_collector.record_tool_call(tool_name=tool_name, args=actual_args, output_summary=None, status="failed", duration_ms=duration_ms, error=str(exc), agent_name=context.agent_name, agent_role=context.agent_role)
                if context.on_trace_update is not None:
                    context.on_trace_update()
            raise

    return wrap
