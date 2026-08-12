from __future__ import annotations

import hashlib
import json
from typing import Any


def _serialized(value: Any) -> str:
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)


def build_input_context_envelope(
    node_config: dict[str, Any],
    resolved_inputs: dict[str, Any],
) -> dict[str, Any]:
    declared = {
        str(port.get("id")): port
        for port in (node_config.get("input") or {}).get("ports", [])
        if isinstance(port, dict) and port.get("id")
    }
    ports: list[dict[str, Any]] = []
    for port_id in sorted(set(declared) | set(resolved_inputs)):
        descriptor = declared.get(port_id, {})
        value = resolved_inputs.get(port_id)
        missing = port_id not in resolved_inputs or value is None
        item_count = len(value) if isinstance(value, (list, dict)) else (0 if missing else 1)
        serialized = "" if missing else _serialized(value)
        ports.append({
            "portId": port_id,
            "name": str(descriptor.get("label") or port_id),
            "required": bool(descriptor.get("required", False)),
            "status": "missing" if missing else "resolved",
            "valueType": str(descriptor.get("type") or type(value).__name__),
            "itemCount": item_count,
            "estimatedTokens": 0 if missing else max(1, len(serialized) // 4),
            "summary": None if missing else f"{type(value).__name__} value with {item_count} item(s)",
            "samples": [],
            "valueFingerprint": None if missing else f"sha256:{hashlib.sha256(serialized.encode()).hexdigest()}",
        })
    canonical = json.dumps(ports, sort_keys=True, separators=(",", ":"), default=str)
    return {
        "ports": ports,
        "totalEstimatedTokens": sum(int(port["estimatedTokens"]) for port in ports),
        "itemCount": sum(int(port["itemCount"]) for port in ports),
        "sourceCount": len([port for port in ports if port["status"] == "resolved"]),
        "sourceKinds": sorted({str(port["valueType"]) for port in ports}),
        "contextFingerprint": f"sha256:{hashlib.sha256(canonical.encode()).hexdigest()}",
    }
