"""
FastMCP Server for Logical Indexing Access.

Exposes tools and resources for exploring and searching
document structures stored in PostgreSQL.

Tools:
- Global Search: search_blocks, search_sections (across all documents)
- Document: list_documents, get_document, get_document_overview, get_document_toc
- Blocks: list_blocks, get_block, get_block_children, get_block_parent,
          get_block_ancestors, get_block_descendants, search_document_blocks
- Sections: list_sections, get_section, get_section_children, get_section_blocks,
            get_section_tree, search_document_sections
- Cross-ref: get_page_blocks, get_blocks_by_type
"""

import json
from typing import Optional, List, Dict, Any

from fastmcp import FastMCP
from fastmcp.server.dependencies import get_http_headers
from fastmcp.server.middleware import Middleware, MiddlewareContext

from src.db.session import get_db_session_sync
from src.logger.logging import get_logger
from src.mcp_sever.context import brain_ids_var, parse_brain_ids_header, external_ids_var, parse_external_ids_header
from src.mcp_sever.db_helpers import (
    get_document_by_internal_id,
    list_documents as db_list_documents,
    get_blocks_for_document,
    get_block_by_id,
    get_block_children as db_get_block_children,
    get_block_ancestors as db_get_block_ancestors,
    get_block_descendants as db_get_block_descendants,
    hybrid_search_blocks,
    global_hybrid_search_blocks,
    global_search_sections_fulltext,
    get_sections_for_document,
    get_section_by_id,
    get_section_children as db_get_section_children,
    get_section_blocks as db_get_section_blocks,
    build_section_tree,
    search_sections_fulltext,
    get_page_blocks as db_get_page_blocks,
    get_blocks_by_type as db_get_blocks_by_type,
)
from src.modules.embeddings import get_embeddings

logger = get_logger("vectorstores-api.mcp.logical_indexing_server")

mcp = FastMCP(
    name="Logical Indexing MCP",
    dependencies=["sqlalchemy", "asyncpg"]
)


class BrainIdMCPMiddleware(Middleware):
    """Log MCP calls and populate brain_ids/external_ids request context from HTTP headers."""

    async def on_message(self, context: MiddlewareContext[Any], call_next):
        headers = get_http_headers(include_all=True)

        # Extract tool name from context
        message = getattr(context, 'message', None) or {}
        method = getattr(message, 'method', None) or 'unknown'
        tool_name = None
        params = getattr(message, 'params', None)
        if params and hasattr(params, 'name'):
            tool_name = params.name
        elif isinstance(params, dict):
            tool_name = params.get('name')

        logger.info(
            f"MCP call: method={method}, tool={tool_name}, "
            f"x-brain-id={headers.get('x-brain-id')}, x-external-id={headers.get('x-external-id')}"
        )

        brain_ids = parse_brain_ids_header(headers.get("x-brain-id"))
        brain_token = None
        if brain_ids:
            brain_token = brain_ids_var.set(brain_ids)

        external_ids = parse_external_ids_header(headers.get("x-external-id"))
        external_token = None
        if external_ids:
            external_token = external_ids_var.set(external_ids)

        try:
            return await call_next(context)
        finally:
            if brain_token is not None:
                brain_ids_var.reset(brain_token)
            else:
                brain_ids_var.set(None)
            if external_token is not None:
                external_ids_var.reset(external_token)
            else:
                external_ids_var.set(None)


mcp.add_middleware(BrainIdMCPMiddleware())


def _get_external_ids_from_context() -> Optional[List[str]]:
    """Resolve external_ids from context var, falling back to HTTP headers."""
    ctx = external_ids_var.get()
    if ctx:
        return ctx
    try:
        headers = get_http_headers(include_all=True)
        return parse_external_ids_header(headers.get("x-external-id"))
    except Exception:
        return None


# =============================================================================
# Global Search Tools (Primary Entry Points)
# =============================================================================

@mcp.tool
def search_blocks(query: str, block_type: Optional[str] = None, limit: int = 10, external_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """
    Global hybrid search across all workspace documents (semantic + keyword).

    This is the PRIMARY discovery tool. Searches all documents using
    vector similarity combined with full-text search.
    Results include document_id (integer) so you can drill into specific documents.

    Args:
        query: Search query string
        block_type: Optional filter by block type (heading, text, table, image, figure)
        limit: Maximum number of results (default: 10)
        external_ids: Optional list of external IDs to scope the search to specific documents

    Returns:
        List of matching blocks with document_id, block_id, content, and relevance scores
    """
    resolved = external_ids or _get_external_ids_from_context()
    if resolved:
        external_ids_var.set(resolved)
    try:
        with get_db_session_sync() as session:
            embeddings = get_embeddings("mcp_global_search")
            query_embedding = embeddings.embed_query(query)

            return global_hybrid_search_blocks(
                session, query, query_embedding,
                block_type=block_type,
                limit=limit,
                alpha=0.8
            )
    finally:
        if resolved:
            external_ids_var.set(None)


@mcp.tool
def search_sections(query: str, limit: int = 10, external_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """
    Global search in section titles across all workspace documents.

    Searches section titles using full-text search across all documents
    in the configured brains. Results include document_id for drill-down.

    Args:
        query: Search query string
        limit: Maximum number of results (default: 10)
        external_ids: Optional list of external IDs to scope the search to specific documents

    Returns:
        List of matching sections with document_id, section_id, title, and relevance rank
    """
    resolved = external_ids or _get_external_ids_from_context()
    if resolved:
        external_ids_var.set(resolved)
    try:
        with get_db_session_sync() as session:
            return global_search_sections_fulltext(session, query, limit=limit)
    finally:
        if resolved:
            external_ids_var.set(None)


# =============================================================================
# Document Tools
# =============================================================================

@mcp.tool
def list_documents(limit: int = 50, offset: int = 0, external_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """
    List all documents in the workspace.

    Args:
        limit: Maximum number of documents to return (default: 50)
        offset: Number of documents to skip for pagination (default: 0)
        external_ids: Optional list of external IDs to filter documents

    Returns:
        List of document metadata including document_id, doc_id, total_pages, created_at
    """
    resolved = external_ids or _get_external_ids_from_context()
    if resolved:
        external_ids_var.set(resolved)
    try:
        with get_db_session_sync() as session:
            docs = db_list_documents(session, limit=limit, offset=offset)
            return [
                {
                    "document_id": doc.id,
                    "doc_id": doc.doc_id,
                    "external_id": doc.external_id,
                    "brain_id": doc.brain_id,
                    "source": doc.source,
                    "total_pages": doc.total_pages,
                    "created_at": str(doc.created_at),
                    "updated_at": str(doc.updated_at)
                }
                for doc in docs
            ]
    finally:
        if resolved:
            external_ids_var.set(None)


@mcp.tool
def get_document(document_id: int) -> Optional[Dict[str, Any]]:
    """
    Get document details by document_id.

    Args:
        document_id: Internal document ID (integer, returned by list_documents and search_blocks)

    Returns:
        Document details or None if not found
    """
    with get_db_session_sync() as session:
        doc = get_document_by_internal_id(session, document_id)
        if not doc:
            return None

        return {
            "document_id": doc.id,
            "doc_id": doc.doc_id,
            "external_id": doc.external_id,
            "brain_id": doc.brain_id,
            "source": doc.source,
            "total_pages": doc.total_pages,
            "overview": doc.overview,
            "toc": doc.toc,
            "processing_time_ms": doc.processing_time_ms,
            "created_at": str(doc.created_at),
            "updated_at": str(doc.updated_at)
        }


@mcp.tool
def get_document_overview(document_id: int) -> Optional[str]:
    """
    Get the AI-generated overview/summary of a document.

    Args:
        document_id: Internal document ID (integer)

    Returns:
        Document overview text or None if not found
    """
    with get_db_session_sync() as session:
        doc = get_document_by_internal_id(session, document_id)
        return doc.overview if doc else None


@mcp.tool
def get_document_toc(document_id: int) -> Optional[str]:
    """
    Get the table of contents of a document in markdown format.

    Args:
        document_id: Internal document ID (integer)

    Returns:
        Table of contents markdown or None if not found
    """
    with get_db_session_sync() as session:
        doc = get_document_by_internal_id(session, document_id)
        return doc.toc if doc else None


# =============================================================================
# Block Tools
# =============================================================================

@mcp.tool
def list_blocks(
    document_id: int,
    block_type: Optional[str] = None,
    page_number: Optional[int] = None,
    limit: int = 100,
    offset: int = 0
) -> List[Dict[str, Any]]:
    """
    List blocks in a document with optional filters.

    Args:
        document_id: Internal document ID (integer)
        block_type: Filter by type (heading, text, table, image, figure)
        page_number: Filter by page number
        limit: Maximum number of blocks to return (default: 100)
        offset: Number of blocks to skip (default: 0)

    Returns:
        List of block data
    """
    with get_db_session_sync() as session:
        blocks = get_blocks_for_document(
            session, document_id,
            block_type=block_type,
            page_number=page_number,
            limit=limit,
            offset=offset
        )
        doc = get_document_by_internal_id(session, document_id)

        return [
            {
                "document_id": document_id,
                "external_id": doc.external_id if doc else None,
                "source": doc.source if doc else None,
                "brain_id": doc.brain_id if doc else None,
                "block_id": b.block_id,
                "block_type": b.block_type,
                "content": b.content[:1000] if b.content else None,
                "page_number": b.page_number,
                "level": b.level,
                "parent_id": b.parent_id,
                "bbox": b.bbox
            }
            for b in blocks
        ]


@mcp.tool
def get_block(document_id: int, block_id: str) -> Optional[Dict[str, Any]]:
    """
    Get a specific block by its ID.

    Args:
        document_id: Internal document ID (integer)
        block_id: Block identifier

    Returns:
        Block data or None if not found
    """
    with get_db_session_sync() as session:
        block = get_block_by_id(session, document_id, block_id)
        if not block:
            return None

        doc = get_document_by_internal_id(session, document_id)
        return {
            "document_id": document_id,
            "external_id": doc.external_id if doc else None,
            "source": doc.source if doc else None,
            "brain_id": doc.brain_id if doc else None,
            "block_id": block.block_id,
            "block_type": block.block_type,
            "content": block.content,
            "page_number": block.page_number,
            "level": block.level,
            "parent_id": block.parent_id,
            "bbox": block.bbox
        }


@mcp.tool
def get_block_children(document_id: int, block_id: str) -> List[Dict[str, Any]]:
    """
    Get child blocks of a block (blocks where parent_id = block_id).

    Args:
        document_id: Internal document ID (integer)
        block_id: Parent block identifier

    Returns:
        List of child block data
    """
    with get_db_session_sync() as session:
        children = db_get_block_children(session, document_id, block_id)
        doc = get_document_by_internal_id(session, document_id)
        return [
            {
                "document_id": document_id,
                "external_id": doc.external_id if doc else None,
                "source": doc.source if doc else None,
                "brain_id": doc.brain_id if doc else None,
                "block_id": b.block_id,
                "block_type": b.block_type,
                "content": b.content[:500] if b.content else None,
                "page_number": b.page_number,
                "level": b.level,
                "bbox": b.bbox
            }
            for b in children
        ]


@mcp.tool
def get_block_parent(document_id: int, block_id: str) -> Optional[Dict[str, Any]]:
    """
    Get the parent block of a block.

    Args:
        document_id: Internal document ID (integer)
        block_id: Child block identifier

    Returns:
        Parent block data or None if block has no parent
    """
    with get_db_session_sync() as session:
        block = get_block_by_id(session, document_id, block_id)
        if not block or not block.parent_id:
            return None

        parent = get_block_by_id(session, document_id, block.parent_id)
        if not parent:
            return None

        doc = get_document_by_internal_id(session, document_id)
        return {
            "document_id": document_id,
            "external_id": doc.external_id if doc else None,
            "source": doc.source if doc else None,
            "brain_id": doc.brain_id if doc else None,
            "block_id": parent.block_id,
            "block_type": parent.block_type,
            "content": parent.content[:500] if parent.content else None,
            "page_number": parent.page_number,
            "level": parent.level,
            "bbox": parent.bbox
        }


@mcp.tool
def get_block_ancestors(document_id: int, block_id: str) -> List[Dict[str, Any]]:
    """
    Get the full ancestor chain from root to the block's immediate parent.

    Args:
        document_id: Internal document ID (integer)
        block_id: Starting block identifier

    Returns:
        List of ancestor block data from root to immediate parent
    """
    with get_db_session_sync() as session:
        ancestors = db_get_block_ancestors(session, document_id, block_id)
        doc = get_document_by_internal_id(session, document_id)
        return [
            {
                "document_id": document_id,
                "external_id": doc.external_id if doc else None,
                "source": doc.source if doc else None,
                "brain_id": doc.brain_id if doc else None,
                "block_id": b.block_id,
                "block_type": b.block_type,
                "content": b.content[:300] if b.content else None,
                "page_number": b.page_number,
                "level": b.level,
                "bbox": b.bbox
            }
            for b in ancestors
        ]


@mcp.tool
def get_block_descendants(document_id: int, block_id: str, max_depth: int = 10) -> List[Dict[str, Any]]:
    """
    Get all descendants of a block recursively as a tree.

    Args:
        document_id: Internal document ID (integer)
        block_id: Starting block identifier
        max_depth: Maximum depth to traverse (default: 10)

    Returns:
        List of descendant blocks with nested children
    """
    with get_db_session_sync() as session:
        return db_get_block_descendants(session, document_id, block_id, max_depth)


@mcp.tool
def search_document_blocks(
    document_id: int,
    query: str,
    block_type: Optional[str] = None,
    limit: int = 10,
) -> List[Dict[str, Any]]:
    """
    Hybrid search within a specific document (semantic + keyword).

    Use this when you already know the document and want to search within it.
    For cross-document search, use search_blocks() instead.

    Args:
        document_id: Internal document ID (integer)
        query: Search query string
        block_type: Optional filter by block type
        limit: Maximum number of results (default: 10)

    Returns:
        List of matching blocks with scores
    """
    with get_db_session_sync() as session:
        embeddings = get_embeddings("mcp_doc_search")
        query_embedding = embeddings.embed_query(query)

        return hybrid_search_blocks(
            session, document_id, query, query_embedding,
            block_type=block_type,
            limit=limit,
            alpha=0.8
        )


# =============================================================================
# Section Tools
# =============================================================================

@mcp.tool
def list_sections(
    document_id: int,
    level: Optional[int] = None,
    limit: int = 100,
    offset: int = 0
) -> List[Dict[str, Any]]:
    """
    List sections in a document with optional filter by level.

    Args:
        document_id: Internal document ID (integer)
        level: Filter by section level (1=chapter, 2=section, 3=subsection)
        limit: Maximum number of sections (default: 100)
        offset: Number of sections to skip (default: 0)

    Returns:
        List of section data
    """
    with get_db_session_sync() as session:
        sections = get_sections_for_document(
            session, document_id,
            level=level,
            limit=limit,
            offset=offset
        )
        doc = get_document_by_internal_id(session, document_id)

        return [
            {
                "document_id": document_id,
                "external_id": doc.external_id if doc else None,
                "source": doc.source if doc else None,
                "brain_id": doc.brain_id if doc else None,
                "section_id": s.section_id,
                "title": s.title,
                "level": s.level,
                "parent_section_id": s.parent_section_id,
                "page_start": s.page_start,
                "page_end": s.page_end
            }
            for s in sections
        ]


@mcp.tool
def get_section(document_id: int, section_id: str) -> Optional[Dict[str, Any]]:
    """
    Get a specific section by its ID.

    Args:
        document_id: Internal document ID (integer)
        section_id: Section identifier

    Returns:
        Section data or None if not found
    """
    with get_db_session_sync() as session:
        section = get_section_by_id(session, document_id, section_id)
        if not section:
            return None

        doc = get_document_by_internal_id(session, document_id)
        return {
            "document_id": document_id,
            "external_id": doc.external_id if doc else None,
            "source": doc.source if doc else None,
            "brain_id": doc.brain_id if doc else None,
            "section_id": section.section_id,
            "title": section.title,
            "level": section.level,
            "parent_section_id": section.parent_section_id,
            "start_block_id": section.start_block_id,
            "end_block_id": section.end_block_id,
            "page_start": section.page_start,
            "page_end": section.page_end
        }


@mcp.tool
def get_section_children(document_id: int, section_id: str) -> List[Dict[str, Any]]:
    """
    Get subsections of a section.

    Args:
        document_id: Internal document ID (integer)
        section_id: Parent section identifier

    Returns:
        List of child section data
    """
    with get_db_session_sync() as session:
        children = db_get_section_children(session, document_id, section_id)
        doc = get_document_by_internal_id(session, document_id)
        return [
            {
                "document_id": document_id,
                "external_id": doc.external_id if doc else None,
                "source": doc.source if doc else None,
                "brain_id": doc.brain_id if doc else None,
                "section_id": s.section_id,
                "title": s.title,
                "level": s.level,
                "page_start": s.page_start,
                "page_end": s.page_end
            }
            for s in children
        ]


@mcp.tool
def get_section_blocks(document_id: int, section_id: str) -> List[Dict[str, Any]]:
    """
    Get all blocks within a section's range.

    Args:
        document_id: Internal document ID (integer)
        section_id: Section identifier

    Returns:
        List of blocks in the section
    """
    with get_db_session_sync() as session:
        section = get_section_by_id(session, document_id, section_id)
        if not section:
            return []

        doc = get_document_by_internal_id(session, document_id)
        blocks = db_get_section_blocks(session, document_id, section)
        return [
            {
                "document_id": document_id,
                "external_id": doc.external_id if doc else None,
                "source": doc.source if doc else None,
                "brain_id": doc.brain_id if doc else None,
                "block_id": b.block_id,
                "block_type": b.block_type,
                "content": b.content[:500] if b.content else None,
                "page_number": b.page_number,
                "level": b.level,
                "bbox": b.bbox
            }
            for b in blocks
        ]


@mcp.tool
def get_section_tree(document_id: int) -> List[Dict[str, Any]]:
    """
    Get the hierarchical section tree for a document.

    Args:
        document_id: Internal document ID (integer)

    Returns:
        Hierarchical tree of sections with nested children
    """
    with get_db_session_sync() as session:
        sections = get_sections_for_document(session, document_id, limit=1000)
        doc = get_document_by_internal_id(session, document_id)
        return build_section_tree(sections, doc)


@mcp.tool
def search_document_sections(document_id: int, query: str, limit: int = 50) -> List[Dict[str, Any]]:
    """
    Full-text search in section titles within a specific document.

    Args:
        document_id: Internal document ID (integer)
        query: Search query string
        limit: Maximum number of results (default: 50)

    Returns:
        List of matching sections with relevance rank
    """
    with get_db_session_sync() as session:
        doc = get_document_by_internal_id(session, document_id)
        return search_sections_fulltext(session, document_id, query, limit=limit, doc=doc)


# =============================================================================
# Cross-Reference Tools
# =============================================================================

@mcp.tool
def get_page_blocks(document_id: int, page_number: int) -> List[Dict[str, Any]]:
    """
    Get all blocks on a specific page of a document.

    Args:
        document_id: Internal document ID (integer)
        page_number: Page number (1-indexed)

    Returns:
        List of blocks on the page
    """
    with get_db_session_sync() as session:
        blocks = db_get_page_blocks(session, document_id, page_number)
        doc = get_document_by_internal_id(session, document_id)
        return [
            {
                "document_id": document_id,
                "external_id": doc.external_id if doc else None,
                "source": doc.source if doc else None,
                "brain_id": doc.brain_id if doc else None,
                "block_id": b.block_id,
                "block_type": b.block_type,
                "content": b.content[:500] if b.content else None,
                "level": b.level,
                "bbox": b.bbox
            }
            for b in blocks
        ]


@mcp.tool
def get_blocks_by_type(document_id: int, block_type: str, limit: int = 100) -> List[Dict[str, Any]]:
    """
    Get all blocks of a specific type in a document.

    Args:
        document_id: Internal document ID (integer)
        block_type: Type of blocks (heading, text, table, image, figure)
        limit: Maximum number of blocks (default: 100)

    Returns:
        List of blocks of the specified type
    """
    with get_db_session_sync() as session:
        blocks = db_get_blocks_by_type(session, document_id, block_type, limit=limit)
        doc = get_document_by_internal_id(session, document_id)
        return [
            {
                "document_id": document_id,
                "external_id": doc.external_id if doc else None,
                "source": doc.source if doc else None,
                "brain_id": doc.brain_id if doc else None,
                "block_id": b.block_id,
                "block_type": b.block_type,
                "content": b.content[:1000] if b.content else None,
                "page_number": b.page_number,
                "level": b.level,
                "bbox": b.bbox
            }
            for b in blocks
        ]


# =============================================================================
# Resources
# =============================================================================

@mcp.resource("logical://documents")
def list_documents_resource() -> str:
    """List all documents in the workspace as a resource."""
    with get_db_session_sync() as session:
        docs = db_list_documents(session, limit=1000)
        return json.dumps([
            {
                "document_id": doc.id,
                "doc_id": doc.doc_id,
                "external_id": doc.external_id,
                "brain_id": doc.brain_id,
                "source": doc.source,
                "total_pages": doc.total_pages,
                "created_at": str(doc.created_at)
            }
            for doc in docs
        ])


@mcp.resource("logical://document/{document_id}")
def get_document_resource(document_id: int) -> str:
    """Get full document with blocks and sections as a resource."""
    with get_db_session_sync() as session:
        doc = get_document_by_internal_id(session, document_id)
        if not doc:
            return json.dumps({"error": "Document not found"})

        blocks = get_blocks_for_document(session, doc.id, limit=10000)
        sections = get_sections_for_document(session, doc.id, limit=1000)

        return json.dumps({
            "document": {
                "document_id": doc.id,
                "doc_id": doc.doc_id,
                "external_id": doc.external_id,
                "brain_id": doc.brain_id,
                "source": doc.source,
                "total_pages": doc.total_pages,
                "overview": doc.overview,
                "toc": doc.toc,
                "processing_time_ms": doc.processing_time_ms
            },
            "blocks": [
                {
                    "external_id": doc.external_id,
                    "brain_id": doc.brain_id,
                    "source": doc.source,
                    "block_id": b.block_id,
                    "block_type": b.block_type,
                    "content": b.content,
                    "page_number": b.page_number,
                    "level": b.level,
                    "parent_id": b.parent_id,
                    "bbox": b.bbox
                }
                for b in blocks
            ],
            "sections": build_section_tree(sections, doc)
        })


@mcp.resource("logical://document/{document_id}/overview")
def get_document_overview_resource(document_id: int) -> str:
    """Get document overview as a resource."""
    with get_db_session_sync() as session:
        doc = get_document_by_internal_id(session, document_id)
        return doc.overview if doc and doc.overview else ""


@mcp.resource("logical://document/{document_id}/toc")
def get_document_toc_resource(document_id: int) -> str:
    """Get document table of contents as a resource."""
    with get_db_session_sync() as session:
        doc = get_document_by_internal_id(session, document_id)
        return doc.toc if doc and doc.toc else ""


@mcp.resource("logical://document/{document_id}/blocks")
def get_document_blocks_resource(document_id: int) -> str:
    """Get all blocks as a resource."""
    with get_db_session_sync() as session:
        doc = get_document_by_internal_id(session, document_id)
        blocks = get_blocks_for_document(session, document_id, limit=10000)
        return json.dumps([
            {
                "external_id": doc.external_id if doc else None,
                "brain_id": doc.brain_id if doc else None,
                "source": doc.source if doc else None,
                "block_id": b.block_id,
                "block_type": b.block_type,
                "content": b.content,
                "page_number": b.page_number,
                "level": b.level,
                "parent_id": b.parent_id,
                "bbox": b.bbox
            }
            for b in blocks
        ])


@mcp.resource("logical://document/{document_id}/blocks/{block_id}")
def get_block_resource(document_id: int, block_id: str) -> str:
    """Get a single block as a resource."""
    with get_db_session_sync() as session:
        block = get_block_by_id(session, document_id, block_id)
        if not block:
            return json.dumps({"error": "Block not found"})

        doc = get_document_by_internal_id(session, document_id)
        return json.dumps({
            "external_id": doc.external_id if doc else None,
            "brain_id": doc.brain_id if doc else None,
            "source": doc.source if doc else None,
            "block_id": block.block_id,
            "block_type": block.block_type,
            "content": block.content,
            "page_number": block.page_number,
            "level": block.level,
            "parent_id": block.parent_id,
            "bbox": block.bbox
        })


@mcp.resource("logical://document/{document_id}/sections")
def get_document_sections_resource(document_id: int) -> str:
    """Get all sections as a hierarchical tree resource."""
    with get_db_session_sync() as session:
        doc = get_document_by_internal_id(session, document_id)
        sections = get_sections_for_document(session, document_id, limit=1000)
        return json.dumps(build_section_tree(sections, doc))


@mcp.resource("logical://document/{document_id}/sections/{section_id}")
def get_section_resource(document_id: int, section_id: str) -> str:
    """Get a section with its blocks as a resource."""
    with get_db_session_sync() as session:
        section = get_section_by_id(session, document_id, section_id)
        if not section:
            return json.dumps({"error": "Section not found"})

        doc = get_document_by_internal_id(session, document_id)
        blocks = db_get_section_blocks(session, document_id, section)
        return json.dumps({
            "external_id": doc.external_id if doc else None,
            "brain_id": doc.brain_id if doc else None,
            "source": doc.source if doc else None,
            "section_id": section.section_id,
            "title": section.title,
            "level": section.level,
            "parent_section_id": section.parent_section_id,
            "page_start": section.page_start,
            "page_end": section.page_end,
            "blocks": [
                {
                    "block_id": b.block_id,
                    "block_type": b.block_type,
                    "content": b.content,
                    "page_number": b.page_number,
                    "bbox": b.bbox
                }
                for b in blocks
            ]
        })
