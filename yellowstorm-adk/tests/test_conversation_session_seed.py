from unittest.mock import AsyncMock

import pytest
from google.adk.errors.already_exists_error import AlreadyExistsError


@pytest.mark.asyncio
async def test_seed_scopes_private_source_to_same_user_and_app(monkeypatch):
    from src.smart_rag.infrastructure.monitoring import responses_history
    from unittest.mock import Mock
    source = object()
    storage = AsyncMock()
    storage.get_session.return_value = source
    storage.create_session.return_value = type('Session', (), {'state': {}})()
    selected = {responses_history.STATE_KEY: {'response_id': 'private-response'}}
    helper = Mock(return_value=selected)
    monkeypatch.setattr(responses_history, 'seed_private_history', helper)
    service = ConversationSessionSeedService(storage)
    await service.seed(user_id='owner', session_id='turn_new', idempotency_key='new',
                       history=[('user', ' question ')], source_session_id='turn_previous')
    storage.get_session.assert_awaited_once_with(app_name=APP_NAME, user_id='owner', session_id='turn_previous')
    helper.assert_called_once_with(source, [('user', 'question')])
    assert storage.create_session.call_args.kwargs['state'] == {'branch_seed_idempotency_key': 'new', **selected}


@pytest.mark.asyncio
async def test_seed_missing_private_source_keeps_application_history():
    storage = AsyncMock()
    storage.get_session.return_value = None
    storage.create_session.return_value = type('Session', (), {'state': {}})()
    service = ConversationSessionSeedService(storage)
    assert await service.seed(user_id='owner', session_id='turn_new', idempotency_key='new',
                              history=[('user', 'question')], source_session_id='turn_missing') is True
    assert storage.create_session.call_args.kwargs['state'] == {'branch_seed_idempotency_key': 'new'}
    assert storage.append_event.await_count == 1

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
async def test_seed_can_create_an_empty_isolated_session():
    session = type("Session", (), {"state": {}})()
    storage = AsyncMock()
    storage.get_session.return_value = None
    storage.create_session.return_value = session
    service = ConversationSessionSeedService(storage)

    assert await service.seed(
        user_id="user-1", session_id="shadow-1", idempotency_key="replay-1", history=[]
    ) is True
    storage.create_session.assert_awaited_once()
    storage.append_event.assert_not_awaited()


@pytest.mark.asyncio
async def test_seed_is_idempotent_for_same_request():
    existing = type("Session", (), {"state": {"branch_seed_idempotency_key": "request-1"}})()
    storage = AsyncMock()
    storage.get_session.return_value = existing
    storage.create_session.side_effect = AlreadyExistsError("exists")
    service = ConversationSessionSeedService(storage)

    assert await service.seed(
        user_id="user-1",
        session_id="session-1",
        idempotency_key="request-1",
        history=[("user", "question")],
    ) is False
    storage.append_event.assert_not_awaited()


@pytest.mark.asyncio
async def test_seed_rejects_an_existing_session_from_another_request():
    existing = type("Session", (), {"state": {"branch_seed_idempotency_key": "other"}})()
    storage = AsyncMock()
    storage.get_session.return_value = existing
    storage.create_session.side_effect = AlreadyExistsError("exists")
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


@pytest.mark.asyncio
async def test_seed_writes_a_real_database_transcript_in_one_commit(tmp_path):
    from google.adk.sessions import DatabaseSessionService
    from sqlalchemy import event as sa_event

    storage = DatabaseSessionService(db_url=f"sqlite+aiosqlite:///{(tmp_path / 'seed.db').as_posix()}")
    commits = []
    sa_event.listen(storage.db_engine.sync_engine, "commit", lambda conn: commits.append(1))
    service = ConversationSessionSeedService(storage)
    history = [("user", f"question {i}") if i % 2 == 0 else ("assistant", f"answer {i}")
               for i in range(20)]

    assert await service.seed(
        user_id="user-1", session_id="turn_1", idempotency_key="k1", history=history
    ) is True
    commits.clear()
    await service.seed(user_id="user-1", session_id="turn_short", idempotency_key="k2", history=history[:2])
    short_commits = len(commits)
    commits.clear()
    await service.seed(user_id="user-1", session_id="turn_long", idempotency_key="k3", history=history)
    assert len(commits) == short_commits  # commit count must not grow with history

    loaded = await storage.get_session(app_name=APP_NAME, user_id="user-1", session_id="turn_1")
    assert [event.content.parts[0].text for event in loaded.events] == [text for _, text in history]
    assert [event.author for event in loaded.events][:2] == ["user", "assistant"]
    assert [event.content.role for event in loaded.events][:2] == ["user", "model"]

    # The runner appends to a freshly loaded session after the seed; it must
    # not trip the stale-session check.
    from google.adk.events import Event
    from google.genai import types
    await storage.append_event(
        session=loaded,
        event=Event(invocation_id="run-1", author="user",
                    content=types.Content(role="user", parts=[types.Part(text="next")])),
    )
    again = await storage.get_session(app_name=APP_NAME, user_id="user-1", session_id="turn_1")
    assert again.events[-1].content.parts[0].text == "next"
    assert len(again.events) == 21
    assert await service.seed(
        user_id="user-1", session_id="turn_1", idempotency_key="k1", history=history
    ) is False


@pytest.mark.asyncio
async def test_seed_falls_back_to_append_event_when_private_hooks_are_missing(tmp_path, monkeypatch):
    from google.adk.sessions import DatabaseSessionService

    import src.grpc_server.conversation_session_seed as seed_module

    monkeypatch.setattr(seed_module, "_DB_SEED_HOOKS", ("_hook_removed_by_upgrade",))
    storage = DatabaseSessionService(db_url=f"sqlite+aiosqlite:///{(tmp_path / 'seed.db').as_posix()}")
    history = [("user", "q"), ("assistant", "a")]

    assert await ConversationSessionSeedService(storage).seed(
        user_id="user-1", session_id="turn_1", idempotency_key="k1", history=history
    ) is True
    loaded = await storage.get_session(app_name=APP_NAME, user_id="user-1", session_id="turn_1")
    assert [event.content.parts[0].text for event in loaded.events] == ["q", "a"]


@pytest.mark.asyncio
async def test_seed_of_a_new_session_skips_the_full_session_read():
    session = type("Session", (), {"state": {}})()
    storage = AsyncMock()
    storage.create_session.return_value = session
    service = ConversationSessionSeedService(storage)

    assert await service.seed(
        user_id="user-1", session_id="session-1", idempotency_key="k", history=[]
    ) is True
    storage.get_session.assert_not_awaited()


@pytest.mark.asyncio
async def test_warm_up_prepares_tables_and_survives_a_failure():
    storage = AsyncMock()
    storage.prepare_tables.side_effect = RuntimeError("db down")

    await ConversationSessionSeedService(storage).warm_up()

    storage.prepare_tables.assert_awaited_once()
