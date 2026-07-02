"""Unit tests for the gRPC API-key authentication interceptor."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import grpc
import pytest

from src.grpc_server.auth_interceptor import ApiKeyAuthInterceptor, API_KEY_HEADER

pytestmark = pytest.mark.asyncio

KEY = "s3cret-key"


def _call_details(metadata):
    return SimpleNamespace(invocation_metadata=metadata, method="/svc/Method")


async def test_requires_non_empty_key():
    with pytest.raises(ValueError):
        ApiKeyAuthInterceptor("")


async def test_valid_key_passes_through():
    interceptor = ApiKeyAuthInterceptor(KEY)
    continuation = AsyncMock(return_value="real_handler")

    result = await interceptor.intercept_service(
        continuation, _call_details([(API_KEY_HEADER, KEY)])
    )

    assert result == "real_handler"
    continuation.assert_awaited_once()


async def test_wrong_key_is_denied():
    interceptor = ApiKeyAuthInterceptor(KEY)
    continuation = AsyncMock(return_value="real_handler")

    result = await interceptor.intercept_service(
        continuation, _call_details([(API_KEY_HEADER, "wrong")])
    )

    assert result is interceptor._deny_handler
    continuation.assert_not_awaited()


async def test_missing_key_is_denied():
    interceptor = ApiKeyAuthInterceptor(KEY)
    continuation = AsyncMock(return_value="real_handler")

    result = await interceptor.intercept_service(
        continuation, _call_details([("user", "u1")])
    )

    assert result is interceptor._deny_handler
    continuation.assert_not_awaited()


async def test_deny_handler_aborts_unauthenticated():
    interceptor = ApiKeyAuthInterceptor(KEY)
    context = AsyncMock()

    await interceptor._deny_handler.unary_unary(None, context)

    context.abort.assert_awaited_once()
    args = context.abort.await_args.args
    assert args[0] == grpc.StatusCode.UNAUTHENTICATED
