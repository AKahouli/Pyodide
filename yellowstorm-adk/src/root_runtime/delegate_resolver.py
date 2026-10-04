"""Trusted selected-definition client; no model-supplied URLs or authority."""
from __future__ import annotations

import os
from typing import Any

import httpx
from google.protobuf import json_format

from src.config.settings import get_settings
from src.grpc_generated import chatbot_pb2


async def _post(scope: Any, path: str, payload: dict) -> dict:
    settings = get_settings()
    token = settings.INTERNAL_SERVICE_SECRET
    base = (os.environ.get("PLATFORM_API_URL") or settings.API_URL).rstrip("/")
    if not token:
        raise RuntimeError("Internal delegation authentication is unavailable")
    if base.endswith("/api"):
        base += "/v1"
    elif not base.endswith("/api/v1"):
        base += "/api/v1"
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(f"{base}/internal/root-work/{scope.execution_id}/{path}",
                                     headers={"X-Internal-Token": token}, json=payload)
        response.raise_for_status()
        body = response.json()
    result = body.get("data", body) if isinstance(body, dict) else None
    if not isinstance(result, dict):
        raise ValueError("Invalid trusted delegation response")
    return result


async def resolve_delegate_definition(scope: Any, call_id: str, branch: str,
                                      agent_id: str, task: str, expected_output: str,
                                      context_refs: list[str]) -> dict:
    result = await _post(scope, "delegate-definition", {"agentId": agent_id, "nativeCallId": call_id,
        "nativeCallBranch": branch, "task": task, "expectedOutput": expected_output,
        "contextRefs": context_refs})
    return _resolved_worker(result)


def _resolved_worker(result):
    if not isinstance(result, dict) or not isinstance(result.get("definition"), dict):
        raise ValueError("Invalid trusted worker resolution")
    raw = dict(result["definition"])
    # REST-only binding fields have their protobuf mirror in agent_params.
    raw.pop("connector_bindings", None)
    raw.pop("connectorIds", None)
    try:
        pb_agent = json_format.ParseDict(raw, chatbot_pb2.Agent())
    except (ValueError, json_format.ParseError):
        raise ValueError("Invalid trusted worker definition") from None
    from src.grpc_server.chatbot_servicer import ChatbotServicer

    result["candidate"] = ChatbotServicer._convert_agent(pb_agent)
    return result


async def resolve_temporary_definition(scope: Any, call_id: str, branch: str, task: str,
                                     expected_output: str, context_refs: list[str]) -> dict:
    return _resolved_worker(await _post(scope, 'temporary-definition', {'nativeCallId': call_id,
        'nativeCallBranch': branch, 'task': task, 'expectedOutput': expected_output,
        'contextRefs': context_refs}))


async def settle_delegate(scope: Any, child_id: str, status: str, text: str | None = None, evidence=None) -> dict:
    if text is not None and len(text.encode('utf-8')) > 262144:
        raise ValueError('Child output exceeds the durable result limit')
    return await _post(scope, f"children/{child_id}/lifecycle", {"status": status,
        **({'evidence': [{key: item[key] for key in ('nativeIdentity', 'outputOrdinal', 'kind', 'payload')}
                        for item in evidence]} if evidence else {}),
        **({"text": text[:8000], "fullText": text} if text is not None else {})})
