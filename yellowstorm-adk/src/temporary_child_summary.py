"""Session-level summary tracking for temporary child-agent runs."""

from __future__ import annotations

import time
from collections import defaultdict
from typing import Any

_SUMMARIES: dict[str, list[dict[str, Any]]] = defaultdict(list)


def record_temporary_child_start(
    session_id: str,
    parent: str,
    child: str,
    task_description: str,
    expected_output: str = "",
    execution_mode: str = "sequential",
) -> None:
    _SUMMARIES[str(session_id)].append(
        {
            "parent": parent,
            "child": child,
            "task_description": task_description,
            "expected_output": expected_output,
            "execution_mode": execution_mode,
            "status": "running",
            "started_at": time.time(),
        }
    )


def record_temporary_child_result(
    session_id: str,
    child: str,
    result: Any,
    status: str = "completed",
) -> None:
    for item in reversed(_SUMMARIES.get(str(session_id), [])):
        if item.get("child") == child:
            item["status"] = status
            item["duration_ms"] = int((time.time() - item["started_at"]) * 1000)
            item["result_preview"] = str(result or "")[:500]
            return


def record_temporary_child_tool_call(
    session_id: str,
    child: str,
    tool_name: str,
    args: dict[str, Any],
    result_preview: str = "",
    status: str = "completed",
) -> None:
    for item in reversed(_SUMMARIES.get(str(session_id), [])):
        if item.get("child") == child:
            tool_calls = item.setdefault("tool_calls", [])
            tool_calls.append(
                {
                    "child": child,
                    "tool_name": tool_name,
                    "args": args,
                    "status": status,
                    "result_preview": result_preview[:500],
                }
            )
            return


def pop_temporary_child_summary(session_id: str) -> dict[str, Any]:
    items = _SUMMARIES.pop(str(session_id), [])
    return {
        "created_count": len(items),
        "execution_modes": sorted({str(item.get("execution_mode")) for item in items}),
        "children": items,
    }
