"""API-key authentication interceptor for the gRPC server.

A single server-level interceptor that requires every incoming call to carry a
shared secret in the ``x-api-key`` metadata header. It guards all services
registered on the server (ChatbotService, A2AAdminService, PlaybookFlowRuntime)
without any per-method wiring.

When no API key is configured the server is unauthenticated (intended for local
development only); callers should not add the interceptor in that case.
"""

from __future__ import annotations

import hmac
import re

import grpc
from structlog import get_logger
from structlog.contextvars import bind_contextvars

from src.middleware.correlation import correlation_id_ctx, trace_id_from_header

logger = get_logger(__name__)

API_KEY_HEADER = "x-api-key"


class ApiKeyAuthInterceptor(grpc.aio.ServerInterceptor):
    """Reject calls whose ``x-api-key`` metadata does not match the shared key.

    The comparison is constant-time to avoid leaking the key via timing.

    Authorized calls also get their correlation context bound (request id from
    ``correlation-id``/``x-request-id``, W3C trace id from ``traceparent``) so
    every log line inside the handler carries it (plan P05). Acting-user
    identity stays with the servicers, which read it from the request payload
    after this auth gate.
    """

    def __init__(self, api_key: str, header: str = API_KEY_HEADER) -> None:
        if not api_key:
            raise ValueError("ApiKeyAuthInterceptor requires a non-empty api_key")
        self._api_key = api_key
        self._header = header

        async def _deny(request, context: grpc.aio.ServicerContext):
            await context.abort(
                grpc.StatusCode.UNAUTHENTICATED,
                "Missing or invalid API key",
            )

        # A terminal handler that aborts before any business logic runs. Aborting
        # short-circuits regardless of the real method's streaming type.
        self._deny_handler = grpc.unary_unary_rpc_method_handler(_deny)

    def _is_authorized(self, handler_call_details: grpc.HandlerCallDetails) -> bool:
        for key, value in handler_call_details.invocation_metadata or ():
            if key == self._header:
                return hmac.compare_digest(value, self._api_key)
        return False

    async def intercept_service(self, continuation, handler_call_details):
        if self._is_authorized(handler_call_details):
            # Metadata keys are lowercase per the gRPC wire format.
            metadata = dict(handler_call_details.invocation_metadata or ())
            corr_id = metadata.get("correlation-id") or metadata.get("x-request-id")
            # contextvars set here reach the handler: grpc.aio runs the
            # interceptor chain and the handler in the same task (verified).
            correlation_id_ctx.set(corr_id)
            bind_contextvars(
                request_id=corr_id or "",
                trace_id=trace_id_from_header(metadata.get("traceparent")),
            )
            return await continuation(handler_call_details)

        logger.warning(
            "[gRPC] Rejected unauthenticated call",
            method=getattr(handler_call_details, "method", "unknown"),
        )
        return self._deny_handler
