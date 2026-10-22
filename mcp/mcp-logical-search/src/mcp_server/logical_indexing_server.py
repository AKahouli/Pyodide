"""
FastMCP Server for Logical Indexing Access.

Tools:
- get_document_strategy: reading strategy for known files
- read_content: full document reader for small documents (strategy = "read_all")
- search: hybrid section + block search for targeted queries
- search_in_sections: focused evidence within selected sections
- read_sections: section blocks and images, with previews for long blocks
- read_blocks: content for one or more exact block IDs
- expand_context: neighboring sections for context expansion
"""

import asyncio
import base64
import json
import time
from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Optional, List, Dict, Any, Union, Literal, Annotated, NamedTuple

from fastmcp import FastMCP, settings as fastmcp_settings
from mcp.types import ImageContent
from openai import APIConnectionError, APITimeoutError, InternalServerError, RateLimitError
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, field_validator, model_validator
from sqlalchemy.exc import InternalError, OperationalError, TimeoutError as SQLAlchemyTimeoutError

from src.config.settings import get_settings
from src.db.session import get_db_session_sync, run_sync_db, check_db_deadline
from src.logger.file_request_logging import (
    current_tool_call_context,
    get_tool_file_logger,
    log_json_line,
    log_tool_call,
    request_logging_enabled,
)
from src.logger.logging import get_logger, McpErrorPrivacyFilter
from src.mcp_server.db_helpers import (
    get_document_by_internal_id,
    list_documents as db_list_documents,
    get_blocks_for_document,
    unified_search,
    get_block_contents_by_ids,
    get_sections_for_document,
    _source_value,
    _resolve_document_id,
    search_blocks_hybrid,
    read_section_with_blocks,
    read_sections_with_blocks,
    read_blocks_by_ids,
    expand_section_context,
    get_document_total_pages,
    read_full_document_content,
    locate_answer_citation_positions,
    locate_answer_citation_positions_mistral,
    get_scoped_document_fts_configs,
    get_scoped_document_refs,
    get_search_document_metadata,
    _document_fts_groups,
)
from src.modules.query_embeddings import get_query_embedding
from src.modules.embeddings import embedding_configured
from src.mcp_server.image_delivery import attach_evidence_images, image_evidence_targets
from src.modules import operations
from src.mcp_server.evidence import excerpt, group_evidence, remove_navigation_entry
from src.mcp_server.section_search import search_section_evidence
from src.mcp_server.filename_semantic import filename_semantic_scores
from src.mcp_server.filename_relevance import filename_relevance
from src.mcp_server.search_scope import SearchScope
from src.mcp_server.db_helpers import _apply_document_filters
from src.db.models import LogicalDocument
from sqlalchemy import select
from src.mcp_server.context_navigation import attach_search_ancestors, paginate_context
from src.modules.query_translation import build_fts_query_variants

settings = get_settings()
# Keep the existing registered component objects while upgrading FastMCP security.
fastmcp_settings.decorator_mode = "object"
logger = get_logger(__name__)
get_logger("fastmcp.server.server").addFilter(McpErrorPrivacyFilter())
RECOVERABLE_DATABASE_ERRORS = (OperationalError, InternalError, SQLAlchemyTimeoutError)
RECOVERABLE_EMBEDDING_ERRORS = (
    operations.CapacityExceededError,
    asyncio.TimeoutError,
    APIConnectionError,
    APITimeoutError,
    InternalServerError,
    RateLimitError,
)


class HybridSearchPreparation(NamedTuple):
    """Independent semantic and lexical inputs for one search pass."""

    query_embedding: Optional[List[float]]
    fts_query_variants: Optional[Dict[str, List[str]]]


@dataclass
class SearchContext:
    """Private metadata and filename scores for exactly one validated search scope."""
    documents: Optional[Union[SearchScope, Dict[str, Dict[str, Any]]]] = None
    filename_scores: Optional[Dict[str, float]] = None


async def _run_db(operation, deadline: Optional[float] = None):
    """Run a synchronous retrieval operation with a worker-owned session."""
    timeout = None if deadline is None else max(0.0, deadline - time.monotonic())
    if timeout is not None and timeout <= 0:
        raise asyncio.TimeoutError
    return await run_sync_db(operation, get_db_session_sync, timeout=timeout)


def _serialized_bytes(value: Any) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _check_read_deadline(deadline: float) -> None:
    if time.monotonic() >= deadline:
        raise asyncio.TimeoutError("Reader request deadline exhausted")


def _deduplicate_context_evidence(contexts):
    seen = {}
    for context_index, context in enumerate(contexts):
        for relation in ("ancestors", "descendants"):
            entries = []
            for section_index, section in enumerate(context.get(relation, [])):
                section_id = section.get("section_id")
                if section_id is not None and section_id in seen:
                    entries.append({"section_id": section_id, "shared_evidence": seen[section_id]})
                else:
                    entries.append(section)
                    if section_id is not None:
                        seen[section_id] = {"context_index": context_index,
                                            "relation": relation, "section_index": section_index}
            if relation in context:
                context[relation] = entries


async def _run_reader_db(operation, deadline: float):
    """Use the shared worker deadline for reader operations."""
    return await _run_db(operation, deadline=deadline)


def _apply_read_content_batch_budget(
    results: List[Dict[str, Any]],
    max_bytes: int,
) -> None:
    """Apply one content budget across the whole batch, at evidence-item boundaries."""
    remaining = max(0, max_bytes)
    for result in results:
        if "error" in result:
            continue

        original_pages = result.get("content") or []
        delivered_pages: List[Dict[str, Any]] = []
        delivered_bytes = 0
        total_bytes = 0
        omitted_blocks = 0
        omitted_images = 0
        omitted_evidence = []

        for original_page in original_pages:
            page = {
                "type": original_page.get("type", "page"),
                "page_number": original_page.get("page_number"),
                "blocks": [],
                "images": [],
            }
            for key in ("blocks", "images"):
                for item in original_page.get(key, []):
                    item_bytes = _serialized_bytes(item)
                    total_bytes += item_bytes
                    if item_bytes <= remaining:
                        page[key].append(item)
                        remaining -= item_bytes
                        delivered_bytes += item_bytes
                    elif key == "blocks":
                        omitted_blocks += 1
                        omitted_evidence.append({"block_id": item.get("block_id")})
                    else:
                        omitted_images += 1
                        omitted_evidence.append({
                            "image_id": item.get("image_id"), "section_id": item.get("section_id"),
                        })
            if page["blocks"] or page["images"]:
                delivered_pages.append(page)

        truncated = omitted_blocks > 0 or omitted_images > 0
        result["content"] = delivered_pages
        result["delivery"] = {
            "batch_byte_budget": max_bytes,
            "delivered_content_bytes": delivered_bytes,
            "total_content_bytes": total_bytes,
            "truncated": truncated,
            "omitted_blocks": omitted_blocks,
            "omitted_images": omitted_images,
        }
        pagination = result.get("pagination", {})
        has_more = pagination.get("has_more", False)
        result["truncated"] = truncated or has_more
        result["retrieval_complete"] = not (
            truncated or has_more or pagination.get("block_offset") or pagination.get("image_offset")
        )
        if omitted_evidence:
            result["omitted_evidence"] = omitted_evidence
        if has_more:
            result["required_next_tool_call"] = {
                "tool": "read_content",
                "arguments": {
                    "workspace_id": result.get("workspace_id"), "document_id": result.get("document_id"),
                    "block_offset": pagination["next_block_offset"],
                    "image_offset": pagination["next_image_offset"],
                },
            }
        if truncated:
            result["next_action"] = (
                "Content is partial. Use search, "
                "read_sections, or read_blocks for the missing evidence before "
                "calling locate_answer_citations."
            )
        elif has_more:
            result["next_action"] = "Continue with required_next_tool_call; this is a partial document."
        elif pagination.get("block_offset") or pagination.get("image_offset"):
            result["next_action"] = "Last page. Combine prior pages and resolve any omitted evidence before citing."
        else:
            result["next_action"] = _terminal_citation_tool_name()


def _decode_json_string_argument(value: Any) -> Any:
    if not isinstance(value, str):
        return value

    stripped = value.strip()
    if not stripped:
        return value

    if stripped[0] not in ('[', '{', '"') and stripped != "null":
        return value

    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return value


def _coerce_json_string_argument(value: Any) -> Any:
    value = _decode_json_string_argument(value)
    if value is None or isinstance(value, (list, dict)):
        return value
    return str(value)


BoundedStringList = Annotated[
    List[str],
    Field(min_length=1, max_length=settings.REQUEST_COLLECTION_MAX_ITEMS),
]
JsonString = Annotated[
    Optional[str],
    BeforeValidator(_coerce_json_string_argument),
    Field(max_length=settings.REQUEST_QUERY_MAX_CHARS),
]
OptionalJsonString = Annotated[Optional[str], BeforeValidator(_coerce_json_string_argument)]
ScopeValue = Annotated[
    Optional[Union[str, BoundedStringList]],
    BeforeValidator(_decode_json_string_argument),
]
SectionIdValue = Annotated[
    Optional[Union[str, BoundedStringList]],
    BeforeValidator(_decode_json_string_argument),
    Field(
        description=(
            "One section ID string or a non-empty list of section ID strings. "
            "For multiple IDs, the response contains one ordered result per ID "
            "under contexts; missing sections produce an error item in that list."
        )
    ),
]
BatchFileNameValue = Annotated[
    Optional[Union[str, BoundedStringList]],
    BeforeValidator(_decode_json_string_argument),
    Field(
        description=(
            "One file name string or a list of file name strings. When multiple "
            "files are known, pass the complete list in one batched tool call; "
            "do not call the tool separately once per file. A single file may "
            "be passed as one string or a one-item list."
        )
    ),
]
BatchDocumentIdValue = Annotated[
    Optional[Union[str, BoundedStringList]],
    BeforeValidator(_decode_json_string_argument),
    Field(
        description=(
            "One indexed document ID (LogicalDocument.id) or a list of document IDs, "
            "not filenames. When multiple "
            "documents are known, pass the complete list in one batched tool call; "
            "do not call the tool separately once per document. A single document may "
            "be passed as one string or a one-item list."
        )
    ),
]
ExcludeSectionIdsValue = Annotated[
    Optional[Annotated[
        List[Annotated[int, Field(strict=True, ge=1)]],
        Field(max_length=settings.REQUEST_COLLECTION_MAX_ITEMS),
    ]],
    BeforeValidator(_decode_json_string_argument),
    Field(description="Optional JSON array of positive integer section IDs, e.g. [97996] or [97996, 97997]. Even one ID needs brackets. Do not send a scalar, a quoted array, or string IDs. Omit on initial search. Use section_id from prior results, not block IDs or local labels."),
]
BlockIdValue = Annotated[
    Optional[Union[str, BoundedStringList]],
    BeforeValidator(_decode_json_string_argument),
    Field(
        description=(
            "One block ID string or a non-empty list of block ID strings. "
            "When multiple block IDs are known, pass all IDs in one tool call; "
            "do not make separate read_blocks calls for individual IDs."
        )
    ),
]
async def _prepare_hybrid_search(
    query: str,
    workspace_id: ScopeValue,
    file_name: BatchFileNameValue,
    embedding_user: str,
    user_id: Optional[str] = None,
    document_id: Optional[Union[str, List[str]]] = None,
    deadline: Optional[float] = None,
    allow_lexical_only: bool = False,
    search_context: Optional[SearchContext] = None,
):
    """Prepare scoped language variants and the original query embedding."""
    started = time.perf_counter()
    logger.info(
        "Hybrid search preparation started: embedding_user=%s file_count=%s",
        embedding_user,
        len(file_name) if isinstance(file_name, list) else (1 if file_name else 0),
    )
    if deadline is None:
        deadline = time.monotonic() + settings.SEARCH_REQUEST_TIMEOUT_SECONDS
    if search_context is not None:
        def load(session):
            if settings.SEARCH_SCALABLE_SCOPE_ENABLED:
                scope = SearchScope(query, user_id=user_id, workspace_id=workspace_id,
                    file_name=file_name, document_id=document_id).prepare(session)
                return scope, scope.configs
            documents = get_search_document_metadata(
                session, user_id, workspace_id, file_name, document_id)
            return documents, [config for config, _ in _document_fts_groups(documents, query)]
        search_context.documents, fts_configs = await _run_db(load, deadline=deadline)
    else:
        fts_configs = await _run_db(lambda session: get_scoped_document_fts_configs(
                session,
                query,
                user_id=user_id,
                workspace_id=workspace_id,
                file_name=file_name,
                document_id=document_id,
            ), deadline=deadline)
    if not fts_configs:
        logger.info("Hybrid search preparation stopped: no scoped documents found")
        return HybridSearchPreparation(None, None)

    async def prepare_embedding() -> Optional[List[float]]:
        if not embedding_configured(settings):
            if not allow_lexical_only:
                raise RuntimeError("Embedding provider is not configured")
            logger.warning("Embedding search skipped because the provider is not configured")
            return None
        try:
            embedding_timeout = getattr(settings, "EMBEDDING_TIMEOUT_SECONDS", None)
            if not isinstance(embedding_timeout, (int, float)):
                embedding_timeout = get_settings().EMBEDDING_TIMEOUT_SECONDS
            return await get_query_embedding(
                query, workspace_id, embedding_user,
                timeout=embedding_timeout,
                deadline=deadline,
            )
        except RECOVERABLE_EMBEDDING_ERRORS as exc:
            if not allow_lexical_only:
                raise
            logger.warning(
                "Embedding search unavailable (%s); continuing with lexical search",
                type(exc).__name__,
            )
            return None

    async def prepare_filenames():
        if search_context is not None and embedding_configured(settings):
            search_context.filename_scores = await _prepare_filename_semantic_scores(
                query, workspace_id, file_name, document_id, deadline,
                documents=search_context.documents)

    # Start all independent preparation together. Cancel siblings on failure;
    # shared embedding work has its own bounded lifetime and cancellation shield.
    tasks = [asyncio.create_task(operation) for operation in (
        prepare_embedding(),
        build_fts_query_variants(
            query, fts_configs,
            deadline=deadline - settings.SEARCH_RETRIEVAL_RESERVE_SECONDS,
        ),
        prepare_filenames(),
    )]
    try:
        query_embedding, fts_query_variants, _ = await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    if search_context is not None and query_embedding is None:
        search_context.filename_scores = {}
    logger.info(
        "Hybrid search preparation completed in %.3fs: embedding_dimensions=%s fts_configs=%s",
        time.perf_counter() - started,
        len(query_embedding) if query_embedding is not None else 0,
        fts_configs,
    )
    return HybridSearchPreparation(query_embedding, fts_query_variants)


def _is_recoverable_paradedb_error(exc: BaseException) -> bool:
    """Only retry failures raised while executing a ParadeDB statement."""
    statement = getattr(exc, "statement", None)
    return isinstance(exc, RECOVERABLE_DATABASE_ERRORS) and "paradedb" in str(statement).lower()


async def _prepare_filename_semantic_scores(query, workspace_id, file_name, document_id, deadline, *, documents=None):
    """Optional scoped filename signal; preserve time for content retrieval."""
    if not settings.SEARCH_FILENAME_SEMANTIC_ENABLED or not settings.SEARCH_FILENAME_WEIGHT:
        return {}
    stage_deadline = time.monotonic() + settings.SEARCH_FILENAME_SEMANTIC_TIMEOUT_SECONDS
    if deadline is not None:
        stage_deadline = min(stage_deadline, deadline - settings.SEARCH_RETRIEVAL_RESERVE_SECONDS)
    if stage_deadline <= time.monotonic():
        return {}
    try:
        def load(session):
            statement = _apply_document_filters(select(LogicalDocument.id, LogicalDocument.file_name),
                workspace_id=workspace_id, file_name=file_name, document_id=document_id)
            return {key: {"file_name": name} for key, name in session.execute(statement).all()}
        if documents is None:
            documents = await _run_db(load, deadline=stage_deadline)
        if isinstance(documents, SearchScope):
            documents = await _run_db(lambda session: documents.filename_candidates(
                session, settings.SEARCH_FILENAME_SEMANTIC_MAX_FILES), deadline=stage_deadline)
            return await filename_semantic_scores(query, documents, deadline=stage_deadline)
        text_scores, issuers = filename_relevance(query, documents, settings.HYBRID_RRF_K)
        if issuers:
            documents = {key: value for key, value in documents.items() if key in issuers}
        keys = sorted(documents, key=lambda key: (-text_scores.get(key, 0), documents[key]["file_name"], str(key)))
        documents = {key: documents[key] for key in keys[:settings.SEARCH_FILENAME_SEMANTIC_MAX_FILES]}
        return await filename_semantic_scores(query, documents, deadline=stage_deadline)
    except (ValueError, operations.CapacityExceededError, *RECOVERABLE_EMBEDDING_ERRORS, *RECOVERABLE_DATABASE_ERRORS) as exc:
        logger.warning("Filename semantic signal unavailable (%s); keeping content and filename text retrieval", type(exc).__name__)
        return {}


async def _run_unified_search(
    query: str,
    query_embedding: Optional[List[float]],
    *,
    workspace_id: ScopeValue,
    file_name: BatchFileNameValue,
    fts_query_variants: Optional[Dict[str, List[str]]],
    exclude_section_ids: Optional[List[int]] = None,
    limit: int = 5,
    document_id: Optional[Union[str, List[str]]] = None,
    per_document_limit: Optional[int] = None,
    deadline: Optional[float] = None,
    include_evidence: bool = False,
    include_hierarchy: bool = False,
    filename_query: Optional[str] = None,
    search_context: Optional[SearchContext] = None,
) -> List[Dict[str, Any]]:
    """Run hybrid search, retrying a failed lexical channel in a fresh session."""
    if (search_context is None or search_context.documents is None) and settings.SEARCH_SCALABLE_SCOPE_ENABLED:
        scope = await _run_db(lambda session: SearchScope(
            query if filename_query is None else filename_query,
            workspace_id=workspace_id, file_name=file_name, document_id=document_id).prepare(session), deadline=deadline)
        search_context = SearchContext(documents=scope)
        if not scope.configs:
            return []
    if not settings.SEARCH_FILENAME_SEMANTIC_ENABLED:
        filename_scores = {}
    elif search_context is not None and search_context.filename_scores is not None:
        filename_scores = search_context.filename_scores
    elif query_embedding is not None:
        filename_scores = await _prepare_filename_semantic_scores(
            query if filename_query is None else filename_query,
            workspace_id, file_name, document_id, deadline,
            documents=search_context.documents if search_context is not None else None)
    else:
        filename_scores = {}
    async def run_database(operation):
        if deadline is None:
            return await _run_db(operation)
        return await _run_db(operation, deadline=deadline)

    def retrieve(session, *, include_lexical: bool = True):
        started = time.perf_counter()
        block_content_cache = {}
        results = unified_search(
            session,
            query,
            query_embedding,
            workspace_id=workspace_id,
            file_name=file_name,
            fts_query_variants=fts_query_variants,
            exclude_section_ids=exclude_section_ids,
            limit=limit,
            document_id=document_id,
            per_document_limit=per_document_limit,
            include_lexical=include_lexical,
            filename_query=filename_query,
            filename_semantic_scores=filename_scores,
            **({"scoped_documents": search_context.documents} if search_context is not None else {}),
            **({"block_content_cache": block_content_cache, "include_block_ids": False} if include_evidence else {}),
        )
        discovered = time.perf_counter()
        if results:
            attach_search_ancestors(session, results,
                include_hierarchy=include_hierarchy)
        hierarchy_loaded = time.perf_counter()
        if include_evidence and results:
            evidence = search_section_evidence(
                session, [result["section_id"] for result in results], workspace_id,
                query, query_embedding, top_k=settings.SEARCH_SECTION_BLOCK_LIMIT,
                preferred_blocks={result["section_id"]: result["matched_block"]["block_id"]
                                  for result in results if result.get("matched_block")},
                preferred_images={result["section_id"]: result["matched_image"]["image_id"]
                                  for result in results if result.get("matched_image")},
                block_content_cache=block_content_cache,
            )
            by_id = {entry["section_id"]: entry for entry in evidence}
            for result in results:
                result["evidence"] = by_id.get(result["section_id"])
        logger.info("Search retrieval timing: discovery_ms=%.3f hierarchy_ms=%.3f evidence_ms=%.3f sections=%d reusable_blocks=%d",
                    (discovered - started) * 1000,
                    (hierarchy_loaded - discovered) * 1000,
                    (time.perf_counter() - hierarchy_loaded) * 1000,
                    len(results), len(block_content_cache))
        return results

    try:
        return await run_database(retrieve)
    except RECOVERABLE_DATABASE_ERRORS as exc:
        if query_embedding is None or not _is_recoverable_paradedb_error(exc):
            raise
        logger.warning(
            "Lexical search unavailable (%s); retrying vector-only search in a fresh session",
            type(exc).__name__,
        )
        return await run_database(
            lambda session: retrieve(session, include_lexical=False)
        )


def _compact_search_results(
    results: List[Dict[str, Any]], top_k: int, workspace_id: ScopeValue,
) -> List[Dict[str, Any]]:
    """Expose ranked sections for follow-up reading."""
    compact = []
    for result in results:
        common = {}
        if result.get("file_name"):
            common["file_name"] = result["file_name"]
        section = {
            "type": "section",
            "section_id": result["section_id"],
            "title": result.get("section_title"),
            "preview": result.get("preview_section"),
            "retrieval_scores": {
                "fused": result.get("score"),
                **result.get("retrieval_scores", {}),
            },
            "required_next_tool_call": {
                "tool": "read_sections",
                "arguments": {
                    "section_id": str(result["section_id"]),
                    "workspace_id": workspace_id,
                },
            },
            **common,
        }
        for key in ("ancestors", "ancestor_count", "ancestors_truncated",
                    "descendants", "descendant_count", "descendants_truncated"):
            if key in result:
                section[key] = list(result[key]) if isinstance(result[key], list) else result[key]
        if result.get("image_count"):
            section["image_count"] = result["image_count"]
        compact.append(section)
        if len(compact) >= top_k:
            break
    return compact[:top_k]


def _bound_legacy_navigation(results):
    """Trim optional hierarchy metadata across the accumulated legacy response."""
    size = _serialized_bytes(results)
    for key in ("descendants", "ancestors"):
        for section in reversed(results):
            while section.get(key) and size > settings.SEARCH_EVIDENCE_MAX_BYTES:
                size += remove_navigation_entry(section, key)
    return results


def _search_evidence_response(results, query, max_bytes=None):
    sections = []
    for result in results:
        section = dict(result.get("evidence") or {})
        if not section:
            match = result.get("matched_block")
            blocks = []
            if match:
                blocks.append({"block_id": match["block_id"], **excerpt(
                    match.get("content"), query, settings.SEARCH_EVIDENCE_MAX_CHARS)})
            if result.get("matched_image"):
                blocks.append(dict(result["matched_image"]))
            section = {"section_id": result["section_id"], "title": result.get("section_title"),
                       "file_name": result.get("file_name"), "workspace_id": result.get("workspace_id"),
                       "document_id": result.get("document_id"), "blocks": blocks,
                       "has_more_blocks": True}
        section["score"] = result.get("score")
        for key in ("ancestors", "ancestor_count", "ancestors_truncated",
                    "descendants", "descendant_count", "descendants_truncated"):
            section.pop(key, None)
            if key in result:
                section[key] = result[key]
        if result.get("image_count"):
            section["image_count"] = result["image_count"]
        sections.append(section)
    return group_evidence(sections, settings.SEARCH_EVIDENCE_MAX_BYTES if max_bytes is None else max_bytes)


def _coverage_evidence_response(coverage, results, query, max_bytes=None):
    budget = settings.SEARCH_EVIDENCE_MAX_BYTES if max_bytes is None else max_bytes
    coverage = _tool_response(coverage)
    coverage.pop("results", None)
    trimmed = False
    # Coverage bookkeeping is part of the same output budget. Report counts if
    # extreme filename lengths or a large scope require bounded status lists.
    for key in ("not_evaluated_documents", "evaluated_documents", "no_hit_documents"):
        while coverage.get(key) and _serialized_bytes(coverage) > budget // 2:
            coverage[key].pop()
            coverage[key + "_omitted"] = coverage.get(key + "_omitted", 0) + 1
            trimmed = True
    coverage.update(_search_evidence_response(results, query,
        max_bytes=budget - _serialized_bytes(coverage) - 128))
    coverage["budget_exhausted"] = coverage["budget_exhausted"] or trimmed
    return coverage


async def search_documents_grouped(
    query: str,
    file_names: BatchFileNameValue,
    debug: bool = False,
    behavior: Literal["best_matches", "coverage"] = "best_matches",
) -> Union[List[Dict[str, Any]], Dict[str, Any]]:
    """Search indexed blocks by canonical document identity.

    Semantic and lexical block evidence is aggregated per document ID. Section
    titles, document metadata, and separate image records are intentionally not
    searched. Image descriptions stored as ordinary block content remain
    searchable like any other block. ``best_matches`` searches a larger bounded
    pool, applies a per-document evidence quota, then returns the strongest
    documents. ``coverage`` evaluates a bounded set of scoped documents one by
    one and reports no-hit and not-evaluated documents without inventing hits.
    """
    _require_query(query)
    if not file_names:
        raise ValueError("file_names is required and must contain at least one file name")
    if behavior not in ("best_matches", "coverage"):
        raise ValueError("behavior must be 'best_matches' or 'coverage'")
    workspace_ids = _get_effective_workspace_ids()
    deadline = time.monotonic() + settings.SEARCH_REQUEST_TIMEOUT_SECONDS

    scoped_documents: List[Dict[str, Any]] = []
    evaluated_documents: List[Dict[str, Any]] = []
    not_evaluated_documents: List[Dict[str, Any]] = []
    if behavior == "coverage":
        scoped_documents = await _run_db(
            lambda session: get_scoped_document_refs(
                session,
                workspace_id=workspace_ids,
                file_name=file_names,
            ),
            deadline=deadline,
        )
        coverage_limit = settings.SEARCH_COVERAGE_DOCUMENT_LIMIT
        evaluated_documents = scoped_documents[:coverage_limit]
        not_evaluated_documents = scoped_documents[coverage_limit:]

    query_embedding, fts_query_variants = await _prepare_hybrid_search(
        query,
        workspace_ids,
        file_names,
        "http_search_documents",
        deadline=deadline,
    )
    if query_embedding is None:
        if behavior == "coverage":
            return {
                "documents": [],
                "evaluated_documents": [],
                "no_hit_documents": [],
                "not_evaluated_documents": scoped_documents,
            }
        return []

    def retrieve_blocks(session):
        if behavior == "best_matches":
            return search_blocks_hybrid(
                session,
                query,
                query_embedding,
                workspace_id=workspace_ids,
                file_name=file_names,
                limit=settings.SEARCH_DOCUMENTS_CANDIDATE_LIMIT,
                fts_query_variants=fts_query_variants,
                include_section_context=False,
                include_document_id=True,
                per_document_limit=settings.SEARCH_DOCUMENTS_MATCHES_PER_DOCUMENT,
            )
        matches = []
        for document in evaluated_documents:
            check_db_deadline()
            matches.extend(search_blocks_hybrid(
                session,
                query,
                query_embedding,
                workspace_id=document["workspace_id"],
                document_id=document["document_id"],
                limit=settings.SEARCH_DOCUMENTS_MATCHES_PER_DOCUMENT,
                fts_query_variants=fts_query_variants,
                include_section_context=False,
                include_document_id=True,
            ))
        return matches

    block_matches = await _run_db(retrieve_blocks, deadline=deadline)

    min_vector_score = settings.SEARCH_DOCUMENTS_MIN_VECTOR_SCORE

    def is_relevant(match: Dict[str, Any]) -> bool:
        scores = match["retrieval_scores"]
        return (
            scores.get("bm25") is not None
            or (scores.get("vector") or 0.0) >= min_vector_score
        )

    block_matches = [match for match in block_matches if is_relevant(match)]

    # LogicalDocument.id is the canonical identity after workspace/file scope
    # resolution. Filename case folding is not an ingestion/storage invariant.
    documents: Dict[str, Dict[str, Any]] = {}
    for match in block_matches:
        document_key = match["document_id"]
        document = documents.setdefault(document_key, {
            "document_id": match["document_id"],
            "file_name": match["file_name"],
            "workspace_id": match["workspace_id"],
            "source": match["source"],
            "score": 0.0,
            "matches": [],
        })
        scores = match["retrieval_scores"]
        keyword_match = scores.get("bm25") is not None
        relevance_score = scores.get("vector") or 0.0
        if keyword_match:
            relevance_score = max(relevance_score, settings.SEARCH_DOCUMENTS_MIN_SCORE)
        document["matches"].append({
            "block_id": match["block_id"],
            "block_type": match["block_type"],
            "score": round(relevance_score, 4),
            "hybrid_score": match["score"],
            "retrieval_scores": scores,
            "preview": match["content"],
            "page_number": match["page_number"],
        })

    # Rank documents, not individual chunks. The best match carries most of the
    # score, while the next two matches provide corroborating evidence. Missing
    # secondary matches do not dilute a strong single-section result.
    for document in documents.values():
        document["matches"].sort(key=lambda item: item["score"], reverse=True)
        top_scores = [item["score"] for item in document["matches"][:3]]
        weights = (1.0, 0.15, 0.05)
        content_score = min(1.0, sum(
            score * weights[index] for index, score in enumerate(top_scores)
        ))
        lexical_match = any(
            match["retrieval_scores"].get("bm25") is not None
            for match in document["matches"]
        )
        document_score = min(
            1.0,
            content_score + (settings.SEARCH_DOCUMENTS_LEXICAL_BONUS if lexical_match else 0.0),
        )
        document["score"] = round(document_score, 4)
        document["document_score"] = document["score"]
        document["semantic_match"] = any(
            (match["retrieval_scores"].get("vector") or 0.0) >= min_vector_score
            for match in document["matches"]
        )
        document["keyword_match"] = lexical_match

    ranked = sorted(documents.values(), key=lambda item: item["score"], reverse=True)
    if not ranked:
        if behavior == "coverage":
            return {
                "documents": [],
                "evaluated_documents": evaluated_documents,
                "no_hit_documents": evaluated_documents,
                "not_evaluated_documents": not_evaluated_documents,
            }
        return []

    best_score = ranked[0]["score"]
    accepted_floor = settings.SEARCH_DOCUMENTS_MIN_SCORE
    if behavior == "best_matches":
        accepted_floor = max(
            accepted_floor,
            best_score * settings.SEARCH_DOCUMENTS_RELATIVE_SCORE,
        )
    ranked = [document for document in ranked if document["score"] >= accepted_floor]
    if behavior == "best_matches":
        ranked = ranked[:settings.SEARCH_DOCUMENTS_RESULT_LIMIT]

    for document in ranked:
        document["relative_score"] = round(
            document["score"] / best_score if best_score else 0.0,
            4,
        )

    if behavior == "best_matches":
        return ranked

    hit_ids = {document["document_id"] for document in ranked}
    return {
        "documents": ranked,
        "evaluated_documents": evaluated_documents,
        "no_hit_documents": [
            document for document in evaluated_documents
            if document["document_id"] not in hit_ids
        ],
        "not_evaluated_documents": not_evaluated_documents,
    }


def _normalize_ids(
        value: Any,
        *,
        tool_name: str,
        argument_name: str,
) -> tuple[List[str], Optional[Dict[str, Any]]]:
    if not value:
        return [], _tool_argument_error(
            tool_name,
            [argument_name],
            f"{argument_name} is required. Pass one ID string or a non-empty list of ID strings.",
        )

    if isinstance(value, dict):
        return [], _tool_argument_error(
            tool_name,
            [f"{argument_name}(single string or list of strings, not object)"],
            f"{argument_name} must be one ID string or a non-empty list of ID strings.",
        )

    raw_ids = value if isinstance(value, list) else [value]
    normalized_ids: List[str] = []
    invalid_indexes: List[int] = []
    for index, value in enumerate(raw_ids):
        if isinstance(value, (list, dict)) or value is None:
            invalid_indexes.append(index)
            continue
        normalized = str(value).strip()
        if not normalized:
            invalid_indexes.append(index)
            continue
        normalized_ids.append(normalized)

    if invalid_indexes:
        return [], _tool_argument_error(
            tool_name,
            [f"{argument_name}[{index}]" for index in invalid_indexes],
            f"Each {argument_name} must be a non-empty string.",
        )

    if not normalized_ids:
        return [], _tool_argument_error(
            tool_name,
            [f"{argument_name}(non-empty)"],
            f"{argument_name} must contain at least one non-empty ID.",
        )

    return normalized_ids, None


def _normalize_section_ids(section_id: Any) -> tuple[List[str], Optional[Dict[str, Any]]]:
    return _normalize_ids(
        section_id,
        tool_name="expand_context",
        argument_name="section_id",
    )


class LocateAnswerCitationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Optional[Literal["text", "image"]] = Field(
        None,
        description="Required citation target type. Must be 'text' with block_id or 'image' with image_id.",
    )
    block_id: Optional[str] = Field(
        None,
        description=(
            "LogicalBlock.id or LogicalBlock.block_id for a text citation. "
            "Required when type='text'."
        ),
    )
    image_id: Optional[str] = Field(
        None,
        description="LogicalImage.id for an image citation. Required when type='image'.",
    )
    evidence_text: Optional[str] = Field(
        None,
        description=(
            "Exact answer evidence text. For text citations this is located inside the cited block. "
            "Send an empty string to cite the entire block/image using its full bounding box. "
            "For image citations this must be copied verbatim from the cited image object's "
            "content field or its linked image block's content, not generated or paraphrased by the LLM."
        ),
    )
    reference: Optional[int] = Field(
        None,
        gt=0,
        description="Numeric answer citation reference, for example 1, 2, or 3.",
    )

    @model_validator(mode="before")
    @classmethod
    def parse_json_string(cls, data: Any) -> Any:
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except json.JSONDecodeError as exc:
                raise ValueError("Citation string must be valid JSON.") from exc
        if not isinstance(data, dict):
            raise ValueError("Citation must be a JSON object.")

        normalized = dict(data)
        if "type" not in normalized:
            if normalized.get("image_id") is not None:
                normalized["type"] = "image"
            elif normalized.get("block_id") is not None:
                normalized["type"] = "text"
        for key in ("block_id", "image_id", "evidence_text"):
            if normalized.get(key) is not None:
                normalized[key] = str(normalized[key])
        return normalized

    @field_validator("block_id")
    @classmethod
    def reject_section_like_block_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = value.strip()
        return normalized

    @model_validator(mode="after")
    def require_citation_target(self) -> "LocateAnswerCitationInput":
        return self


CitationList = Annotated[
    List[LocateAnswerCitationInput],
    BeforeValidator(_decode_json_string_argument),
    Field(max_length=settings.REQUEST_COLLECTION_MAX_ITEMS),
]

class MistralAwareMCP(FastMCP):
    """FastMCP subclass that exposes only the active citation locator."""

    async def get_tools(self):
        return {tool.name: tool for tool in await super().list_tools(run_middleware=False)}

    async def get_resources(self):
        return {str(resource.uri): resource for resource in await self.list_resources()}

    async def get_resource_templates(self):
        return {str(resource.uri_template): resource for resource in await self.list_resource_templates()}

    async def list_tools(self, *, run_middleware=True):
        tools = await super().list_tools(run_middleware=run_middleware)
        try:
            from fastmcp.server.dependencies import get_http_request
            req = get_http_request()
            mistral_on = (req.headers.get("Mistral") or req.headers.get("X-Mistral") or "").lower().strip() in (
                "true",
                "1",
                "yes",
            )
        except Exception:
            mistral_on = False
        import logging
        logging.getLogger("mcp-server").info(
            "MistralAwareMCP._mcp_list_tools: mistral=%s, tools_before=%d",
            mistral_on,
            len(tools),
        )
        hidden_citation_tool = (
            "locate_answer_citations"
            if mistral_on
            else "locate_answer_citations_mistral"
        )
        tools = [t for t in tools if t.name != hidden_citation_tool]
        logging.getLogger("mcp-server").info(
            "MistralAwareMCP._mcp_list_tools: tools_after=%d", len(tools)
        )
        return tools


mcp = MistralAwareMCP(
    name="Logical Indexing MCP",
    mask_error_details=True,
)

_REQUEST_WORKSPACE_IDS: ContextVar[List[str]] = ContextVar("mcp_request_workspace_ids", default=[])
_REQUESTED_WORKSPACE_IDS: ContextVar[List[str]] = ContextVar("mcp_requested_workspace_ids", default=[])


class AuthorizationScopeError(ValueError):
    """The authenticated request scope is missing or does not permit access."""


def _normalize_workspace_values(value: ScopeValue) -> List[str]:
    value = _decode_json_string_argument(value)
    if value is None:
        return []
    if isinstance(value, str):
        values = [item.strip() for item in value.split(",")]
    else:
        values = []
        for item in value:
            values.extend(str(item).strip() for item in str(item).split(",") if item)
    return list(dict.fromkeys(item for item in values if item))


def set_request_workspace_ids(workspace_ids: ScopeValue) -> Token[List[str]]:
    return _REQUEST_WORKSPACE_IDS.set(_normalize_workspace_values(workspace_ids))


def clear_request_workspace_ids(token: Token[List[str]]) -> None:
    _REQUEST_WORKSPACE_IDS.reset(token)


def set_requested_workspace_ids(workspace_ids: ScopeValue) -> Token[List[str]]:
    return _REQUESTED_WORKSPACE_IDS.set(_normalize_workspace_values(workspace_ids))


def clear_requested_workspace_ids(token: Token[List[str]]) -> None:
    _REQUESTED_WORKSPACE_IDS.reset(token)


def _get_request_workspace_ids() -> List[str]:
    workspace_ids = _REQUEST_WORKSPACE_IDS.get()
    if not workspace_ids:
        raise AuthorizationScopeError("Missing Workspace-Id header")
    return workspace_ids


def _get_effective_workspace_ids() -> List[str]:
    """Return the workspace scope supplied by the authenticated caller."""
    from fastmcp.server.dependencies import get_http_request

    try:
        request = get_http_request()
    except RuntimeError:
        pass  # In-process callers use the explicit context below.
    else:
        # Stateful MCP handlers inherit initialization context variables. Resolve
        # scope from the current POST, authenticated by APIKeyAuthMiddleware.
        workspace_ids = getattr(request.state, "authorized_workspace_ids", [])
        if not workspace_ids:
            raise AuthorizationScopeError("Missing Workspace-Id header")
        return workspace_ids

    authorized = _get_request_workspace_ids()
    requested = _REQUESTED_WORKSPACE_IDS.get()
    if not requested:
        return authorized
    unauthorized = sorted(set(requested) - set(authorized))
    if unauthorized:
        raise AuthorizationScopeError(
            "Workspace-Id header exceeds the authenticated workspace scope: "
            + ", ".join(unauthorized)
        )
    return requested


_REQUEST_MISTRAL: ContextVar[bool] = ContextVar("mcp_request_mistral", default=False)


def set_request_mistral(enabled: bool) -> Token[bool]:
    return _REQUEST_MISTRAL.set(enabled)


def clear_request_mistral(token: Token[bool]) -> None:
    _REQUEST_MISTRAL.reset(token)


def _is_mistral_enabled() -> bool:
    return _REQUEST_MISTRAL.get()


_READ_CONTENT_FORBIDDEN_FOLLOWUPS = [
    "search",
    "search_in_sections",
    "read_sections",
    "read_blocks",
    "expand_context",
]


def _terminal_citation_tool_name() -> str:
    return (
        "locate_answer_citations_mistral"
        if _is_mistral_enabled()
        else "locate_answer_citations"
    )


def _require_search_scope(workspace_id: ScopeValue = None) -> None:
    if not workspace_id:
        raise ValueError("workspace_id is required")
    # Match the exact IDs consumed by SQL. Comma separation belongs to the
    # transport header; splitting a tool ID could authorize a different row.
    requested = {workspace_id} if isinstance(workspace_id, str) else set(workspace_id)
    if not requested:
        raise ValueError("workspace_id is required")
    allowed = set(_get_effective_workspace_ids())
    unauthorized = sorted(requested - allowed)
    if unauthorized:
        raise AuthorizationScopeError(
            "workspace_id is not allowed by the Workspace-Id header: "
            + ", ".join(unauthorized)
        )


def _require_query(query: Optional[str]) -> None:
    if not query or not query.strip():
        raise ValueError("query is required and must be a non-empty string")


def _tool_argument_error(tool_name: str, missing_args: List[str], detail: str) -> Dict[str, Any]:
    return _tool_response({
        "error": "Invalid or missing tool arguments.",
        "tool": tool_name,
        "missing_args": missing_args,
        "detail": detail,
        "action": (
            f"Call {tool_name} again with the required arguments. "
            "Use exact values returned by prior search results when available."
        ),
    })


def _validate_query_tool_args(
        tool_name: str,
        query: Optional[str],
        workspace_id: ScopeValue,
) -> Optional[Dict[str, Any]]:
    missing = []
    if not query or not str(query).strip():
        missing.append("query")
    if isinstance(query, (list, dict)):
        missing.append("query(single non-empty string)")
    if not workspace_id:
        missing.append("workspace_id")
    if missing:
        return _tool_argument_error(
            tool_name,
            missing,
            "query and workspace_id are required. Do not call this search tool with only workspace_id.",
        )
    return None


def _validate_workspace_args(
        tool_name: str,
        workspace_id: ScopeValue,
        extra_missing: Optional[List[str]] = None,
) -> Optional[Dict[str, Any]]:
    missing = list(extra_missing or [])
    if not workspace_id:
        missing.append("workspace_id")
    if isinstance(workspace_id, dict):
        missing.append("workspace_id(string or list of strings, not object)")
    workspace_ids = _normalize_workspace_values(workspace_id)
    if workspace_id and not workspace_ids:
        missing.append("workspace_id(non-empty string or list of non-empty strings)")
    if missing:
        return _tool_argument_error(
            tool_name,
            missing,
            "This tool requires workspace_id as one non-empty string or a non-empty list of strings.",
        )
    return None


def _validate_document_scope_args(
        tool_name: str,
        workspace_id: ScopeValue,
        document_id: ScopeValue,
) -> Optional[Dict[str, Any]]:
    missing = []
    if not workspace_id:
        missing.append("workspace_id")
    if not document_id:
        missing.append("document_id")
    if isinstance(workspace_id, dict):
        missing.append("workspace_id(string or list of strings, not object)")
    if isinstance(document_id, dict):
        missing.append("document_id(single string or list of strings, not object)")

    document_ids = document_id if isinstance(document_id, list) else [document_id]
    if any(not isinstance(value, str) or not value.strip() for value in document_ids):
        missing.append("document_id(non-empty string or list of non-empty strings)")

    if missing:
        return _tool_argument_error(
            tool_name,
            missing,
            (
                "This tool requires workspace_id as one string or a list of strings and document_id as "
                "one non-empty string or a non-empty list of strings."
            ),
        )
    return None


def _strip_response_keys(value: Any, omitted_keys: set[str]) -> Any:
    if isinstance(value, dict):
        return {
            key: _strip_response_keys(item, omitted_keys)
            for key, item in value.items()
            if key not in omitted_keys
        }
    if isinstance(value, list):
        return [_strip_response_keys(item, omitted_keys) for item in value]
    return value


def _tool_response(
        value: Any,
        omitted_keys: Optional[set[str]] = None,
        include_source: bool = False,
) -> Any:
    keys = {"user_id", "file_name", "file_names"}
    if not include_source:
        keys.add("source")
    if omitted_keys:
        keys.update(omitted_keys)
    return _strip_response_keys(value, keys)


def _image_mime_type(image_bytes: bytes) -> str:
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    if image_bytes.startswith(b"GIF87a") or image_bytes.startswith(b"GIF89a"):
        return "image/gif"
    return "image/png"


def _image_content_from_base64(raw: str) -> Optional[ImageContent]:
    if not raw:
        return None

    mime_type: Optional[str] = None
    data = raw
    if raw.startswith("data:") and "," in raw:
        header, data = raw.split(",", 1)
        mime_type = header.split(";", 1)[0].removeprefix("data:") or None

    try:
        image_bytes = base64.b64decode(data)
    except Exception:
        return None

    return ImageContent(
        type="image",
        data=data,
        mimeType=mime_type or _image_mime_type(image_bytes),
    )


def _extract_image_content(value: Any, images: List[ImageContent], indexes=None) -> Any:
    if indexes is None:
        indexes = {}
    if isinstance(value, dict):
        output: Dict[str, Any] = {}
        for key, item in value.items():
            if key == "image_base64":
                image_content = (
                    _image_content_from_base64(item)
                    if isinstance(item, str)
                    else None
                )
                if image_content:
                    identity = value.get("image_id")
                    index = indexes.get(identity) if identity is not None else None
                    if index is None:
                        index = len(images) + 1
                        images.append(image_content)
                        if identity is not None:
                            indexes[identity] = index
                    output["image_content_index"] = index
                continue
            output[key] = _extract_image_content(item, images, indexes)
        return output

    if isinstance(value, list):
        return [_extract_image_content(item, images, indexes) for item in value]

    return value


def _tool_multimodal_response(
        value: Any,
        omitted_keys: Optional[set[str]] = None,
        include_source: bool = False,
) -> Any:
    response = _tool_response(
        value,
        omitted_keys=omitted_keys,
        include_source=include_source,
    )
    images: List[ImageContent] = []
    response = _extract_image_content(response, images)
    if not images:
        return response
    return [response, *images]


async def _tool_evidence_response(response, workspace_id, deadline):
    if image_evidence_targets(response):
        response = await _run_db(lambda session: attach_evidence_images(
            session, response, workspace_id), deadline=deadline)
    return _tool_multimodal_response(response)


def _log_expand_context_tool_timing(payload: Dict[str, Any]) -> None:
    if not request_logging_enabled():
        return
    log_json_line(get_tool_file_logger(), {
        "event": "expand_context_tool_timing",
        **current_tool_call_context(),
        **payload,
    })


# =============================================================================
# Document Reading Strategy Tool
# =============================================================================

@mcp.tool
@log_tool_call
async def get_document_strategy(
        workspace_id: ScopeValue = None,
        document_id: BatchDocumentIdValue = None,
) -> Dict[str, Any]:
    """Choose full reading versus search for complete known-document reading.
For a targeted question, use search directly. Required workspace_id and
document_id accept a string or list of indexed document IDs (LogicalDocument.id); batch all known documents in one call.

Returns next_tool_calls grouped by page count (PAGE_THRESHOLD, default 20):
small documents use read_content, larger documents use search with a query you supply.
Missing documents appear in not_found_document_ids. A document ID is resolved once across
the requested workspaces, in order. Follow returned arguments, preserving scope.
Do not call without known document IDs. Finish document-grounded answers with the
active citation locator.
    """
    page_threshold = settings.PAGE_THRESHOLD
    arg_error = _validate_document_scope_args("get_document_strategy", workspace_id, document_id)
    if arg_error:
        return arg_error
    _require_search_scope(workspace_id=workspace_id)
    workspace_ids = _normalize_workspace_values(workspace_id)
    document_ids = document_id if isinstance(document_id, list) else [document_id]
    read_all_document_ids: List[str] = []
    read_all_workspace_ids: List[str] = []
    search_document_ids: List[str] = []
    search_workspace_ids: List[str] = []
    not_found_document_ids: List[str] = []
    def retrieve(session):
        for current_document_id in document_ids:
            found = False
            for current_workspace_id in workspace_ids:
                result = get_document_total_pages(
                    session,
                    document_id=current_document_id,
                    workspace_id=current_workspace_id,
                )
                if not result:
                    continue

                target_files, target_workspaces = (
                    (search_document_ids, search_workspace_ids)
                    if result["total_pages"] > page_threshold
                    else (read_all_document_ids, read_all_workspace_ids)
                )
                target_files.append(current_document_id)
                if current_workspace_id not in target_workspaces:
                    target_workspaces.append(current_workspace_id)
                found = True
                break
            if not found:
                not_found_document_ids.append(current_document_id)

    await _run_reader_db(retrieve, time.monotonic() + settings.READ_REQUEST_TIMEOUT_SECONDS)

    next_tool_calls: List[Dict[str, Any]] = []
    if read_all_document_ids:
        next_tool_calls.append({
            "tool": "read_content",
            "arguments": {
                "workspace_id": (
                    read_all_workspace_ids[0]
                    if len(read_all_workspace_ids) == 1
                    else read_all_workspace_ids
                ),
                "document_id": read_all_document_ids,
            },
            "after_success": {
                "next_action": _terminal_citation_tool_name(),
                "do_not_call_for_these_files": _READ_CONTENT_FORBIDDEN_FOLLOWUPS,
            },
        })
    if search_document_ids:
        next_tool_calls.append({
            "tool": "search",
            "arguments": {
                "workspace_id": (
                    search_workspace_ids[0]
                    if len(search_workspace_ids) == 1
                    else search_workspace_ids
                ),
                "document_id": search_document_ids,
            },
        })

    return _tool_response({
        "workspace_id": workspace_id,
        "next_tool_calls": next_tool_calls,
        "not_found_document_ids": not_found_document_ids,
    })


@mcp.tool
@log_tool_call
async def read_content(
        workspace_id: ScopeValue = None,
        document_id: BatchDocumentIdValue = None,
) -> Any:
    """Read full known documents selected by get_document_strategy.next_tool_calls.
Required workspace_id and document_id accept strings or lists. Returns the complete
indexed document in content chunks, grouping each section's full text and images.
No pagination, truncation, delivery metadata, or separate section/block objects.
Inline [block_id: ID] markers preserve text citation IDs; image_id and
image_content_index link chunk images to actual MCP image items in this response.
A document_id list returns one content result per input document, in input order;
missing documents produce corresponding errors. Reuse successful full reads and
proceed to the active citation locator without rereading those files. Verify relevant
prerequisites, exceptions, and references before answering procedures or lists.
    """
    arg_error = _validate_document_scope_args("read_content", workspace_id, document_id)
    if arg_error:
        return arg_error
    _require_search_scope(workspace_id=workspace_id)

    workspace_ids = _normalize_workspace_values(workspace_id)
    is_batched = isinstance(document_id, list)
    document_ids = document_id if isinstance(document_id, list) else [document_id]
    deadline = time.monotonic() + settings.READ_REQUEST_TIMEOUT_SECONDS
    def retrieve(session):
        results: List[Dict[str, Any]] = []
        for current_document_id in document_ids:
            _check_read_deadline(deadline)
            result = None
            for current_workspace_id in workspace_ids:
                _check_read_deadline(deadline)
                result = read_full_document_content(
                    session,
                    document_id=current_document_id,
                    workspace_id=current_workspace_id,
                )
                if result:
                    break
            if not result:
                error = {
                    "error": "Document not found for the given scope",
                    "document_id": current_document_id,
                }
                results.append(error)
                continue
            results.append(result)
        return results

    results = await _run_reader_db(retrieve, deadline)

    response = results if is_batched else results[0]
    return _tool_multimodal_response(response)


# =============================================================================
# Primary Search Tool
# =============================================================================

@mcp.tool
@log_tool_call
async def search(
        query: JsonString = None,
        workspace_id: ScopeValue = None,
        document_id: BatchDocumentIdValue = None,
        top_k: Annotated[int, Field(ge=1, le=10)] = 5,
        exclude_section_ids: ExcludeSectionIdsValue = None,
        include_hierarchy: bool = False,
) -> Any:
    """Find exact evidence for a targeted question with one hybrid retrieval pass.
Required query and workspace_id; workspace_id accepts a string or list. Include
document_id when known (string/list), otherwise omit it. Batch the complete known
document scope. top_k counts sections, 1-10 (default 5); use fewer for localized facts.

Returns documents[] identified by document_id, with sections[] with numeric section_id, rank, score, exact blocks,
block_id/image_id, content_truncated, and has_more_blocks. Scores are relevance
signals, not confidence. Read and cite returned evidence directly when sufficient.
Do not automatically read every hit or repeat complete-document reads. budget_exhausted
and omission flags identify partial delivery, not a requirement to read unrelated
content. Resolve omissions that could change the answer; do not claim exhaustive
coverage from excerpts.

For a specific gap: search_in_sections inside known sections, read_blocks for
needed full blocks, read_sections for sequence/actual images, expand_context for
structural scope. Reformulate search only for unresolved material outside known
sections; preserve workspace/document scope, names, dates, and constraints.
include_hierarchy defaults false; enable when applicability, prerequisites,
exceptions, or broader structure matter. It returns ancestor/descendant IDs and
titles with counts/truncation, not their evidence. Select relevant roots explicitly.

To discover different sections, exclude_section_ids is a native integer array
copied from earlier numeric section_id values, e.g. [97996]. Omit on first search
or when revisiting evidence; never use block IDs or sec_ prefixes. Exclusions
filter both candidate channels before limits. Use JSON booleans/integers, not
strings. Complete material evidence checks before the terminal citation locator.
Image descriptions participate in block text/vector retrieval; visual embeddings
in logical_images.image_embedding independently discover sections using the same query vector.
Retained image hits return
actual images as MCP image items linked by image_id/image_content_index. The JSON
evidence and image payloads have separate byte budgets; image_status reports omissions.
    """
    arg_error = _validate_query_tool_args("search", query, workspace_id)
    if arg_error:
        return arg_error
    if document_id is not None:
        arg_error = _validate_document_scope_args("search", workspace_id, document_id)
        if arg_error:
            return arg_error
    if not isinstance(include_hierarchy, bool):
        return _tool_argument_error("search", ["include_hierarchy"], "Use a boolean true or false.")
    if exclude_section_ids is not None and (
        not isinstance(exclude_section_ids, list)
        or len(exclude_section_ids) > settings.REQUEST_COLLECTION_MAX_ITEMS
        or any(isinstance(value, bool) or not isinstance(value, int) or value <= 0
               for value in exclude_section_ids)
    ):
        return _tool_argument_error("search", ["exclude_section_ids"],
            "Use a bounded list of positive numeric section_id values from prior results.")
    _require_search_scope(workspace_id=workspace_id)
    query = str(query).strip()
    deadline = time.monotonic() + settings.SEARCH_REQUEST_TIMEOUT_SECONDS
    search_context = SearchContext()
    query_embedding, fts_query_variants = await _prepare_hybrid_search(
        query, workspace_id, None, "mcp_unified_search",
        document_id=document_id,
        deadline=deadline, allow_lexical_only=True, search_context=search_context,
    )
    results = []
    if query_embedding is not None or fts_query_variants is not None:
        results = await _run_unified_search(
            query, query_embedding, workspace_id=workspace_id, file_name=None, document_id=document_id,
            fts_query_variants=fts_query_variants,
            exclude_section_ids=list(dict.fromkeys(exclude_section_ids or [])),
            limit=top_k, per_document_limit=settings.SEARCH_BEST_MATCHES_PER_DOCUMENT,
            deadline=deadline, include_evidence=True, include_hierarchy=include_hierarchy,
            filename_query=query,
            search_context=search_context,
        )
    response = _search_evidence_response(results[:top_k], query)
    return await _tool_evidence_response(response, workspace_id, deadline)



@mcp.tool
@log_tool_call
async def search_in_sections(
        query: JsonString = None,
        section_id: SectionIdValue = None,
        workspace_id: ScopeValue = None,
        top_k: Annotated[int, Field(ge=1, le=10)] = 3,
        include_neighbors: bool = True,
) -> Any:
    """Find focused evidence within selected known sections without reading them all.
Required query, workspace_id, and section_id (one numeric public section ID or a
list, maximum 10). Copy IDs from results; no document_id argument. top_k=1-10 (default 3).

Returns documents[] identified by document_id with exact block/image-description excerpts with IDs, scores, omission flags,
and a shared byte budget. Both block text and image visual embeddings are searched
with the same query vector. Section titles supply subject context. Semantic and
lexical ranking has no minimum-score cutoff here; empty/low-score results do not
prove absence. include_neighbors=true adds up to two adjacent blocks per hit.
Resolve material truncation/omissions with read_blocks/read_sections; do not
repeat a complete document read. Image hits return MCP image items linked by
image_id/image_content_index, with image_status for payload omissions.
Use read_sections for sequence or omitted images,
expand_context for structural dependencies, and search for gaps outside known
sections. Batch only sections relevant to the unresolved question.
    """
    error = _validate_query_tool_args("search_in_sections", query, workspace_id)
    if error:
        return error
    section_ids, error = _normalize_ids(section_id, tool_name="search_in_sections", argument_name="section_id")
    if error:
        return error
    if (len(section_ids) > settings.SECTION_SEARCH_MAX_SECTIONS
            or any(not value.isdecimal() for value in section_ids)):
        return _tool_argument_error("search_in_sections", ["section_id"],
            f"Pass at most {settings.SECTION_SEARCH_MAX_SECTIONS} numeric public section IDs.")
    if isinstance(top_k, bool) or not isinstance(top_k, int) or not 1 <= top_k <= 10:
        return _tool_argument_error("search_in_sections", ["top_k"], "Use an integer from 1 through 10.")
    _require_search_scope(workspace_id=workspace_id)
    deadline = time.monotonic() + settings.SEARCH_REQUEST_TIMEOUT_SECONDS
    # Prepare one embedding for the whole batch; lexical-only retrieval is useful
    # even when the embedding provider is unavailable.
    embedding = None
    if embedding_configured(settings):
        try:
            embedding = await get_query_embedding(
                str(query).strip(), workspace_id, "mcp_search_in_sections",
                timeout=settings.EMBEDDING_TIMEOUT_SECONDS,
                deadline=deadline - settings.SEARCH_RETRIEVAL_RESERVE_SECONDS)
        except RECOVERABLE_EMBEDDING_ERRORS:
            logger.warning("Section search embedding unavailable; using lexical section context")
    results = await _run_db(lambda session: search_section_evidence(
        session, section_ids, workspace_id, str(query).strip(), embedding,
        top_k=top_k, include_neighbors=include_neighbors), deadline=deadline)
    response = group_evidence(results, settings.SEARCH_EVIDENCE_MAX_BYTES)
    return await _tool_evidence_response(response, workspace_id, deadline)


@log_tool_call
async def search_native(
        query: JsonString = None,
        workspace_id: ScopeValue = None,
        file_name: BatchFileNameValue = None,
) -> List[Dict[str, Any]]:
    """
    Standalone hybrid search that returns matching section content directly.

    Uses the same retrieval pipeline as search (hybrid section + block search
    fused with RRF), but each result contains the full concatenated text of the
    matched section. No prior tool call is required and no follow-up tool call
    is expected after it. The same lexical-only and vector-only dependency
    fallbacks apply; database-wide failures remain errors.

    Args:
        query: Required non-empty search query string.
        workspace_id: Required — one workspace name or a list of workspace names.
        file_name: Optional file name or list of file names used to restrict
            retrieval to selected documents.

    Returns:
        List of results with section_id, section_title, content, page_range,
        score, file_name and workspace_id. score is a ranking heuristic, not a
        probability of correctness.
    """
    arg_error = _validate_query_tool_args("search_native", query, workspace_id)
    if arg_error:
        return arg_error

    deadline = time.monotonic() + settings.SEARCH_REQUEST_TIMEOUT_SECONDS
    search_context = SearchContext()
    query_embedding, fts_query_variants = await _prepare_hybrid_search(
        query,
        workspace_id,
        file_name,
        "mcp_native_search",
        search_context=search_context,
        deadline=deadline,
        allow_lexical_only=True,
    )
    if query_embedding is None and fts_query_variants is None:
        return []

    results = await _run_unified_search(
        query,
        query_embedding,
        workspace_id=workspace_id,
        file_name=file_name,
        fts_query_variants=fts_query_variants,
        limit=15,
        deadline=deadline,
        search_context=search_context,
    )
    all_block_ids = [
        block_id
        for result in results
        for block_id in result.get("block_ids", [])
    ]
    block_contents = await _run_db(
        lambda session: get_block_contents_by_ids(session, all_block_ids),
        deadline=deadline,
    )

    return [
        {
            "section_id": result.get("section_id"),
            "section_title": result.get("section_title"),
            "content": "\n\n".join(
                block_contents[block_id]
                for block_id in result.get("block_ids", [])
                if block_id in block_contents
            ),
            "page_range": result.get("page_range"),
            "score": result.get("score"),
            "file_name": result.get("file_name"),
            "workspace_id": result.get("workspace_id"),
        }
        for result in results
    ]


# =============================================================================
# Navigation & Retrieval Tools
# =============================================================================

@mcp.tool
@log_tool_call
async def read_sections(
        section_id: SectionIdValue = None,
        workspace_id: ScopeValue = None,
        include_blocks: bool = True,
        block_offset: Annotated[int, Field(ge=0)] = 0,
        image_offset: Annotated[int, Field(ge=0)] = 0,
        query: JsonString = None,
        include_images: bool = True,
) -> Any:
    """Read selected sections' own blocks and images in source order. Required
workspace_id and numeric public section_id (string/list); no document_id argument. Batch
selected IDs, not every search result. query focuses exact excerpts; set
include_images=false when stored descriptions suffice, true for visual inspection.
Each resolved section includes its document_id. Image bytes are separate MCP items, linked by image_id/image_content_index.

Long blocks expose content_truncated/content_length and a read_blocks follow-up;
read full text only when the missing portion matters. Large sections return
required_next_tool_call with block_offset/image_offset; offsets require one ID.
Recover relevant omitted_evidence/not_evaluated sections separately. Combine
needed pages in source order; absence of continuation does not prove earlier
pages were read. Check prerequisites, branches, exceptions and boundaries before
claiming a complete procedure/list. shared_section_index reuses an earlier item
in this batch. Skip rereading documents already delivered by complete read_content.
    """
    section_ids, section_id_error = _normalize_ids(
        section_id,
        tool_name="read_sections",
        argument_name="section_id",
    )
    if section_id_error:
        return section_id_error
    arg_error = _validate_workspace_args("read_sections", workspace_id)
    if arg_error:
        return arg_error
    _require_search_scope(workspace_id=workspace_id)

    if (block_offset or image_offset) and len(section_ids) != 1:
        return _tool_argument_error("read_sections", ["section_id"], "Continuation requires one section ID.")
    deadline = time.monotonic() + settings.READ_REQUEST_TIMEOUT_SECONDS

    def retrieve(session):
        loaded = read_sections_with_blocks(
            session, section_ids, workspace_id, include_blocks, block_offset, image_offset,
            **({"query": query, "include_images": include_images}
               if query is not None or not include_images else {}),
        )
        results = []
        delivered_sections = {}
        remaining_bytes = settings.READ_CONTENT_BATCH_MAX_BYTES
        for requested_section_id, result in zip(section_ids, loaded):
            _check_read_deadline(deadline)
            if result and result["section_id"] in delivered_sections:
                results.append({"section_id": result["section_id"],
                                "shared_section_index": delivered_sections[result["section_id"]]})
                continue
            if remaining_bytes <= 0:
                results.append({
                    "section_id": requested_section_id, "retrieval_complete": False, "truncated": True,
                    "status": "not_evaluated", "reason": "batch_byte_budget_exhausted",
                    "required_next_tool_call": {"tool": "read_sections", "arguments": {
                        "section_id": requested_section_id, "workspace_id": workspace_id,
                        "include_blocks": include_blocks,
                    }},
                })
                continue
            if result:
                continuation = result.get("required_next_tool_call")
                if continuation and continuation.get("tool") == "read_sections":
                    continuation["arguments"].update(query=query, include_images=include_images)
                delivered_sections[result["section_id"]] = len(results)
                budget = {"content": [{"blocks": result.get("blocks", []), "images": result.get("images", [])}]}
                _apply_read_content_batch_budget([budget], remaining_bytes)
                remaining_bytes -= budget["delivery"]["delivered_content_bytes"]
                if budget["truncated"]:
                    page = budget["content"][0] if budget["content"] else {"blocks": [], "images": []}
                    if include_blocks:
                        result["blocks"] = page["blocks"]
                    result["images"] = page["images"]
                    result.update(truncated=True, retrieval_complete=False,
                                  omitted_evidence=budget["omitted_evidence"], next_action=budget["next_action"])
            results.append(result or {
                "section_id": requested_section_id,
                "error": "Section not found",
            })
        response = results[0] if not isinstance(section_id, list) else {"sections": results}
        return _tool_multimodal_response(response)

    return await _run_reader_db(retrieve, deadline)


@mcp.tool
@log_tool_call
async def read_blocks(
        block_id: BlockIdValue = None,
        workspace_id: ScopeValue = None,
        content_offset: Annotated[int, Field(ge=0)] = 0,
) -> Any:
    """Read selected exact blocks using retrieved internal numeric block IDs (string
or list) and required workspace_id. No document_id argument. Batch only needed blocks.
Reuse already delivered text; do not reread complete read_content documents.

Returns ordered resolved blocks with document_id or per-ID errors. Full text is delivered when
it fits the shared byte budget. Oversized blocks expose content_truncated and
next_content_offset: continue with one block_id and content_offset (original
character offset). Recover needed not_evaluated items separately; a
remaining_not_evaluated marker counts trailing omitted inputs. Selected blocks
do not prove exhaustive coverage. Use read_sections for sequence/context and
search_in_sections for unresolved details within a section. Image
blocks also return MCP image items linked by image_id/image_content_index.
    """
    block_ids, block_id_error = _normalize_ids(
        block_id,
        tool_name="read_blocks",
        argument_name="block_id",
    )
    if block_id_error:
        return block_id_error
    if isinstance(content_offset, bool) or not isinstance(content_offset, int) or content_offset < 0:
        return _tool_argument_error("read_blocks", ["content_offset"], "Use a nonnegative integer.")
    if content_offset and len(block_ids) != 1:
        return _tool_argument_error("read_blocks", ["block_id"], "Continuation requires one block ID.")
    arg_error = _validate_workspace_args("read_blocks", workspace_id)
    if arg_error:
        return arg_error
    _require_search_scope(workspace_id=workspace_id)

    def retrieve(session):
        doc_ids = _resolve_document_id(session, workspace_id=workspace_id, defer=True)
        if not (session.execute(select(doc_ids.exists())).scalar()
                if hasattr(doc_ids, "exists") else doc_ids):
            return _tool_response({"error": "No documents found in scope"})
        blocks = read_blocks_by_ids(session, block_ids, doc_ids)
        blocks_by_id: Dict[str, Dict[str, Any]] = {}
        for block in blocks:
            blocks_by_id[str(block.get("block_id"))] = block
            if block.get("external_block_id") is not None:
                blocks_by_id[str(block["external_block_id"])] = block
        ordered = [
            blocks_by_id.get(requested_id, {
                "block_id": requested_id,
                "error": "Block not found",
            })
            for requested_id in block_ids
        ]
        placeholders = [{"block_id": item.get("block_id"), "status": "not_evaluated",
                         "reason": "batch_byte_budget_exhausted"} for item in ordered]
        remaining = settings.SEARCH_EVIDENCE_MAX_BYTES - _serialized_bytes(placeholders)
        delivered = []
        for index, block in enumerate(ordered):
            remaining += _serialized_bytes(placeholders[index])
            item = dict(block)
            content = item.get("content")
            if isinstance(content, str):
                # Reserve metadata and continuation flags before slicing UTF-8.
                metadata_bytes = _serialized_bytes({**item, "content": ""}) + 256
                allowance = max(0, remaining - metadata_bytes)
                text = content[content_offset:]
                if allowance < 16:
                    item = placeholders[index]
                elif content_offset or _serialized_bytes(item) > remaining:
                    # JSON escaping may expand text; count encoded JSON, not characters.
                    lo, hi = 0, len(text)
                    while lo < hi:
                        mid = (lo + hi + 1) // 2
                        if _serialized_bytes(text[:mid]) <= allowance:
                            lo = mid
                        else:
                            hi = mid - 1
                    item.update(content=text[:lo], content_length=len(content),
                                content_offset=content_offset, content_truncated=lo < len(text))
                    if lo < len(text):
                        item["next_content_offset"] = content_offset + lo
            remaining -= _serialized_bytes(item)
            delivered.append(item)
        while (_serialized_bytes(delivered) + 256 * len(image_evidence_targets(delivered))
               > settings.SEARCH_EVIDENCE_MAX_BYTES):
            # Very small budgets may not even fit all ID placeholders. Preserve
            # a compact explicit marker; callers already hold the requested IDs.
            if delivered and delivered[-1].get("status") == "remaining_not_evaluated":
                marker = delivered.pop()
            else:
                marker = {"status": "remaining_not_evaluated", "count": 0}
            delivered.pop()
            marker["count"] += 1
            delivered.append(marker)
        return _tool_multimodal_response(attach_evidence_images(session, delivered, workspace_id))

    return await _run_reader_db(retrieve, time.monotonic() + settings.READ_REQUEST_TIMEOUT_SECONDS)


@mcp.tool
@log_tool_call
async def expand_context(
        section_id: SectionIdValue = None,
        workspace_id: ScopeValue = None,
        include_content: bool = True,
        content_offset: Annotated[int, Field(ge=0)] = 0,
        context_version: Optional[str] = None,
) -> Any:
    """Read structural context only when evidence depends on it: selected section,
all descendants recursively, and each ancestor's own blocks. Required numeric
public section_id (string/list) and workspace_id; no document_id argument. For siblings,
select the parent explicitly. include_content=false returns only IDs/titles
without reading blocks. Skip after a complete read_content of the document.

Each resolved context includes document_id. Text includes exact block_id/image_id markers. Batch overlapping roots when
needed; shared_evidence references earlier content within this response. Image
markers in the delivered content also return actual MCP image items, linked in
images[] by image_id/image_content_index; image_status reports payload omissions.
When requesting complete subtree content, finish its continuation pages:
has_more=true supplies required_next_tool_call; use one root, returned
content_offset and context_version. Concatenate character slices; restart if
source version changes. Boundaries show parent/previous/next sibling navigation.
context_complete covers selected context after all pages, not the whole document
or semantic topic; hierarchy_issues flags broken references/cycles.
Oversized contexts return context_complete=false and stop_reason=content_load_budget;
follow the section-reader call or expand smaller subtrees to recover the evidence. Cite IDs from
content markers. Choose a broader root only for a specific unresolved gap.
    """
    section_ids, error = _normalize_section_ids(section_id)
    if error:
        return error
    error = _validate_workspace_args("expand_context", workspace_id)
    if error:
        return error
    if isinstance(content_offset, bool) or not isinstance(content_offset, int) or content_offset < 0:
        return {"error": "content_offset must be a non-negative integer"}
    if (content_offset or context_version) and (len(section_ids) != 1 or not include_content):
        return {"error": "Continuation requires one section_id and include_content=true"}
    if content_offset and not context_version:
        return {"error": "Continuation requires the returned context_version"}
    _require_search_scope(workspace_id=workspace_id)

    def retrieve(session):
        doc_ids = _resolve_document_id(session, workspace_id=workspace_id, defer=True)
        if not (session.execute(select(doc_ids.exists())).scalar()
                if hasattr(doc_ids, "exists") else doc_ids):
            return {"error": "No documents found in scope"}
        contexts = []
        batch_cache = {}
        budget = settings.SEARCH_EVIDENCE_MAX_BYTES
        per_context = budget if len(section_ids) == 1 else max(1, (budget - 512) // len(section_ids))
        for requested in section_ids:
            check_db_deadline()
            result = expand_section_context(session, requested, doc_ids,
                batch_cache=batch_cache,
                **({"include_content": False} if not include_content else {}))
            if result is None:
                contexts.append({"section_id": requested, "error": "Section not found"})
                continue
            if include_content and "error" not in result:
                result = paginate_context(result, content_offset, per_context, context_version)
            contexts.append(result)
        if len(contexts) == 1:
            if _serialized_bytes(contexts[0]) > budget:
                return {"error": "Navigation metadata exceeds response budget. Use include_content=true for paginated content."}
            return _tool_response(contexts[0])
        parts = []
        for index, context in enumerate(contexts):
            if "content" in context:
                parts.append("[context " + str(index) + "]\n" + context.pop("content"))
        response = {"contexts": contexts}
        if include_content:
            response["content"] = "\n\n".join(parts)
        if _serialized_bytes(response) > budget:
            return {"error": "Batch metadata exceeds response budget. Retry with one section_id and include_content=true."}
        return _tool_response(response)

    started = time.monotonic()
    response = await _run_reader_db(retrieve, started + settings.READ_REQUEST_TIMEOUT_SECONDS)
    _log_expand_context_tool_timing({
        "status": "error" if "error" in response else "success",
        "total_ms": round((time.monotonic() - started) * 1000, 3),
        "section_id_count": len(section_ids),
        "include_content": include_content,
        "content_offset": content_offset,
    })
    return await _tool_evidence_response(response, workspace_id,
        started + settings.READ_REQUEST_TIMEOUT_SECONDS) if include_content else _tool_response(response)


@mcp.tool
@log_tool_call
async def locate_answer_citations(
        workspace_id: ScopeValue = None,
        citations: Annotated[
            Optional[CitationList],
            Field(
                description=(
                    "Required JSON array of citation objects, even for one citation. "
                    "Send citations: [{...}], never a quoted/escaped JSON string or a single object. "
                    "Each item MUST include type. "
                    "For text citations use {'type':'text','block_id':'...','evidence_text':'...','reference':1}. "
                    "For image citations use {'type':'image','image_id':'...','evidence_text':'exact text copied from the linked image block or images[]','reference':1}."
                )
            ),
        ] = None,
) -> Dict[str, Any]:
    """Terminal retrieval call for answers using document evidence. Finish material
coverage, contradiction and omission checks first; cite only returned references.
Required top-level workspace_id and citations; no document_id argument. citations must be
a native JSON array, even for one item. Example (replace with retrieved values):
{"workspace_id":"workspace-id","citations":[{"type":"text","block_id":"14579","evidence_text":"exact retrieved text","reference":1}]}

Use internal numeric block IDs for text, retrieved image_id for images; never
section IDs or invented identifiers. External aliases must be unambiguous.
Each item needs type, its ID, exact evidence_text, and positive integer reference.
Use evidence_text="" to cite the whole block/image, including visual descriptions
of images without text. Returns full stored content and the whole target bbox;
missing/null evidence_text is invalid. Non-empty evidence still requires a source match.
Image evidence must match stored image content/linked block/OCR, not a generated
visual summary. Matching tolerates case/whitespace differences, preserves numbers,
signs, punctuation and negation, and omits unsupported/ambiguous items.

Returns citations[] with reference (e.g. [1]), document_id, source, page_number, highlight_text,
and highlight_bbox [x,y,w,h]. Text normally uses word positions; missing coordinates
can yield null bbox. Verified image-description matches can use whole-image bbox.
A location confirms a source match, not claim entailment or answer completeness.
If a reference is absent, remove that unsupported claim or explicitly qualify it;
do not invent citations or source coordinates.
    """
    missing = []
    if not workspace_id:
        missing.append("workspace_id")
    if citations is None:
        missing.append("citations")
    if missing:
        return _tool_argument_error(
            "locate_answer_citations",
            missing,
            "workspace_id and citations[] are required. Each citation needs type, evidence_text, reference, and block_id or image_id.",
        )
    _require_search_scope(workspace_id=workspace_id)

    if not citations:
        return _tool_response({"citations": []})

    citation_payloads = []
    for citation in citations:
        payload = citation.model_dump() if isinstance(citation, BaseModel) else dict(citation)
        if "type" not in payload:
            if payload.get("image_id") is not None:
                payload["type"] = "image"
            elif payload.get("block_id") is not None:
                payload["type"] = "text"
        for key in ("block_id", "image_id", "evidence_text"):
            if payload.get(key) is not None:
                payload[key] = str(payload[key])
        citation_payloads.append(payload)
    citation_errors = []
    for index, citation in enumerate(citation_payloads):
        citation_type = citation.get("type")
        required = ["type", "evidence_text", "reference"]
        if citation_type == "text":
            required.append("block_id")
        elif citation_type == "image":
            required.append("image_id")
        missing_fields = [field for field in required if citation.get(field) is None
                          or (field != "evidence_text" and citation.get(field) == "")]
        if citation_type not in ("text", "image"):
            missing_fields.append("type(text or image)")
        block_id = citation.get("block_id")
        if citation_type == "text" and isinstance(block_id, str) and (
                block_id.startswith("sec_") or "_sec_" in block_id
        ):
            missing_fields.append("block_id(LogicalBlock.id or LogicalBlock.block_id, not section_id)")
        if missing_fields:
            citation_errors.append({
                "citation_index": index,
                "missing_fields": missing_fields,
                "received": citation,
            })
    if citation_errors:
        return _tool_response({
            "error": "Invalid citation arguments.",
            "tool": "locate_answer_citations",
            "citation_errors": citation_errors,
            "action": (
                "For text citations use type='text', block_id as a string, exact evidence_text, and reference. "
                "For image citations use type='image', image_id, exact evidence_text copied from the linked image block or images[], and reference."
            ),
        })

    return await _run_db(lambda session: _tool_response(
            locate_answer_citation_positions(
                session,
                citations=citation_payloads,
                user_id=None,
                workspace_id=workspace_id,
                file_name=None,
            ),
            omitted_keys={"section_id", "block_id"},
            include_source=True,
        ), deadline=time.monotonic() + settings.READ_REQUEST_TIMEOUT_SECONDS)


@mcp.tool
@log_tool_call
async def locate_answer_citations_mistral(
        workspace_id: ScopeValue = None,
        citations: Annotated[
            Optional[CitationList],
            Field(
                description=(
                    "Required JSON array of citation objects, even for one citation. "
                    "Send citations: [{...}], never a quoted/escaped JSON string or a single object. "
                    "Same input shape as locate_answer_citations. "
                    "For text citations use {'type':'text','block_id':'...','evidence_text':'...','reference':1}. "
                    "For image citations use {'type':'image','image_id':'...','evidence_text':'...','reference':1}; "
                    "image_id is resolved against logical_blocks.id or logical_blocks.block_id."
                )
            ),
        ] = None,
) -> Dict[str, Any]:
    """Terminal citation locator for Mistral-indexed documents. Complete material
evidence checks first and use only returned references afterward. Required
workspace_id and citations; no document_id argument. citations is a native JSON array even
for one item, e.g. [{"type":"text","block_id":"14579","evidence_text":"exact source text","reference":1}].

Copy internal numeric block IDs from retrieval; external aliases must be
unambiguous. Each item needs type=text/image, block_id or image_id, exact stored
evidence_text, and positive integer reference. Use evidence_text="" for the target's
full stored content and whole-block bbox,
including images without text; missing/null evidence_text is invalid. Otherwise
evidence must match stored content. Mistral image_id resolves a stored
block, not logical_images. Unsupported/ambiguous evidence is omitted; matching
allows case/whitespace differences only. Returned highlight_text comes from
stored content. Uses whole-block bbox converted from stored pixels to PDF-point
[x,y,w,h], not word-level highlighting. Returns citations[] with reference, document_id,
source, page_number, highlight_text and highlight_bbox. Location does not prove
claim entailment; remove or qualify unsupported claims. Never invent references.
    """
    missing = []
    if not workspace_id:
        missing.append("workspace_id")
    if citations is None:
        missing.append("citations")
    if missing:
        return _tool_argument_error(
            "locate_answer_citations_mistral",
            missing,
            "workspace_id and citations[] are required. Each citation needs type, evidence_text, reference, and block_id or image_id.",
        )
    _require_search_scope(workspace_id=workspace_id)

    if not citations:
        return _tool_response({"citations": []})

    citation_payloads = []
    for citation in citations:
        payload = citation.model_dump() if isinstance(citation, BaseModel) else dict(citation)
        if "type" not in payload:
            if payload.get("image_id") is not None:
                payload["type"] = "image"
            elif payload.get("block_id") is not None:
                payload["type"] = "text"
        for key in ("block_id", "image_id", "evidence_text"):
            if payload.get(key) is not None:
                payload[key] = str(payload[key])
        citation_payloads.append(payload)
    citation_errors = []
    for index, citation in enumerate(citation_payloads):
        citation_type = citation.get("type")
        required = ["type", "evidence_text", "reference"]
        if citation_type == "text":
            required.append("block_id")
        elif citation_type == "image":
            required.append("image_id")
        missing_fields = [field for field in required if citation.get(field) is None
                          or (field != "evidence_text" and citation.get(field) == "")]
        if citation_type not in ("text", "image"):
            missing_fields.append("type(text or image)")
        block_id = citation.get("block_id")
        if citation_type == "text" and isinstance(block_id, str) and (
                block_id.startswith("sec_") or "_sec_" in block_id
        ):
            missing_fields.append("block_id(LogicalBlock.id or LogicalBlock.block_id, not section_id)")
        if missing_fields:
            citation_errors.append({
                "citation_index": index,
                "missing_fields": missing_fields,
                "received": citation,
            })
    if citation_errors:
        return _tool_response({
            "error": "Invalid citation arguments.",
            "tool": "locate_answer_citations_mistral",
            "citation_errors": citation_errors,
            "action": (
                "For text citations use type='text', block_id as a string, exact evidence_text, and reference. "
                "For image citations use type='image', image_id, exact evidence_text, and reference. "
                "Citation targets must resolve to logical_blocks.id or logical_blocks.block_id."
            ),
        })

    return await _run_db(lambda session: _tool_response(
            locate_answer_citation_positions_mistral(
                session,
                citations=citation_payloads,
                user_id=None,
                workspace_id=workspace_id,
                file_name=None,
            ),
            omitted_keys={"section_id", "block_id"},
            include_source=True,
        ), deadline=time.monotonic() + settings.READ_REQUEST_TIMEOUT_SECONDS)


# =============================================================================
# Resources
# =============================================================================

@mcp.resource("logical://documents")
async def list_documents_resource() -> str:
    """List document_id values and metadata for the authorized workspaces."""
    workspace_ids = _get_effective_workspace_ids()
    def retrieve(session):
        docs = db_list_documents(session, limit=1000, workspace_id=workspace_ids)
        return json.dumps([
            {
                "document_id": doc.id,
                "workspace_id": doc.workspace_id,
                "source": _source_value(doc.source),
                "total_pages": doc.total_pages,
                "created_at": str(doc.created_at),
            }
            for doc in docs
        ])

    return await _run_reader_db(retrieve, time.monotonic() + settings.READ_REQUEST_TIMEOUT_SECONDS)


@mcp.resource("logical://document/{document_id}")
async def get_document_resource(document_id: str) -> str:
    """Get full document with blocks and sections."""
    workspace_ids = _get_effective_workspace_ids()
    def retrieve(session):
        doc = get_document_by_internal_id(session, document_id, workspace_id=workspace_ids)
        if not doc:
            return json.dumps({"error": "Document not found"})
        blocks = get_blocks_for_document(session, doc.id, limit=10000)
        sections = get_sections_for_document(session, doc.id, limit=1000)
        return json.dumps({
            "document": {
                "document_id": doc.id,
                "workspace_id": doc.workspace_id,
                "source": _source_value(doc.source),
                "total_pages": doc.total_pages,
                "overview": doc.overview,
                "processing_time_ms": doc.processing_time_ms,
            },
            "blocks": [
                {
                    "block_id": b.id,
                    "document_id": document_id,
                    "content": b.content,
                    "source": _source_value(doc.source),
                    "id": b.id,
                    "section_id": b.section_id,
                    "page": b.page_number,
                }
                for b in blocks
            ],
            "sections": [
                {
                    "document_id": document_id,
                    "content": s.title,
                    "source": _source_value(doc.source),
                    "section_id": s.section_id,
                }
                for s in sections
            ],
        })

    return await _run_reader_db(retrieve, time.monotonic() + settings.READ_REQUEST_TIMEOUT_SECONDS)


@mcp.resource("logical://document/{document_id}/overview")
async def get_document_overview_resource(document_id: str) -> str:
    """Get document overview."""
    workspace_ids = _get_effective_workspace_ids()
    def retrieve(session):
        doc = get_document_by_internal_id(session, document_id, workspace_id=workspace_ids)
        return doc.overview if doc and doc.overview else ""

    return await _run_reader_db(retrieve, time.monotonic() + settings.READ_REQUEST_TIMEOUT_SECONDS)


@mcp.resource("logical://document/{document_id}/blocks")
async def get_document_blocks_resource(document_id: str) -> str:
    """Get all blocks."""
    workspace_ids = _get_effective_workspace_ids()
    def retrieve(session):
        doc = get_document_by_internal_id(session, document_id, workspace_id=workspace_ids)
        if not doc:
            return json.dumps([])
        blocks = get_blocks_for_document(session, document_id, limit=10000)
        return json.dumps([
            {
                "document_id": document_id,
                "content": b.content,
                "source": _source_value(doc.source) if doc else None,
                "id": b.id,
                "section_id": b.section_id,
                "page": b.page_number,
            }
            for b in blocks
        ])

    return await _run_reader_db(retrieve, time.monotonic() + settings.READ_REQUEST_TIMEOUT_SECONDS)


@mcp.resource("logical://document/{document_id}/sections")
async def get_document_sections_resource(document_id: str) -> str:
    """Get all sections."""
    workspace_ids = _get_effective_workspace_ids()
    def retrieve(session):
        doc = get_document_by_internal_id(session, document_id, workspace_id=workspace_ids)
        if not doc:
            return json.dumps([])
        sections = get_sections_for_document(session, document_id, limit=1000)
        return json.dumps([
            {
                "document_id": document_id,
                "content": s.title,
                "source": _source_value(doc.source) if doc else None,
                "section_id": s.section_id,
            }
            for s in sections
        ])

    return await _run_reader_db(retrieve, time.monotonic() + settings.READ_REQUEST_TIMEOUT_SECONDS)
