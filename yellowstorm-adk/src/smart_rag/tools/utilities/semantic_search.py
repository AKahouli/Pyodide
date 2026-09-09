from typing import Any

import math

import httpx


def create_semantic_search(runtime_context: dict[str, Any]):
    """Create a graph search tool bound to a server-authorized schema."""
    schema_name = str(runtime_context.get("semantic_model_schema_name") or "").strip()
    url = str(runtime_context.get("semantic_search_url") or "").strip()
    token = str(runtime_context.get("semantic_search_token") or "").strip()
    try:
        timeout_seconds = float(runtime_context.get("semantic_search_timeout_seconds", 300))
    except (TypeError, ValueError):
        timeout_seconds = 300.0
    if not math.isfinite(timeout_seconds):
        timeout_seconds = 300.0
    timeout_seconds = min(max(timeout_seconds, 1.0), 1800.0)
    if not schema_name or not url or not token:
        return None

    async def semantic_search(query: str) -> dict[str, Any]:
        """Search the selected semantic model for evidence related to the query."""
        normalized_query = query.strip()
        if not normalized_query:
            return {"error": "A non-empty semantic search query is required."}

        try:
            async with httpx.AsyncClient(timeout=timeout_seconds) as client:
                response = await client.post(
                    url,
                    headers={"Authorization": f"Bearer {token}"},
                    json={
                        "schema_name": schema_name,
                        "query": normalized_query,
                        "debug": False,
                        "include_supporting_data": True,
                    },
                )
                response.raise_for_status()
                result = response.json()
                return result if isinstance(result, dict) else {"results": result}
        except httpx.HTTPError as exc:
            return {"error": f"Semantic search request failed: {type(exc).__name__}"}
        except ValueError:
            return {"error": "Semantic search returned an invalid JSON response."}

    return semantic_search
