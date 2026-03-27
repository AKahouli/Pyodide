"""Graph instance caching and lifecycle management for playbook-specific execution graphs."""

import hashlib
import json
from typing import Dict, Optional, Tuple, Any
from datetime import datetime, timedelta

from langgraph.checkpoint.base import BaseCheckpointSaver
from structlog import get_logger

from src.langgraph_engine.graph_builder import DynamicGraphBuilder

logger = get_logger(__name__)

# Graph instance cache: playbook_id -> (graph, created_at, content_hash)
_graph_cache: Dict[str, Tuple[Any, datetime, str]] = {}

# Cache TTL (24 hours)
GRAPH_CACHE_TTL = timedelta(hours=24)

# Thread-to-graph mapping for interrupt resume
_thread_graphs: Dict[str, Tuple[Any, datetime]] = {}

THREAD_GRAPH_TTL_SECONDS = 3600


def _compute_content_hash(tasks: list, edges: list) -> str:
    """Compute a hash of task and edge contents for cache invalidation."""
    content = json.dumps({"tasks": tasks, "edges": edges}, sort_keys=True, default=str)
    return hashlib.sha256(content.encode()).hexdigest()


def get_or_create_graph(
    playbook_id: str,
    tasks: list,
    edges: list,
    checkpointer: Optional[BaseCheckpointSaver] = None,
    force_rebuild: bool = False,
):
    """Get or create a dynamic execution graph for a playbook."""
    global _graph_cache

    now = datetime.now()
    content_hash = _compute_content_hash(tasks, edges)

    if not force_rebuild and playbook_id in _graph_cache:
        graph, created_at, cached_hash = _graph_cache[playbook_id]

        if now - created_at < GRAPH_CACHE_TTL:
            if content_hash == cached_hash:
                logger.info("[GraphCache] Using cached graph", playbook_id=playbook_id)
                return graph
            else:
                logger.info("[GraphCache] Content changed, rebuilding", playbook_id=playbook_id)
        else:
            logger.info("[GraphCache] Cache expired, rebuilding", playbook_id=playbook_id)

    logger.info("[GraphCache] Creating new graph", playbook_id=playbook_id, tasks=len(tasks))
    builder = DynamicGraphBuilder(checkpointer=checkpointer)
    graph = builder.build_execution_graph(tasks, edges, playbook_id)

    _graph_cache[playbook_id] = (graph, now, content_hash)
    return graph


def store_thread_graph(thread_id: str, graph):
    """Store graph instance for a thread (needed for interrupt resume)."""
    _thread_graphs[thread_id] = (graph, datetime.now())


def get_thread_graph(thread_id: str):
    """Get graph instance for a thread."""
    if thread_id in _thread_graphs:
        graph, created_at = _thread_graphs[thread_id]
        age = (datetime.now() - created_at).total_seconds()
        if age < THREAD_GRAPH_TTL_SECONDS:
            return graph
        else:
            del _thread_graphs[thread_id]
    return None


def cleanup_thread_graph(thread_id: str):
    """Remove graph instance after execution completes."""
    if thread_id in _thread_graphs:
        del _thread_graphs[thread_id]


def invalidate_playbook_graph(playbook_id: str):
    """Invalidate cached graph for a specific playbook."""
    global _graph_cache
    if playbook_id in _graph_cache:
        del _graph_cache[playbook_id]
        logger.info("[GraphCache] Invalidated graph", playbook_id=playbook_id)


def cleanup_stale_graphs():
    """Remove expired graphs and thread instances from cache."""
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
