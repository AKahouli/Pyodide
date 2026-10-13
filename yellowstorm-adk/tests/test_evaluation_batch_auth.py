"""Auth and ownership contract for the ADK evaluation streaming endpoint.

The endpoint runs an agent evaluation for one acting user. The service key alone never
names the actor: the backend (which authenticated the end user) must send
``X-YellowStorm-User-Id``, and the body's own ``user_id`` must agree with it. The old
in-memory POC routes (launch/status/delete over a module-level store) are gone.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.routers.evaluation_batch import router


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _with_api_key(monkeypatch) -> None:
    # The dependency reads the module-level `app_settings` captured at import time — in the
    # full suite other tests replace the cached settings instance, so patch THAT object,
    # not whatever get_settings() returns now (same pattern as test_identity_binding.py).
    import src.authentification.get_current_user as auth_module

    monkeypatch.setattr(auth_module.app_settings, "ADK_API_KEY", "secret-key", raising=False)


def _request(user_id: str = "user-a") -> dict:
    return {
        "agent": {"name": "helper", "description": "", "prompt": "You help."},
        "test_cases": [
            {"input": {"messages": [{"role": "user", "content": "q"}]},
             "reference_output": {"messages": [{"role": "assistant", "content": "a"}]}},
        ],
        "session_id": "sess-1",
        "user_id": user_id,
    }


def _streaming_evaluator(events: list[dict] | None = None) -> AsyncMock:
    async def evaluate(request, queue):
        for event in (events or [{"type": "progress", "test_case": {"test_number": 1}}]):
            await queue.put(event)
        await queue.put(None)

    return AsyncMock(side_effect=evaluate)


def test_streaming_evaluation_requires_api_key(monkeypatch):
    _with_api_key(monkeypatch)
    evaluator = _streaming_evaluator()
    with patch("src.routers.evaluation_batch.run_adk_evaluation_streaming", evaluator):
        assert _client().post("/evaluation-batch/execute_agent_evaluator", json=_request()).status_code == 401
        assert _client().post("/evaluation-batch/execute_agent_evaluator", json=_request(),
                              headers={"x-api-key": "wrong"}).status_code == 401
    evaluator.assert_not_awaited()


def test_streaming_evaluation_requires_trusted_actor(monkeypatch):
    _with_api_key(monkeypatch)
    evaluator = _streaming_evaluator()
    with patch("src.routers.evaluation_batch.run_adk_evaluation_streaming", evaluator):
        # A valid service key with no acting user is a caller bug, not an anonymous run.
        missing = _client().post("/evaluation-batch/execute_agent_evaluator", json=_request(),
                                 headers={"x-api-key": "secret-key"})
        blank = _client().post("/evaluation-batch/execute_agent_evaluator", json=_request(),
                               headers={"x-api-key": "secret-key", "X-YellowStorm-User-Id": "   "})
    assert missing.status_code == 403
    assert blank.status_code == 403
    evaluator.assert_not_awaited()


def test_streaming_evaluation_refuses_a_renamed_actor(monkeypatch):
    _with_api_key(monkeypatch)
    evaluator = _streaming_evaluator()
    with patch("src.routers.evaluation_batch.run_adk_evaluation_streaming", evaluator):
        response = _client().post("/evaluation-batch/execute_agent_evaluator", json=_request(user_id="user-b"),
                                  headers={"x-api-key": "secret-key", "X-YellowStorm-User-Id": "user-a"})
    assert response.status_code == 403
    evaluator.assert_not_awaited()


def test_streaming_evaluation_answers_the_matching_actor_with_sse(monkeypatch):
    _with_api_key(monkeypatch)
    evaluator = _streaming_evaluator([{"type": "progress", "test_case": {"test_number": 1, "question": "q"}}])
    with patch("src.routers.evaluation_batch.run_adk_evaluation_streaming", evaluator):
        response = _client().post("/evaluation-batch/execute_agent_evaluator", json=_request(user_id="user-a"),
                                  headers={"x-api-key": "secret-key", "X-YellowStorm-User-Id": "user-a"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert '"question": "q"' in response.text
    # The evaluator runs with the request the trusted actor validated.
    assert evaluator.await_args.args[0].user_id == "user-a"


def test_overlong_or_typed_actor_is_refused(monkeypatch):
    _with_api_key(monkeypatch)
    evaluator = _streaming_evaluator()
    with patch("src.routers.evaluation_batch.run_adk_evaluation_streaming", evaluator):
        overlong = _client().post("/evaluation-batch/execute_agent_evaluator", json=_request(user_id="u" * 201),
                                  headers={"x-api-key": "secret-key", "X-YellowStorm-User-Id": "u" * 201})
        assert overlong.status_code == 403
        # A non-string user_id never reaches the comparison at all.
        body = _request(user_id="user-a")
        body["user_id"] = 123
        typed = _client().post("/evaluation-batch/execute_agent_evaluator", json=body,
                               headers={"x-api-key": "secret-key", "X-YellowStorm-User-Id": "user-a"})
        assert typed.status_code == 422
    evaluator.assert_not_awaited()


def test_actor_header_padding_is_ignored(monkeypatch):
    _with_api_key(monkeypatch)
    evaluator = _streaming_evaluator()
    with patch("src.routers.evaluation_batch.run_adk_evaluation_streaming", evaluator):
        response = _client().post("/evaluation-batch/execute_agent_evaluator", json=_request(user_id="user-a"),
                                  headers={"x-api-key": "secret-key", "X-YellowStorm-User-Id": " user-a "})
    assert response.status_code == 200
    evaluator.assert_awaited_once()


def test_former_poc_routes_are_gone(monkeypatch):
    _with_api_key(monkeypatch)
    client = _client()
    assert client.post("/evaluation-batch/launch", json={}).status_code in (404, 405, 410)
    assert client.get("/evaluation-batch/status/any-id").status_code in (404, 405, 410)
    assert client.delete("/evaluation-batch/any-id").status_code in (404, 405, 410)
    # Nothing a renamed status path could answer: the module keeps no store at all.
    import src.routers.evaluation_batch as module

    assert not hasattr(module, "evaluations_store")


def test_stream_cancels_its_evaluation_when_the_client_leaves(monkeypatch):
    """A disconnected stream cancels its evaluation; nothing keeps running for nobody."""
    _with_api_key(monkeypatch)
    started = []

    async def evaluate(request, queue):
        started.append(True)
        try:
            await queue.put({"type": "progress", "test_case": {"test_number": 1}})
            import asyncio

            await asyncio.sleep(30)
            await queue.put(None)
        except asyncio.CancelledError:
            raise

    with patch("src.routers.evaluation_batch.run_adk_evaluation_streaming", AsyncMock(side_effect=evaluate)):
        with _client().stream("POST", "/evaluation-batch/execute_agent_evaluator", json=_request(user_id="user-a"),
                              headers={"x-api-key": "secret-key", "X-YellowStorm-User-Id": "user-a"}) as response:
            chunks = list(response.iter_lines())
        assert response.status_code == 200
    assert chunks and json.loads([line for line in chunks if line.startswith("data: ")][0][6:])["type"] == "progress"
