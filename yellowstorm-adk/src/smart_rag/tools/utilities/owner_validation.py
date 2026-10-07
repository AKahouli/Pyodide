"""Telegram owner validation — fire-and-forget approval request.

The agent is chatting with an external visitor (Telegram guest flow, injected
per turn by the NestJS single-agent channel). When the caller asks for
something the agent cannot decide alone (scheduling, commitments…), the tool
nudges the bot owner's personal Telegram chat with inline buttons and returns
immediately — waiting mid-turn is what `mcp_tasks` exists for and we are not
that. The owner's tap is relayed later by the backend as a follow-up message
in the same conversation, which becomes the agent's next "turn".
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


def create_request_owner_validation_tool(runtime_context: Dict[str, Any] | None = None):
    """Factory hook for RUNTIME_NATIVE_TOOL_FACTORIES. The backend bakes the
    integration/conversation ids into agent_params for the duration of the run."""
    ctx = runtime_context or {}
    integration_id = str(ctx.get("telegram_validation_integration_id") or "")
    conversation_id = str(ctx.get("telegram_validation_conversation_id") or "")


    async def request_owner_validation(
        question: str,
        choices: List[str] | None = None,
    ) -> Dict[str, Any]:
        """Ask your owner (the agent controller) for a decision or approval.

        Use this when the external visitor requests something you cannot decide
        alone: scheduling a meeting, committing to something, giving access,
        accepting an offer, etc.

        Args:
          question: the concrete question for your owner (e.g. "Visitor X
            wants coffee on Tuesday at 15:00 — OK?").
         choices: optional answer buttons. Omit this argument when the owner
             should answer freely in text.

        Returns immediately once the question was sent. Your owner's answer
        will arrive as a follow-up message in this conversation — acknowledge
        the caller warmly ("I asked your question to the person concerned")
        and finish your reply.
        """
        import httpx
        from src.config.settings import get_settings

        logger.info(
            "request_owner_validation called integration=%s conversation=%s question_length=%s choices_count=%s",
            integration_id, conversation_id, len(question), len(choices or []),
        )
        try:
            settings = get_settings()
        except Exception as e:
            logger.warning("request_owner_validation: settings unavailable: %s", e)
            return {"status": "unavailable", "detail": "platform API is not configured"}

        url = (getattr(settings, "API_URL", "") or "").rstrip("/")
        token = getattr(settings, "INTERNAL_SERVICE_SECRET", "") or ""
        if not url or not token:
            logger.warning(
                "request_owner_validation unavailable: API_URL configured=%s internal token configured=%s",
                bool(url),
                bool(token),
            )
            return {"status": "unavailable", "detail": "platform API is not configured"}

        if url.endswith("/api/v1"):
            api_base = url
        elif url.endswith("/api"):
            api_base = f"{url}/v1"
        else:
            api_base = f"{url}/api/v1"

        payload = {
            "integration_id": integration_id,
            "conversation_id": conversation_id,
            "question": question,
            "choices": [str(choice) for choice in (choices or [])],
        }
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    f"{api_base}/telegram/internal/validations",
                    json=payload,
                    headers={
                        "X-Internal-Token": token,
                        "Content-Type": "application/json",
                    },
                )
                if resp.status_code != 200:
                    logger.warning(
                        "request_owner_validation failed status=%s body=%s",
                        resp.status_code,
                        resp.text[:1000],
                    )
                    return {
                        "status": "error",
                        "detail": f"the validation request failed (HTTP {resp.status_code}) — propose alternatives to the caller",
                    }
                body = resp.json()
                data = body["data"] if isinstance(body, dict) and isinstance(body.get("data"), dict) else body
                logger.info("request_owner_validation ok validation_id=%s", data.get("validationId"))
                return {
                    "status": "pending_owner_validation",
                    "validation_id": data.get("validationId"),
                    "question": data.get("question"),
                    "choices": data.get("choices"),
                    "sent_to_owner": True,
                    "detail": (
                        "Your owner has received the question with buttons. "
                        "Tell the caller the request has been forwarded and can "
                        "end your reply — the response will arrive automatically."
                    ),
                }
        except Exception as e:
            logger.warning("request_owner_validation error: %s", e)
            return {
                "status": "error",
                "detail": "the request could not be sent to your owner — propose alternatives to the caller",
            }


    from src.root_runtime.leaf_tools import register_tool_execution_kind
    return register_tool_execution_kind(request_owner_validation, "leaf")
