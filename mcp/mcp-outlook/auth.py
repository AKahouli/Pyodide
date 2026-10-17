from __future__ import annotations

from contextvars import ContextVar
from hmac import compare_digest
import os
import re

import jwt
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from starlette.types import ASGIApp, Receive, Scope, Send

from graph_helpers import _request_conversation_id, _request_user_id

_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$")
_actor_id: ContextVar[str | None] = ContextVar("mcp_actor_id", default=None)


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


class AuthMiddleware:
    """Authenticate MCP ingress; Graph credentials never come from this request."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self.mode = os.getenv("MCP_AUTH_MODE", "JWT").upper()
        self.ingress_token = os.getenv("MCP_INGRESS_TOKEN", "")
        public_key = os.getenv("MCP_JWT_PUBLIC_KEY", "")
        self.public_key = open(public_key, encoding="utf-8").read() if os.path.isfile(public_key) else public_key
        self.issuer = os.getenv("MCP_JWT_ISSUER", "")
        self.audience = os.getenv("MCP_JWT_AUDIENCE", "mcp")
        if self.mode not in {"JWT", "BEARER"}:
            raise ValueError("MCP_AUTH_MODE must be JWT or Bearer")
        if self.mode == "JWT" and not (self.public_key and self.issuer):
            raise ValueError("JWT ingress requires MCP_JWT_PUBLIC_KEY and MCP_JWT_ISSUER")
        if self.mode == "BEARER" and not self.ingress_token:
            raise ValueError("Bearer ingress requires MCP_INGRESS_TOKEN")

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
        header_map = {k.lower(): v.decode("utf-8", "replace") for k, v in headers}
        user_token = _request_user_id.set(actor)
        run_token = _request_conversation_id.set(header_map.get(b"x-conversation-id".decode()) or header_map.get(b"x-execution-id".decode()))
        actor_token = _actor_id.set(actor)
        try:
            await self.app(scope, receive, send)
        finally:
            _actor_id.reset(actor_token)
            _request_conversation_id.reset(run_token)
            _request_user_id.reset(user_token)


def actor_id() -> str:
    return _actor_id.get() or ""
