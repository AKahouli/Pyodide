"""Publish generated Playbook artifacts into platform-controlled storage."""

import base64
import asyncio
import binascii
import contextlib
from contextvars import ContextVar
from dataclasses import dataclass, field
from functools import wraps
import json
import time
import mimetypes
import re
from typing import Any, Dict

import httpx

from src.config.settings import get_settings


MAX_ARTIFACT_BYTES = 10 * 1024 * 1024
_ARTIFACT_ID_RE = re.compile(r"^[a-f0-9]{32}$")


@dataclass(repr=False)
class _PublicationAuthority:
    execution_id: str
    user_id: str
    token: str = field(repr=False)
    failed: bool = False
    lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)


_authority: ContextVar[_PublicationAuthority | None] = ContextVar("playbook_artifact_authority", default=None)


async def publication_authority_headers() -> dict[str, str]:
    authority = _authority.get()
    if authority is None or authority.failed:
        raise ValueError('Authenticated Playbook dispatch authority is required')
    return {**_machine_headers(), 'X-YellowStorm-Execution-Authority': authority.token}


def _machine_headers() -> dict[str, str]:
    settings = get_settings()
    token = getattr(settings, "ADK_PLAYBOOK_ARTIFACT_SERVICE_TOKEN", None)
    if not isinstance(token, str) or not token.strip() or token != token.strip():
        raise ValueError("Dedicated artifact service credential is unavailable")
    return {"X-YellowStorm-Service-Principal": "adk-playbook-artifact", "X-YellowStorm-Service-Token": token}


async def _renew(authority: _PublicationAuthority) -> None:
    async with authority.lock:
        if authority.failed:
            raise ValueError("Artifact execution authority is unavailable")
        url = f"{_api_base(str(get_settings().API_URL))}/internal/playbook-artifacts/executions/{authority.execution_id}/authority/renew"
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
            response = await client.post(url, headers={**_machine_headers(), "X-YellowStorm-Execution-Authority": authority.token})
        if response.is_error:
            authority.failed = True
            raise ValueError("Artifact execution authority renewal was denied")
        body = response.json()
        result = body.get("data", body) if isinstance(body, dict) else None
        token = result.get("token") if isinstance(result, dict) else None
        if not isinstance(token, str) or not token:
            authority.failed = True
            raise ValueError("Invalid artifact authority renewal response")
        authority.token = token


async def _keep_authority_live(authority: _PublicationAuthority) -> None:
    try:
        while True:
            await asyncio.sleep(120)
            await _renew(authority)
    except asyncio.CancelledError:
        raise
    except Exception:
        # Never log httpx errors containing request headers/proof. Future calls
        # fail closed; there is no selector-based bootstrap or expired refresh.
        authority.failed = True


def with_artifact_authority(method):
    """Authenticated gRPC metadata only; never checkpoint/model state or Struct."""
    @wraps(method)
    async def wrapped(self, request, context):
        proofs = [value for key, value in context.invocation_metadata()
                  if key.lower() == "x-yellowstorm-artifact-authority"]
        if len(proofs) != 1 or not isinstance(proofs[0], str) or not proofs[0] or "," in proofs[0]:
            raise ValueError("Authenticated dispatch artifact authority is required")
        _machine_headers()
        authority = _PublicationAuthority(str(request.execution_id), str(request.owner_id), proofs[0])
        binding = _authority.set(authority)
        heartbeat = asyncio.create_task(_keep_authority_live(authority))
        try:
            async for event in method(self, request, context):
                yield event
        finally:
            heartbeat.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await heartbeat
            _authority.reset(binding)
    return wrapped


def decode_artifact_base64(payload: Any) -> bytes:
    if isinstance(payload, dict):
        payload = payload.get("result")
    if not isinstance(payload, str) or not payload:
        raise ValueError("Artifact download returned no data")
    max_encoded_length = 4 * ((MAX_ARTIFACT_BYTES + 2) // 3)
    if len(payload) > max_encoded_length:
        raise ValueError("Artifact exceeds the 10 MB publication limit")
    try:
        content = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("Artifact download returned invalid base64") from error
    if not content:
        raise ValueError("Artifact download returned an empty file")
    if len(content) > MAX_ARTIFACT_BYTES:
        raise ValueError("Artifact exceeds the 10 MB publication limit")
    return content


def _api_base(raw_api_url: str) -> str:
    normalized = raw_api_url.rstrip("/")
    if normalized.endswith("/api/v1"):
        return normalized[:-3]
    if normalized.endswith("/api"):
        return normalized
    return f"{normalized}/api"


async def publish_playbook_artifact(
    *,
    payload: Any,
    filename: str,
    execution_id: str,
    user_id: str,
) -> Dict[str, Any]:
    settings = get_settings()
    api_url = str(getattr(settings, "API_URL", "") or "")
    authority = _authority.get()
    if (not api_url or not authority or authority.failed or authority.execution_id != execution_id
            or authority.user_id != user_id):
        raise ValueError("Platform artifact publication is not configured")

    try:
        claims = json.loads(base64.urlsafe_b64decode(authority.token.split('.')[1] + '==='))
        needs_renewal = claims['exp'] - time.time() < 60
    except (IndexError, KeyError, ValueError, TypeError):
        raise ValueError("Invalid artifact dispatch authority") from None
    if needs_renewal:
        await _renew(authority)

    safe_filename = filename.replace("\\", "/").rsplit("/", 1)[-1].strip()
    if not safe_filename:
        raise ValueError("Artifact filename is missing")
    mime_type = mimetypes.guess_type(safe_filename)[0] or "application/octet-stream"
    content = decode_artifact_base64(payload)
    url = f"{_api_base(api_url)}/internal/playbook-artifacts/executions/{execution_id}"

    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
        response = await client.post(
            url,
            headers={
                **_machine_headers(),
                "X-YellowStorm-Execution-Authority": authority.token,
                "X-YellowStorm-User-Id": user_id,
            },
            files={"file": (safe_filename, content, mime_type)},
        )
    if response.is_error:
        raise ValueError("Platform artifact publication was denied")
    body = response.json()
    result = body.get("data") if isinstance(body, dict) and isinstance(body.get("data"), dict) else body
    artifact_id = result.get("artifactId") if isinstance(result, dict) else None
    if not isinstance(artifact_id, str) or not _ARTIFACT_ID_RE.fullmatch(artifact_id):
        raise ValueError("Platform returned an invalid artifact receipt")
    return {
        "artifactId": artifact_id,
        "filename": safe_filename,
        "mimeType": str(result.get("mimeType") or mime_type),
        "size": int(result.get("size") or len(content)),
    }
