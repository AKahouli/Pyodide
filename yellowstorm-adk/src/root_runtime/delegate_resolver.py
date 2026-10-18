"""Trusted selected-definition client; no model-supplied URLs or authority."""
from __future__ import annotations

import os
import base64
import json
import asyncio
import contextlib
from contextvars import ContextVar
from dataclasses import dataclass, field
from functools import wraps
from typing import Any

import httpx
from google.protobuf import json_format

from src.config.settings import get_settings
from src.grpc_generated import chatbot_pb2


@dataclass(repr=False)
class _RootAuthority:
    execution_id: str
    token: str = field(repr=False)
    purpose: str = 'root-work'
    failed: bool = False
    child_proofs: dict[str, str] = field(default_factory=dict, repr=False)


_root_authority: ContextVar[_RootAuthority | None] = ContextVar('root_execution_authority', default=None)
_native_child_authority: ContextVar[_RootAuthority | None] = ContextVar('foreground_native_child_authority', default=None)


def _authority_headers(authority):
    token = getattr(get_settings(), 'ADK_ROOT_RUNTIME_SERVICE_TOKEN', None)
    if authority is None or authority.failed or not isinstance(token, str) or not token.strip() or token != token.strip():
        raise ValueError('Authenticated root dispatch authority is required')
    return {'X-YellowStorm-Service-Principal': 'adk-root-runtime', 'X-YellowStorm-Service-Token': token,
        'X-YellowStorm-Execution-Authority': authority.token}


async def root_authority_headers():
    return _authority_headers(_root_authority.get())


async def native_actor_headers():
    child = _native_child_authority.get()
    if child is not None:
        return _authority_headers(child)  # A failed child must never fall back to its parent.
    if _root_authority.get() is not None:
        return await root_authority_headers()
    from src.flow_engine.runtime.artifact_publication import publication_authority_headers
    return await publication_authority_headers()


async def _child_heartbeat(authority):
    try:
        while True:
            await asyncio.sleep(120)
            settings = get_settings()
            base = (os.environ.get('PLATFORM_API_URL') or settings.API_URL).rstrip('/')
            base = base + '/v1' if base.endswith('/api') else base if base.endswith('/api/v1') else base + '/api/v1'
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(f'{base}/internal/root-work/{authority.execution_id}/authority/renew',
                    headers=_authority_headers(authority), json={})
            if response.is_error:
                raise ValueError('Child authority renewal denied')
            body = response.json()
            result = body.get('data', body) if isinstance(body, dict) else None
            token = result.get('token') if isinstance(result, dict) else None
            if not isinstance(token, str) or not token:
                raise ValueError('Invalid child authority renewal response')
            authority.token = token
    except asyncio.CancelledError:
        raise
    except Exception:
        authority.failed = True


@contextlib.asynccontextmanager
async def foreground_child_authority(execution_id):
    parent = _root_authority.get()
    token = parent.child_proofs.get(execution_id) if parent and parent.purpose == 'root-work' else None
    if not token:
        raise ValueError('Privately admitted foreground child authority is required')
    authority = _RootAuthority(execution_id, token)
    binding = _native_child_authority.set(authority)
    heartbeat = None
    try:
        _authority_headers(authority)
        heartbeat = asyncio.create_task(_child_heartbeat(authority))
        yield
    finally:
        if heartbeat:
            heartbeat.cancel()
            with contextlib.suppress(asyncio.CancelledError): await heartbeat
        _native_child_authority.reset(binding)


async def _root_heartbeat(authority):
    try:
        while True:
            await asyncio.sleep(120)
            result = await _post(authority, 'authority/renew', {})
            if not isinstance(result.get('token'), str) or not result['token']:
                raise ValueError('Invalid root authority renewal response')
            authority.token = result['token']
    except asyncio.CancelledError:
        raise
    except Exception:
        authority.failed = True


def with_root_authority(method):
    @wraps(method)
    async def wrapped(self, request, context):
        scope = getattr(request, 'execution_scope', None)
        execution_id = getattr(scope, 'execution_id', '')
        metadata_key = 'x-yellowstorm-root-authority' if execution_id else 'x-yellowstorm-native-authority'
        proofs = [value for key, value in context.invocation_metadata() if key.lower() == metadata_key]
        if len(proofs) != 1 or not isinstance(proofs[0], str) or not proofs[0] or ',' in proofs[0]:
            raise ValueError('Authenticated root dispatch authority is required')
        if not execution_id:
            try:
                execution_id = json.loads(base64.urlsafe_b64decode(proofs[0].split('.')[1] + '==='))['executionId']
            except (ValueError, KeyError, IndexError, TypeError):
                raise ValueError('Invalid native dispatch authority') from None
        authority = _RootAuthority(execution_id, proofs[0], 'root-work' if scope and getattr(scope, 'execution_id', '') else 'native-conversation')
        binding = _root_authority.set(authority)
        heartbeat = None
        try:
            await root_authority_headers()
            heartbeat = asyncio.create_task(_root_heartbeat(authority))
            async for event in method(self, request, context): yield event
        finally:
            if heartbeat:
                heartbeat.cancel()
                with contextlib.suppress(asyncio.CancelledError): await heartbeat
            _root_authority.reset(binding)
    return wrapped


async def _post(scope: Any, path: str, payload: dict) -> dict:
    settings = get_settings()
    authority = _root_authority.get()
    if authority is None or authority.execution_id != scope.execution_id:
        raise ValueError('Foreign or missing root execution authority')
    if authority.purpose != 'root-work' and path != 'authority/renew':
        raise ValueError('Native authority cannot control Root execution')
    base = (os.environ.get("PLATFORM_API_URL") or settings.API_URL).rstrip("/")
    if base.endswith("/api"):
        base += "/v1"
    elif not base.endswith("/api/v1"):
        base += "/api/v1"
    async with httpx.AsyncClient(timeout=30.0) as client:
        route = f'{scope.execution_id}/{path}' if authority.purpose == 'root-work' else 'native-authority/renew'
        response = await client.post(f"{base}/internal/root-work/{route}",
                                     headers=await root_authority_headers(), json=payload)
        if response.is_error:
            raise ValueError('Root operation denied')
        body = response.json()
    result = body.get("data", body) if isinstance(body, dict) else None
    if not isinstance(result, dict):
        raise ValueError("Invalid trusted delegation response")
    if path in ('delegate-definition', 'temporary-definition') and not result.get('result'):
        child_id = result.get('executionId')
        proof = response.headers.get('x-yellowstorm-child-authority')
        if not isinstance(child_id, str) or not proof or ',' in proof:
            raise ValueError('Missing private child admission authority')
        authority.child_proofs[child_id] = proof
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
    from src.root_runtime.evidence_submission import prepare_evidence_submission
    submitted = await prepare_evidence_submission(scope, child_id, evidence, f'children/{child_id}/evidence-page') if status == 'completed' else {}
    return await _post(scope, f"children/{child_id}/lifecycle", {"status": status, **submitted,
        **({"text": text[:8000], "fullText": text} if text is not None else {})})
