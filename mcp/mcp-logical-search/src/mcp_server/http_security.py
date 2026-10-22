"""HTTP boundary controls; scope permissions never come from model arguments."""
import asyncio
from collections import defaultdict, deque
from ipaddress import ip_address, ip_network
import secrets
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from src.config.settings import get_settings
from src.mcp_server.logical_indexing_server import (
    _normalize_workspace_values, set_request_workspace_ids, clear_request_workspace_ids,
)


class RequestBodyLimitMiddleware:
    """Bound actual ASGI bytes, including chunked requests, before JSON parsing."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in ("POST", "PUT", "PATCH"):
            return await self.app(scope, receive, send)
        limit = get_settings().HTTP_BODY_MAX_BYTES
        headers = dict(scope["headers"])
        try:
            length = int(headers.get(b"content-length", b"0"))
            if length < 0:
                raise ValueError
        except ValueError:
            return await JSONResponse({"error": "invalid_content_length"}, status_code=400)(scope, receive, send)
        if length > limit:
            return await JSONResponse({"error": "request_too_large"}, status_code=413)(scope, receive, send)

        async def read_body():
            body = bytearray()
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return None
                chunk = message.get("body", b"")
                if len(body) + len(chunk) > limit:
                    return False
                body.extend(chunk)
                if not message.get("more_body", False):
                    return bytes(body)
        try:
            body = await asyncio.wait_for(read_body(), timeout=10)
        except asyncio.TimeoutError:
            return await JSONResponse({"error": "request_timeout"}, status_code=408)(scope, receive, send)
        if body is None:
            return
        if body is False:
            return await JSONResponse({"error": "request_too_large"}, status_code=413)(scope, receive, send)
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()
        await self.app(scope, replay, send)


class APIKeyAuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, api_key: str):
        super().__init__(app)
        self.api_key = api_key
        # One service credential; workspace headers cannot grow the rate-limit map.
        self.requests = defaultdict(deque)

    async def dispatch(self, request, call_next):
        settings = get_settings()
        path = request.url.path
        if path.startswith("/.well-known") or path == "/register":
            return JSONResponse({"error": "not_found"}, status_code=404)
        if path in ("/health/live", "/health/ready"):
            try:
                peer = ip_address(request.client.host)
                internal = any(peer in ip_network(value) for value in settings.HEALTH_ALLOWED_NETWORKS)
            except (ValueError, AttributeError):
                internal = False
            if not internal:
                return JSONResponse({"error": "probe_network_forbidden"}, status_code=403)

        auth = request.headers.get("Authorization", "")
        provided = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        if not provided or not secrets.compare_digest(provided.encode("utf-8"), self.api_key.encode("utf-8")):
            return JSONResponse({"error": "unauthorized"}, status_code=401,
                                headers={"WWW-Authenticate": "Bearer"})

        now = time.monotonic()
        limits = [("all", settings.HTTP_REQUESTS_PER_MINUTE)]
        if path == "/routing-profile":
            limits.append(("model", settings.HTTP_MODEL_REQUESTS_PER_MINUTE))
        for category, limit in limits:
            history = self.requests[category]
            while history and history[0] <= now - 60:
                history.popleft()
            if len(history) >= limit:
                return JSONResponse({"error": "rate_limited"}, status_code=429,
                                    headers={"Retry-After": "60"})
            history.append(now)

        scope_headers = request.headers.getlist("Workspace-Id")
        if any(len(value) > settings.HTTP_SCOPE_MAX_CHARS for value in scope_headers):
            return JSONResponse({"error": "invalid_workspace_scope"}, status_code=422)
        requested = _normalize_workspace_values(scope_headers)
        if len(requested) > settings.REQUEST_COLLECTION_MAX_ITEMS:
            return JSONResponse({"error": "invalid_workspace_scope"}, status_code=422)
        document_route = path in ("/routing-profile", "/summarize", "/search_documents", "/search_native", "/search_native/batch")
        # MCP initialization/discovery has no workspace. Tools and resource reads
        # enforce the current request's workspace scope before accessing data.
        if document_route and not requested:
            return JSONResponse({"error": "workspace_header_required"}, status_code=403)

        # Trusted application code supplies this dynamic scope outside the LLM.
        # End-user entitlement checks belong to that backend/gateway.
        request.state.authorized_workspace_ids = requested
        token = set_request_workspace_ids(requested)
        try:
            return await call_next(request)
        finally:
            clear_request_workspace_ids(token)
