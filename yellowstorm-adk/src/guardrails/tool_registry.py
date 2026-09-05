from typing import Any


TOOL_SAFETY_VALUES = frozenset({"read", "write", "delete", "internal", "unknown"})


NATIVE_TOOL_POLICIES: dict[str, dict[str, str]] = {
    "calculator": {"safety": "read", "kind": "native"},
    "render_chart": {"safety": "internal", "kind": "visualization"},
    "present_choices": {"safety": "internal", "kind": "interaction"},
    "generate_web_preview": {"safety": "internal", "kind": "visualization"},
    "perform_document_search": {"safety": "read", "kind": "retrieval"},
    "perform_filtered_search": {"safety": "read", "kind": "retrieval"},
    "perform_web_search": {"safety": "read", "kind": "external_read"},
    "python_interpreter": {"safety": "write", "kind": "execution"},
    "code_interpreter": {"safety": "write", "kind": "execution"},
    "save_file_to_workspace": {"safety": "write", "kind": "workspace_write"},
    "run_code": {"safety": "write", "kind": "execution"},
    "create_temporary_child_agent": {"safety": "internal", "kind": "orchestration"},
}


def normalize_tool_safety(value: object) -> str:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in TOOL_SAFETY_VALUES else "unknown"


def tool_policy(tool_name: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    policy = {
        "safety": "unknown",
        "kind": "unknown",
        "source": "unknown",
        **NATIVE_TOOL_POLICIES.get(tool_name, {}),
        **(metadata or {}),
    }
    policy["safety"] = normalize_tool_safety(policy.get("safety"))
    policy["kind"] = str(policy.get("kind") or policy.get("tool_kind") or "unknown")
    source = str(policy.get("source") or "unknown")
    policy["source"] = "native" if source == "unknown" and tool_name in NATIVE_TOOL_POLICIES else source
    return policy
