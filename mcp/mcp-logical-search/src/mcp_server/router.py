"""
FastAPI router for MCP Server endpoints.

Provides HTTP/SSE transport for the Logical Indexing MCP server.
"""

import asyncio
import time
from contextlib import asynccontextmanager
from typing import Annotated, Literal

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.openapi.utils import get_openapi
from pydantic import BaseModel, Field, field_validator, model_validator
from starlette.responses import JSONResponse
from starlette.requests import Request
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy import text

from src.mcp_server.logical_indexing_server import (
    mcp,
    set_requested_workspace_ids,
    clear_requested_workspace_ids,
    set_request_mistral,
    clear_request_mistral,
    search_documents_grouped,
    search_native,
    _get_effective_workspace_ids,
    AuthorizationScopeError,
)
from src.mcp_server.http_security import APIKeyAuthMiddleware, RequestBodyLimitMiddleware
from src.config.settings import get_settings
from src.db.session import dispose_engines, get_engine, run_sync_db, validate_database_transport
from src.modules.model_security import validate_model_endpoint
from src.mcp_server.db_helpers import get_document_summary_outline
from src.logger.logging import get_logger
from src.modules.document_resume import (
    DocumentNotFoundError,
    EmptyTableOfContentsError,
    _load_document_source,
    generate_document_routing_profile,
)
from src.modules.embeddings import close_embeddings
from src.modules.query_translation import close_translation_client
from src.modules.language import initialize_language_model
from src.modules import operations

logger = get_logger("vectorstores-api.mcp.router")
_shutdown_tasks = set()


async def shutdown_resources(grace_seconds):
    operations.stop_admission()

    async def close_after_drain():
        await operations.drain()
        try:
            await close_translation_client()
        finally:
            close_embeddings()
            await dispose_engines()

    if await operations.drain(timeout=grace_seconds):
        await close_after_drain()
    else:
        # Threads cannot safely be killed. Keep their resources alive until done.
        logger.warning("Shutdown grace expired; deferring resource closure until workers finish")
        task = asyncio.create_task(close_after_drain())
        _shutdown_tasks.add(task)
        task.add_done_callback(_shutdown_tasks.discard)
settings = get_settings()
BoundedStringList = Annotated[
    list[str],
    Field(min_length=1, max_length=settings.REQUEST_COLLECTION_MAX_ITEMS),
]


def _authorize_http_workspaces(value):
    requested = [value] if isinstance(value, str) else value or []
    try:
        allowed = _get_effective_workspace_ids()
    except AuthorizationScopeError:
        raise HTTPException(status_code=403, detail="Workspace authorization is required") from None
    if not requested or set(requested) - set(allowed):
        raise HTTPException(status_code=403, detail="Workspace is not authorized")


def _validate_scope_lengths(value):
    values = [value] if isinstance(value, str) else value or []
    if any(len(item) > settings.HTTP_SCOPE_MAX_CHARS for item in values):
        raise ValueError("Workspace/file value exceeds the configured length limit")
    return value


class SearchDocumentsRequest(BaseModel):
    query: str = Field(
        min_length=1,
        max_length=settings.REQUEST_QUERY_MAX_CHARS,
        description="Query used for hybrid semantic and keyword search.",
    )
    file_names: BoundedStringList = Field(
        description="Unique indexed file names to search within.",
    )
    debug: bool = Field(
        default=False,
        description=(
            "When true, return document scores and matched block details "
            "instead of only file names."
        ),
    )
    behavior: Literal["best_matches", "coverage"] = Field(
        default="best_matches",
        description=(
            "best_matches ranks the strongest documents; coverage evaluates a "
            "bounded set of documents individually and reports coverage status."
        ),
    )

    @field_validator("query")
    @classmethod
    def validate_query(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("query must be a non-empty string")
        return value

    @field_validator("file_names")
    @classmethod
    def validate_file_names(cls, values: list[str]) -> list[str]:
        _validate_scope_lengths(values)
        normalized = []
        for value in values:
            if not isinstance(value, str) or not value.strip():
                raise ValueError("file_names must contain only non-empty strings")
            stripped = value.strip()
            if stripped not in normalized:
                normalized.append(stripped)
        return normalized


class SearchDocumentCandidate(BaseModel):
    document_id: str
    file_name: str
    workspace_id: str
    score: float = Field(
        description="Ranking-quality heuristic; not a probability of correctness."
    )
    rank: int


class SearchDocumentRef(BaseModel):
    document_id: str
    file_name: str
    workspace_id: str


class SearchDocumentsResponse(BaseModel):
    query: str
    documents: list[SearchDocumentCandidate]
    total: int
    debug: list[dict] | None = None
    behavior: Literal["best_matches", "coverage"] = "best_matches"
    evaluated_documents: list[SearchDocumentRef] | None = None
    no_hit_documents: list[SearchDocumentRef] | None = None
    not_evaluated_documents: list[SearchDocumentRef] | None = None


class SearchNativeRequest(BaseModel):
    query: str = Field(
        min_length=1,
        max_length=settings.REQUEST_QUERY_MAX_CHARS,
        description="Required non-empty search query.",
    )
    workspace_id: str | BoundedStringList = Field(
        description="Workspace name or list of workspace names to search.",
    )
    file_name: str | BoundedStringList | None = Field(
        default=None,
        description="Optional file name or list of file names to search within.",
    )

    @field_validator("query")
    @classmethod
    def validate_query(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("query must be a non-empty string")
        return value

    @field_validator("workspace_id")
    @classmethod
    def validate_workspace_id(cls, value: str | list[str]) -> str | list[str]:
        _validate_scope_lengths(value)
        if isinstance(value, str):
            value = value.strip()
            if not value:
                raise ValueError("workspace_id must be a non-empty string")
            return value
        normalized = [item.strip() for item in value if isinstance(item, str) and item.strip()]
        if len(normalized) != len(value) or not normalized:
            raise ValueError("workspace_id must contain only non-empty strings")
        return list(dict.fromkeys(normalized))

    @field_validator("file_name")
    @classmethod
    def validate_file_name(cls, value: str | list[str] | None) -> str | list[str] | None:
        _validate_scope_lengths(value)
        if value is None:
            return None
        if isinstance(value, str):
            value = value.strip()
            if not value:
                raise ValueError("file_name must be a non-empty string")
            return value
        normalized = [item.strip() for item in value if isinstance(item, str) and item.strip()]
        if len(normalized) != len(value) or not normalized:
            raise ValueError("file_name must contain only non-empty strings")
        return list(dict.fromkeys(normalized))


class SearchNativeBatchItem(BaseModel):
    id: str = Field(min_length=1, description="Caller-provided correlation ID.")
    query: str = Field(
        min_length=1,
        max_length=settings.REQUEST_QUERY_MAX_CHARS,
        description="Required non-empty search query.",
    )
    workspace_id: str = Field(min_length=1, description="Workspace to search.")
    file_name: str = Field(min_length=1, description="File to search within.")

    @field_validator("id", "query", "workspace_id", "file_name")
    @classmethod
    def validate_non_empty_string(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("value must be a non-empty string")
        return value

    @field_validator("id", "workspace_id", "file_name")
    @classmethod
    def validate_scope_length(cls, value):
        return _validate_scope_lengths(value)


class SearchNativeBatchRequest(BaseModel):
    requests: list[SearchNativeBatchItem] = Field(
        min_length=1,
        max_length=settings.REQUEST_BATCH_MAX_ITEMS,
    )

    @model_validator(mode="after")
    def validate_unique_ids(self):
        ids = [request.id for request in self.requests]
        if len(ids) != len(set(ids)):
            raise ValueError("request IDs must be unique")
        return self


class DocumentSummaryRequest(BaseModel):
    workspace_id: str | BoundedStringList
    file_name: str | BoundedStringList

    @field_validator("workspace_id", "file_name")
    @classmethod
    def validate_scope_values(cls, value: str | list[str]) -> str | list[str]:
        _validate_scope_lengths(value)
        if isinstance(value, str):
            value = value.strip()
            if not value:
                raise ValueError("value must be a non-empty string")
            return value
        normalized = [item.strip() for item in value if isinstance(item, str) and item.strip()]
        if len(normalized) != len(value):
            raise ValueError("list must contain only non-empty strings")
        return list(dict.fromkeys(normalized))

    @model_validator(mode="after")
    def validate_total_pairs(self):
        workspaces = self.workspace_id if isinstance(self.workspace_id, list) else [self.workspace_id]
        files = self.file_name if isinstance(self.file_name, list) else [self.file_name]
        if len(workspaces) * len(files) > settings.HTTP_SUMMARY_MAX_PAIRS:
            raise ValueError("Too many workspace/file pairs")
        return self


def _is_truthy_header(value: str) -> bool:
    return value.lower().strip() in ("true", "1", "yes")


def _filter_tools_for_request(tools, request: Request = None):
    if request is None:
        mistral_on = False
    else:
        mistral_on = _is_truthy_header(request.headers.get("Mistral") or request.headers.get("X-Mistral") or "")
    hidden_citation_tool = "locate_answer_citations" if mistral_on else "locate_answer_citations_mistral"
    return {
        name: tool
        for name, tool in tools.items()
        if name != hidden_citation_tool
    }


async def create_mcp_info_response(request: Request = None):
    """Return information about available MCP tools."""
    tools = _filter_tools_for_request(await mcp.get_tools(), request)
    resources = await mcp.get_resources()
    resource_templates = await mcp.get_resource_templates()
    return {
        "name": mcp.name,
        "tools_count": len(tools),
        "resources_count": len(resources) + len(resource_templates),
        "tools": [
            {
                "name": t.name,
                "description": (t.description[:100] + "...") if t.description and len(t.description) > 100 else t.description
            }
            for t in tools.values()
        ],
        "resources": [
            {
                "uri": str(r.uri),
                "name": r.name
            }
            for r in resources.values()
        ],
        "resource_templates": [
            {
                "uri_template": str(r.uri_template),
                "name": r.name
            }
            for r in resource_templates.values()
        ],
    }


# Create the router for MCP-related HTTP endpoints
router = APIRouter(prefix="/mcp", tags=["MCP"])


@router.get("/")
async def mcp_info(request: Request):
    """
    Get information about the MCP server including available tools and resources.

    Returns:
        JSON with MCP server info, tools list, and resources list
    """
    return await create_mcp_info_response(request)


@router.get("/tools")
async def list_tools(request: Request):
    """
    List all available MCP tools.

    Returns:
        JSON array of tool definitions
    """
    tools = _filter_tools_for_request(await mcp.get_tools(), request)
    return {
        "tools": [
            {
                "name": t.name,
                "description": t.description,
                "input_schema": t.parameters,
            }
            for t in tools.values()
        ]
    }


@router.get("/resources")
async def list_resources():
    """
    List all available MCP resources.

    Returns:
        JSON array of resource definitions
    """
    resources = await mcp.get_resources()
    resource_templates = await mcp.get_resource_templates()
    return {
        "resources": [
            {
                "uri": str(r.uri),
                "name": r.name,
                "description": getattr(r, 'description', None)
            }
            for r in resources.values()
        ],
        "resource_templates": [
            {
                "uri_template": str(r.uri_template),
                "name": r.name,
                "description": getattr(r, 'description', None)
            }
            for r in resource_templates.values()
        ],
    }


async def starlette_mcp_info(request: Request):
    return JSONResponse(await create_mcp_info_response(request))


async def starlette_liveness(request: Request):
    return JSONResponse({"status": "ok"})


async def starlette_readiness(request: Request):
    if not operations.accepting_requests():
        return JSONResponse({"status": "draining"}, status_code=503)
    state = request.app.state
    if not hasattr(state, "readiness_lock"):
        state.readiness_lock = asyncio.Lock()
        state.readiness_result = None
    async with state.readiness_lock:
        cached = state.readiness_result
        if cached and time.monotonic() < cached[0]:
            return JSONResponse({"status": cached[1]}, status_code=cached[2])
        status, code = "ready", 200
        async def probe():
            async with get_engine().connect() as connection:
                await connection.execute(text("SELECT 1"))
        try:
            await asyncio.wait_for(probe(), timeout=5)
        except Exception:
            logger.warning("Readiness database probe failed")
            status, code = "unavailable", 503
        state.readiness_result = (time.monotonic() + settings.HEALTH_READY_CACHE_SECONDS, status, code)
        return JSONResponse({"status": status}, status_code=code)


async def starlette_list_tools(request: Request):
    tools = _filter_tools_for_request(await mcp.get_tools(), request)
    return JSONResponse({
        "tools": [
            {
                "name": t.name,
                "description": t.description,
                "input_schema": t.parameters,
            }
            for t in tools.values()
        ]
    })


async def starlette_list_resources(request: Request):
    return JSONResponse(await list_resources())


async def starlette_document_ready(request: Request):
    """Lightweight readiness probe: report whether a document has usable sections.

    Consumers (deep-research ingestion) poll this before calling the heavy
    /routing-profile so they never hit the 422 race window.

    Query params: workspace_id, file_name (both required, non-empty).

    Returns 200 with {"exists": bool, "has_sections": bool, "ready": bool}.
    Only invalid inputs return 422; the endpoint never errors on missing docs.
    """
    import asyncio as _asyncio

    workspace_id = (request.query_params.get("workspace_id") or "").strip()
    file_name = (request.query_params.get("file_name") or "").strip()
    if not workspace_id or not file_name:
        return JSONResponse(
            {
                "error": "invalid_request",
                "detail": "workspace_id and file_name are required non-empty query params.",
            },
            status_code=422,
        )

    _authorize_http_workspaces(workspace_id)
    try:
        _validate_scope_lengths([workspace_id, file_name])
    except ValueError:
        return JSONResponse({"error": "invalid_request"}, status_code=422)

    try:
        source = await _asyncio.to_thread(_load_document_source, file_name, workspace_id)
    except DocumentNotFoundError:
        return JSONResponse({"exists": False, "has_sections": False, "ready": False})
    except EmptyTableOfContentsError:
        return JSONResponse({"exists": True, "has_sections": False, "ready": False})
    except Exception:
        logger.error("document-ready probe failed")
        return JSONResponse(
            {"error": "document_ready_probe_failed"},
            status_code=502,
        )

    sections = source.get("sections") if isinstance(source, dict) else None
    has_sections = isinstance(sections, list) and len(sections) > 0
    return JSONResponse(
        {"exists": True, "has_sections": has_sections, "ready": has_sections}
    )


async def starlette_routing_profile(request: Request):
    """Generate a grounded search profile from one document's section content."""
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(
            {"error": "invalid_json", "detail": "Request body must be valid JSON."},
            status_code=400,
        )

    if not isinstance(payload, dict):
        return JSONResponse(
            {"error": "invalid_request", "detail": "Request body must be a JSON object."},
            status_code=422,
        )

    workspace_id = payload.get("workspace_id")
    file_name = payload.get("file_name")
    if not isinstance(workspace_id, str) or not workspace_id.strip():
        return JSONResponse(
            {
                "error": "invalid_request",
                "detail": "workspace_id must be one non-empty string; lists are not accepted.",
            },
            status_code=422,
        )
    if not isinstance(file_name, str) or not file_name.strip():
        return JSONResponse(
            {
                "error": "invalid_request",
                "detail": "file_name must be one non-empty string; lists are not accepted.",
            },
            status_code=422,
        )

    workspace_id = workspace_id.strip()
    file_name = file_name.strip()
    _authorize_http_workspaces(workspace_id)
    try:
        _validate_scope_lengths([workspace_id, file_name])
    except ValueError:
        return JSONResponse({"error": "invalid_request"}, status_code=422)
    try:
        routing_profile = await asyncio.wait_for(generate_document_routing_profile(
            file_name=file_name,
            workspace_id=workspace_id,
        ), timeout=settings.ROUTING_PROFILE_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        return JSONResponse({"error": "document_routing_profile_timeout"}, status_code=504)
    except operations.CapacityExceededError:
        return JSONResponse({"error": "service_busy"}, status_code=503, headers={"Retry-After": "1"})
    except DocumentNotFoundError as exc:
        return JSONResponse(
            {"error": "document_not_found", "detail": str(exc)},
            status_code=404,
        )
    except EmptyTableOfContentsError as exc:
        return JSONResponse(
            {"error": "invalid_request", "detail": str(exc)},
            status_code=422,
        )
    except Exception:
        logger.error("Standalone document routing-profile generation failed")
        return JSONResponse(
            {"error": "document_routing_profile_failed"},
            status_code=502,
        )

    return JSONResponse(routing_profile)


async def starlette_summarize(payload: DocumentSummaryRequest):
    """Return the stored section outline for one or more documents."""
    _authorize_http_workspaces(payload.workspace_id)
    workspace_ids = (
        payload.workspace_id if isinstance(payload.workspace_id, list)
        else [payload.workspace_id]
    )
    file_names = payload.file_name if isinstance(payload.file_name, list) else [payload.file_name]
    is_batched = isinstance(payload.workspace_id, list) or isinstance(payload.file_name, list)

    def retrieve(session):
        results = []
        for workspace_id in workspace_ids:
            for file_name in file_names:
                outline = get_document_summary_outline(
                    session,
                    file_name,
                    workspace_id=workspace_id,
                )
                result = (
                    {"table_of_contents": outline["table_of_contents"]}
                    if outline else {"error": "Document not found"}
                )
                if is_batched:
                    result.update({"workspace_id": workspace_id, "file_name": file_name})
                results.append(result)
        return results

    try:
        results = await run_sync_db(retrieve)
    except Exception:
        logger.error("Standalone document summary failed")
        return JSONResponse({"error": "document_summary_failed"}, status_code=502)
    return JSONResponse(results if is_batched else results[0])


async def starlette_search_documents(
    payload: SearchDocumentsRequest,
):
    """Return a ranked document-candidate envelope for the requested query."""
    try:
        search_arguments = dict(
            query=payload.query,
            file_names=payload.file_names,
            debug=payload.debug,
        )
        if payload.behavior != "best_matches":
            search_arguments["behavior"] = payload.behavior
        result = await search_documents_grouped(**search_arguments)
    except ValueError as exc:
        return JSONResponse(
            {"error": "invalid_request", "detail": str(exc)},
            status_code=422,
        )
    except operations.CapacityExceededError:
        return JSONResponse({"error": "service_busy", "retryable": True},
                            status_code=503, headers={"Retry-After": "1"})
    except Exception:
        logger.error("Standalone document search failed")
        return JSONResponse(
            {"error": "document_search_failed"},
            status_code=502,
        )

    coverage = result if isinstance(result, dict) else None
    documents = coverage["documents"] if coverage is not None else result
    ranked_documents = [
        {
            "document_id": document["document_id"],
            "file_name": document["file_name"],
            "workspace_id": document["workspace_id"],
            "score": document["score"],
            "rank": rank,
        }
        for rank, document in enumerate(documents, start=1)
    ]
    response = {
        "query": payload.query,
        "behavior": payload.behavior,
        "documents": ranked_documents,
        "total": len(ranked_documents),
        "debug": documents if payload.debug else None,
    }
    if coverage is not None:
        response.update({
            "evaluated_documents": coverage["evaluated_documents"],
            "no_hit_documents": coverage["no_hit_documents"],
            "not_evaluated_documents": coverage["not_evaluated_documents"],
        })
    return JSONResponse(response)


async def starlette_search_native(payload: SearchNativeRequest):
    """Return full matching section content using the native hybrid search."""
    _authorize_http_workspaces(payload.workspace_id)
    try:
        results = await search_native(
            query=payload.query,
            workspace_id=payload.workspace_id,
            file_name=payload.file_name,
        )
    except ValueError as exc:
        return JSONResponse(
            {"error": "invalid_request", "detail": str(exc)},
            status_code=422,
        )
    except operations.CapacityExceededError:
        return JSONResponse({"error": "service_busy", "retryable": True},
                            status_code=503, headers={"Retry-After": "1"})
    except Exception:
        logger.error("Standalone native search failed")
        return JSONResponse(
            {"error": "native_search_failed"},
            status_code=502,
        )
    return JSONResponse(results)


async def starlette_search_native_batch(payload: SearchNativeBatchRequest):
    """Run up to ten independent native searches and correlate them by ID."""

    _authorize_http_workspaces([item.workspace_id for item in payload.requests])

    async def run_one(item: SearchNativeBatchItem) -> dict:
        try:
            results = await search_native(
                query=item.query,
                workspace_id=item.workspace_id,
                file_name=item.file_name,
            )
            projected_results = [
                {
                    key: result.get(key)
                    for key in (
                        "content", "file_name", "page_range",
                        "workspace_id", "section_id",
                    )
                }
                for result in results
            ]
            return {"id": item.id, "result": projected_results}
        except operations.CapacityExceededError:
            return {"id": item.id, "error": {"message": "Service capacity is busy", "retryable": True}}
        except Exception:
            logger.error("Native batch search failed")
            return {"id": item.id, "error": {"message": "Search failed"}}

    results = await asyncio.gather(*(run_one(item) for item in payload.requests))
    return JSONResponse({"results": results})


class MCPWorkspaceIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        token = set_requested_workspace_ids(request.headers.getlist("Workspace-Id"))
        try:
            return await call_next(request)
        finally:
            clear_requested_workspace_ids(token)


class MCPMistralMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        header_val = (request.headers.get("Mistral") or request.headers.get("X-Mistral") or "").lower().strip()
        token = set_request_mistral(header_val in ("true", "1", "yes"))
        try:
            return await call_next(request)
        finally:
            clear_request_mistral(token)


def create_mcp_starlette_app() -> FastAPI:
    """
    Create a FastAPI app that combines documented HTTP endpoints with MCP transport.

    The historical function name is retained for caller compatibility.

    Returns:
        FastAPI application with HTTP and MCP endpoints
    """
    settings = get_settings()
    mcp_app = mcp.http_app(path="/")

    @asynccontextmanager
    async def lifespan(app):
        try:
            validate_database_transport()
            if settings.LITELLM_BASE_URL or settings.LITELLM_API_KEY:
                if not settings.LITELLM_BASE_URL or not settings.LITELLM_API_KEY:
                    raise RuntimeError("Configure both LITELLM_BASE_URL and LITELLM_API_KEY")
                validate_model_endpoint(settings)
            operations.start_admission()
            initialize_language_model(settings.LANGUAGE_MODEL_PATH)
            async with mcp_app.lifespan(app):
                yield
        finally:
            await shutdown_resources(settings.SHUTDOWN_GRACE_SECONDS)

    app = FastAPI(
        title="Logical Indexing MCP Server",
        description="HTTP endpoints exposed by the Logical Indexing MCP server.",
        version="1.0.0",
        docs_url="/docs",
        openapi_url="/openapi.json",
        redoc_url=None,
        middleware=[
            Middleware(RequestBodyLimitMiddleware),
            Middleware(
                APIKeyAuthMiddleware,
                api_key=settings.MCP_API_KEY,
            ),
            Middleware(MCPWorkspaceIdMiddleware),
            Middleware(MCPMistralMiddleware),
        ],
        lifespan=lifespan,
    )

    app.add_api_route(
        "/health/live",
        starlette_liveness,
        methods=["GET"],
        include_in_schema=False,
    )
    app.add_api_route(
        "/health/ready",
        starlette_readiness,
        methods=["GET"],
        include_in_schema=False,
    )
    app.add_api_route(
        "/",
        starlette_mcp_info,
        methods=["GET"],
        summary="Get MCP server information",
        tags=["Server"],
    )
    app.add_api_route(
        "/tools",
        starlette_list_tools,
        methods=["GET"],
        summary="List available MCP tools",
        tags=["Server"],
    )
    app.add_api_route(
        "/resources",
        starlette_list_resources,
        methods=["GET"],
        summary="List available MCP resources",
        tags=["Server"],
    )
    app.add_api_route(
        "/routing-profile",
        starlette_routing_profile,
        methods=["POST"],
        summary="Generate a document routing profile",
        tags=["Documents"],
        openapi_extra={
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {
                            "type": "object",
                            "required": ["workspace_id", "file_name"],
                            "properties": {
                                "workspace_id": {"type": "string"},
                                "file_name": {"type": "string"},
                            },
                        }
                    }
                },
            }
        },
    )
    app.add_api_route(
        "/summarize",
        starlette_summarize,
        methods=["POST"],
        summary="Return a document summary outline",
        tags=["Documents"],
    )
    app.add_api_route(
        "/search_documents",
        starlette_search_documents,
        methods=["POST"],
        response_model=SearchDocumentsResponse,
        summary="Search indexed documents",
        description=(
            "Embeds the query, runs hybrid block retrieval (including indexed "
            "image descriptions), and groups ranked matches by canonical document "
            "ID. Search scope is the requested file_names across indexed workspaces. "
            "best_matches returns ranked candidates; coverage evaluates a bounded "
            "set per document and reports no-hit and not-evaluated documents."
        ),
        tags=["Documents"],
    )
    app.add_api_route(
        "/search_native",
        starlette_search_native,
        methods=["POST"],
        response_model=list[dict],
        summary="Search section content directly",
        description=(
            "Runs the native hybrid section and block search and returns the full "
            "concatenated content of each matching section. Search scope is taken "
            "from workspace_id in the request body."
        ),
        tags=["Documents"],
    )
    app.add_api_route(
        "/search_native/batch",
        starlette_search_native_batch,
        methods=["POST"],
        response_model=dict,
        summary="Run a batch of native section searches",
        description=(
            "Runs between one and ten independent native searches. Each input "
            "ID appears exactly once in either a result or error entry."
        ),
        tags=["Documents"],
    )
    app.mount("/sse", mcp_app)
    app.mount("/http", mcp_app)

    def custom_openapi():
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(
            title=app.title,
            version=app.version,
            description=app.description,
            routes=app.routes,
        )
        schema.setdefault("components", {}).setdefault("securitySchemes", {})[
            "BearerAuth"
        ] = {
            "type": "http",
            "scheme": "bearer",
            "description": "Enter the configured MCP_API_KEY.",
        }
        schema["security"] = [{"BearerAuth": []}]
        app.openapi_schema = schema
        return app.openapi_schema

    app.openapi = custom_openapi

    return app


# Create the standalone MCP app that can be mounted
mcp_starlette_app = create_mcp_starlette_app()
