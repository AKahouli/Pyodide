"""Iteration-aware artifact routing.

Port from legacy artifact_routing.py — simplified for the new
iteration-keyed result model.
"""

from __future__ import annotations

from typing import Any


def route_artifact(
    node_id: str,
    iteration: int,
    artifact: dict[str, Any],
    port_id: str = "default",
) -> dict[str, Any]:
    return {
        "node_id": node_id,
        "iteration": iteration,
        "port_id": port_id,
        "artifact": artifact,
    }


def collect_artifacts(
    task_outputs: dict[tuple[str, int], Any],
    node_id: str,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for (nid, iteration), output in task_outputs.items():
        if nid == node_id:
            results.append({
                "iteration": iteration,
                "output": output,
            })
    results.sort(key=lambda r: r["iteration"])
    return results
