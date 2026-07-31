import hashlib
import re


def build_connector_tool_name(connector_slug: str, action_key: str) -> str:
    candidate = f"{connector_slug}_{action_key}"
    sanitized = re.sub(r"[^A-Za-z0-9_-]+", "_", candidate)
    if sanitized == candidate and len(sanitized) <= 64:
        return sanitized

    suffix = hashlib.sha256(candidate.encode("utf-8")).hexdigest()[:16]
    return f"{sanitized[:47]}_{suffix}"
