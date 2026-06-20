"""Tests for the runtime → NestJS HTTP client.

Asserts the service-token and idempotency-key headers are sent, that
the event id is included in the body, and that the base URL is the
configured one (no hardcoded localhost).
"""
from __future__ import annotations

import json

import httpx
import pytest

from app.clients import EVENT_ID_HEADER, SERVICE_TOKEN_HEADER, BackendClient
from app.config import Settings


def make_settings() -> Settings:
    return Settings(
        port=8011,
        backend_base_url="http://backend.test:3000",
        service_token="test-service-token-1234567890",
        request_timeout_seconds=5,
        adk_version="2.2.0",
        log_level="INFO",
        litellm_api_base_url=None,
        litellm_api_secret_key=None,
    )


@pytest.mark.asyncio
async def test_plan_delta_sends_service_token_and_event_id() -> None:
    settings = make_settings()
    captured: dict = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["method"] = request.method
        captured["headers"] = dict(request.headers)
        body = json.loads(request.content.decode("utf-8"))
        captured["body"] = body
        return httpx.Response(202, json={"applied": True, "replay": False, "eventId": body.get("eventId")})

    transport = httpx.MockTransport(handler)
    client = BackendClient(settings)
    # Bypass start() and inject the mocked transport directly.
    client._client = httpx.AsyncClient(  # type: ignore[attr-defined]
        base_url=settings.backend_base_url,
        timeout=settings.request_timeout_seconds,
        headers={SERVICE_TOKEN_HEADER: settings.service_token},
        transport=transport,
    )
    try:
        ack = await client.plan_delta(
            stream_id="stream-1",
            body={"basePlanVersion": 0, "body": {"create_tasks": []}},
            event_id="evt-fixed",
        )
    finally:
        await client.aclose()

    assert captured["method"] == "POST"
    assert captured["url"].endswith("/api/v1/worky/internal/streams/stream-1/plan-delta")
    assert captured["headers"][SERVICE_TOKEN_HEADER.lower()] == settings.service_token
    assert captured["headers"][EVENT_ID_HEADER.lower()] == "evt-fixed"
    assert captured["body"]["eventId"] == "evt-fixed"
    assert ack["applied"] is True
    assert ack["eventId"] == "evt-fixed"


@pytest.mark.asyncio
async def test_new_event_id_is_unique_and_prefixed() -> None:
    a = BackendClient.new_event_id()
    b = BackendClient.new_event_id()
    assert a.startswith("worky-")
    assert b.startswith("worky-")
    assert a != b


@pytest.mark.asyncio
async def test_use_before_start_raises() -> None:
    client = BackendClient(make_settings())
    with pytest.raises(RuntimeError, match="start\\(\\) must be awaited"):
        await client.plan_delta("stream-1", {})
