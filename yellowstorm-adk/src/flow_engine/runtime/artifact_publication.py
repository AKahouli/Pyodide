"""Publish generated Playbook artifacts into platform-controlled storage."""

import base64
import binascii
import mimetypes
import re
from typing import Any, Dict

import httpx

from src.config.settings import get_settings


MAX_ARTIFACT_BYTES = 10 * 1024 * 1024
_ARTIFACT_ID_RE = re.compile(r"^[a-f0-9]{32}$")


def decode_artifact_base64(payload: Any) -> bytes:
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
    internal_token: str,
) -> Dict[str, Any]:
    settings = get_settings()
    api_url = str(getattr(settings, "API_URL", "") or "")
    if not api_url or not internal_token or not execution_id or not user_id:
        raise ValueError("Platform artifact publication is not configured")

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
                "X-Internal-Token": internal_token,
                "X-YellowStorm-User-Id": user_id,
            },
            files={"file": (safe_filename, content, mime_type)},
        )
    response.raise_for_status()
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
