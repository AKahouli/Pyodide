import json
from typing import Any


def build_agent_config(metadata: dict[str, Any]) -> dict[str, Any]:
    agent_params = metadata.get("agent_params") if isinstance(metadata.get("agent_params"), dict) else {}
    agent_tools = metadata.get("agent_tools") if isinstance(metadata.get("agent_tools"), list) else []
    agent_skills = metadata.get("skills") if isinstance(metadata.get("skills"), list) else []
    return {
        "name": str(metadata.get("agent_name") or ""),
        "type": str(metadata.get("agent_type") or metadata.get("type") or ""),
        "tools": [tool for tool in agent_tools if isinstance(tool, dict)],
        "skills": [skill for skill in agent_skills if isinstance(skill, dict)],
        "agent_params": agent_params,
        "brain_ids": [
            str(item.get("workspace_id"))
            for item in metadata.get("brain_context", [])
            if isinstance(item, dict) and item.get("workspace_id")
        ] if isinstance(metadata.get("brain_context"), list) else [],
    }


def parse_connector_bindings(metadata: dict[str, Any], agent_params: dict[str, Any]) -> list[dict[str, Any]]:
    bindings = metadata.get("connector_bindings")
    if isinstance(bindings, list):
        return [item for item in bindings if isinstance(item, dict)]
    raw = agent_params.get("connector_bindings_json")
    if not isinstance(raw, str) or not raw.strip():
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return [item for item in parsed if isinstance(item, dict)] if isinstance(parsed, list) else []
