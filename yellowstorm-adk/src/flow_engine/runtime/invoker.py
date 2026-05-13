"""Invocation wrapper — ainvoke / astream over a compiled StateGraph."""

from __future__ import annotations

from typing import Any, AsyncGenerator, Optional

from langgraph.graph.graph import CompiledGraph
from structlog import get_logger

from src.flow_engine.state import ExecutionState

logger = get_logger(__name__)


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
    logger.info("[invoker] Streaming graph", recursion_limit=recursion_limit)
    async for event in graph.astream(initial_state, merged_config):
        yield event
