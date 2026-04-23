"""
Async database session management for PostgreSQL using SQLAlchemy.
"""

from contextlib import asynccontextmanager, contextmanager
from typing import AsyncGenerator

from pgvector.psycopg2 import register_vector
from sqlalchemy import create_engine, event
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base

from src.config.settings import get_settings
from src.logger.logging import get_logger

logger = get_logger(__name__)
settings = get_settings()

# Create base class for models
Base = declarative_base()

# Database engine (lazy initialization)
_engine = None
_session_factory = None
_sync_engine = None
_sync_session_factory = None


def get_engine():
    """Get or create the async database engine."""
    global _engine
    if _engine is None:
        database_url = settings.DATABASE_URL
        _engine = create_async_engine(
            database_url,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=10,
            echo=False,
        )
        logger.info(f"Created async database engine from DATABASE_URL")
    return _engine


def get_session_factory():
    """Get or create the async session factory."""
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            bind=get_engine(),
            class_=AsyncSession,
            autocommit=False,
            autoflush=False,
            expire_on_commit=False,
        )
    return _session_factory


@asynccontextmanager
async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Async context manager for database sessions.

    Usage:
        async with get_db_session() as session:
            result = await session.execute(query)
    """
    session_factory = get_session_factory()
    session = session_factory()
    try:
        yield session
        await session.commit()
    except Exception as e:
        await session.rollback()
        logger.error(f"Database session error: {e}")
        raise
    finally:
        await session.close()


async def init_db():
    """
    Initialize database tables asynchronously.

    Creates all tables defined in the models if they don't exist.
    """
    from src.db.models import LogicalDocument, LogicalBlock, LogicalSection

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables initialized")


def get_sync_session():
    """
    Get a synchronous session for use in Celery tasks.

    Since Celery tasks run synchronously, we need a sync session.
    This creates a sync engine from the async URL.
    """
    from sqlalchemy.orm import sessionmaker

    global _sync_engine, _sync_session_factory
    if _sync_session_factory is None:
        # Convert async URL to sync URL
        database_url = settings.DATABASE_URL
        sync_url = database_url.replace('+asyncpg', '')

        _sync_engine = create_engine(
            sync_url,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=10,
            echo=False,
        )

        @event.listens_for(_sync_engine, "connect")
        def register_pgvector_types(dbapi_connection, connection_record):
            register_vector(dbapi_connection)

        _sync_session_factory = sessionmaker(
            bind=_sync_engine,
            autocommit=False,
            autoflush=False,
        )

    return _sync_session_factory()


@contextmanager
def get_db_session_sync():
    """
    Synchronous context manager for database sessions (for Celery tasks).

    Usage:
        with get_db_session_sync() as session:
            result = session.query(LogicalDocument).all()
    """
    session = get_sync_session()
    try:
        yield session
        session.commit()
    except Exception as e:
        session.rollback()
        logger.error(f"Database session error: {e}")
        raise
    finally:
        session.close()
