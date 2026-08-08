from __future__ import annotations

from typing import Any, Callable


def emit_dynamic_event(writer: Callable[[dict[str, Any]], None], event_type: str, node_id: str, iteration: int, payload: dict[str, Any]) -> None:
    writer({"type": event_type, "node_id": node_id, "iteration": iteration, "payload": payload})
