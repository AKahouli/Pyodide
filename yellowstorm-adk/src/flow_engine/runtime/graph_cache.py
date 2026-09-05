from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Awaitable, Callable


@dataclass
class GraphCacheEntry:
    graph: Any
    created_at: float
    last_accessed_at: float
    snapshot_size_bytes: int


RUNTIME_AGENT_PARAM_KEYS = {"session_id"}


def _normalize_snapshot_value(value: Any) -> Any:
    if isinstance(value, list):
        return [_normalize_snapshot_value(item) for item in value]
    if not isinstance(value, dict):
        return value

    normalized: dict[str, Any] = {}
    for key, item in value.items():
        if key == "agent_params" and isinstance(item, dict):
            normalized[key] = {
                nested_key: _normalize_snapshot_value(nested_value)
                for nested_key, nested_value in item.items()
                if nested_key not in RUNTIME_AGENT_PARAM_KEYS
            }
            continue
        normalized[key] = _normalize_snapshot_value(item)
    return normalized


def stable_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")


def snapshot_hash(snapshot: dict[str, Any]) -> str:
    normalized_snapshot = _normalize_snapshot_value(snapshot)
    return hashlib.sha256(stable_json(normalized_snapshot)).hexdigest()


class CompiledGraphCache:
    def __init__(self, max_entries: int = 128, ttl_seconds: int = 900) -> None:
        self.max_entries = max_entries
        self.ttl_seconds = ttl_seconds
        self._entries: OrderedDict[str, GraphCacheEntry] = OrderedDict()
        self._locks: dict[str, asyncio.Lock] = {}
        self.hits = 0
        self.misses = 0

    @property
    def size(self) -> int:
        return len(self._entries)

    def reconfigure(self, *, max_entries: int, ttl_seconds: int) -> None:
        max_entries = max(1, int(max_entries))
        ttl_seconds = max(1, int(ttl_seconds))
        if max_entries == self.max_entries and ttl_seconds == self.ttl_seconds:
            return
        self.max_entries = max_entries
        self.ttl_seconds = ttl_seconds
        self._entries.clear()
        self._locks.clear()

    def clear(self) -> None:
        self._entries.clear()
        self._locks.clear()

    async def get_or_compile(
        self,
        snapshot: dict[str, Any],
        compile_fn: Callable[[dict[str, Any]], Awaitable[Any] | Any],
        *,
        cache_scope: str | None = None,
    ) -> tuple[Any, str, bool]:
        snapshot_key = snapshot_hash(snapshot)
        key = f"{cache_scope}:{snapshot_key}" if cache_scope else snapshot_key
        now = time.monotonic()
        cached_entry = self._entries.get(key)
        if cached_entry and now - cached_entry.created_at <= self.ttl_seconds:
            self.hits += 1
            cached_entry.last_accessed_at = now
            self._entries.move_to_end(key)
            return cached_entry.graph, snapshot_key, True

        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            now = time.monotonic()
            cached_entry = self._entries.get(key)
            if cached_entry and now - cached_entry.created_at <= self.ttl_seconds:
                self.hits += 1
                cached_entry.last_accessed_at = now
                self._entries.move_to_end(key)
                return cached_entry.graph, snapshot_key, True

            self.misses += 1
            compile_snapshot = copy.deepcopy(snapshot)
            graph = compile_fn(compile_snapshot)
            if asyncio.iscoroutine(graph):
                graph = await graph

            self._entries[key] = GraphCacheEntry(
                graph=graph,
                created_at=now,
                last_accessed_at=now,
                snapshot_size_bytes=len(stable_json(snapshot)),
            )
            self._entries.move_to_end(key)
            self._evict(now)
            return graph, snapshot_key, False

    def _evict(self, now: float) -> None:
        expired_keys = [
            key for key, entry in self._entries.items()
            if now - entry.created_at > self.ttl_seconds
        ]
        for key in expired_keys:
            self._entries.pop(key, None)
            self._locks.pop(key, None)

        while len(self._entries) > self.max_entries:
            oldest_key, _ = self._entries.popitem(last=False)
            self._locks.pop(oldest_key, None)
