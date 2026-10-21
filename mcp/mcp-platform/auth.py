from contextlib import ExitStack
from contextvars import ContextVar
from dataclasses import dataclass
import re
import jwt
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey

from starlette.types import ASGIApp, Receive, Scope, Send
from structlog.contextvars import bind_contextvars, reset_contextvars


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


actor_context: ContextVar[PlatformActorContext | None] = ContextVar("platform_actor_context", default=None)
acting_user_id: ContextVar[str | None] = ContextVar("platform_acting_user_id", default=None)
# The verified, backend-issued MCP JWT of the current call (ADR-0024). Forwarded
# to the backend as the signed actor assertion; never logged.
verified_mcp_jwt: ContextVar[str | None] = ContextVar("platform_verified_mcp_jwt", default=None)


class TrustedIdentityMiddleware:
    """JWT-only ingress (ADR-0033): the backend-signed RS256 assertion is the
    only credential; static tokens and naked user-id headers never authenticate."""

    def __init__(self, app: ASGIApp, jwt_public_key: str, jwt_issuer: str, jwt_audience: str) -> None:
        if not jwt_issuer or not jwt_audience or not isinstance(load_pem_public_key(jwt_public_key.encode()), RSAPublicKey):
            raise ValueError("JWT authentication requires an RSA public key, issuer and audience")
        self.app = app
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
            issued_at, expires_at = claims["iat"], claims["exp"]
            if (type(issued_at) is not int or type(expires_at) is not int
                    or not 0 < expires_at - issued_at <= 300):
                return "", ""
            user_id = claims["sub"]
            return (user_id, parts[1]) if isinstance(user_id, str) and _IDENTIFIER.fullmatch(user_id) else ("", "")
        except (jwt.InvalidTokenError, TypeError, ValueError, OverflowError):
            return "", ""

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        raw_headers = scope.get("headers", [])
        # Retired static credentials are rejected before anything else,
        # including the health routes (fail-closed, ADR-0033).
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
        jwt_user_id, assertion = self._jwt_identity(raw_headers)
        header_user_id = headers.get(b"x-yellowstorm-user-id", b"").decode("utf-8", errors="replace").strip()
        if header_user_id and header_user_id != jwt_user_id:
            await send({"type": "http.response.start", "status": 401,
                        "headers": [(b"content-type", b"application/json")]})
            await send({"type": "http.response.body", "body": b'{"error":"unauthorized"}'})
            return
        values = {
            "user_id": jwt_user_id,
            "agent_id": headers.get(b"x-yellowstorm-agent-id", b"").decode("utf-8", errors="replace").strip(),
            "conversation_id": headers.get(b"x-yellowstorm-conversation-id", b"").decode("utf-8", errors="replace").strip(),
            "correlation_id": headers.get(b"x-correlation-id", b"").decode("utf-8", errors="replace").strip(),
        }
        invalid_identity = any(
            value and not _IDENTIFIER.fullmatch(value)
            for value in values.values()
        )
        if not jwt_user_id or invalid_identity:
            await send({
                "type": "http.response.start",
                "status": 401,
                "headers": [(b"content-type", b"application/json")],
            })
            await send({"type": "http.response.body", "body": b'{"error":"unauthorized"}'})
            return

        # The signed sub already carries the identity; fill the trace fields
        # so the forwarded headers stay well-formed for the backend guard.
        values["agent_id"] = values["agent_id"] or _UNKNOWN_AGENT
        values["conversation_id"] = values["conversation_id"] or _UNKNOWN_CONVERSATION
        values["correlation_id"] = values["correlation_id"] or _UNKNOWN_CORRELATION
        context = PlatformActorContext(
            user_id=values["user_id"],
            agent_id=values["agent_id"],
            conversation_id=values["conversation_id"],
            correlation_id=values["correlation_id"],
        )
        # Restore previous values even on partial setup, nested calls and cancellation.
        with ExitStack() as cleanup:
            cleanup.callback(acting_user_id.reset, acting_user_id.set(values["user_id"]))
            cleanup.callback(actor_context.reset, actor_context.set(context))
            cleanup.callback(verified_mcp_jwt.reset, verified_mcp_jwt.set(assertion))
            bound = bind_contextvars(
                username=values["user_id"],
                agent_id=context.agent_id,
                conversation_id=context.conversation_id,
                request_id=context.correlation_id,
            )
            cleanup.callback(reset_contextvars, **bound)
            await self.app(scope, receive, send)


def require_actor_context() -> PlatformActorContext:
    context = actor_context.get()
    if context is None:
        raise RuntimeError("Trusted actor context is unavailable")
    return context


def require_acting_user_id() -> str:
    return require_actor_context().user_id
