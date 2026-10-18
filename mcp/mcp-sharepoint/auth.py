from __future__ import annotations

from contextvars import ContextVar
from hmac import compare_digest
import os
import re

import jwt
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from starlette.types import ASGIApp, Receive, Scope, Send

from graph_helpers import (
    _delegated_provider_token,
    _request_conversation_id,
    _request_user_id,
)

_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$")
_actor_id: ContextVar[str | None] = ContextVar("mcp_actor_id", default=None)
DEFAULT_PROVIDER_TOKEN_HEADER = "x-m365-access-token"


def _headers(scope: Scope) -> list[tuple[bytes, bytes]]:
    return list(scope.get("headers", []))


def _authorization(headers: list[tuple[bytes, bytes]]) -> str:
    values = [v.decode("utf-8", "replace") for k, v in headers if k.lower() == b"authorization"]
    if len(values) != 1:
        return ""
    parts = values[0].split()
    return parts[1] if len(parts) == 2 and parts[0].lower() == "bearer" else ""


def _deny(send: Send) -> None:
    raise RuntimeError("_deny must be awaited")


async def _unauthorized(send: Send) -> None:
    await send({"type": "http.response.start", "status": 401, "headers": [(b"content-type", b"application/json"), (b"www-authenticate", b'Bearer realm="mcp"')]})
    await send({"type": "http.response.body", "body": b'{"error":"unauthorized"}'})


async def _provider_credential_required(send: Send) -> None:
    await send({"type": "http.response.start", "status": 403, "headers": [(b"content-type", b"application/json")]})
    await send({"type": "http.response.body", "body": b'{"error":"provider_credential_required"}'})


def _single_header(headers: list[tuple[bytes, bytes]], name: str) -> str:
    """The only value of `name`, or "" when it is absent or duplicated."""
    values = [v.decode("utf-8", "replace").strip() for k, v in headers if k.lower() == name.encode() and v.decode("utf-8", "replace").strip()]
    return values[0] if len(values) == 1 else ""


class AuthMiddleware:
    """Authenticate MCP ingress and bind the acting user's delegated Graph token.

    Two independent credentials arrive on every call and neither substitutes for
    the other (ADR-0017): the Authorization bearer is the backend-signed actor
    assertion (JWT mode) and the configured provider-token header carries the
    verified user's Microsoft Graph token. Tool calls fail closed when the
    provider token is absent or when it echoes the ingress assertion.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self.mode = os.getenv("MCP_AUTH_MODE", "JWT").upper()
        self.ingress_token = os.getenv("MCP_INGRESS_TOKEN", "")
        public_key = os.getenv("MCP_JWT_PUBLIC_KEY", "")
        self.public_key = open(public_key, encoding="utf-8").read() if os.path.isfile(public_key) else public_key
        self.issuer = os.getenv("MCP_JWT_ISSUER", "")
        self.audience = os.getenv("MCP_JWT_AUDIENCE", "mcp")
        self.provider_token_header = (os.getenv("M365_TOKEN_HEADER") or DEFAULT_PROVIDER_TOKEN_HEADER).strip().lower()
        if self.mode not in {"JWT", "BEARER"}:
            raise ValueError("MCP_AUTH_MODE must be JWT or Bearer")
        if self.mode == "JWT" and not (self.public_key and self.issuer):
            raise ValueError("JWT ingress requires MCP_JWT_PUBLIC_KEY and MCP_JWT_ISSUER")
        if self.mode == "BEARER" and not self.ingress_token:
            raise ValueError("Bearer ingress requires MCP_INGRESS_TOKEN")
        if not _IDENTIFIER.fullmatch(self.provider_token_header):
            raise ValueError("M365_TOKEN_HEADER is not a valid header name")

    def _actor(self, token: str, headers: list[tuple[bytes, bytes]]) -> str:
        if self.mode == "BEARER":
            values = [v.decode("utf-8", "replace") for k, v in headers if k.lower() == b"x-user-id"]
            return values[0].strip() if len(values) == 1 and _IDENTIFIER.fullmatch(values[0].strip()) else ""
        try:
            claims = jwt.decode(token, self.public_key, algorithms=["RS256"], issuer=self.issuer, audience=self.audience, options={"require": ["sub", "iss", "aud", "iat", "exp"]})
            subject = claims.get("sub", "")
            return subject if isinstance(subject, str) and _IDENTIFIER.fullmatch(subject) else ""
        except (jwt.InvalidTokenError, TypeError, ValueError, OverflowError):
            return ""

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("path") in {"/health", "/health/live", "/health/ready"}:
            await self.app(scope, receive, send)
            return
        headers = _headers(scope)
        token = _authorization(headers)
        authenticated = compare_digest(token, self.ingress_token) if self.mode == "BEARER" else bool(self._actor(token, headers))
        actor = self._actor(token, headers) if authenticated else ""
        if not authenticated or (scope.get("path") == "/mcp" and not actor):
            await _unauthorized(send)
            return
        provider_token = _single_header(headers, self.provider_token_header)
        # The user's Graph token is required for tool calls, must not be reused as
        # (or confused with) the ingress assertion, and is never read from the
        # environment — an ambient token would defeat per-user provider authority.
        if scope.get("path") == "/mcp" and (not provider_token or provider_token == token):
            await _provider_credential_required(send)
            return
        header_map = {k.lower(): v.decode("utf-8", "replace") for k, v in headers}
        user_token = _request_user_id.set(actor)
        run_token = _request_conversation_id.set(header_map.get(b"x-conversation-id".decode()) or header_map.get(b"x-execution-id".decode()))
        actor_token = _actor_id.set(actor)
        provider_token_handle = _delegated_provider_token.set(provider_token or None)
        try:
            await self.app(scope, receive, send)
        finally:
            _delegated_provider_token.reset(provider_token_handle)
            _actor_id.reset(actor_token)
            _request_conversation_id.reset(run_token)
            _request_user_id.reset(user_token)


def actor_id() -> str:
    return _actor_id.get() or ""
