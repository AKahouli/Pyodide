from typing import Any

import httpx


SECOND_BRAIN_ALLOWED_ACTIONS = frozenset({
    "search_playbooks",
    "open_playbook_context",
    "get_playbook_summary",
    "get_task_details",
    "get_task_dependencies",
    "validate_playbook",
    "start_playbook_execution",
    "list_recent_executions",
    "get_playbook_execution",
    "get_execution_diagnostics",
})


def is_second_brain_config(config: dict[str, Any]) -> bool:
    agent_type = str(config.get("agent_type") or "").lower().replace("-", "_").replace(" ", "_")
    return agent_type == "platform_copilot"


def action_key(tool_name: str, metadata: dict[str, Any]) -> str:
    configured = str(metadata.get("action_key") or "")
    if configured:
        return configured
    return next(
        (action for action in sorted(SECOND_BRAIN_ALLOWED_ACTIONS, key=len, reverse=True)
         if tool_name == action or tool_name.endswith(f"_{action}")),
        tool_name,
    )


async def evaluate_second_brain_tool(
    config: dict[str, Any],
    tool_name: str,
    args: dict[str, Any],
    metadata: dict[str, Any],
) -> dict[str, Any]:
    action = action_key(tool_name, metadata)
    if action not in SECOND_BRAIN_ALLOWED_ACTIONS:
        return {
            "decision": "denied",
            "code": "MASCOT_TOOL_NOT_ALLOWED",
            "message": "This tool is not enabled for My Second Brain.",
        }

    params = config.get("agent_params") or {}
    platform_api_url = str(params.get("platform_api_url") or "").rstrip("/")
    platform_api_token = str(params.get("platform_api_token") or "")
    tenant_id = str(params.get("mascot_tenant_id") or "")
    conversation_id = str(params.get("mascot_conversation_id") or "")
    correlation_id = str(params.get("mascot_correlation_id") or "")
    user_id = str(config.get("user_id") or params.get("user_id") or "")
    agent_id = str(config.get("id") or "")
    if not all((platform_api_url, platform_api_token, tenant_id, user_id, agent_id, conversation_id, correlation_id)):
        return {
            "decision": "denied",
            "code": "MASCOT_POLICY_CONTEXT_MISSING",
            "message": "The trusted mascot tool context is incomplete.",
        }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
            response = await client.post(
                f"{platform_api_url}/v1/internal/playbook-assistant/mascot/tool-policy/evaluate",
                headers={
                    "X-Internal-Token": platform_api_token,
                    "X-YellowStorm-Tenant-Id": tenant_id,
                    "X-YellowStorm-User-Id": user_id,
                    "X-YellowStorm-Agent-Id": agent_id,
                    "X-YellowStorm-Conversation-Id": conversation_id,
                    "X-Correlation-Id": correlation_id,
                },
                json={"toolName": tool_name, "arguments": args},
            )
            response.raise_for_status()
            body = response.json()
    except (httpx.HTTPError, ValueError):
        return {
            "decision": "denied",
            "code": "MASCOT_POLICY_UNAVAILABLE",
            "message": "The mascot tool policy is temporarily unavailable.",
            "retryable": True,
        }

    result = body.get("data") if isinstance(body, dict) and body.get("success") is True else body
    if not isinstance(result, dict):
        return {
            "decision": "denied",
            "code": "MASCOT_POLICY_INVALID_RESPONSE",
            "message": "The mascot tool policy returned an invalid response.",
        }
    if result.get("decision") == "allowed" and action == "start_playbook_execution":
        idempotency_key = result.get("idempotencyKey")
        if not isinstance(idempotency_key, str) or not idempotency_key:
            return {
                "decision": "denied",
                "code": "MASCOT_CONFIRMATION_INVALID",
                "message": "The confirmed action did not include a server idempotency key.",
            }
        args["idempotency_key"] = idempotency_key
    return result
