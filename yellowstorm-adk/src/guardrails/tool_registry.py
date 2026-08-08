from typing import Any


NATIVE_TOOL_POLICIES: dict[str, dict[str, str]] = {
    "calculator": {"safety": "read", "kind": "native"},
    "perform_document_search": {"safety": "read", "kind": "retrieval"},
    "perform_filtered_search": {"safety": "read", "kind": "retrieval"},
    "perform_web_search": {"safety": "read", "kind": "external_read"},
    "python_interpreter": {"safety": "write", "kind": "execution"},
    "code_interpreter": {"safety": "write", "kind": "execution"},
    "save_file_to_workspace": {"safety": "write", "kind": "workspace_write"},
    "create_temporary_child_agent": {"safety": "internal", "kind": "orchestration"},
}


def tool_policy(tool_name: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"safety": "unknown", "kind": "unknown", **NATIVE_TOOL_POLICIES.get(tool_name, {}), **(metadata or {})}
