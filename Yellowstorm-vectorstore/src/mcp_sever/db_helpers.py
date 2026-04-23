"""
Database helper functions for MCP server.

Provides query functions for accessing logical indexing data
from PostgreSQL database.
"""

from typing import Optional, List, Dict, Any
from sqlalchemy import select, func, text, or_
from sqlalchemy.orm import Session

from src.config.settings import get_settings
from src.db.models import LogicalDocument, LogicalBlock, LogicalSection
from src.mcp_sever.context import brain_ids_var, external_ids_var, parse_brain_ids_header, parse_external_ids_header


settings = get_settings()


def _get_headers():
    """Safely get HTTP headers from the current request context."""
    try:
        from fastmcp.server.dependencies import get_http_headers
        return get_http_headers(include_all=True)
    except Exception:
        return {}


def _has_explicit_brain_id() -> bool:
    """Check if a brain_id was explicitly provided (context var or header), not from settings default."""
    if brain_ids_var.get() is not None:
        return True
    headers = _get_headers()
    return bool(parse_brain_ids_header(headers.get("x-brain-id")))


def get_brain_ids() -> List[str]:
    """Get brain IDs from request context, falling back to HTTP headers, then settings."""
    ctx_brain_ids = brain_ids_var.get()
    if ctx_brain_ids:
        return ctx_brain_ids

    headers = _get_headers()
    header_brain_ids = parse_brain_ids_header(headers.get("x-brain-id"))
    if header_brain_ids:
        return header_brain_ids

    return [settings.BRAIN_ID]


def get_external_ids() -> Optional[List[str]]:
    """Get external IDs from request context, falling back to HTTP headers."""
    ctx = external_ids_var.get()
    if ctx:
        return ctx

    headers = _get_headers()
    return parse_external_ids_header(headers.get("x-external-id"))


def get_document_by_internal_id(session: Session, document_id: int) -> Optional[LogicalDocument]:
    """
    Get a document by its internal integer primary key.

    Args:
        session: SQLAlchemy session
        document_id: Internal document ID (primary key)

    Returns:
        LogicalDocument or None if not found
    """
    stmt = select(LogicalDocument).where(LogicalDocument.id == document_id)
    return session.execute(stmt).scalar_one_or_none()


def get_document_by_doc_id(session: Session, doc_id: str) -> Optional[LogicalDocument]:
    """
    Get a document by doc_id (globally unique).

    Args:
        session: SQLAlchemy session
        doc_id: Unique document identifier

    Returns:
        LogicalDocument or None if not found
    """
    stmt = select(LogicalDocument).where(LogicalDocument.doc_id == doc_id)
    return session.execute(stmt).scalar_one_or_none()


def list_documents(
    session: Session,
    limit: int = 50,
    offset: int = 0
) -> List[LogicalDocument]:
    """
    List all documents in the configured brains, optionally filtered by external IDs.

    Args:
        session: SQLAlchemy session
        limit: Maximum number of documents to return
        offset: Number of documents to skip

    Returns:
        List of LogicalDocument objects
    """
    stmt = select(LogicalDocument)

    external_ids = get_external_ids()
    brain_ids = get_brain_ids()
    has_brain_id = _has_explicit_brain_id()

    if external_ids and has_brain_id:
        stmt = stmt.where(
            LogicalDocument.external_id.in_(external_ids),
            LogicalDocument.brain_id.in_(brain_ids)
        )
    elif external_ids:
        stmt = stmt.where(LogicalDocument.external_id.in_(external_ids))
    else:
        stmt = stmt.where(LogicalDocument.brain_id.in_(brain_ids))

    stmt = stmt.order_by(LogicalDocument.created_at.desc()).limit(limit).offset(offset)
    return list(session.execute(stmt).scalars().all())


def get_blocks_for_document(
    session: Session,
    document_id: int,
    block_type: Optional[str] = None,
    page_number: Optional[int] = None,
    limit: int = 100,
    offset: int = 0
) -> List[LogicalBlock]:
    """
    Get blocks for a document with optional filters.

    Args:
        session: SQLAlchemy session
        document_id: Internal document ID
        block_type: Optional filter by block type (heading, text, table, image)
        page_number: Optional filter by page number
        limit: Maximum number of blocks to return
        offset: Number of blocks to skip

    Returns:
        List of LogicalBlock objects
    """
    stmt = select(LogicalBlock).where(
        LogicalBlock.document_id == document_id
    )

    if block_type:
        stmt = stmt.where(LogicalBlock.block_type == block_type)
    if page_number is not None:
        stmt = stmt.where(LogicalBlock.page_number == page_number)

    stmt = stmt.order_by(LogicalBlock.id).limit(limit).offset(offset)
    return list(session.execute(stmt).scalars().all())


def get_block_by_id(session: Session, document_id: int, block_id: str) -> Optional[LogicalBlock]:
    """
    Get a specific block by its block_id.

    Args:
        session: SQLAlchemy session
        document_id: Internal document ID
        block_id: Block identifier

    Returns:
        LogicalBlock or None if not found
    """
    stmt = select(LogicalBlock).where(
        LogicalBlock.document_id == document_id,
        LogicalBlock.block_id == block_id
    )
    return session.execute(stmt).scalar_one_or_none()


def get_block_children(session: Session, document_id: int, block_id: str) -> List[LogicalBlock]:
    """
    Get child blocks (blocks where parent_id = block_id).

    Args:
        session: SQLAlchemy session
        document_id: Internal document ID
        block_id: Parent block identifier

    Returns:
        List of child LogicalBlock objects
    """
    stmt = select(LogicalBlock).where(
        LogicalBlock.document_id == document_id,
        LogicalBlock.parent_id == block_id
    ).order_by(LogicalBlock.id)
    return list(session.execute(stmt).scalars().all())


def get_block_parent(session: Session, document_id: int, block_id: str) -> Optional[LogicalBlock]:
    """
    Get the parent block of a given block.

    Args:
        session: SQLAlchemy session
        document_id: Internal document ID
        block_id: Child block identifier

    Returns:
        Parent LogicalBlock or None if block has no parent
    """
    block = get_block_by_id(session, document_id, block_id)
    if not block or not block.parent_id:
        return None

    return get_block_by_id(session, document_id, block.parent_id)


def get_block_ancestors(session: Session, document_id: int, block_id: str) -> List[LogicalBlock]:
    """
    Get all ancestors of a block (parent, grandparent, etc.) up to root.

    Args:
        session: SQLAlchemy session
        document_id: Internal document ID
        block_id: Starting block identifier

    Returns:
        List of ancestor LogicalBlock objects from root to immediate parent
    """
    ancestors = []
    current_block = get_block_by_id(session, document_id, block_id)

    while current_block and current_block.parent_id:
        parent = get_block_by_id(session, document_id, current_block.parent_id)
        if parent:
            ancestors.insert(0, parent)
            current_block = parent
        else:
            break

        if len(ancestors) > 100:
            break

    return ancestors


def get_block_descendants(
    session: Session,
    document_id: int,
    block_id: str,
    max_depth: int = 10,
    _current_depth: int = 0
) -> List[Dict[str, Any]]:
    """
    Get all descendants of a block recursively.

    Args:
        session: SQLAlchemy session
        document_id: Internal document ID
        block_id: Starting block identifier
        max_depth: Maximum depth to traverse
        _current_depth: Internal use for recursion tracking

    Returns:
        List of dictionaries with block data and nested children
    """
    if _current_depth >= max_depth:
        return []

    brain_id = None
    external_id = None
    source = None
    if _current_depth == 0:
        doc = session.query(
            LogicalDocument.brain_id, LogicalDocument.external_id, LogicalDocument.source
        ).filter(
            LogicalDocument.id == document_id
        ).first()
        if doc:
            brain_id, external_id, source = doc[0], doc[1], doc[2]

    children = get_block_children(session, document_id, block_id)
    result = []

    for child in children:
        child_dict = {
            "external_id": external_id,
            "source": source,
            "brain_id": brain_id,
            "block_id": child.block_id,
            "block_type": child.block_type,
            "content": child.content[:500] if child.content else None,
            "level": child.level,
            "page_number": child.page_number,
            "bbox": child.bbox,
            "children": get_block_descendants(
                session, document_id, child.block_id, max_depth, _current_depth + 1
            )
        }
        result.append(child_dict)

    return result


def search_blocks_fulltext(
    session: Session,
    document_id: int,
    query: str,
    block_type: Optional[str] = None,
    limit: int = 50
) -> List[Dict[str, Any]]:
    """
    Full-text search in block content using PostgreSQL tsvector.

    Args:
        session: SQLAlchemy session
        document_id: Internal document ID
        query: Search query string
        block_type: Optional filter by block type
        limit: Maximum number of results

    Returns:
        List of dictionaries with block data and relevance rank
    """
    stmt = select(
        LogicalBlock,
        LogicalDocument.brain_id,
        func.ts_rank(
            LogicalBlock.content_tsv,
            func.plainto_tsquery('english', query)
        ).label('rank')
    ).join(
        LogicalDocument, LogicalBlock.document_id == LogicalDocument.id
    ).where(
        LogicalBlock.document_id == document_id,
        LogicalBlock.content_tsv.op('@@')(func.plainto_tsquery('english', query))
    )

    if block_type:
        stmt = stmt.where(LogicalBlock.block_type == block_type)

    stmt = stmt.order_by(text('rank DESC')).limit(limit)
    results = session.execute(stmt).all()

    return [
        {
            "brain_id": brain_id,
            "block_id": block.block_id,
            "block_type": block.block_type,
            "content": block.content[:500] if block.content else None,
            "page_number": block.page_number,
            "level": block.level,
            "bbox": block.bbox,
            "rank": float(rank)
        }
        for block, brain_id, rank in results
    ]


def hybrid_search_blocks(
    session: Session,
    document_id: int,
    query: str,
    query_embedding: List[float],
    block_type: Optional[str] = None,
    limit: int = 50,
    alpha: float = 0.5
) -> List[Dict[str, Any]]:
    """
    Hybrid search combining full-text and vector similarity.

    Score = alpha * vector_score + (1-alpha) * fts_score

    Args:
        session: SQLAlchemy session
        document_id: Internal document ID
        query: Search query string
        query_embedding: Pre-computed query embedding vector
        block_type: Optional filter by block type
        limit: Maximum number of results
        alpha: Weight for semantic vs keyword (0.5=equal, 1.0=semantic only, 0.0=keyword only)

    Returns:
        List of dictionaries with block data and scores
    """
    raw_vector_score = (1 - LogicalBlock.embedding.cosine_distance(query_embedding))
    vector_score = func.coalesce(raw_vector_score, 0.0)

    fts_rank = func.ts_rank(
        LogicalBlock.content_tsv,
        func.plainto_tsquery('english', query)
    )
    fts_score = func.coalesce(fts_rank * 10, 0.0)

    combined_score = (alpha * vector_score) + ((1 - alpha) * fts_score)

    stmt = select(
        LogicalBlock,
        LogicalDocument.brain_id,
        vector_score.label('vector_score'),
        fts_score.label('fts_score'),
        combined_score.label('combined_score')
    ).join(
        LogicalDocument, LogicalBlock.document_id == LogicalDocument.id
    ).where(
        LogicalBlock.document_id == document_id,
        or_(
            LogicalBlock.content_tsv.op('@@')(func.plainto_tsquery('english', query)),
            LogicalBlock.embedding.isnot(None)
        )
    )

    if block_type:
        stmt = stmt.where(LogicalBlock.block_type == block_type)

    stmt = stmt.order_by(text('combined_score DESC')).limit(limit)
    results = session.execute(stmt).all()

    return [
        {
            "brain_id": brain_id,
            "block_id": block.block_id,
            "block_type": block.block_type,
            "content": block.content[:500] if block.content else None,
            "page_number": block.page_number,
            "level": block.level,
            "bbox": block.bbox,
            "vector_score": float(v_score) if v_score is not None else 0.0,
            "fts_score": float(f_score) if f_score is not None else 0.0,
            "combined_score": float(c_score) if c_score is not None else 0.0
        }
        for block, brain_id, v_score, f_score, c_score in results
    ]


def global_hybrid_search_blocks(
    session: Session,
    query: str,
    query_embedding: List[float],
    block_type: Optional[str] = None,
    limit: int = 10,
    alpha: float = 0.8
) -> List[Dict[str, Any]]:
    """
    Global hybrid search across all documents in all configured brains.

    Args:
        session: SQLAlchemy session
        query: Search query string
        query_embedding: Pre-computed query embedding vector
        block_type: Optional filter by block type
        limit: Maximum number of results
        alpha: Weight for semantic vs keyword

    Returns:
        List of dictionaries with block data, scores, and document_id
    """
    brain_ids = get_brain_ids()
    external_ids = get_external_ids()
    has_brain_id = _has_explicit_brain_id()

    doc_stmt = select(LogicalDocument.id)
    if external_ids and has_brain_id:
        doc_stmt = doc_stmt.where(
            LogicalDocument.external_id.in_(external_ids),
            LogicalDocument.brain_id.in_(brain_ids)
        )
    elif external_ids:
        doc_stmt = doc_stmt.where(LogicalDocument.external_id.in_(external_ids))
    else:
        doc_stmt = doc_stmt.where(LogicalDocument.brain_id.in_(brain_ids))
    doc_ids = [row[0] for row in session.execute(doc_stmt).all()]

    if not doc_ids:
        return []

    raw_vector_score = (1 - LogicalBlock.embedding.cosine_distance(query_embedding))
    vector_score = func.coalesce(raw_vector_score, 0.0)

    fts_rank = func.ts_rank(
        LogicalBlock.content_tsv,
        func.plainto_tsquery('english', query)
    )
    fts_score = func.coalesce(fts_rank * 10, 0.0)

    combined_score = (alpha * vector_score) + ((1 - alpha) * fts_score)

    stmt = select(
        LogicalBlock,
        LogicalBlock.document_id.label('doc_internal_id'),
        vector_score.label('vector_score'),
        fts_score.label('fts_score'),
        combined_score.label('combined_score')
    ).where(
        LogicalBlock.document_id.in_(doc_ids),
        or_(
            LogicalBlock.content_tsv.op('@@')(func.plainto_tsquery('english', query)),
            LogicalBlock.embedding.isnot(None)
        )
    )

    if block_type:
        stmt = stmt.where(LogicalBlock.block_type == block_type)

    stmt = stmt.order_by(text('combined_score DESC')).limit(limit)
    results = session.execute(stmt).all()

    doc_id_map = {}
    if results:
        internal_ids = list(set(r[1] for r in results))
        doc_lookup = select(LogicalDocument.id, LogicalDocument.doc_id, LogicalDocument.external_id, LogicalDocument.source, LogicalDocument.brain_id).where(
            LogicalDocument.id.in_(internal_ids)
        )
        for row in session.execute(doc_lookup).all():
            doc_id_map[row[0]] = {"doc_id": row[1], "external_id": row[2], "source": row[3], "brain_id": row[4]}

    return [
        {
            "document_id": doc_internal_id,
            "doc_id": doc_id_map.get(doc_internal_id, {}).get("doc_id"),
            "external_id": doc_id_map.get(doc_internal_id, {}).get("external_id"),
            "source": doc_id_map.get(doc_internal_id, {}).get("source"),
            "brain_id": doc_id_map.get(doc_internal_id, {}).get("brain_id"),
            "block_id": block.block_id,
            "block_type": block.block_type,
            "content": block.content[:500] if block.content else None,
            "page_number": block.page_number,
            "level": block.level,
            "bbox": block.bbox,
            "vector_score": float(v_score) if v_score is not None else 0.0,
            "fts_score": float(f_score) if f_score is not None else 0.0,
            "combined_score": float(c_score) if c_score is not None else 0.0
        }
        for block, doc_internal_id, v_score, f_score, c_score in results
    ]


def global_search_sections_fulltext(
    session: Session,
    query: str,
    limit: int = 10
) -> List[Dict[str, Any]]:
    """
    Full-text search in section titles across all documents in all configured brains.

    Args:
        session: SQLAlchemy session
        query: Search query string
        limit: Maximum number of results

    Returns:
        List of dictionaries with section data, document_id, and relevance rank
    """
    brain_ids = get_brain_ids()
    external_ids = get_external_ids()
    has_brain_id = _has_explicit_brain_id()

    doc_stmt = select(LogicalDocument.id)
    if external_ids and has_brain_id:
        doc_stmt = doc_stmt.where(
            LogicalDocument.external_id.in_(external_ids),
            LogicalDocument.brain_id.in_(brain_ids)
        )
    elif external_ids:
        doc_stmt = doc_stmt.where(LogicalDocument.external_id.in_(external_ids))
    else:
        doc_stmt = doc_stmt.where(LogicalDocument.brain_id.in_(brain_ids))
    doc_ids = [row[0] for row in session.execute(doc_stmt).all()]

    if not doc_ids:
        return []

    stmt = select(
        LogicalSection,
        LogicalSection.document_id.label('doc_internal_id'),
        func.ts_rank(
            LogicalSection.title_tsv,
            func.plainto_tsquery('english', query)
        ).label('rank')
    ).where(
        LogicalSection.document_id.in_(doc_ids),
        LogicalSection.title_tsv.op('@@')(func.plainto_tsquery('english', query))
    ).order_by(text('rank DESC')).limit(limit)

    results = session.execute(stmt).all()

    doc_id_map = {}
    if results:
        internal_ids = list(set(r[1] for r in results))
        doc_lookup = select(LogicalDocument.id, LogicalDocument.doc_id, LogicalDocument.external_id, LogicalDocument.source, LogicalDocument.brain_id).where(
            LogicalDocument.id.in_(internal_ids)
        )
        for row in session.execute(doc_lookup).all():
            doc_id_map[row[0]] = {"doc_id": row[1], "external_id": row[2], "source": row[3], "brain_id": row[4]}

    return [
        {
            "document_id": doc_internal_id,
            "doc_id": doc_id_map.get(doc_internal_id, {}).get("doc_id"),
            "external_id": doc_id_map.get(doc_internal_id, {}).get("external_id"),
            "source": doc_id_map.get(doc_internal_id, {}).get("source"),
            "brain_id": doc_id_map.get(doc_internal_id, {}).get("brain_id"),
            "section_id": section.section_id,
            "title": section.title,
            "level": section.level,
            "page_start": section.page_start,
            "page_end": section.page_end,
            "rank": float(rank)
        }
        for section, doc_internal_id, rank in results
    ]


def get_sections_for_document(
    session: Session,
    document_id: int,
    level: Optional[int] = None,
    limit: int = 100,
    offset: int = 0
) -> List[LogicalSection]:
    """
    Get sections for a document with optional filters.

    Args:
        session: SQLAlchemy session
        document_id: Internal document ID
        level: Optional filter by section level
        limit: Maximum number of sections to return
        offset: Number of sections to skip

    Returns:
        List of LogicalSection objects
    """
    stmt = select(LogicalSection).where(
        LogicalSection.document_id == document_id
    )

    if level is not None:
        stmt = stmt.where(LogicalSection.level == level)

    stmt = stmt.order_by(LogicalSection.id).limit(limit).offset(offset)
    return list(session.execute(stmt).scalars().all())


def get_section_by_id(session: Session, document_id: int, section_id: str) -> Optional[LogicalSection]:
    """
    Get a specific section by its section_id.

    Args:
        session: SQLAlchemy session
        document_id: Internal document ID
        section_id: Section identifier

    Returns:
        LogicalSection or None if not found
    """
    stmt = select(LogicalSection).where(
        LogicalSection.document_id == document_id,
        LogicalSection.section_id == section_id
    )
    return session.execute(stmt).scalar_one_or_none()


def get_section_children(session: Session, document_id: int, section_id: str) -> List[LogicalSection]:
    """
    Get child sections (sections where parent_section_id = section_id).

    Args:
        session: SQLAlchemy session
        document_id: Internal document ID
        section_id: Parent section identifier

    Returns:
        List of child LogicalSection objects
    """
    stmt = select(LogicalSection).where(
        LogicalSection.document_id == document_id,
        LogicalSection.parent_section_id == section_id
    ).order_by(LogicalSection.id)
    return list(session.execute(stmt).scalars().all())


def get_section_blocks(
    session: Session,
    document_id: int,
    section: LogicalSection
) -> List[LogicalBlock]:
    """
    Get blocks within a section's range (start_block_id to end_block_id).

    Args:
        session: SQLAlchemy session
        document_id: Internal document ID
        section: LogicalSection object

    Returns:
        List of LogicalBlock objects in the section range
    """
    if not section.start_block_id or not section.end_block_id:
        return []

    stmt = select(LogicalBlock).where(
        LogicalBlock.document_id == document_id
    ).order_by(LogicalBlock.id)

    all_blocks = list(session.execute(stmt).scalars().all())

    in_range = False
    result = []
    for block in all_blocks:
        if block.block_id == section.start_block_id:
            in_range = True
        if in_range:
            result.append(block)
        if block.block_id == section.end_block_id:
            break

    return result


def build_section_tree(sections: List[LogicalSection], doc=None) -> List[Dict[str, Any]]:
    """
    Build a hierarchical tree from flat section list.

    Args:
        sections: List of LogicalSection objects
        doc: Optional LogicalDocument object to include external_id, source, brain_id

    Returns:
        List of section dictionaries with nested children
    """
    external_id = doc.external_id if doc else None
    source = doc.source if doc else None
    brain_id = doc.brain_id if doc else None

    section_map = {}
    for section in sections:
        section_map[section.section_id] = {
            "external_id": external_id,
            "source": source,
            "brain_id": brain_id,
            "section_id": section.section_id,
            "title": section.title,
            "level": section.level,
            "page_start": section.page_start,
            "page_end": section.page_end,
            "children": []
        }

    root_sections = []
    for section in sections:
        section_dict = section_map[section.section_id]
        if section.parent_section_id and section.parent_section_id in section_map:
            section_map[section.parent_section_id]["children"].append(section_dict)
        else:
            root_sections.append(section_dict)

    return root_sections


def search_sections_fulltext(
    session: Session,
    document_id: int,
    query: str,
    limit: int = 50,
    doc=None
) -> List[Dict[str, Any]]:
    """
    Full-text search in section titles using PostgreSQL tsvector.

    Args:
        session: SQLAlchemy session
        document_id: Internal document ID
        query: Search query string
        limit: Maximum number of results
        doc: Optional LogicalDocument object to include external_id, source, brain_id

    Returns:
        List of dictionaries with section data and relevance rank
    """
    stmt = select(
        LogicalSection,
        func.ts_rank(
            LogicalSection.title_tsv,
            func.plainto_tsquery('english', query)
        ).label('rank')
    ).where(
        LogicalSection.document_id == document_id,
        LogicalSection.title_tsv.op('@@')(func.plainto_tsquery('english', query))
    ).order_by(text('rank DESC')).limit(limit)

    results = session.execute(stmt).all()

    external_id = doc.external_id if doc else None
    source = doc.source if doc else None
    brain_id = doc.brain_id if doc else None

    return [
        {
            "external_id": external_id,
            "source": source,
            "brain_id": brain_id,
            "section_id": section.section_id,
            "title": section.title,
            "level": section.level,
            "page_start": section.page_start,
            "page_end": section.page_end,
            "rank": float(rank)
        }
        for section, rank in results
    ]


def get_page_blocks(session: Session, document_id: int, page_number: int) -> List[LogicalBlock]:
    """
    Get all blocks on a specific page.

    Args:
        session: SQLAlchemy session
        document_id: Internal document ID
        page_number: Page number to get blocks for

    Returns:
        List of LogicalBlock objects on the page
    """
    return get_blocks_for_document(
        session,
        document_id,
        page_number=page_number,
        limit=1000
    )


def get_blocks_by_type(
    session: Session,
    document_id: int,
    block_type: str,
    limit: int = 100
) -> List[LogicalBlock]:
    """
    Get all blocks of a specific type in a document.

    Args:
        session: SQLAlchemy session
        document_id: Internal document ID
        block_type: Type of blocks to get (heading, text, table, image)
        limit: Maximum number of blocks to return

    Returns:
        List of LogicalBlock objects of the specified type
    """
    return get_blocks_for_document(
        session,
        document_id,
        block_type=block_type,
        limit=limit
    )
