"""Create ADK conversation sessions from an existing chat transcript."""

from __future__ import annotations

import uuid
from typing import Iterable

from google.adk.events import Event
from google.adk.sessions import DatabaseSessionService
from google.genai import types

from src.config.settings import get_settings


APP_NAME = "manager_app"
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
    ) -> bool:
        entries = [(role, text.strip()) for role, text in history if text.strip()]
        if not entries:
            raise ValueError("Conversation history must contain text")

        existing = await self._session_service.get_session(
            app_name=APP_NAME,
            user_id=user_id,
            session_id=session_id,
        )
        if existing:
            if existing.state.get(SEED_KEY_STATE) == idempotency_key:
                return False
            raise SessionSeedConflictError(f"Session {session_id} already exists")

        session = await self._session_service.create_session(
            app_name=APP_NAME,
            user_id=user_id,
            session_id=session_id,
            state={SEED_KEY_STATE: idempotency_key},
        )

        try:
            for role, text in entries:
                is_user = role == "user"
                await self._session_service.append_event(
                    session=session,
                    event=Event(
                        invocation_id=f"branch-seed-{uuid.uuid4()}",
                        author="user" if is_user else "assistant",
                        content=types.Content(
                            role="user" if is_user else "model",
                            parts=[types.Part(text=text)],
                        ),
                    ),
                )
        except Exception:
            await self._session_service.delete_session(APP_NAME, user_id, session_id)
            raise

        return True

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
