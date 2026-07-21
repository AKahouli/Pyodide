from contextvars import ContextVar
from hmac import compare_digest

from starlette.types import ASGIApp, Receive, Scope, Send


acting_user_id: ContextVar[str | None] = ContextVar("playbook_acting_user_id", default=None)


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
        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        supplied_token = headers.get(b"x-playbook-mcp-token", b"").decode("utf-8", errors="replace")
        user_id = headers.get(b"x-yellowstorm-user-id", b"").decode("utf-8", errors="replace").strip()
        if not self.ingress_token or not compare_digest(supplied_token, self.ingress_token) or not user_id:
            await send({
                "type": "http.response.start",
                "status": 401,
                "headers": [(b"content-type", b"application/json")],
            })
            await send({"type": "http.response.body", "body": b'{"error":"unauthorized"}'})
            return

        token = acting_user_id.set(user_id)
        try:
            await self.app(scope, receive, send)
        finally:
            acting_user_id.reset(token)


def require_acting_user_id() -> str:
    user_id = acting_user_id.get()
    if not user_id:
        raise RuntimeError("Trusted acting user identity is unavailable")
    return user_id
