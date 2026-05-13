"""Parallel fan-out/fan-in wiring.

Parallel execution is achieved through LangGraph's built-in parallel
node execution: when multiple edges target distinct nodes from the same
source, they run concurrently.  This module handles the fan-in after
parallel branches converge.
"""

from __future__ import annotations

from typing import Any

from langgraph.graph import StateGraph
from structlog import get_logger

logger = get_logger(__name__)


def add_parallel_edges(
    graph: StateGraph,
    raw_edges: list[dict[str, Any]],
    raw_nodes: list[dict[str, Any]],
) -> None:
    logger.info("[parallel] No explicit fan-in needed — LangGraph handles parallel fan-out natively")
