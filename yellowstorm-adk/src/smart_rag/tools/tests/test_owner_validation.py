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


@pytest.mark.asyncio
async def test_tool_returns_pending_payload(monkeypatch):
    calls = {}

    async def fake_post(self, url, *, json=None, headers=None):
        calls["url"] = url
        calls["json"] = json
        return _FakeResponse(200, {
            "validationId": "v1",
            "question": "Coffee Tuesday 15:00?",
            "choices": ["Yes", "No"],
        })

    import httpx as httpx_module
    monkeypatch.setattr(httpx_module.AsyncClient, "post", fake_post, raising=True)

    settings = SimpleNamespace(
        API_URL="http://localhost:3000/api",
        INTERNAL_SERVICE_SECRET="secret",
    )
    import src.config.settings as settings_module
    monkeypatch.setattr(settings_module, "get_settings", lambda: settings, raising=True)

    tool = create_request_owner_validation_tool({
        "telegram_validation_integration_id": "int-1",
        "telegram_validation_conversation_id": "conv-1",
    })
    result = await tool("Coffee Tuesday 15:00?", ["Yes", "No"])

    assert calls["url"] == "http://localhost:3000/api/v1/telegram/internal/validations"
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
async def test_tool_reports_error_status(monkeypatch):
    async def fake_post(self, url, **kwargs):
        return _FakeResponse(502, {"message": "boom"})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post, raising=True)
    settings = SimpleNamespace(API_URL="http://localhost:3000/api", INTERNAL_SERVICE_SECRET="s")
    import src.config.settings as settings_module
    monkeypatch.setattr(settings_module, "get_settings", lambda: settings, raising=True)

    result = await create_request_owner_validation_tool({})("q", ["a"])
    assert result["status"] == "error"


def test_native_registry_resolves_tool():
    from src.smart_rag.tools.native_tool_registry import get_native_tool

    tool = get_native_tool("request_owner_validation", {
        "telegram_validation_integration_id": "i",
        "telegram_validation_conversation_id": "c",
    })
    assert callable(tool)
    assert tool.__name__ == "request_owner_validation"
