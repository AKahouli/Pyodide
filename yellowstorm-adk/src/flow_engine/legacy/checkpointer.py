"""LangGraph checkpointer configuration for playbook execution persistence."""

import tempfile
from pathlib import Path

from structlog import get_logger
from src.config.settings import get_settings

logger = get_logger(__name__)

_checkpointer = None
_checkpointer_cm = None


async def init_checkpointer():
    """Initialize checkpointer at application startup."""
    global _checkpointer, _checkpointer_cm
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

    if _checkpointer is not None:
        return _checkpointer

    settings = get_settings()
    configured_path = str(settings.LANGGRAPH_CHECKPOINT_PATH or "").strip()
    if configured_path:
        db_path = configured_path
    else:
        checkpoint_dir = Path(tempfile.gettempdir()) / "yellowstorm_checkpoints"
        checkpoint_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        db_path = str(checkpoint_dir / "checkpoints.db")

    Path(db_path).parent.mkdir(mode=0o700, parents=True, exist_ok=True)

    _checkpointer_cm = AsyncSqliteSaver.from_conn_string(db_path)
    _checkpointer = await _checkpointer_cm.__aenter__()

    logger.info("[checkpointer] Initialized SQLite checkpointer", db_path=db_path)
    return _checkpointer


async def close_checkpointer():
    """Close checkpointer at application shutdown."""
    global _checkpointer, _checkpointer_cm

    if _checkpointer_cm is not None:
        try:
            await _checkpointer_cm.__aexit__(None, None, None)
            logger.info("[checkpointer] Closed checkpointer")
        except Exception as e:
            logger.error("[checkpointer] Error closing checkpointer", error=str(e))
        finally:
            _checkpointer = None
            _checkpointer_cm = None


def get_checkpointer_sync():
    """Get checkpointer synchronously (must be initialized first)."""
    return _checkpointer


async def get_checkpointer():
    """Get or create the checkpointer instance."""
    global _checkpointer
    if _checkpointer is None:
        await init_checkpointer()
    return _checkpointer
