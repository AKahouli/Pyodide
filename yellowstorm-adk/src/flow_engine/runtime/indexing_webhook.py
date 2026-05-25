"""Shared registry for indexing webhook completions."""

from __future__ import annotations

import asyncio
from typing import Any, Dict, Optional

_pending_indexing: Dict[str, "asyncio.Future[Dict[str, Any]]"] = {}


def register_indexing_future(doc_id: str) -> "asyncio.Future[Dict[str, Any]]":
    future: asyncio.Future[Dict[str, Any]] = asyncio.get_running_loop().create_future()
    _pending_indexing[doc_id] = future
    return future


def pop_indexing_future(doc_id: str) -> Optional["asyncio.Future[Dict[str, Any]]"]:
    return _pending_indexing.pop(doc_id, None)


def resolve_indexing_webhook(doc_id: str, status: str, payload: Dict[str, Any]) -> bool:
    future = pop_indexing_future(doc_id)
    if future is None or future.done():
        return False
    future.set_result({"status": status, "payload": payload})
    return True
