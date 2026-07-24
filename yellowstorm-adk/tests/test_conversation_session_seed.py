from unittest.mock import AsyncMock

import pytest

from src.grpc_server.conversation_session_seed import (
    APP_NAME,
    ConversationSessionSeedService,
    SessionSeedConflictError,
)


@pytest.mark.asyncio
async def test_seed_creates_ordered_user_and_model_events():
    session = type("Session", (), {"state": {}})()
    storage = AsyncMock()
    storage.get_session.return_value = None
    storage.create_session.return_value = session
    service = ConversationSessionSeedService(storage)

    created = await service.seed(
        user_id="user-1",
        session_id="session-1",
        idempotency_key="request-1",
        history=[("user", " question "), ("assistant", " answer ")],
    )

    assert created is True
    storage.create_session.assert_awaited_once_with(
        app_name=APP_NAME,
        user_id="user-1",
        session_id="session-1",
        state={"branch_seed_idempotency_key": "request-1"},
    )
    events = [call.kwargs["event"] for call in storage.append_event.await_args_list]
    authors = [getattr(event, "author", None) or event.kwargs["author"] for event in events]
    contents = [getattr(event, "content", None) or event.kwargs["content"] for event in events]
    assert authors == ["user", "assistant"]
    assert [content.role for content in contents] == ["user", "model"]
    assert [content.parts[0].text for content in contents] == ["question", "answer"]


@pytest.mark.asyncio
async def test_seed_is_idempotent_for_same_request():
    existing = type("Session", (), {"state": {"branch_seed_idempotency_key": "request-1"}})()
    storage = AsyncMock()
    storage.get_session.return_value = existing
    service = ConversationSessionSeedService(storage)

    assert await service.seed(
        user_id="user-1",
        session_id="session-1",
        idempotency_key="request-1",
        history=[("user", "question")],
    ) is False
    storage.create_session.assert_not_awaited()


@pytest.mark.asyncio
async def test_seed_rejects_an_existing_session_from_another_request():
    existing = type("Session", (), {"state": {"branch_seed_idempotency_key": "other"}})()
    storage = AsyncMock()
    storage.get_session.return_value = existing
    service = ConversationSessionSeedService(storage)

    with pytest.raises(SessionSeedConflictError):
        await service.seed(
            user_id="user-1",
            session_id="session-1",
            idempotency_key="request-1",
            history=[("user", "question")],
        )


@pytest.mark.asyncio
async def test_seed_deletes_partial_session_after_append_failure():
    session = type("Session", (), {"state": {}})()
    storage = AsyncMock()
    storage.get_session.return_value = None
    storage.create_session.return_value = session
    storage.append_event.side_effect = RuntimeError("write failed")
    service = ConversationSessionSeedService(storage)

    with pytest.raises(RuntimeError):
        await service.seed(
            user_id="user-1",
            session_id="session-1",
            idempotency_key="request-1",
            history=[("user", "question")],
        )
    storage.delete_session.assert_awaited_once_with(APP_NAME, "user-1", "session-1")


@pytest.mark.asyncio
async def test_delete_requires_matching_seed_request():
    existing = type("Session", (), {"state": {"branch_seed_idempotency_key": "request-1"}})()
    storage = AsyncMock()
    storage.get_session.return_value = existing
    service = ConversationSessionSeedService(storage)

    with pytest.raises(SessionSeedConflictError):
        await service.delete(
            user_id="user-1",
            session_id="session-1",
            idempotency_key="other-request",
        )
    storage.delete_session.assert_not_awaited()

    assert await service.delete(
        user_id="user-1",
        session_id="session-1",
        idempotency_key="request-1",
    ) is True
    storage.delete_session.assert_awaited_once_with(APP_NAME, "user-1", "session-1")
