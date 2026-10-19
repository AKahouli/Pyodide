"""Renew delegated MCP tokens through the trusted YellowStorm backend."""

import base64
import json
import time
from urllib.parse import urlsplit

import httpx


def _server_identity(value: str) -> tuple:
    url = urlsplit(value)
    if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError("Invalid MCP server URL")
    return url.scheme, url.hostname, url.port or (443 if url.scheme == "https" else 80), url.path.rstrip("/")


def current_assertion(headers: dict) -> str:
    values = [value for key, value in headers.items() if key.lower() == "authorization"]
    if len(values) != 1 or not isinstance(values[0], str):
        raise RuntimeError("MCP JWT requires a current assertion; rebind authenticated execution")
    parts = values[0].split(" ")
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1] or any(c.isspace() for c in parts[1]):
        raise RuntimeError("MCP JWT requires a current assertion; rebind authenticated execution")
    return parts[1]


def assertion_expiry(headers: dict, auth_env: dict) -> int:
    """Check lifetime/shape only; backend and MCP verify signed authority.

    Authenticated execution supplies the binding. Decoded claims here are only
    fail-closed renewal scheduling hints, never identity or policy authority.
    """
    try:
        token = current_assertion(headers)
        encoded_header, encoded_claims, signature = token.split(".")
        header = json.loads(base64.urlsafe_b64decode(encoded_header + "=" * (-len(encoded_header) % 4)))
        claims = json.loads(base64.urlsafe_b64decode(encoded_claims + "=" * (-len(encoded_claims) % 4)))
        now = time.time()
        expiry, issued = claims["exp"], claims["iat"]
        if (not signature or header.get("alg") != "RS256"
                or type(expiry) is not int or type(issued) is not int
                or not 0 < expiry - issued <= 300 or issued > now
                or not claims.get("sub")
                or claims.get("connectorId") != auth_env.get("YELLOWSTORM_MCP_JWT_CONNECTOR_ID")
                or type(claims.get("securityRevision")) is not int or claims["securityRevision"] < 1
                or ("nbf" in claims and (type(claims["nbf"]) is not int or claims["nbf"] > now))):
            raise ValueError("Invalid assertion")
        if expiry <= now:
            raise RuntimeError("MCP JWT assertion expired; rebind authenticated execution")
        return expiry
    except (ValueError, TypeError, KeyError, AttributeError):
        raise RuntimeError("MCP JWT assertion invalid; rebind authenticated execution") from None


async def renew_mcp_jwt(server_url: str, auth_env: dict, headers: dict) -> tuple[dict, int]:
    # Import lazily: ordinary Bearer connectors do not need platform settings.
    from src.config.settings import get_settings

    settings = get_settings()
    # Deployment settings only: never source this secret from connector env/config.
    service_token = getattr(settings, "ADK_RUNTIME_MCP_RENEWAL_TOKEN", "")
    if not service_token or not settings.API_URL:
        raise RuntimeError("MCP JWT renewal requires backend API_URL and ADK_RUNTIME_MCP_RENEWAL_TOKEN")
    assertion_expiry(headers, auth_env)
    assertion = current_assertion(headers)
    api_url = settings.API_URL.rstrip("/")
    if api_url.endswith("/api"):
        api_url += "/v1"
    elif not api_url.endswith("/v1"):
        api_url += "/api/v1"
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
            response = await client.post(
                f"{api_url}/connectors/internal/mcp-token",
                headers={
                    "X-Yellowstorm-Service-Principal": "adk-runtime",
                    "X-Yellowstorm-Service-Token": service_token,
                },
                json={"connectorId": auth_env["YELLOWSTORM_MCP_JWT_CONNECTOR_ID"],
                      "assertion": assertion},
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
            if type(expiry) is not int or expiry <= time.time():
                raise ValueError("Expired MCP JWT response")
            try:
                # Response metadata cannot schedule use beyond the JWT itself.
                # Signature/current-policy checks remain backend/MCP authority.
                expiry = min(expiry, assertion_expiry({"Authorization": f"Bearer {token}"}, auth_env))
            except RuntimeError:
                raise ValueError("Invalid renewed assertion") from None
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        # Responses can contain credentials; never propagate their body or token.
        raise RuntimeError("MCP JWT renewal failed") from None
    return {**{key: value for key, value in headers.items() if key.lower() != "authorization"},
            "Authorization": f"Bearer {token}"}, expiry
