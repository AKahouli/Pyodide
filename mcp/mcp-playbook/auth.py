from contextvars import ContextVar
from dataclasses import dataclass
from hmac import compare_digest
import re
import jwt
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey

from starlette.types import ASGIApp, Receive, Scope, Send
from structlog.contextvars import bind_contextvars, unbind_contextvars


_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$")

# JWT mode fallbacks for the optional trace fields: the acting user id is the
# only security-relevant identity; agent/conversation/correlation are
# traceability aids, and the backend delegated-actor guard (ADR-0024) requires a
# non-empty correlation id.
_UNKNOWN_AGENT = "unknown-agent"
_UNKNOWN_CONVERSATION = "unknown-conversation"
_UNKNOWN_CORRELATION = "unknown-correlation"


@dataclass(frozen=True)
class PlatformActorContext:
    user_id: str
    agent_id: str
    conversation_id: str
    correlation_id: str


actor_context: ContextVar[PlatformActorContext | None] = ContextVar("playbook_actor_context", default=None)
acting_user_id: ContextVar[str | None] = ContextVar("playbook_acting_user_id", default=None)
# The verified, backend-issued MCP JWT of the current call (ADR-0024). Forwarded
# to the backend as the signed actor assertion; never logged.
verified_mcp_jwt: ContextVar[str | None] = ContextVar("playbook_verified_mcp_jwt", default=None)


def _has_valid_bearer_auth(headers: list[tuple[bytes, bytes]], ingress_token: str) -> bool:
    if not ingress_token:
        return False

    authorization_values = [
        value for name, value in headers if name.lower() == b"authorization"
    ]
    if len(authorization_values) != 1:
        return False
    if any(name.lower() == b"x-playbook-mcp-token" for name, _value in headers):
        return False

    parts = authorization_values[0].decode("utf-8", errors="replace").split()
    return (
        len(parts) == 2
        and parts[0].lower() == "bearer"
        and compare_digest(parts[1], ingress_token)
    )


class TrustedIdentityMiddleware:
    def __init__(self, app: ASGIApp, ingress_token: str, auth_mode: str = "Bearer", jwt_public_key: str = "", jwt_issuer: str = "", jwt_audience: str = "mcp-playbook") -> None:
        if auth_mode not in ("JWT", "Bearer"):
            raise ValueError("Auth mode must be JWT or Bearer")
        if auth_mode == "JWT":
            if not jwt_issuer or not jwt_audience or not isinstance(load_pem_public_key(jwt_public_key.encode()), RSAPublicKey):
                raise ValueError("JWT mode requires an RSA public key, issuer and audience")
        self.app = app
        self.ingress_token = ingress_token
        self.auth_mode = auth_mode
        self.jwt_public_key = jwt_public_key
        self.jwt_issuer = jwt_issuer
        self.jwt_audience = jwt_audience

    def _jwt_identity(self, headers: list[tuple[bytes, bytes]]) -> tuple[str, str]:
        values = [value for name, value in headers if name.lower() == b"authorization"]
        if len(values) != 1:
            return "", ""
        parts = values[0].decode("utf-8", errors="replace").split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            return "", ""
        try:
            claims = jwt.decode(parts[1], self.jwt_public_key, algorithms=["RS256"],
                issuer=self.jwt_issuer, audience=self.jwt_audience,
                options={"require": ["sub", "iss", "aud", "iat", "exp"]})
            user_id = claims["sub"]
            return (user_id, parts[1]) if isinstance(user_id, str) and _IDENTIFIER.fullmatch(user_id) else ("", "")
        except (jwt.InvalidTokenError, TypeError, ValueError, OverflowError):
            return "", ""

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        raw_headers = scope.get("headers", [])
        if any(name.lower() == b"x-playbook-mcp-token" for name, _value in raw_headers):
            await send({
                "type": "http.response.start",
                "status": 401,
                "headers": [(b"content-type", b"application/json")],
            })
            await send({"type": "http.response.body", "body": b'{"error":"unauthorized"}'})
            return

        if scope.get("path") in ("/health/live", "/health/ready"):
            await self.app(scope, receive, send)
            return
        headers = {key.lower(): value for key, value in raw_headers}
        jwt_user_id, assertion = self._jwt_identity(raw_headers) if self.auth_mode == "JWT" else ("", "")
        values = {
            "user_id": jwt_user_id if self.auth_mode == "JWT" else headers.get(b"x-yellowstorm-user-id", b"").decode("utf-8", errors="replace").strip(),
            "agent_id": headers.get(b"x-yellowstorm-agent-id", b"").decode("utf-8", errors="replace").strip(),
            "conversation_id": headers.get(b"x-yellowstorm-conversation-id", b"").decode("utf-8", errors="replace").strip(),
            "correlation_id": headers.get(b"x-correlation-id", b"").decode("utf-8", errors="replace").strip(),
        }
        invalid_identity = any(
            value and not _IDENTIFIER.fullmatch(value)
            for value in values.values()
        )
        authenticated = bool(jwt_user_id) if self.auth_mode == "JWT" else _has_valid_bearer_auth(raw_headers, self.ingress_token)
        if not authenticated or invalid_identity:
            await send({
                "type": "http.response.start",
                "status": 401,
                "headers": [(b"content-type", b"application/json")],
            })
            await send({"type": "http.response.body", "body": b'{"error":"unauthorized"}'})
            return

        if self.auth_mode == "JWT":
            # The signed sub already carries the identity; fill the trace fields
            # so the forwarded headers stay well-formed for the backend guard.
            values["agent_id"] = values["agent_id"] or _UNKNOWN_AGENT
            values["conversation_id"] = values["conversation_id"] or _UNKNOWN_CONVERSATION
            values["correlation_id"] = values["correlation_id"] or _UNKNOWN_CORRELATION
        complete_actor = self.auth_mode == "JWT" and bool(values["user_id"]) or all(values[key] for key in (
            "user_id",
            "agent_id",
            "conversation_id",
            "correlation_id",
        ))
        context = PlatformActorContext(
            user_id=values["user_id"],
            agent_id=values["agent_id"],
            conversation_id=values["conversation_id"],
            correlation_id=values["correlation_id"],
        ) if complete_actor else None
        user_token = acting_user_id.set(values["user_id"] or None)
        actor_token = actor_context.set(context)
        jwt_token = verified_mcp_jwt.set(assertion or None)
        # Unified-logging context (plan P05): the SDK merges these contextvars at
        # emit time, so every envelope from this tool call carries the actor.
        bound = bind_contextvars(
            username=values["user_id"] or "",
            agent_id=(context.agent_id if context else ""),
            conversation_id=(context.conversation_id if context else ""),
            request_id=(context.correlation_id if context else ""),
        )
        try:
            await self.app(scope, receive, send)
        finally:
            unbind_contextvars(*bound)
            actor_context.reset(actor_token)
            acting_user_id.reset(user_token)
            verified_mcp_jwt.reset(jwt_token)


def require_actor_context() -> PlatformActorContext:
    context = actor_context.get()
    if context is None:
        raise RuntimeError("Trusted actor context is unavailable")
    return context


def require_acting_user_id() -> str:
    return require_actor_context().user_id
