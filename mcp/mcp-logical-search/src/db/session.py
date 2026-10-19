"""
Async database session management for PostgreSQL using SQLAlchemy.
"""

import asyncio
from contextlib import asynccontextmanager, contextmanager
from contextvars import ContextVar
from threading import Event
from datetime import datetime, timezone
import time
import ssl
from ipaddress import ip_address
from typing import AsyncGenerator, Callable, TypeVar
from weakref import WeakKeyDictionary

from pgvector.psycopg2 import register_vector
from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base, Session

from src.config.settings import get_settings
from src.modules import operations
from src.logger.file_request_logging import (
    current_tool_call_context,
    get_postgres_file_logger,
    log_json_line,
    request_logging_enabled,
    request_logging_selected,
)
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
_query_logging_registered_engine_ids = set()
_sync_db_semaphores = WeakKeyDictionary()
_sync_db_tasks = set()
T = TypeVar("T")
_worker_budget = ContextVar("db_worker_budget", default=(None, None))


def check_db_deadline():
    deadline, cancelled = _worker_budget.get()
    if (cancelled is not None and cancelled.is_set()) or (
        deadline is not None and time.monotonic() >= deadline
    ):
        raise asyncio.TimeoutError("Database operation deadline exhausted or caller cancelled")


@contextmanager
def database_budget(session, deadline, cancelled):
    token = _worker_budget.set((deadline, cancelled))

    def before_execute(state):
        check_db_deadline()
        if deadline is not None:
            connection = session.connection()
            check_db_deadline()
            remaining_ms = max(1, int((deadline - time.monotonic()) * 1000))
            statement_ms = min(remaining_ms, settings.DB_STATEMENT_TIMEOUT_MS) \
                if settings.DB_STATEMENT_TIMEOUT_MS > 0 else remaining_ms
            connection.exec_driver_sql(f"SET LOCAL statement_timeout = {statement_ms}")

    if isinstance(session, Session):
        event.listen(session, "do_orm_execute", before_execute)
    try:
        check_db_deadline()
        yield
        check_db_deadline()
    finally:
        if isinstance(session, Session):
            event.remove(session, "do_orm_execute", before_execute)
        _worker_budget.reset(token)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _redact_query_parameters(value, max_string_length: int = 300, max_sequence_length: int = 20):
    if isinstance(value, dict):
        return {
            key: _redact_query_parameters(item, max_string_length, max_sequence_length)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        if len(value) > max_sequence_length and all(isinstance(item, (float, int)) for item in value):
            return {
                "redacted": True,
                "reason": "large_numeric_sequence",
                "length": len(value),
            }
        return [
            _redact_query_parameters(item, max_string_length, max_sequence_length)
            for item in value
        ]
    if isinstance(value, str) and len(value) > max_string_length:
        return {
            "truncated": True,
            "original_chars": len(value),
            "preview": value[:max_string_length],
        }
    return value


def _register_query_file_logging(engine, engine_name: str) -> None:
    if not request_logging_enabled():
        return

    engine_id = id(engine)
    if engine_id in _query_logging_registered_engine_ids:
        return
    _query_logging_registered_engine_ids.add(engine_id)

    @event.listens_for(engine, "before_cursor_execute")
    def log_postgres_request_submitted(conn, cursor, statement, parameters, context, executemany):
        selected = request_logging_selected()
        request_id = id(context)
        submitted_at = _utc_now()
        context._mcp_request_log = {
            "postgres_request_id": request_id,
            "submitted_at": submitted_at,
            "start": time.perf_counter(),
            "selected": selected,
        }
        if not selected:
            return
        log_json_line(get_postgres_file_logger(), {
            "event": "postgresql_request_submitted",
            "postgres_request_id": request_id,
            "submitted_at": submitted_at,
            "engine": engine_name,
            "executemany": executemany,
            **current_tool_call_context(),
            "statement": statement,
            "parameters": _redact_query_parameters(parameters),
        }, selected=True)

    @event.listens_for(engine, "after_cursor_execute")
    def log_postgres_request_returned(conn, cursor, statement, parameters, context, executemany):
        request_log = getattr(context, "_mcp_request_log", None) or {}
        if not request_log.get("selected"):
            return
        start = request_log.get("start", time.perf_counter())
        log_json_line(get_postgres_file_logger(), {
            "event": "postgresql_request_returned",
            "postgres_request_id": request_log.get("postgres_request_id", id(context)),
            "submitted_at": request_log.get("submitted_at"),
            "returned_at": _utc_now(),
            "duration_ms": round((time.perf_counter() - start) * 1000, 3),
            "engine": engine_name,
            "executemany": executemany,
            **current_tool_call_context(),
            "rowcount": cursor.rowcount,
            "statement": statement,
            "parameters": _redact_query_parameters(parameters),
        }, selected=True)

    @event.listens_for(engine, "handle_error")
    def log_postgres_request_error(exception_context):
        context = exception_context.execution_context
        request_log = getattr(context, "_mcp_request_log", None) if context else {}
        if not request_log or not request_log.get("selected"):
            return
        start = request_log.get("start", time.perf_counter()) if request_log else time.perf_counter()
        log_json_line(get_postgres_file_logger(), {
            "event": "postgresql_request_returned",
            "postgres_request_id": request_log.get("postgres_request_id", id(context)) if request_log else id(context),
            "submitted_at": request_log.get("submitted_at") if request_log else None,
            "returned_at": _utc_now(),
            "duration_ms": round((time.perf_counter() - start) * 1000, 3),
            "engine": engine_name,
            **current_tool_call_context(),
            "status": "error",
            "error_type": type(exception_context.original_exception).__name__,
            "error": str(exception_context.original_exception),
            "statement": exception_context.statement,
            "parameters": _redact_query_parameters(exception_context.parameters),
        }, selected=True)


def _async_database_url() -> str:
    database_url = settings.DATABASE_URL
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if database_url.startswith("postgresql+psycopg2://"):
        return database_url.replace("postgresql+psycopg2://", "postgresql+asyncpg://", 1)
    return database_url


def _sync_database_url() -> str:
    database_url = settings.DATABASE_URL
    if database_url.startswith("postgresql+asyncpg://"):
        return database_url.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+psycopg2://", 1)
    return database_url


def _database_transport(database_url, *, asynchronous):
    """Translate one verified TLS policy to asyncpg and libpq driver options."""
    url = make_url(database_url)
    query = dict(url.query)
    if any(key in query for key in ("host", "hostaddr", "service", "servicefile")):
        raise ValueError("Database host must be specified in the URL authority, not query overrides")
    sslmode = query.pop("sslmode", None)
    ssl_option = query.pop("ssl", None)
    if sslmode and ssl_option and sslmode != ssl_option:
        raise ValueError("Conflicting database TLS options")
    mode = sslmode or ssl_option or settings.DB_TLS_MODE
    ca_file = query.pop("sslrootcert", None) or settings.DB_TLS_CA_FILE
    try:
        loopback = ip_address(url.host or "").is_loopback
    except ValueError:
        loopback = url.host == "localhost" or url.host is None
    if mode != "verify-full" and not (mode == "disable" and loopback):
        raise ValueError("Database connections require verify-full TLS; disable is allowed only on loopback")
    clean_url = url.set(query=query)
    if asynchronous:
        context = ssl.create_default_context(cafile=None if ca_file == "system" else ca_file) if mode == "verify-full" else False
        return clean_url, {"ssl": context}
    options = {"sslmode": mode}
    if mode == "verify-full":
        certificate = ca_file or ssl.get_default_verify_paths().cafile
        if certificate:
            options["sslrootcert"] = certificate
    return clean_url, options


def validate_database_transport():
    """Fail startup on insecure URLs or invalid CA configuration without DB work."""
    _database_transport(_async_database_url(), asynchronous=True)
    _database_transport(_sync_database_url(), asynchronous=False)


def get_engine():
    """Get or create the async database engine."""
    global _engine
    if _engine is None:
        database_url, transport = _database_transport(_async_database_url(), asynchronous=True)
        _engine = create_async_engine(
            database_url,
            pool_pre_ping=True,
            pool_size=settings.DB_POOL_SIZE,
            max_overflow=settings.DB_MAX_OVERFLOW,
            pool_timeout=settings.DB_POOL_TIMEOUT_SECONDS,
            connect_args={
                **transport,
                "timeout": settings.DB_CONNECT_TIMEOUT_SECONDS,
                "server_settings": {
                    "statement_timeout": str(settings.DB_STATEMENT_TIMEOUT_MS),
                    "default_transaction_read_only": "on",
                },
            },
            echo=settings.DB_ECHO,
            hide_parameters=True,
        )
        _register_query_file_logging(_engine.sync_engine, "async")
        logger.info("Created async database engine from DATABASE_URL")
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
        logger.error("Database session error: %s", type(e).__name__)
        raise
    finally:
        await session.close()


async def init_db():
    """
    Initialize database tables asynchronously.

    Creates all tables defined in the models if they don't exist.
    """
    from src.db.models import LogicalDocument, LogicalBlock, LogicalSection, LogicalImage, LogicalTextPosition

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
        database_url, transport = _database_transport(_sync_database_url(), asynchronous=False)
        _sync_engine = create_engine(
            database_url,
            pool_pre_ping=True,
            pool_size=settings.DB_POOL_SIZE,
            max_overflow=settings.DB_MAX_OVERFLOW,
            pool_timeout=settings.DB_POOL_TIMEOUT_SECONDS,
            connect_args={
                **transport,
                "connect_timeout": settings.DB_CONNECT_TIMEOUT_SECONDS,
                "options": f"-c statement_timeout={settings.DB_STATEMENT_TIMEOUT_MS} -c default_transaction_read_only=on",
            },
            echo=settings.DB_ECHO,
            hide_parameters=True,
        )
        _register_query_file_logging(_sync_engine, "sync")

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
        logger.error("Database session error: %s", type(e).__name__)
        raise
    finally:
        session.close()


async def run_sync_db(
    operation: Callable[[object], T],
    session_context_factory: Callable = get_db_session_sync,
    timeout: float | None = None,
) -> T:
    """Run one complete synchronous session operation off the event loop.

    The permit is released by the underlying worker task, not by its awaiting
    request, so request cancellation cannot admit extra database work while a
    psycopg2 call is still running.
    """
    loop = asyncio.get_running_loop()
    operations.require_admission()
    semaphore = _sync_db_semaphores.get(loop)
    if semaphore is None:
        semaphore = asyncio.Semaphore(settings.DB_SYNC_WORKER_LIMIT)
        _sync_db_semaphores[loop] = semaphore

    started = time.monotonic()
    deadline = None if timeout is None else started + timeout
    cancelled = Event()
    await operations.acquire_capacity(semaphore, queue_limit=settings.DB_QUEUE_LIMIT, timeout=timeout)

    try:
        operations.require_admission()
        if deadline is not None and time.monotonic() >= deadline:
            raise asyncio.TimeoutError
    except BaseException:
        semaphore.release()
        raise

    def execute() -> T:
        with session_context_factory() as session:
            with database_budget(session, deadline, cancelled):
                return operation(session)

    task = operations.track(asyncio.create_task(asyncio.to_thread(execute)))
    _sync_db_tasks.add(task)

    def release_permit(completed_task: asyncio.Task) -> None:
        _sync_db_tasks.discard(completed_task)
        semaphore.release()
        if not completed_task.cancelled():
            completed_task.exception()

    task.add_done_callback(release_permit)
    try:
        if timeout is None:
            return await asyncio.shield(task)
        remaining = timeout - (time.monotonic() - started)
        if remaining <= 0:
            raise asyncio.TimeoutError
        return await asyncio.wait_for(asyncio.shield(task), timeout=remaining)
    except (asyncio.CancelledError, asyncio.TimeoutError):
        cancelled.set()
        raise


async def dispose_engines() -> None:
    """Dispose shared pools during application shutdown."""
    global _engine, _session_factory, _sync_engine, _sync_session_factory
    if _engine is not None:
        await _engine.dispose()
    if _sync_engine is not None:
        _sync_engine.dispose()
    _engine = None
    _session_factory = None
    _sync_engine = None
    _sync_session_factory = None
