from contextvars import ContextVar
from dataclasses import dataclass
import json
import re

import jwt
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from cryptography.hazmat.primitives.serialization import load_pem_public_key

from starlette.types import ASGIApp, Receive, Scope, Send

try:  # Unified logging is provided by the shared runtime when deployed.
    from structlog.contextvars import bind_contextvars, reset_contextvars
except Exception:  # pragma: no cover - optional dependency in bare test installs
    def bind_contextvars(**_kwargs):
        return ()

    def reset_contextvars(**_kwargs):
        return None


_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$")
_OBJECT_ID = re.compile(r"^[0-9a-fA-F]{24}$")
_FILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,254}$")
_LEGACY_HEADER = b"x-pyodide-mcp-token"
_HEALTH_PATHS = ("/health/live", "/health/ready")

# JWT mode fallbacks for the optional trace fields: the acting user id is the
# only security-relevant identity; agent/conversation/correlation are
# traceability aids, and the backend delegated-actor guard (ADR-0024) requires a
# non-empty correlation id.
_UNKNOWN_AGENT = "unknown-agent"
_UNKNOWN_CONVERSATION = "unknown-conversation"
_UNKNOWN_CORRELATION = "unknown-correlation"


def _input_file_names(value: str) -> tuple[str, ...]:
    """The trusted workspace file names (logical references) carried on the connector binding."""
    names = [item.strip() for item in value.split(",") if item.strip()]
    valid = [name for name in names if _FILE_NAME.fullmatch(name) and ".." not in name]
    return tuple(dict.fromkeys(valid))


def _first_workspace_id(value: str) -> str | None:
    """The ADK sends `workspace_id` as a single id or a JSON array; keep the first ObjectId."""
    candidate = value
    if value.startswith("["):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return None
        candidate = next((str(item) for item in parsed if str(item).strip()), "")
    candidate = candidate.strip().lower()
    return candidate if _OBJECT_ID.fullmatch(candidate) else None


@dataclass(frozen=True)
class PlatformActorContext:
    user_id: str
    agent_id: str
    conversation_id: str
    correlation_id: str


actor_context: ContextVar[PlatformActorContext | None] = ContextVar("pyodide_actor_context", default=None)
acting_user_id: ContextVar[str | None] = ContextVar("pyodide_acting_user_id", default=None)
# The verified, backend-issued MCP JWT of the current call (ADR-0024/ADR-0033). Forwarded
# to the backend as the signed actor assertion; never logged.
verified_mcp_jwt: ContextVar[str | None] = ContextVar("pyodide_verified_mcp_jwt", default=None)
workspace_id: ContextVar[str | None] = ContextVar("pyodide_workspace_id", default=None)
input_file_names: ContextVar[tuple[str, ...]] = ContextVar("pyodide_input_file_names", default=())


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
            # The acting user is a YellowStorm user (Mongo ObjectId); anything
            # else never authenticates.
            return (user_id, parts[1]) if isinstance(user_id, str) and _OBJECT_ID.fullmatch(user_id) else ("", "")
        except (jwt.InvalidTokenError, TypeError, ValueError, OverflowError):
            return "", ""

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        raw_headers = scope.get("headers", [])
        # The retired static credential is rejected before anything else,
        # including the health routes (fail-closed, ADR-0033).
        if any(name.lower() == _LEGACY_HEADER for name, _value in raw_headers):
            await _unauthorized(send)
            return

        if scope.get("path") in _HEALTH_PATHS:
            await self.app(scope, receive, send)
            return

        headers = {key.lower(): value for key, value in raw_headers}
        jwt_user_id, assertion = self._jwt_identity(raw_headers)
        header_user_id = headers.get(b"x-yellowstorm-user-id", b"").decode("utf-8", errors="replace").strip()
        if header_user_id and header_user_id != jwt_user_id:
            await _unauthorized(send)
            return
        values = {
            "user_id": jwt_user_id,
            "agent_id": headers.get(b"x-yellowstorm-agent-id", b"").decode("utf-8", errors="replace").strip(),
            # The ADK tool wrapper stamps the generic streamable-HTTP context name
            # (x-conversation-id); accept it as the platform conversation header.
            "conversation_id": (
                headers.get(b"x-yellowstorm-conversation-id", b"").decode("utf-8", errors="replace").strip()
                or headers.get(b"x-conversation-id", b"").decode("utf-8", errors="replace").strip()
            ),
            "correlation_id": headers.get(b"x-correlation-id", b"").decode("utf-8", errors="replace").strip(),
        }
        invalid_identity = any(
            value and not _IDENTIFIER.fullmatch(value)
            for value in values.values()
        )
        if not jwt_user_id or invalid_identity:
            await _unauthorized(send)
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
        workspace_raw = headers.get(b"workspace_id", b"").decode("utf-8", errors="replace").strip()
        files_raw = headers.get(b"x-yellowstorm-input-files", b"").decode("utf-8", errors="replace").strip()
        # Parse connector-binding context BEFORE any ContextVar mutation: a parser
        # failure (e.g. RecursionError on a deeply nested workspace_id array) must
        # not leave a half-installed identity behind the cleanup boundary.
        workspace_value = _first_workspace_id(workspace_raw)
        files_value = _input_file_names(files_raw)
        user_token = acting_user_id.set(values["user_id"])
        actor_token = actor_context.set(context)
        assertion_token = verified_mcp_jwt.set(assertion)
        workspace_token = workspace_id.set(workspace_value)
        files_token = input_file_names.set(files_value)
        bound: dict = {}
        try:
            bound = bind_contextvars(
                username=values["user_id"],
                agent_id=context.agent_id,
                conversation_id=context.conversation_id,
                request_id=context.correlation_id,
            )
            await self.app(scope, receive, send)
        finally:
            if bound:
                reset_contextvars(**bound)
            input_file_names.reset(files_token)
            workspace_id.reset(workspace_token)
            verified_mcp_jwt.reset(assertion_token)
            actor_context.reset(actor_token)
            acting_user_id.reset(user_token)


async def _unauthorized(send: Send) -> None:
    await send({
        "type": "http.response.start",
        "status": 401,
        "headers": [(b"content-type", b"application/json")],
    })
    await send({"type": "http.response.body", "body": b'{"error":"unauthorized"}'})


def require_actor_context() -> PlatformActorContext:
    context = actor_context.get()
    if context is None:
        raise RuntimeError("Trusted actor context is unavailable")
    return context


def require_acting_user_id() -> str:
    user_id = acting_user_id.get()
    if not user_id:
        raise RuntimeError("Trusted acting user is unavailable")
    return user_id
