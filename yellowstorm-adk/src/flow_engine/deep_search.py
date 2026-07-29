"""Relevant-document pre-filter for playbook deep-search execution."""

from __future__ import annotations

from typing import Any, Iterable

import httpx
import structlog

from src.config.settings import get_settings


logger = structlog.get_logger(__name__)


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


def _unwrap_response(payload: dict[str, Any]) -> dict[str, Any]:
    """Unwrap common API response envelopes without discarding routing metadata."""
    current = payload
    for _ in range(3):
        files = current.get("files")
        if (
            isinstance(files, list)
            or (
                isinstance(files, dict)
                and any(isinstance(files.get(group), list) for group in ("required", "optional"))
            )
            or any(isinstance(current.get(key), list) for key in ("results", "documents"))
        ):
            return current
        nested = next(
            (
                current.get(key)
                for key in ("data", "result", "response")
                if isinstance(current.get(key), dict)
            ),
            None,
        )
        if nested is None:
            return current
        current = nested
    return current


def normalize_response(payload: Any) -> dict[str, Any]:
    """Validate the routing response while preserving its LLM guidance."""
    if not isinstance(payload, dict):
        raise ValueError("Deep search response must be a JSON object")

    response = _unwrap_response(payload)
    # Support both the routing API's ``files`` and the semantic-search API's
    # historical ``results``/``documents`` names during rolling deployments.
    raw_files = response.get("files")
    grouped_files = isinstance(raw_files, dict)
    item_key = "files" if grouped_files or isinstance(raw_files, list) else next(
        (
            key
            for key in ("results", "documents")
            if isinstance(response.get(key), list)
        ),
        "",
    )
    if grouped_files:
        raw_groups = {
            group: raw_files.get(group, [])
            for group in ("required", "optional")
        }
        if not all(isinstance(items, list) for items in raw_groups.values()):
            raw_groups = {}
    else:
        raw_items = response.get(item_key) if item_key else None
        raw_groups = {"all": raw_items} if isinstance(raw_items, list) else {}

    if not raw_groups:
        top_level_keys = sorted(str(key) for key in payload)
        response_keys = sorted(str(key) for key in response)
        raise ValueError(
            "Deep search response is missing a files/results list "
            f"(top_level_keys={top_level_keys}, response_keys={response_keys})"
        )

    normalized_groups: dict[str, list[dict[str, Any]]] = {
        group: [] for group in raw_groups
    }
    seen: set[str] = set()
    for group, raw_items in raw_groups.items():
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
            normalized_groups[group].append(normalized_item)

    normalized = dict(response)
    if grouped_files:
        # Preserve required/optional routing guidance for the LLM.
        normalized["files"] = normalized_groups
    else:
        normalized_items = normalized_groups["all"]
        # Expose one stable key to callers of historical flat responses.
        normalized["files"] = normalized_items
        if item_key != "files":
            normalized[item_key] = normalized_items
    normalized["total_files"] = sum(len(items) for items in normalized_groups.values())
    return normalized


def routed_file_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Return all required and optional routed files in priority order."""
    files = payload.get("files")
    if isinstance(files, list):
        return [item for item in files if isinstance(item, dict)]
    if isinstance(files, dict):
        return [
            item
            for group in ("required", "optional")
            for item in files.get(group, [])
            if isinstance(item, dict)
        ]
    results = payload.get("results")
    return [item for item in results if isinstance(item, dict)] if isinstance(results, list) else []


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
    if not request_payload["query"]:
        raise RuntimeError("A query is required when deep search is enabled")

    timeout = float(getattr(settings, "DEEP_SEARCH_TIMEOUT_SECONDS", 30.0) or 30.0)
    logger.info(
        "deep_search_request",
        endpoint=f"{base_url.rstrip('/')}/api/query",
        query=request_payload["query"],
        workspace_id=resolved_workspace_id,
    )
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
            logger.info(
                "deep_search_response",
                status_code=getattr(response, "status_code", None),
                top_level_keys=sorted(str(key) for key in payload)
                if isinstance(payload, dict)
                else [],
                response_type=type(payload).__name__,
                workspace_id=resolved_workspace_id,
            )
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Deep search request failed: {exc}") from exc
    except ValueError as exc:
        raise RuntimeError("Deep search returned invalid JSON") from exc

    return normalize_response(payload)
