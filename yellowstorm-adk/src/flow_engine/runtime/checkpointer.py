"""Shared PostgreSQL-backed LangGraph checkpointer."""

from __future__ import annotations

import asyncio
import hashlib
import re
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from typing import Optional

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import AsyncConnection, sql
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from structlog import get_logger

from src.config.settings import get_settings

logger = get_logger(__name__)

_checkpointer: Optional[BaseCheckpointSaver] = None
_pool: Optional[AsyncConnectionPool] = None
_connection_string: Optional[str] = None
_init_lock = asyncio.Lock()
_operation_locks: dict[str, asyncio.Lock] = {}
_SCHEMA_PATTERN = re.compile(r"[a-z_][a-z0-9_]{0,62}")


def normalize_postgres_connection_string(database_url: str) -> str:
    """Convert SQLAlchemy PostgreSQL URLs to psycopg-compatible URLs."""
    for prefix in ("postgresql+asyncpg://", "postgresql+psycopg://"):
        if database_url.startswith(prefix):
            return "postgresql://" + database_url[len(prefix) :]
    if database_url.startswith(("postgresql://", "postgres://")):
        return database_url
    raise ValueError("LangGraph checkpoints require a PostgreSQL DATABASE_URL")


def validate_checkpoint_schema(schema: str) -> str:
    if not _SCHEMA_PATTERN.fullmatch(schema):
        raise ValueError(
            "LANGGRAPH_CHECKPOINT_SCHEMA must be a lowercase PostgreSQL identifier"
        )
    return schema


async def init_checkpointer(
    connection_string: Optional[str] = None,
    *,
    schema: Optional[str] = None,
    pool_min_size: Optional[int] = None,
    pool_max_size: Optional[int] = None,
    pool_timeout: Optional[float] = None,
) -> BaseCheckpointSaver:
    """Create the schema, run saver migrations, and open the shared pool."""
    global _checkpointer, _pool, _connection_string

    async with _init_lock:
        if _checkpointer is not None:
            return _checkpointer

        settings = get_settings()
        conninfo = normalize_postgres_connection_string(
            connection_string or settings.DATABASE_URL
        )
        resolved_schema = validate_checkpoint_schema(
            schema or settings.LANGGRAPH_CHECKPOINT_SCHEMA
        )
        min_size = pool_min_size or settings.LANGGRAPH_CHECKPOINT_POOL_MIN_SIZE
        max_size = pool_max_size or settings.LANGGRAPH_CHECKPOINT_POOL_MAX_SIZE
        timeout = pool_timeout or settings.LANGGRAPH_CHECKPOINT_POOL_TIMEOUT_SECONDS
        if min_size > max_size:
            raise ValueError(
                "LANGGRAPH_CHECKPOINT_POOL_MIN_SIZE cannot exceed "
                "LANGGRAPH_CHECKPOINT_POOL_MAX_SIZE"
            )

        lock_key = int.from_bytes(
            hashlib.sha256(
                f"yellowstorm-langgraph:{resolved_schema}".encode("ascii")
            ).digest()[:8],
            byteorder="big",
            signed=True,
        )

        async with await AsyncConnection.connect(
            conninfo,
            autocommit=True,
            prepare_threshold=0,
            row_factory=dict_row,
        ) as bootstrap:
            await bootstrap.execute(
                sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(
                    sql.Identifier(resolved_schema)
                )
            )
            await bootstrap.execute(
                sql.SQL("SET search_path TO {}").format(sql.Identifier(resolved_schema))
            )
            await bootstrap.execute("SELECT pg_advisory_lock(%s)", (lock_key,))
            try:
                await AsyncPostgresSaver(bootstrap).setup()
            finally:
                await bootstrap.execute("SELECT pg_advisory_unlock(%s)", (lock_key,))

        async def configure_connection(conn: AsyncConnection) -> None:
            await conn.execute(
                sql.SQL("SET search_path TO {}").format(
                    sql.Identifier(resolved_schema)
                )
            )

        pool = AsyncConnectionPool(
            conninfo,
            kwargs={
                "autocommit": True,
                "prepare_threshold": 0,
                "row_factory": dict_row,
            },
            min_size=min_size,
            max_size=max_size,
            timeout=timeout,
            open=False,
            configure=configure_connection,
            name="yellowstorm-langgraph-checkpoints",
        )
        try:
            await pool.open(wait=True, timeout=timeout)
        except BaseException:
            await pool.close()
            raise

        _pool = pool
        _connection_string = conninfo
        _checkpointer = AsyncPostgresSaver(pool)
        logger.info(
            "[checkpointer] Initialized",
            backend="postgresql",
            schema=resolved_schema,
            pool_min_size=min_size,
            pool_max_size=max_size,
        )
        return _checkpointer


async def close_checkpointer() -> None:
    global _checkpointer, _pool, _connection_string

    async with _init_lock:
        pool = _pool
        if pool is None:
            _checkpointer = None
            _connection_string = None
            return
        try:
            await pool.close()
        finally:
            _checkpointer = None
            _pool = None
            _connection_string = None


def get_checkpointer() -> Optional[BaseCheckpointSaver]:
    return _checkpointer


async def ensure_checkpointer() -> BaseCheckpointSaver:
    if _checkpointer is not None:
        return _checkpointer
    return await init_checkpointer()


@asynccontextmanager
async def checkpoint_operation_lock(operation_key: str) -> AsyncIterator[None]:
    """Serialize persistence-sensitive operations across ADK processes."""
    conninfo = _connection_string
    if conninfo is None:
        lock = _operation_locks.setdefault(operation_key, asyncio.Lock())
        try:
            async with lock:
                yield
        finally:
            if not lock.locked():
                _operation_locks.pop(operation_key, None)
        return

    lock_key = int.from_bytes(
        hashlib.sha256(
            f"yellowstorm-checkpoint-operation:{operation_key}".encode("utf-8")
        ).digest()[:8],
        byteorder="big",
        signed=True,
    )
    async with await AsyncConnection.connect(
        conninfo,
        autocommit=True,
        prepare_threshold=0,
        row_factory=dict_row,
    ) as connection:
        await connection.execute("SELECT pg_advisory_lock(%s)", (lock_key,))
        try:
            yield
        finally:
            await connection.execute("SELECT pg_advisory_unlock(%s)", (lock_key,))
