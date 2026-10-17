"""Background TTL eviction for idle sandboxes."""
from __future__ import annotations

import asyncio
import logging

from .config import Settings
from .manager import MultiUserSandboxManager

logger = logging.getLogger(__name__)


async def run_ttl_eviction_loop(
    multi_manager: MultiUserSandboxManager,
    settings: Settings,
    interval_sec: int = 60,
) -> None:
    """Periodically destroy sandboxes that exceeded sandbox_ttl_minutes idle time."""
    while True:
        try:
            await asyncio.sleep(interval_sec)
            evicted = await multi_manager.evict_idle()
            if evicted:
                logger.info("TTL eviction cycle: removed %d idle sandbox(es)", evicted)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("TTL eviction loop error: %s", exc)
