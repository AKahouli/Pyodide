"""Bounded, identity-scoped reuse of MCP toolsets across turns.

Without reuse every turn rebuilds its ``MCPToolset`` objects, so the first
model request pays the MCP handshake plus ``tools/list`` before the provider
call. ADK already pools sessions and can cache ``tools/list`` *per toolset
instance*; this module keeps the instance alive between turns of one
conversation so both mechanisms actually get reused.

Isolation: an entry is addressed by a digest of everything that determines
what the MCP server sees and returns -- toolset class, MCP type, URL, every
header (user id, workspace ids, auth headers), timeouts, tool filter -- plus a
caller-provided scope (user + conversation). The conversation id comes from
the turn scope opened by the gRPC servicer, because isolated root runs use a
fresh ADK session id per message. Two callers share a toolset only
if the server cannot tell them apart. The digest is the only thing stored as a
key, so header values never appear in keys or logs.
"""

from __future__ import annotations

import asyncio
import contextvars
import hashlib
import json
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Dict, Iterable, List, Optional, Set

from google.adk.tools.mcp_tool.mcp_toolset import (
    SseConnectionParams,
    StreamableHTTPConnectionParams,
)
from yellowmind_observability import get_logger

logger = get_logger(__name__)

# An evicted toolset leased by a running turn is closed when that turn
# releases it. Toolsets fetched outside a turn scope cannot be tracked, so
# they are closed after this grace period instead of immediately.
EVICTION_CLOSE_GRACE_SECONDS = 120.0
_CLOSE_TIMEOUT_SECONDS = 10.0


class ToolsetTurn:
    """One agent run: the conversation it belongs to and the toolsets it leased."""

    def __init__(self, conversation_id: Optional[str]) -> None:
        self.conversation_id = conversation_id or None
        self.leased: List[tuple["McpToolsetCache", Any]] = []
        self._released = False

    def release(self) -> None:
        if self._released:
            return
        self._released = True
        for cache, toolset in self.leased:
            cache.release(toolset)
        self.leased.clear()


_current_turn: contextvars.ContextVar[Optional[ToolsetTurn]] = contextvars.ContextVar(
    "mcp_toolset_turn", default=None
)


def begin_toolset_turn(conversation_id: Optional[str]) -> ToolsetTurn:
    """Open a turn scope in the current context.

    Tasks created afterwards inherit it, so toolsets fetched while the turn
    runs are leased to it. The caller must call ``release()`` when the run
    ends (a task done-callback is enough).
    """
    turn = ToolsetTurn(conversation_id)
    _current_turn.set(turn)
    return turn


def current_conversation_id() -> Optional[str]:
    turn = _current_turn.get()
    return turn.conversation_id if turn else None


def build_toolset_cache_key(
    *,
    connection_params: Any,
    mcp_type: str,
    tool_filter: Any,
    scope: Optional[str],
    toolset_class: type,
) -> Optional[str]:
    """Digest identifying the exact server view a toolset provides.

    Returns None (caller must not cache) when the identity cannot be captured
    completely: no scope, non-HTTP transport, or a callable tool filter.
    """
    if not scope:
        return None
    if not isinstance(connection_params, (StreamableHTTPConnectionParams, SseConnectionParams)):
        return None
    if tool_filter is not None and not isinstance(tool_filter, (list, tuple, set, frozenset)):
        return None
    payload = {
        "class": f"{toolset_class.__module__}.{toolset_class.__qualname__}",
        "mcp_type": mcp_type,
        "scope": scope,
        "url": connection_params.url,
        "headers": dict(sorted((connection_params.headers or {}).items())),
        "timeout": connection_params.timeout,
        "sse_read_timeout": connection_params.sse_read_timeout,
        "terminate_on_close": getattr(connection_params, "terminate_on_close", None),
        "tool_filter": None if tool_filter is None else sorted(tool_filter),
    }
    encoded = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


class McpToolsetCache:
    """LRU + idle-TTL cache of live toolsets; evicted toolsets are closed."""

    def __init__(
        self,
        *,
        max_entries: int,
        idle_seconds: float,
        clock: Callable[[], float] = time.monotonic,
        close_grace_seconds: float = EVICTION_CLOSE_GRACE_SECONDS,
    ) -> None:
        self._max_entries = max_entries
        self._idle_seconds = idle_seconds
        self._clock = clock
        self._close_grace_seconds = close_grace_seconds
        self._entries: "OrderedDict[str, tuple[Any, float]]" = OrderedDict()
        self._lock = threading.Lock()
        self._background: Set[asyncio.Task] = set()
        # Keyed by id(): toolsets need not be hashable; entries live only
        # while the toolset is referenced from the cache or a turn.
        self._leases: Dict[int, int] = {}
        self._pending_close: Dict[int, Any] = {}

    @property
    def enabled(self) -> bool:
        return self._max_entries > 0

    def __len__(self) -> int:
        return len(self._entries)

    def get_or_create(self, key: str, factory: Callable[[], Any]) -> Any:
        """Return the live toolset for ``key``, building it on a miss.

        The factory runs outside the lock so a slow build never blocks other
        keys; if two misses race, the first stored toolset wins.
        """
        toolset = self._lookup(key)
        if toolset is None:
            built = factory()
            toolset, evicted, lost_race = self._store(key, built)
            if lost_race:
                evicted.append(built)
            self._dispose(evicted)
        self._lease(toolset)
        return toolset

    def release(self, toolset: Any) -> None:
        """End one turn's lease; closes the toolset if it was evicted meanwhile."""
        with self._lock:
            ident = id(toolset)
            remaining = self._leases.get(ident, 0) - 1
            if remaining > 0:
                self._leases[ident] = remaining
                return
            self._leases.pop(ident, None)
            pending = self._pending_close.pop(ident, None)
        if pending is not None:
            self._close_later(pending, 0.0)

    def invalidate(self, toolset: Any) -> bool:
        """Drop ``toolset`` (e.g. after a failed connect) so the next turn reconnects."""
        with self._lock:
            for key, (candidate, _) in list(self._entries.items()):
                if candidate is toolset:
                    del self._entries[key]
                    break
            else:
                return False
            if self._leases.get(id(toolset), 0) > 0:
                self._pending_close[id(toolset)] = toolset
                return True
        self._close_later(toolset, 0.0)
        return True

    async def close_all(self) -> None:
        with self._lock:
            toolsets = [toolset for toolset, _ in self._entries.values()]
            toolsets.extend(self._pending_close.values())
            self._entries.clear()
            self._pending_close.clear()
            self._leases.clear()
        await asyncio.gather(*(self._close(toolset) for toolset in toolsets))

    def _lookup(self, key: str) -> Optional[Any]:
        with self._lock:
            now = self._clock()
            evicted = self._pop_expired(now)
            entry = self._entries.get(key)
            if entry is not None:
                self._entries[key] = (entry[0], now)
                self._entries.move_to_end(key)
        self._dispose(evicted)
        return entry[0] if entry is not None else None

    def _store(self, key: str, built: Any) -> tuple[Any, List[Any], bool]:
        evicted: List[Any] = []
        with self._lock:
            now = self._clock()
            existing = self._entries.get(key)
            if existing is not None:
                self._entries[key] = (existing[0], now)
                self._entries.move_to_end(key)
                return existing[0], evicted, True
            self._entries[key] = (built, now)
            while len(self._entries) > self._max_entries:
                _, (oldest, _) = self._entries.popitem(last=False)
                evicted.append(oldest)
        return built, evicted, False

    def _lease(self, toolset: Any) -> None:
        turn = _current_turn.get()
        if turn is None:
            return
        with self._lock:
            self._leases[id(toolset)] = self._leases.get(id(toolset), 0) + 1
        turn.leased.append((self, toolset))

    def _dispose(self, toolsets: List[Any]) -> None:
        """Close evicted toolsets now, or when their last leasing turn ends."""
        for toolset in toolsets:
            with self._lock:
                if self._leases.get(id(toolset), 0) > 0:
                    self._pending_close[id(toolset)] = toolset
                    continue
            self._close_later(toolset, self._close_grace_seconds)

    def _pop_expired(self, now: float) -> List[Any]:
        expired = [
            key for key, (_, last_used) in self._entries.items()
            if now - last_used >= self._idle_seconds
        ]
        return [self._entries.pop(key)[0] for key in expired]

    def _close_later(self, toolset: Any, delay: float) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # Closing is async and needs the loop the toolset's sessions live
            # on; without one they are only reclaimed by garbage collection.
            logger.warning(
                "dependency.request.failed",
                dependency="mcp",
                operation="toolset_close",
                reason="no_running_event_loop",
            )
            return
        task = loop.create_task(self._close(toolset, delay))
        self._background.add(task)
        task.add_done_callback(self._background.discard)

    async def _close(self, toolset: Any, delay: float = 0.0) -> None:
        try:
            if delay:
                await asyncio.sleep(delay)
            await asyncio.wait_for(toolset.close(), timeout=_CLOSE_TIMEOUT_SECONDS)
        except Exception as error:
            logger.warning(
                "dependency.request.failed",
                dependency="mcp",
                operation="toolset_close",
                error=error,
            )


_cache: Optional[McpToolsetCache] = None
_cache_lock = threading.Lock()


def get_toolset_cache() -> McpToolsetCache:
    """Process-wide cache configured from settings (0 entries disables it)."""
    global _cache
    if _cache is None:
        with _cache_lock:
            if _cache is None:
                from src.config.settings import get_settings

                settings = get_settings()
                _cache = McpToolsetCache(
                    max_entries=settings.MCP_TOOLSET_CACHE_MAX_ENTRIES,
                    idle_seconds=settings.MCP_TOOLSET_CACHE_IDLE_SECONDS,
                )
    return _cache


def reset_toolset_cache_for_tests() -> None:
    global _cache
    _cache = None


_prewarm_tasks: Set[asyncio.Task] = set()


def prewarm_mcp_toolsets(tools: Iterable[Any]) -> int:
    """Start connecting cached MCP toolsets in the background.

    The connect + ``tools/list`` otherwise happens lazily at the first model
    request; starting it as soon as the agent is built overlaps it with
    session and runner setup. Best effort: ADK's own call remains the owner
    of the terminal outcome, so a failure here is only noted concisely.
    Returns the number of warm-ups started.
    """
    started = 0
    for tool in tools:
        if getattr(tool, "_toolset_cache_managed", False) is not True:
            continue
        try:
            task = asyncio.get_running_loop().create_task(_prewarm(tool))
        except RuntimeError:
            return started
        _prewarm_tasks.add(task)
        task.add_done_callback(_prewarm_tasks.discard)
        started += 1
    return started


async def _prewarm(toolset: Any) -> None:
    try:
        await toolset.get_tools()
    except Exception as error:
        logger.warning(
            "dependency.request.failed",
            dependency="mcp",
            operation="toolset_prewarm",
            error=error,
        )
