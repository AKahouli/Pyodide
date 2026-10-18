"""Tests for the Telegram owner-validation tool factory (no network)."""
from __future__ import annotations

import importlib
import json
from types import SimpleNamespace

import httpx
import pytest

from src.smart_rag.tools.utilities.owner_validation import (
    create_request_owner_validation_tool,
)


class _FakeResponse:
    def __init__(self, status_code, body):
        self.status_code = status_code
        self._body = body
        self.text = json.dumps(body)

    def json(self):
        return self._body


@pytest.fixture
def private_dispatch(monkeypatch):
    from src.root_runtime import delegate_resolver as resolver
    import src.config.settings as settings_module
    settings = SimpleNamespace(API_URL="http://localhost:3000/api",
        ADK_ROOT_RUNTIME_SERVICE_TOKEN="root-test-machine-token", INTERNAL_SERVICE_SECRET="unused-legacy")
    monkeypatch.setattr(settings_module, "get_settings", lambda: settings)
    monkeypatch.setattr(resolver, "get_settings", lambda: settings)
    binding = resolver._root_authority.set(resolver._RootAuthority("message", "private-signed-proof", "native-conversation"))
    try:
        yield settings
    finally:
        resolver._root_authority.reset(binding)


@pytest.mark.asyncio
@pytest.mark.parametrize("status_code", [200, 201])
async def test_tool_returns_pending_payload(monkeypatch, private_dispatch, status_code):
    calls = {}

    async def fake_post(self, url, *, json=None, headers=None):
        calls["url"] = url
        calls["json"] = json
        calls["headers"] = headers
        return _FakeResponse(status_code, {
            "validationId": "v1",
            "question": "Coffee Tuesday 15:00?",
            "choices": ["Yes", "No"],
        })

    import httpx as httpx_module
    monkeypatch.setattr(httpx_module.AsyncClient, "post", fake_post, raising=True)

    tool = create_request_owner_validation_tool({
        "telegram_validation_integration_id": "int-1",
        "telegram_validation_conversation_id": "conv-1",
    })
    result = await tool("Coffee Tuesday 15:00?", ["Yes", "No"])

    assert calls["url"] == "http://localhost:3000/api/v1/telegram/internal/validations"
    assert calls["headers"]["X-YellowStorm-Service-Principal"] == "adk-root-runtime"
    assert calls["headers"]["X-YellowStorm-Execution-Authority"] == "private-signed-proof"
    assert "X-Internal-Token" not in calls["headers"]
    assert calls["json"] == {
        "integration_id": "int-1",
        "conversation_id": "conv-1",
        "question": "Coffee Tuesday 15:00?",
        "choices": ["Yes", "No"],
    }
    assert result["status"] == "pending_owner_validation"
    assert result["validation_id"] == "v1"
    assert result["sent_to_owner"] is True


@pytest.mark.asyncio
async def test_tool_reports_error_status(monkeypatch, private_dispatch):
    async def fake_post(self, url, **kwargs):
        return _FakeResponse(502, {"message": "boom"})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post, raising=True)
    result = await create_request_owner_validation_tool({})("q", ["a"])
    assert result["status"] == "error"


@pytest.mark.asyncio
async def test_legacy_machine_key_without_private_dispatch_never_sends(monkeypatch, private_dispatch):
    from src.root_runtime import delegate_resolver as resolver
    calls = []
    async def fake_post(self, *args, **kwargs):
        calls.append(kwargs)
        raise AssertionError("A legacy credential cannot authorize a validation")
    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    binding = resolver._root_authority.set(None)
    try:
        result = await create_request_owner_validation_tool({})("q")
    finally:
        resolver._root_authority.reset(binding)
    assert result["status"] == "unavailable"
    assert calls == []


def test_native_registry_resolves_tool():
    from src.smart_rag.tools.native_tool_registry import get_native_tool

    tool = get_native_tool("request_owner_validation", {
        "telegram_validation_integration_id": "i",
        "telegram_validation_conversation_id": "c",
    })
    assert callable(tool)
    assert tool.__name__ == "request_owner_validation"
