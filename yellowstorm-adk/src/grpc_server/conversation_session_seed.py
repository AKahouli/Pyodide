"""Create ADK conversation sessions from an existing chat transcript."""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from typing import Iterable
from types import SimpleNamespace

from google.adk.errors.already_exists_error import AlreadyExistsError
from google.adk.events import Event
from google.adk.sessions import DatabaseSessionService
from google.genai import types
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as postgres_insert

from yellowmind_observability import get_logger

from src.config.settings import get_settings

logger = get_logger(__name__)


APP_NAME = "manager_app"
# Private DatabaseSessionService hooks the one-transaction seed relies on
# (verified against google-adk 2.11.0). If an upgrade removes any of them the
# seed falls back to the public, slower per-event append_event path.
# Upgrade checklist: docs/runbooks/adk-upgrade-session-seed-check.md
_DB_SEED_HOOKS = (
    "_get_schema_classes",
    "_rollback_on_exception_session",
    "_uses_naive_datetime",
)
SEED_KEY_STATE = "branch_seed_idempotency_key"


class SessionSeedConflictError(Exception):
    """Raised when a session exists for a different branch request."""


class ConversationSessionSeedService:
    def __init__(self, session_service: DatabaseSessionService | None = None) -> None:
        self._session_service = session_service or DatabaseSessionService(
            db_url=get_settings().DATABASE_URL
        )

    async def seed(
        self,
        *,
        user_id: str,
        session_id: str,
        idempotency_key: str,
        history: Iterable[tuple[str, str]],
        source_session_id: str = "",
    ) -> bool:
        entries = [(role, text.strip()) for role, text in history if text.strip()]
        state = {SEED_KEY_STATE: idempotency_key}
        if source_session_id and source_session_id != session_id:
            from src.smart_rag.infrastructure.monitoring.responses_history import seed_private_history
            source = await self._load_private_source(user_id, source_session_id)
            if source is not None:
                state.update(seed_private_history(source, entries))

        service = self._session_service
        if (type(service) is DatabaseSessionService
            and all(hasattr(service, hook) for hook in _DB_SEED_HOOKS)
            and service.db_engine.dialect.name == 'postgresql'):
            return await self._seed_database_atomic(user_id, session_id, state, entries)

        # Create first: seeds almost always target a new id, and create_session
        # already checks for a duplicate, so the full session read (state plus
        # every event) is only paid on a retry.
        try:
            session = await self._session_service.create_session(
                app_name=APP_NAME,
                user_id=user_id,
                session_id=session_id,
                state=state,
            )
        except AlreadyExistsError:
            existing = await self._session_service.get_session(
                app_name=APP_NAME,
                user_id=user_id,
                session_id=session_id,
            )
            if existing and existing.state.get(SEED_KEY_STATE) == idempotency_key:
                return False
            raise SessionSeedConflictError(f"Session {session_id} already exists")

        try:
            await self._append_history(session, entries)
        except Exception:
            await self._session_service.delete_session(APP_NAME, user_id, session_id)
            raise

        return True

    async def _seed_database_atomic(self, user_id, session_id, state, entries) -> bool:
        """Publish a new PostgreSQL seed and its complete transcript atomically.

        Seed state is exclusively session-local. Shared app/user state is only
        initialized when absent, never copied or overwritten. Custom services
        retain the public create/append path and its ownership checks.
        """
        service = self._session_service
        await service.prepare_tables()
        schema = service._get_schema_classes()
        events = self._history_events(entries)
        now = datetime.now(timezone.utc)
        updated = datetime.fromtimestamp(events[-1].timestamp, timezone.utc) if events else now
        if service._uses_naive_datetime():
            now, updated = now.replace(tzinfo=None), updated.replace(tzinfo=None)
        async with service._rollback_on_exception_session() as transaction:
            created = (await transaction.execute(postgres_insert(schema.StorageSession).values(
                app_name=APP_NAME, user_id=user_id, id=session_id, state=state,
                create_time=now, update_time=updated,
            ).on_conflict_do_nothing(index_elements=['app_name', 'user_id', 'id'])
                .returning(schema.StorageSession.id))).scalar_one_or_none()
            if created is None:
                existing = (await transaction.execute(select(schema.StorageSession.state).where(
                    schema.StorageSession.app_name == APP_NAME,
                    schema.StorageSession.user_id == user_id,
                    schema.StorageSession.id == session_id,
                ))).scalar_one_or_none()
                if existing and existing.get(SEED_KEY_STATE) == state[SEED_KEY_STATE]:
                    return False
                raise SessionSeedConflictError(f'Session {session_id} already exists')
            for model, values in (
                (schema.StorageAppState, {'app_name': APP_NAME, 'state': {}}),
                (schema.StorageUserState, {'app_name': APP_NAME, 'user_id': user_id, 'state': {}}),
            ):
                await transaction.execute(postgres_insert(model).values(**values).on_conflict_do_nothing())
            session = SimpleNamespace(app_name=APP_NAME, user_id=user_id, id=session_id)
            for event in events:
                transaction.add(schema.StorageEvent.from_event(session, event))
            await transaction.commit()
        return True

    async def _load_private_source(self, user_id: str, session_id: str):
        service = self._session_service
        # Custom/fenced services must retain their public ownership checks.
        if type(service) is not DatabaseSessionService or not all(
            hasattr(service, hook) for hook in _DB_SEED_HOOKS
        ):
            return await service.get_session(app_name=APP_NAME, user_id=user_id, session_id=session_id)
        await service.prepare_tables()
        # Only source-local private state and its full transcript participate in
        # continuity validation. App/user state is neither needed nor copied.
        schema = service._get_schema_classes()
        async with service._rollback_on_exception_session(read_only=True) as sql_session:
            state = (await sql_session.execute(select(schema.StorageSession.state).where(
                schema.StorageSession.app_name == APP_NAME,
                schema.StorageSession.user_id == user_id,
                schema.StorageSession.id == session_id,
            ))).scalar_one_or_none()
            if state is None:
                return None
            rows = (await sql_session.execute(select(schema.StorageEvent).where(
                schema.StorageEvent.app_name == APP_NAME,
                schema.StorageEvent.user_id == user_id,
                schema.StorageEvent.session_id == session_id,
            ).order_by(schema.StorageEvent.timestamp.asc(), schema.StorageEvent.id.asc()))).scalars().all()
            return SimpleNamespace(state=state, events=[row.to_event() for row in rows])

    async def _append_history(
        self, session, entries: list[tuple[str, str]]
    ) -> None:
        events = self._history_events(entries)
        if not events:
            return
        service = self._session_service
        if type(service) is DatabaseSessionService and all(
            hasattr(service, hook) for hook in _DB_SEED_HOOKS
        ):
            await self._insert_events_in_one_transaction(service, session, events)
            return
        for event in events:
            await service.append_event(session=session, event=event)

    @staticmethod
    def _history_events(entries: list[tuple[str, str]]) -> list[Event]:
        # Explicit, strictly increasing timestamps keep the transcript order
        # when all rows are written in one transaction (the default
        # per-event clock reads can tie on coarse clocks).
        base = time.time()
        # Importing the existing transcript is one bootstrap operation, not a
        # new ADK invocation for every historical message. Otherwise interval
        # compaction sees all imported messages as newly completed invocations
        # and repeats its summarizer call on every isolated successor turn.
        invocation_id = f"branch-seed-{uuid.uuid4()}"
        return [
            Event(
                invocation_id=invocation_id,
                author="user" if role == "user" else "assistant",
                content=types.Content(
                    role="user" if role == "user" else "model",
                    parts=[types.Part(text=text)],
                ),
                timestamp=base + index * 0.001,
            )
            for index, (role, text) in enumerate(entries)
        ]

    @staticmethod
    async def _insert_events_in_one_transaction(
        service: DatabaseSessionService, session, events: list[Event]
    ) -> None:
        """Write the whole transcript with one commit.

        ``append_event`` costs a lock, three state reads, an update and a
        commit per event, all sequential database round trips, so seeding a
        long conversation on every turn grew linearly with its history (about
        200 ms per message). The session was created an instant ago under a
        unique id, so there is no concurrent writer to guard against and the
        per-event revision checks add nothing.
        """
        schema = service._get_schema_classes()
        async with service._rollback_on_exception_session() as sql_session:
            update_time = datetime.fromtimestamp(events[-1].timestamp, timezone.utc)
            result = await sql_session.execute(update(schema.StorageSession).where(
                schema.StorageSession.app_name == session.app_name,
                schema.StorageSession.user_id == session.user_id,
                schema.StorageSession.id == session.id,
            ).values(update_time=(update_time.replace(tzinfo=None)
                                  if service._uses_naive_datetime() else update_time)))
            if result.rowcount != 1:
                raise SessionSeedConflictError('Seed target disappeared before history insertion')
            for event in events:
                sql_session.add(schema.StorageEvent.from_event(session, event))
            await sql_session.commit()

    async def warm_up(self) -> None:
        """Run ADK's one-time schema check and table setup (about 1.5 s on a
        remote database) at startup instead of inside the first user turn.

        Best effort: on failure the first seed simply runs the setup itself
        and owns that outcome, so this only records a concise warning.
        """
        prepare = getattr(self._session_service, "prepare_tables", None)
        if prepare is None:
            return
        try:
            await prepare()
        except Exception as error:
            logger.warning(
                "dependency.request.failed",
                dependency="session_database",
                operation="prepare_tables",
                error=error,
            )

    async def delete(
        self, *, user_id: str, session_id: str, idempotency_key: str
    ) -> bool:
        existing = await self._session_service.get_session(
            app_name=APP_NAME,
            user_id=user_id,
            session_id=session_id,
        )
        if existing and existing.state.get(SEED_KEY_STATE) != idempotency_key:
            raise SessionSeedConflictError(f"Session {session_id} belongs to another request")
        await self._session_service.delete_session(APP_NAME, user_id, session_id)
        return existing is not None
