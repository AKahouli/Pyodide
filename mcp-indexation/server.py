import asyncio
import json
import os
import sys
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastmcp import FastMCP, Context

load_dotenv()

mcp = FastMCP(
    "YellowStorm Indexation",
    instructions=(
        "Provides document indexing tools for YellowStorm workspaces. "
        "Use index_document to trigger indexing of an already-imported document "
        "and wait for completion. Use get_indexing_status to check current status."
    ),
)

BACKEND_URL = os.getenv("PLATFORM_API_URL", "").rstrip("/")
INTERNAL_TOKEN = os.getenv("INTERNAL_SERVICE_SECRET", "")
DEFAULT_TIMEOUT = int(os.getenv("INDEXING_TIMEOUT_SECONDS", "600"))
POLL_INTERVAL = int(os.getenv("INDEXING_POLL_INTERVAL_SECONDS", "5"))


def _headers() -> dict[str, str]:
    return {
        "X-Internal-Token": INTERNAL_TOKEN,
        "Content-Type": "application/json",
    }


async def _poll_until_done(
    client: httpx.AsyncClient,
    workspace_id: str,
    doc_id: str,
    ctx: Context,
    timeout: int,
    poll_interval: int,
) -> dict:
    elapsed = 0
    while elapsed < timeout:
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval

        status_url = (
            f"{BACKEND_URL}/internal/workspaces/{workspace_id}"
            f"/documents/{doc_id}/index-status"
        )
        resp = await client.get(status_url, headers=_headers())
        if resp.status_code != 200:
            await ctx.warning(f"Status poll returned HTTP {resp.status_code}")
            continue

        data = resp.json()
        status = data.get("indexingStatus", "unknown")
        await ctx.info(f"Indexing status: {status} ({elapsed}s elapsed)")

        if status in ("ready", "failed"):
            return data

        progress = min(int((elapsed / timeout) * 100), 99)
        await ctx.report_progress(progress=progress, total=100)

    return {
        "documentId": doc_id,
        "indexingStatus": "timeout",
        "indexingError": f"Indexing did not complete within {timeout}s",
    }


@mcp.tool()
async def index_document(
    workspace_id: str,
    document_id: str,
    timeout: Optional[int] = None,
    ctx: Context = None,
) -> str:
    """Index a document in a workspace and wait for completion.

    Triggers re-indexing of an already-imported document, then polls until
    the indexing reaches 'ready' or 'failed' status. This is a blocking call
    designed for playbook steps that need the document indexed before continuing.

    Args:
        workspace_id: The workspace ID containing the document.
        document_id: The document ID to index.
        timeout: Maximum seconds to wait for indexing completion (default: 600).
    """
    if not BACKEND_URL:
        return json.dumps({"status": "error", "message": "PLATFORM_API_URL is not configured"})
    if not INTERNAL_TOKEN:
        return json.dumps({"status": "error", "message": "INTERNAL_SERVICE_SECRET is not configured"})

    max_wait = timeout or DEFAULT_TIMEOUT
    await ctx.info(f"Triggering indexation for document {document_id} in workspace {workspace_id}")

    async with httpx.AsyncClient(timeout=30.0) as client:
        reindex_url = (
            f"{BACKEND_URL}/internal/workspaces/{workspace_id}"
            f"/documents/{document_id}/reindex"
        )
        resp = await client.post(reindex_url, headers=_headers())

        if resp.status_code == 404:
            return json.dumps({
                "status": "error",
                "message": "Document not found",
                "document_id": document_id,
            })

        if resp.status_code == 400:
            detail = resp.json()
            return json.dumps({
                "status": "error",
                "message": detail.get("message", "Document cannot be indexed"),
                "document_id": document_id,
            })

        if resp.status_code != 200:
            return json.dumps({
                "status": "error",
                "message": f"Unexpected HTTP {resp.status_code}: {resp.text}",
                "document_id": document_id,
            })

        trigger_data = resp.json()
        await ctx.info(f"Indexation triggered: {trigger_data.get('indexingStatus')}")

        if trigger_data.get("indexingStatus") in ("ready", "failed"):
            return json.dumps({
                "status": "success" if trigger_data["indexingStatus"] == "ready" else "error",
                "document_id": trigger_data.get("id", document_id),
                "indexing_status": trigger_data["indexingStatus"],
                "message": trigger_data.get("message", ""),
            })

        await ctx.report_progress(progress=5, total=100)
        result = await _poll_until_done(
            client, workspace_id, document_id, ctx, max_wait, POLL_INTERVAL
        )

    final_status = result.get("indexingStatus", "unknown")
    await ctx.report_progress(progress=100, total=100)

    return json.dumps({
        "status": "success" if final_status == "ready" else "error",
        "document_id": result.get("documentId", document_id),
        "indexing_status": final_status,
        "indexing_error": result.get("indexingError"),
        "last_indexed_at": result.get("lastIndexedAt"),
    })


@mcp.tool()
async def get_indexing_status(
    workspace_id: str,
    document_id: str,
) -> str:
    """Get the current indexing status of a document.

    Returns the indexing status without waiting for completion.
    Possible statuses: none, pending, processing, ready, failed.

    Args:
        workspace_id: The workspace ID containing the document.
        document_id: The document ID to check.
    """
    if not BACKEND_URL:
        return json.dumps({"status": "error", "message": "PLATFORM_API_URL is not configured"})
    if not INTERNAL_TOKEN:
        return json.dumps({"status": "error", "message": "INTERNAL_SERVICE_SECRET is not configured"})

    async with httpx.AsyncClient(timeout=15.0) as client:
        url = (
            f"{BACKEND_URL}/internal/workspaces/{workspace_id}"
            f"/documents/{document_id}/index-status"
        )
        resp = await client.get(url, headers=_headers())

        if resp.status_code == 404:
            return json.dumps({"status": "error", "message": "Document not found"})

        if resp.status_code != 200:
            return json.dumps({
                "status": "error",
                "message": f"HTTP {resp.status_code}: {resp.text}",
            })

        data = resp.json()
        return json.dumps({
            "status": "success",
            "document_id": data.get("documentId"),
            "indexing_status": data.get("indexingStatus"),
            "indexing_error": data.get("indexingError"),
            "last_indexed_at": data.get("lastIndexedAt"),
        })


@mcp.tool()
async def search_relevant_documents(
    query: str,
    workspace_name: str,
    top_k: int = 5,
) -> str:
    """Search for relevant documents using community-graph semantic search.

    Args:
        query: The search query string
        workspace_name: The workspace to search in
        top_k: Maximum number of results to return (default 5)

    Returns:
        JSON string with search results
    """
    import json as _json
    from community_graph_client import search as _cg_search

    loop = asyncio.get_running_loop()
    results = await loop.run_in_executor(
        None, _cg_search, query, workspace_name, top_k
    )
    return _json.dumps(results, ensure_ascii=False)


if __name__ == "__main__":
    transport = os.getenv("INDEXATION_MCP_TRANSPORT", "stdio")
    port = int(os.getenv("MCP_PORT", os.getenv("PORT", "8020")))

    print(
        f"Starting YellowStorm Indexation MCP server ({transport}) on port {port}",
        file=sys.stderr,
    )

    if transport in ("sse", "http", "streamable-http"):
        mcp.run(transport=transport, host="0.0.0.0", port=port)
    else:
        mcp.run(transport="stdio")
