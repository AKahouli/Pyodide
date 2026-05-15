"""Invocation wrapper — ainvoke / astream over a compiled StateGraph.

Uses stream_mode=["updates", "custom"] so that nodes can emit lifecycle
events via get_stream_writer() while state transitions still propagate.
"""

from __future__ import annotations

from typing import Any, AsyncGenerator, Optional

try:
    from langgraph.graph.graph import CompiledGraph
except ImportError:
    from typing import Any as CompiledGraph  # fallback for older langgraph versions
from structlog import get_logger

from src.flow_engine.state import ExecutionState

logger = get_logger(__name__)

STREAM_MODE_UPDATES = "updates"
STREAM_MODE_CUSTOM = "custom"


async def invoke_graph(
    graph: CompiledGraph,
    initial_state: ExecutionState,
    recursion_limit: int = 25,
    config: Optional[dict[str, Any]] = None,
) -> ExecutionState:
    merged_config = {
        "recursion_limit": recursion_limit,
        **(config or {}),
    }
    logger.info("[invoker] Invoking graph", recursion_limit=recursion_limit)
    result = await graph.ainvoke(initial_state, merged_config)
    return result


async def stream_graph(
    graph: CompiledGraph,
    initial_state: ExecutionState,
    recursion_limit: int = 25,
    config: Optional[dict[str, Any]] = None,
) -> AsyncGenerator[dict[str, Any], None]:
    merged_config = {
        "recursion_limit": recursion_limit,
        **(config or {}),
    }
    logger.info("[invoker] Streaming graph", recursion_limit=recursion_limit, thread_id=merged_config.get("configurable", {}).get("thread_id"))

    async for chunk in graph.astream(
        initial_state,
        merged_config,
        stream_mode=[STREAM_MODE_UPDATES, STREAM_MODE_CUSTOM],
    ):
        if isinstance(chunk, tuple) and len(chunk) == 2:
            mode_tuple, data = chunk
            mode = mode_tuple[0] if isinstance(mode_tuple, tuple) and mode_tuple else str(mode_tuple)
        else:
            mode = STREAM_MODE_UPDATES
            data = chunk

        yield {"_mode": mode, "_data": data}
