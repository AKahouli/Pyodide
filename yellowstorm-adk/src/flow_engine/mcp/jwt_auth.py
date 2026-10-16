"""Renew delegated MCP tokens through the trusted YellowStorm backend."""

import time
from urllib.parse import urlsplit

import httpx


def _server_identity(value: str) -> tuple:
    url = urlsplit(value)
    if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError("Invalid MCP server URL")
    return url.scheme, url.hostname, url.port or (443 if url.scheme == "https" else 80), url.path.rstrip("/")


async def renew_mcp_jwt(server_url: str, auth_env: dict, headers: dict) -> tuple[dict, int]:
    # Import lazily: ordinary Bearer connectors do not need platform settings.
    from src.config.settings import get_settings

    settings = get_settings()
    secret = settings.INTERNAL_SERVICE_SECRET
    if not secret or not settings.API_URL:
        raise RuntimeError("MCP JWT renewal requires backend API_URL and INTERNAL_SERVICE_SECRET")
    api_url = settings.API_URL.rstrip("/")
    if api_url.endswith("/api"):
        api_url += "/v1"
    elif not api_url.endswith("/v1"):
        api_url += "/api/v1"
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
            response = await client.post(
                f"{api_url}/connectors/internal/mcp-token",
                headers={"X-Internal-Token": secret},
                json={"connectorId": auth_env["YELLOWSTORM_MCP_JWT_CONNECTOR_ID"],
                      "userId": auth_env["YELLOWSTORM_MCP_JWT_USER_ID"]},
            )
            response.raise_for_status()
            payload = response.json()
            if isinstance(payload, dict) and payload.get("success") is True:
                payload = payload.get("data")
            if not isinstance(payload, dict) or _server_identity(payload["serverUrl"]) != _server_identity(server_url):
                raise ValueError("MCP JWT server mismatch")
            token = payload["token"]
            expiry = payload["expiresAt"]
            if not isinstance(token, str) or not token or any(c.isspace() for c in token):
                raise ValueError("Invalid MCP JWT response")
            if not isinstance(expiry, int) or expiry <= time.time():
                raise ValueError("Expired MCP JWT response")
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        # Responses can contain credentials; never propagate their body or token.
        raise RuntimeError("MCP JWT renewal failed") from None
    return {**{key: value for key, value in headers.items() if key.lower() != "authorization"},
            "Authorization": f"Bearer {token}"}, expiry
