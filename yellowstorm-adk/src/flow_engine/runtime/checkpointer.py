"""Checkpointer — shared SQLite-backed LangGraph checkpointer.

Reuses the same pattern as the legacy checkpointer but exposed
through the flow_engine package boundary.
"""

from __future__ import annotations

from typing import Any, Optional

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from structlog import get_logger

logger = get_logger(__name__)

_checkpointer: Optional[AsyncSqliteSaver] = None
_checkpointer_cm: Any = None


async def init_checkpointer(db_path: Optional[str] = None) -> AsyncSqliteSaver:
    global _checkpointer, _checkpointer_cm

    if _checkpointer is not None:
        return _checkpointer

    resolved_path = db_path or _default_checkpoint_path()
    _checkpointer_cm = AsyncSqliteSaver.from_conn_string(resolved_path)
    _checkpointer = await _checkpointer_cm.__aenter__()
    logger.info("[checkpointer] Initialized", path=resolved_path)
    return _checkpointer


async def close_checkpointer() -> None:
    global _checkpointer, _checkpointer_cm
    if _checkpointer_cm is not None:
        await _checkpointer_cm.__aexit__(None, None, None)
        _checkpointer = None
        _checkpointer_cm = None


def get_checkpointer() -> Optional[AsyncSqliteSaver]:
    return _checkpointer


async def ensure_checkpointer(db_path: Optional[str] = None) -> AsyncSqliteSaver:
    if _checkpointer is not None:
        return _checkpointer
    return await init_checkpointer(db_path)


def _default_checkpoint_path() -> str:
    import tempfile
    from pathlib import Path

    d = Path(tempfile.gettempdir()) / "yellowstorm_flow_checkpoints"
    d.mkdir(mode=0o700, parents=True, exist_ok=True)
    return str(d / "checkpoints.db")
