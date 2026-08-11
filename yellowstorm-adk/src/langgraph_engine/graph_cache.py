"""Graph instance caching and lifecycle management for playbook-specific execution graphs."""

import hashlib
import json
from typing import Dict, Optional, Tuple, Any
from datetime import datetime, timedelta

from langgraph.checkpoint.base import BaseCheckpointSaver
from structlog import get_logger

from src.langgraph_engine.state import StepCallback, NoopStepCallback
from src.langgraph_engine.graph_builder import DynamicGraphBuilder

logger = get_logger(__name__)

_graph_cache: Dict[str, Tuple[Any, datetime, str]] = {}

GRAPH_CACHE_TTL = timedelta(hours=24)

_thread_graphs: Dict[str, Tuple[Any, datetime]] = {}

THREAD_GRAPH_TTL_SECONDS = 3600


def _compute_content_hash(tasks: list, edges: list) -> str:
    content = json.dumps({"tasks": tasks, "edges": edges}, sort_keys=True, default=str)
    return hashlib.sha256(content.encode()).hexdigest()


def get_or_create_graph(
    playbook_id: str,
    tasks: list,
    edges: list,
    checkpointer: Optional[BaseCheckpointSaver] = None,
    on_step_update: StepCallback = NoopStepCallback,
    force_rebuild: bool = False,
) -> Dict[str, Any]:
    """Get or create a dynamic execution graph for a playbook.

    Returns the full ``graph_info`` dict produced by
    ``DynamicGraphBuilder.build_execution_graph`` (keys: ``compiled``,
    ``playbook_id``, ``task_count``, ``edge_count``).
    """
    global _graph_cache

    now = datetime.now()
    content_hash = _compute_content_hash(tasks, edges)

    if not force_rebuild and playbook_id in _graph_cache:
        graph_info, created_at, cached_hash = _graph_cache[playbook_id]

        if now - created_at < GRAPH_CACHE_TTL:
            if content_hash == cached_hash:
                logger.info("[GraphCache] Using cached graph", playbook_id=playbook_id)
                return graph_info
            else:
                logger.info("[GraphCache] Content changed, rebuilding", playbook_id=playbook_id)
        else:
            logger.info("[GraphCache] Cache expired, rebuilding", playbook_id=playbook_id)

    logger.info("[GraphCache] Creating new graph", playbook_id=playbook_id, tasks=len(tasks))
    builder = DynamicGraphBuilder(checkpointer=checkpointer)
    graph_info = builder.build_execution_graph(tasks, edges, playbook_id, on_step_update)

    _graph_cache[playbook_id] = (graph_info, now, content_hash)
    return graph_info


def store_thread_graph(thread_id: str, compiled_graph) -> None:
    _thread_graphs[thread_id] = (compiled_graph, datetime.now())


def get_thread_graph(thread_id: str):
    if thread_id in _thread_graphs:
        graph, created_at = _thread_graphs[thread_id]
        age = (datetime.now() - created_at).total_seconds()
        if age < THREAD_GRAPH_TTL_SECONDS:
            return graph
        else:
            del _thread_graphs[thread_id]
    return None


def cleanup_thread_graph(thread_id: str) -> None:
    if thread_id in _thread_graphs:
        del _thread_graphs[thread_id]


def invalidate_playbook_graph(playbook_id: str) -> None:
    global _graph_cache
    if playbook_id in _graph_cache:
        del _graph_cache[playbook_id]
        logger.info("[GraphCache] Invalidated graph", playbook_id=playbook_id)


def cleanup_stale_graphs() -> int:
    global _graph_cache

    now = datetime.now()
    expired = [k for k, (_, created_at, _) in _graph_cache.items() if now - created_at >= GRAPH_CACHE_TTL]
    for key in expired:
        del _graph_cache[key]

    stale_threads = [
        k for k, (_, created_at) in _thread_graphs.items()
        if (now - created_at).total_seconds() > THREAD_GRAPH_TTL_SECONDS
    ]
    for key in stale_threads:
        del _thread_graphs[key]

    return len(expired) + len(stale_threads)
