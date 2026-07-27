"""Relevant-document pre-filter for playbook deep-search execution."""

from __future__ import annotations

from typing import Any, Iterable

import httpx

from src.config.settings import get_settings


def merge_file_names(*groups: Iterable[str]) -> list[str]:
    """Merge filename groups case-insensitively while preserving their order."""
    merged: list[str] = []
    seen: set[str] = set()
    for group in groups:
        for raw_name in group:
            file_name = str(raw_name or "").strip()
            key = file_name.casefold()
            if not file_name or key in seen:
                continue
            seen.add(key)
            merged.append(file_name)
    return merged


def normalize_response(payload: Any) -> dict[str, Any]:
    """Validate the routing response while preserving its LLM guidance."""
    if not isinstance(payload, dict):
        raise ValueError("Deep search response must be a JSON object")

    # /api/query returns routing decisions under ``files``. Keep support for
    # the former ``results`` response so rolling deployments remain compatible.
    item_key = "files" if isinstance(payload.get("files"), list) else "results"
    raw_items = payload.get(item_key)
    if not isinstance(raw_items, list):
        raise ValueError("Deep search response is missing a files list")

    normalized_items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        file_name = str(item.get("file_name") or item.get("filename") or "").strip()
        key = file_name.casefold()
        if not file_name or key in seen:
            continue
        seen.add(key)
        normalized_item = dict(item)
        normalized_item["file_name"] = file_name
        normalized_items.append(normalized_item)

    normalized = dict(payload)
    normalized[item_key] = normalized_items
    normalized["total_files"] = len(normalized_items)
    return normalized


async def search_relevant_documents(
    query: str,
    workspace_id: str,
) -> dict[str, Any]:
    """Call the authenticated community-graph relevant-documents endpoint."""
    settings = get_settings()
    base_url = str(getattr(settings, "COMMUNITY_GRAPH_URL", None) or "").strip()
    api_key = str(getattr(settings, "API_KEY_COMMUNITY_GRAPH", None) or "").strip()
    if not base_url:
        raise RuntimeError("COMMUNITY_GRAPH_URL is required when deep search is enabled")
    if not api_key:
        raise RuntimeError("API_KEY_COMMUNITY_GRAPH is required when deep search is enabled")

    resolved_workspace_id = str(workspace_id or "").strip()
    if not resolved_workspace_id:
        raise RuntimeError("A workspace_id is required when deep search is enabled")

    request_payload = {
        "workspace_id": resolved_workspace_id,
        "query": str(query or "").strip(),
    }
    timeout = float(getattr(settings, "DEEP_SEARCH_TIMEOUT_SECONDS", 30.0) or 30.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                f"{base_url.rstrip('/')}/api/query",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=request_payload,
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Deep search request failed: {exc}") from exc
    except ValueError as exc:
        raise RuntimeError("Deep search returned invalid JSON") from exc

    return normalize_response(payload)
