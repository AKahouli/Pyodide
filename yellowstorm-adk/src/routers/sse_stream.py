"""Shared SSE pump for queue-backed streaming endpoints.

The producer coroutine pushes JSON-serializable dict chunks into an
``asyncio.Queue`` and finishes with a ``None`` sentinel; the pump drains it
into ``text/event-stream`` frames. Cancelling the pump (client disconnect)
cancels the producer so nothing keeps writing into the queue.
"""

import asyncio
import json
from typing import Any, AsyncGenerator

from src.logger.logging import get_logger

logger = get_logger("api.routers.sse_stream")


async def event_stream(
    q: "asyncio.Queue[dict[str, Any]]",
    bg_task: "asyncio.Task",
    endpoint_name: str,
) -> AsyncGenerator[str, None]:
    """Yield events from the queue for streaming responses."""
    first_chunk = True
    try:
        while True:
            chunk = await q.get()
            if chunk is None:
                logger.info(f"Stream finished for {endpoint_name}")
                break
            if first_chunk:
                logger.info(f"First chunk emitted for {endpoint_name}")
                first_chunk = False
            yield f"data: {json.dumps(chunk)}\n\n"
    except asyncio.CancelledError:
        logger.warning("Client disconnected, cancelling background task")
        bg_task.cancel()
        raise
