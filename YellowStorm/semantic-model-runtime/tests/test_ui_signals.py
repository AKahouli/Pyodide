from __future__ import annotations

import json

import httpx
import pytest

from app.persistence.ui_signal_outbox import UiSignal, safe_payload
from app.realtime.dispatcher import UiSignalDispatcher
from app.realtime.publisher import RealtimeBroadcastPublisher, publisher_jwt


def test_signal_payload_is_allowlisted():
    assert safe_payload("model-1", {
        "status": "ready", "reason": "completed", "sourceName": "secret.xlsx",
    }) == {"modelId": "model-1", "status": "ready", "reason": "completed"}


def test_publisher_jwt_is_model_scoped():
    claims = publisher_jwt("secret", "model-1").split(".")[1]
    claims += "=" * (-len(claims) % 4)
    import base64

    assert json.loads(base64.urlsafe_b64decode(claims))["model_id"] == "model-1"


@pytest.mark.asyncio
async def test_realtime_failure_releases_signal_without_failing_business_state():
    class Repository:
        released = False
        claim_seconds = 0

        async def claim(self, **kwargs):  # type: ignore[no-untyped-def]
            self.claim_seconds = kwargs["claim_seconds"]
            return [UiSignal(1, "model-1", "population-status-changed",
                             {"modelId": "model-1", "status": "completed"}, 1)]

        async def release(self, *_args, **_kwargs):  # type: ignore[no-untyped-def]
            self.released = True
            return True

        async def mark_published(self, *_args):  # type: ignore[no-untyped-def]
            return True

    class Publisher:
        timeout_seconds = 3.0

        async def publish(self, **_kwargs):  # type: ignore[no-untyped-def]
            raise httpx.ConnectError("realtime down")

    repository = Repository()
    assert await UiSignalDispatcher(repository, Publisher()).dispatch_once() == 0  # type: ignore[arg-type]
    assert repository.released is True
    assert repository.claim_seconds >= 70


@pytest.mark.asyncio
async def test_publisher_posts_private_broadcast(monkeypatch: pytest.MonkeyPatch):
    captured: dict = {}

    class Response:
        def raise_for_status(self) -> None:
            return None

    class Client:
        def __init__(self, **kwargs):  # type: ignore[no-untyped-def]
            captured["timeout"] = kwargs["timeout"]

        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return self

        async def __aexit__(self, *_args):  # type: ignore[no-untyped-def]
            return None

        async def post(self, url, **kwargs):  # type: ignore[no-untyped-def]
            captured.update({"url": url, **kwargs})
            return Response()

    monkeypatch.setattr("app.realtime.publisher.httpx.AsyncClient", Client)
    publisher = RealtimeBroadcastPublisher(
        url="http://realtime:4000", tenant="tenant.local", jwt_secret="secret")
    await publisher.publish(model_id="model-1", event_type="data-revision-changed",
                            payload={"modelId": "model-1", "dataRevision": 2})

    assert captured["url"] == "http://realtime:4000/api/broadcast"
    assert captured["headers"]["Host"] == "tenant.local"
    assert captured["json"]["messages"][0]["private"] is True
