"""Async repository for the A2A agent store (Postgres)."""

from typing import Optional, Any, Dict

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from src.a2a_gateway.models import Base, A2AAgent
from src.a2a_gateway.security import generate_api_key
from src.config.settings import get_settings
from src.logger.logging import get_logger

logger = get_logger("api.a2a_gateway.repository")


async def dispose_a2a_engine():
    await A2AAgentRepository.dispose()


class A2AAgentRepository:
    """Persists published A2A agents. Reuses the main DATABASE_URL by default."""

    _engine = None
    _session_factory = None

    @classmethod
    async def initialize(cls):
        if cls._engine is not None:
            return
        settings = get_settings()
        db_url = getattr(settings, "A2A_DATABASE_URL", None) or settings.DATABASE_URL
        if db_url.startswith("postgresql://"):
            db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

        # SQLite (dev/test) doesn't accept the Postgres connection-pool args.
        engine_kwargs: dict = {"echo": False}
        if not db_url.startswith("sqlite"):
            engine_kwargs.update(
                pool_pre_ping=True,
                pool_recycle=1800,
                pool_size=5,
                max_overflow=10,
                pool_timeout=5,
            )

        cls._engine = create_async_engine(db_url, **engine_kwargs)
        cls._session_factory = async_sessionmaker(
            bind=cls._engine, class_=AsyncSession, expire_on_commit=False
        )
        async with cls._engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("A2A agent store initialized")

    @classmethod
    async def dispose(cls):
        if cls._engine is not None:
            await cls._engine.dispose()
            cls._engine = None
            cls._session_factory = None

    @classmethod
    def _require_factory(cls):
        if cls._session_factory is None:
            raise RuntimeError("A2AAgentRepository is not initialized")
        return cls._session_factory

    @classmethod
    async def upsert(
        cls,
        agent_id: str,
        name: str,
        definition: Dict[str, Any],
        user_id: Optional[str],
    ) -> str:
        """Create or replace a published agent; returns the new plaintext key.

        One endpoint per agent: publishing an already-published agent replaces
        its definition and issues a fresh key (old key stops working).
        """
        plaintext, prefix, key_hash = generate_api_key()
        factory = cls._require_factory()
        async with factory() as session:
            async with session.begin():
                existing = await session.get(A2AAgent, agent_id)
                if existing is None:
                    session.add(
                        A2AAgent(
                            agent_id=agent_id,
                            name=name,
                            definition=definition,
                            api_key_hash=key_hash,
                            api_key_prefix=prefix,
                            enabled=True,
                            user_id=user_id,
                        )
                    )
                else:
                    existing.name = name
                    existing.definition = definition
                    existing.api_key_hash = key_hash
                    existing.api_key_prefix = prefix
                    existing.enabled = True
                    existing.user_id = user_id
        return plaintext

    @classmethod
    async def get(cls, agent_id: str) -> Optional[A2AAgent]:
        factory = cls._require_factory()
        async with factory() as session:
            return await session.get(A2AAgent, agent_id)

    @classmethod
    async def rotate_key(cls, agent_id: str) -> Optional[str]:
        plaintext, prefix, key_hash = generate_api_key()
        factory = cls._require_factory()
        async with factory() as session:
            async with session.begin():
                agent = await session.get(A2AAgent, agent_id)
                if agent is None:
                    return None
                agent.api_key_hash = key_hash
                agent.api_key_prefix = prefix
        return plaintext

    @classmethod
    async def set_enabled(cls, agent_id: str, enabled: bool) -> bool:
        factory = cls._require_factory()
        async with factory() as session:
            async with session.begin():
                agent = await session.get(A2AAgent, agent_id)
                if agent is None:
                    return False
                agent.enabled = enabled
        return True
