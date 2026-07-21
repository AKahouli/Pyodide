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


def normalize_response(payload: Any, workspace_id: str) -> dict[str, Any]:
    """Validate and normalize a relevant-documents API response."""
    if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
        raise ValueError("Deep search response is missing a results list")

    response_workspace_id = str(payload.get("workspace_id") or workspace_id).strip()
    results: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in payload["results"]:
        if not isinstance(item, dict):
            continue
        file_name = str(item.get("file_name") or item.get("filename") or "").strip()
        key = file_name.casefold()
        if not file_name or key in seen:
            continue
        seen.add(key)
        try:
            hybrid_score = float(item.get("hybrid_score", 0.0))
        except (TypeError, ValueError):
            hybrid_score = 0.0
        results.append(
            {
                "description": str(item.get("description") or ""),
                "file_name": file_name,
                "hybrid_score": hybrid_score,
                "workspace_id": str(item.get("workspace_id") or response_workspace_id),
            }
        )
    return {
        "workspace_id": response_workspace_id,
        "total_results": len(results),
        "results": results,
    }


async def search_relevant_documents(
    query: str,
    workspace_id: str,
) -> dict[str, Any]:
    """Call the authenticated community-graph relevant-documents endpoint."""
    settings = get_settings()
    base_url = str(getattr(settings, "COMMUNITY_GRAPH_URL", None) or "").strip()
    api_key = str(getattr(settings, "MCP_API_KEY_DEEP_SEARCH", None) or "").strip()
    workspace_id = str(workspace_id or "").strip()
    if not base_url:
        raise RuntimeError("COMMUNITY_GRAPH_URL is required when deep search is enabled")
    if not api_key:
        raise RuntimeError("MCP_API_KEY_DEEP_SEARCH is required when deep search is enabled")
    if not workspace_id:
        raise ValueError("workspace_id is required when deep search is enabled")

    request_payload = {
        "query": str(query or "").strip(),
        "workspace_id": workspace_id,
    }
    timeout = float(getattr(settings, "DEEP_SEARCH_TIMEOUT_SECONDS", 30.0) or 30.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                f"{base_url.rstrip('/')}/relevant-documents/search",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Workspace-Id": workspace_id,
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

    return normalize_response(payload, workspace_id)
