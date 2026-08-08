from typing import Any


def adapt_canonical_playbook(value: dict[str, Any]) -> dict[str, Any]:
    """Return a neutral graph envelope for the shared validation service."""
    return {"nodes": value.get("nodes", []), "edges": value.get("control_edges", value.get("controlEdges", []))}
