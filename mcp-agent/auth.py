from contextvars import ContextVar
from dataclasses import dataclass
from hmac import compare_digest
import re

from starlette.types import ASGIApp, Receive, Scope, Send


_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$")


@dataclass(frozen=True)
class PlatformActorContext:
    user_id: str
    agent_id: str
    conversation_id: str
    correlation_id: str


actor_context: ContextVar[PlatformActorContext | None] = ContextVar("agent_mcp_actor_context", default=None)
acting_user_id: ContextVar[str | None] = ContextVar("agent_mcp_acting_user_id", default=None)


def _has_valid_bearer_auth(headers: list[tuple[bytes, bytes]], ingress_token: str) -> bool:
    if not ingress_token:
        return False

    authorization_values = [
        value for name, value in headers if name.lower() == b"authorization"
    ]
    if len(authorization_values) != 1:
        return False

    parts = authorization_values[0].decode("utf-8", errors="replace").split()
    return (
        len(parts) == 2
        and parts[0].lower() == "bearer"
        and compare_digest(parts[1], ingress_token)
    )


class TrustedIdentityMiddleware:
    def __init__(self, app: ASGIApp, ingress_token: str) -> None:
        self.app = app
        self.ingress_token = ingress_token

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        if scope.get("path") in ("/health/live", "/health/ready"):
            await self.app(scope, receive, send)
            return

        raw_headers = scope.get("headers", [])
        headers = {key.lower(): value for key, value in raw_headers}
        values = {
            "user_id": headers.get(b"x-yellowstorm-user-id", b"").decode("utf-8", errors="replace").strip(),
            "agent_id": headers.get(b"x-yellowstorm-agent-id", b"").decode("utf-8", errors="replace").strip(),
            "conversation_id": headers.get(b"x-yellowstorm-conversation-id", b"").decode("utf-8", errors="replace").strip(),
            "correlation_id": headers.get(b"x-correlation-id", b"").decode("utf-8", errors="replace").strip(),
        }
        invalid_identity = any(
            value and not _IDENTIFIER.fullmatch(value)
            for value in values.values()
        )
        if not _has_valid_bearer_auth(raw_headers, self.ingress_token) or invalid_identity:
            await send({
                "type": "http.response.start",
                "status": 401,
                "headers": [(b"content-type", b"application/json")],
            })
            await send({"type": "http.response.body", "body": b'{"error":"unauthorized"}'})
            return

        complete_actor = all(values[key] for key in (
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
        try:
            await self.app(scope, receive, send)
        finally:
            actor_context.reset(actor_token)
            acting_user_id.reset(user_token)


def require_actor_context() -> PlatformActorContext:
    context = actor_context.get()
    if context is None:
        raise RuntimeError("Trusted actor context is unavailable")
    return context


def require_acting_user_id() -> str:
    return require_actor_context().user_id
