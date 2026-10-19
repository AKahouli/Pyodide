"""
Database helper functions for MCP server.

Provides query functions for accessing logical indexing data
from PostgreSQL database.
"""

import io
import json
import re
import base64
import time
import unicodedata
from bisect import bisect_right
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from typing import Optional, List, Dict, Any, Tuple, Union
from sqlalchemy import select, func, text, or_, tuple_, cast, String, bindparam, literal_column, case
from sqlalchemy.orm import Session, Load, load_only, defer, with_expression
from sqlalchemy.sql.selectable import SelectBase
from src.db.session import check_db_deadline
from PIL import Image
from rapidfuzz import fuzz

from src.config.settings import get_settings
from src.db.models import LogicalDocument, LogicalBlock, LogicalSection, LogicalImage, LogicalTextPosition
from src.logger.file_request_logging import current_tool_call_context, get_tool_file_logger, log_json_line, request_logging_enabled
from src.modules.language import FASTTEXT_TO_PG_CONFIG, get_pg_ts_config
from src.mcp_server.filename_relevance import filename_relevance
from src.mcp_server.search_scope import SearchScope


settings = get_settings()


def bounded_image_column(column):
    """Keep oversized stored payloads in PostgreSQL rather than Python memory."""
    return case((func.octet_length(column) <= settings.IMAGE_MAX_ENCODED_BYTES, column), else_="").label(column.key)


def bounded_image_options():
    return [with_expression(column, bounded_image_column(column))
            for column in (LogicalImage.content, LogicalImage.image_base64)]


ScopeValue = Optional[Union[str, List[str]]]
DocumentId = str
DocumentIdScope = Optional[Union[DocumentId, List[DocumentId]]]
FtsQueryVariants = Optional[Dict[str, List[str]]]

FUZZY_MATCH_THRESHOLD = 0.72
FUZZY_EARLY_EXIT_THRESHOLD = 0.98
MAX_FUZZY_WINDOWS = 2500
BM25_STEMMED_CONFIGS = {"english", "french"}
SUMMARY_PREVIEW_PAGE_THRESHOLD = 50
SUMMARY_PREVIEW_MAX_CHARS = 100
ROUTING_SECTION_CONTENT_MAX_CHARS = 8000


def _log_expand_context_timing(payload: Dict[str, Any]) -> None:
    if not request_logging_enabled():
        return
    log_json_line(get_tool_file_logger(), {
        "event": "expand_context_timing",
        **current_tool_call_context(),
        **payload,
    })


def _normalize_scope_values(value: ScopeValue) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        values = [value]
    else:
        values = [item for item in value if item]
    return [item for item in values if item]


def _source_value(source: Optional[str]) -> Optional[str]:
    if not source:
        return None
    return source


def _document_fts_groups(
    doc_map: Dict[DocumentId, Dict[str, Any]],
    query: str,
) -> List[Tuple[str, List[DocumentId]]]:
    """Group document ids by the FTS config used to build their tsvectors."""
    if isinstance(doc_map, SearchScope):
        return doc_map.groups()
    fallback_config = None
    grouped: Dict[str, List[DocumentId]] = defaultdict(list)
    for document_id, metadata in doc_map.items():
        fts_config = metadata.get("fts_config")
        if not fts_config:
            if fallback_config is None:
                fallback_config = get_pg_ts_config(query)
            fts_config = fallback_config
        normalized_config = _normalize_fts_config(fts_config)
        grouped[normalized_config].append(document_id)
    return list(grouped.items())


def _workspace_ids_for_documents(
    doc_map: Dict[DocumentId, Dict[str, Any]],
    document_ids: Optional[List[DocumentId]] = None,
) -> List[str]:
    if isinstance(doc_map, SearchScope):
        return doc_map.workspaces
    selected_ids = set(document_ids) if document_ids is not None else None
    return list(dict.fromkeys(
        metadata.get("workspace_id")
        for document_id, metadata in doc_map.items()
        if (selected_ids is None or document_id in selected_ids)
        and metadata.get("workspace_id")
    ))


def _apply_workspace_partition_filter(
    stmt,
    model,
    doc_map: Dict[DocumentId, Dict[str, Any]],
    document_ids: Optional[List[DocumentId]] = None,
):
    """Expose workspace scope directly so PostgreSQL can prune partitions."""
    workspace_ids = _workspace_ids_for_documents(doc_map, document_ids)
    if workspace_ids:
        stmt = stmt.where(model.workspace_id.in_(workspace_ids))
    return stmt


def _normalize_fts_config(fts_config: Any) -> str:
    normalized = str(fts_config).strip().lower()
    return FASTTEXT_TO_PG_CONFIG.get(normalized, normalized)


def _search_document_ids(doc_map):
    return doc_map.documents() if isinstance(doc_map, SearchScope) else list(doc_map)


def _search_document_predicate(model, doc_map):
    if isinstance(doc_map, SearchScope) and doc_map.direct_workspace_filter():
        return model.workspace_id.in_(doc_map.workspaces)
    return model.document_id.in_(_search_document_ids(doc_map))


def _fts_query_expression(
    fts_config: str,
    original_query: str,
    query_variants: FtsQueryVariants = None,
):
    variants = (query_variants or {}).get(fts_config) or [original_query]
    unique_variants = list(dict.fromkeys(
        variant.strip() for variant in variants if isinstance(variant, str) and variant.strip()
    )) or [original_query]
    expression = func.plainto_tsquery(fts_config, unique_variants[0])
    for variant in unique_variants[1:]:
        expression = expression.op("||")(func.plainto_tsquery(fts_config, variant))
    return expression


def _query_variants_for_config(
    fts_config: str,
    original_query: str,
    query_variants: FtsQueryVariants,
) -> List[str]:
    variants = (query_variants or {}).get(fts_config) or [original_query]
    return list(dict.fromkeys(
        variant.strip() for variant in variants
        if isinstance(variant, str) and variant.strip()
    )) or [original_query]


def _rrf_score(vector_rank: Optional[int], bm25_rank: Optional[int],
               image_rank: Optional[int] = None, *, include_images: bool = False) -> float:
    k = settings.HYBRID_RRF_K
    vector_weight = settings.HYBRID_VECTOR_WEIGHT
    bm25_weight = settings.HYBRID_BM25_WEIGHT
    raw_score = 0.0
    if vector_rank is not None:
        raw_score += vector_weight / (k + vector_rank)
    if bm25_rank is not None:
        raw_score += bm25_weight / (k + bm25_rank)
    if image_rank is not None:
        raw_score += vector_weight / (k + image_rank)
    maximum = (vector_weight * (2 if include_images or image_rank is not None else 1) + bm25_weight) / (k + 1)
    return raw_score / maximum if maximum else 0.0


def _image_vector_candidates(session, doc_map, query_embedding, candidate_limit,
                             exclude_section_keys=None):
    """Discover visual evidence without loading image bytes or stored vectors."""
    image = LogicalImage
    stmt = select(image.id, image.document_id, image.section_id,
                  (1 - image.embedding.cosine_distance(query_embedding)).label("score")).where(
        image.document_id.in_(_search_document_ids(doc_map)),
        image.section_id.isnot(None), image.embedding.isnot(None))
    if exclude_section_keys:
        stmt = stmt.where(tuple_(image.document_id, image.section_id).not_in(exclude_section_keys))
    return session.execute(stmt.order_by(
        image.embedding.cosine_distance(query_embedding), image.id).limit(candidate_limit)).all()


def _bm25_section_candidates(
    session: Session,
    doc_map: Dict[DocumentId, Dict[str, Any]],
    query: str,
    query_variants: FtsQueryVariants,
    candidate_limit: int,
    fts_groups: Optional[List[Tuple[str, List[DocumentId]]]] = None,
    exclude_section_ids: Optional[List[int]] = None,
) -> Tuple[Dict[Tuple[DocumentId, str], float], Dict[Tuple[DocumentId, str], int]]:
    merged = {}
    ranks = {}
    groups = _document_fts_groups(doc_map, query) if fts_groups is None else fts_groups
    for fts_config, config_doc_ids in groups:
        group = {}
        bm25_field = (
            f"title_{fts_config}"
            if fts_config in BM25_STEMMED_CONFIGS
            else "title"
        )
        for variant in _query_variants_for_config(fts_config, query, query_variants):
            bm25_score = func.paradedb.score(LogicalSection.id)
            stmt = select(
                LogicalSection.document_id,
                LogicalSection.section_id,
                bm25_score.label("bm25_score"),
            ).where(
                *([] if isinstance(doc_map, SearchScope) else [LogicalSection.document_id.in_(config_doc_ids)]),
                LogicalSection.id.op("@@@")(func.paradedb.match(bm25_field, variant)),
            )
            stmt = _apply_workspace_partition_filter(
                stmt, LogicalSection, doc_map, config_doc_ids
            )
            if exclude_section_ids:
                stmt = stmt.where(LogicalSection.id.not_in(exclude_section_ids))
            if isinstance(doc_map, SearchScope) and not doc_map.direct_workspace_filter(lexical=True):
                # pg_search 0.18 can lose score projections above a scope join.
                # Materialize scores before the document semi-join; apply the
                # candidate limit only after every authorized document filter.
                scored = stmt.cte("section_bm25").prefix_with("MATERIALIZED")
                stmt = select(scored.c.document_id, scored.c.section_id, scored.c.bm25_score).where(
                    scored.c.document_id.in_(config_doc_ids)).order_by(scored.c.bm25_score.desc()).limit(candidate_limit)
            else:
                stmt = stmt.order_by(bm25_score.desc()).limit(candidate_limit)
            for doc_internal_id, section_id, score in session.execute(stmt).all():
                if not section_id:
                    continue
                key = (doc_internal_id, section_id)
                value = float(score or 0.0)
                current = group.get(key)
                if current is None or value > current:
                    group[key] = value
        ordered = sorted(group, key=group.get, reverse=True)
        for rank, key in enumerate(ordered, start=1):
            merged[key] = group[key]
            ranks[key] = min(ranks.get(key, rank), rank)
    return merged, ranks


def _bm25_block_candidates(
    session: Session,
    doc_map: Dict[DocumentId, Dict[str, Any]],
    query: str,
    query_variants: FtsQueryVariants,
    candidate_limit: int,
    section_id: Optional[str] = None,
    fts_groups: Optional[List[Tuple[str, List[DocumentId]]]] = None,
    exclude_section_keys: Optional[List[Tuple[DocumentId, str]]] = None,
) -> Tuple[Dict[int, Tuple[DocumentId, Optional[str], float]], Dict[int, int]]:
    merged = {}
    ranks = {}
    groups = _document_fts_groups(doc_map, query) if fts_groups is None else fts_groups
    for fts_config, config_doc_ids in groups:
        group = {}
        bm25_field = (
            f"content_{fts_config}"
            if fts_config in BM25_STEMMED_CONFIGS
            else "content"
        )
        for variant in _query_variants_for_config(fts_config, query, query_variants):
            bm25_score = func.paradedb.score(LogicalBlock.id)
            stmt = select(
                LogicalBlock.id,
                LogicalBlock.document_id,
                LogicalBlock.section_id,
                bm25_score.label("bm25_score"),
            ).where(
                *([] if isinstance(doc_map, SearchScope) else [LogicalBlock.document_id.in_(config_doc_ids)]),
                LogicalBlock.id.op("@@@")(func.paradedb.match(bm25_field, variant)),
            )
            stmt = _apply_workspace_partition_filter(
                stmt, LogicalBlock, doc_map, config_doc_ids
            )
            if section_id:
                stmt = stmt.where(LogicalBlock.section_id == section_id)
            if exclude_section_keys:
                stmt = stmt.where(
                    tuple_(LogicalBlock.document_id, LogicalBlock.section_id).not_in(
                        exclude_section_keys
                    )
                )
            if isinstance(doc_map, SearchScope) and not doc_map.direct_workspace_filter(lexical=True):
                scored = stmt.cte("block_bm25").prefix_with("MATERIALIZED")
                stmt = select(scored.c.id, scored.c.document_id, scored.c.section_id, scored.c.bm25_score).where(
                    scored.c.document_id.in_(config_doc_ids)).order_by(scored.c.bm25_score.desc()).limit(candidate_limit)
            else:
                stmt = stmt.order_by(bm25_score.desc()).limit(candidate_limit)
            for block_id, doc_internal_id, block_section_id, score in session.execute(stmt).all():
                value = float(score or 0.0)
                current = group.get(block_id)
                if current is None or value > current[2]:
                    group[block_id] = (doc_internal_id, block_section_id, value)
        ordered = sorted(group, key=lambda block_id: group[block_id][2], reverse=True)
        for rank, block_id in enumerate(ordered, start=1):
            merged[block_id] = group[block_id]
            ranks[block_id] = min(ranks.get(block_id, rank), rank)
    return merged, ranks


def get_scoped_document_fts_configs(
    session: Session,
    query: str,
    user_id: Optional[str] = None,
    workspace_id: ScopeValue = None,
    file_name: ScopeValue = None,
    document_id: DocumentIdScope = None,
) -> List[str]:
    """Return FTS configs only for documents inside the requested search scope."""
    stmt = select(LogicalDocument.fts_config).distinct()
    stmt = _apply_document_filters(
        stmt,
        user_id=user_id,
        workspace_id=workspace_id,
        file_name=file_name,
        document_id=document_id,
    )
    rows = session.execute(stmt).all()
    fallback_config = None
    configs = []
    for row in rows:
        config = row[0]
        if not config:
            if fallback_config is None:
                fallback_config = get_pg_ts_config(query)
            config = fallback_config
        normalized = _normalize_fts_config(config)
        if normalized not in configs:
            configs.append(normalized)
    return configs


def _apply_document_filters(
    stmt,
    user_id: Optional[str] = None,
    workspace_id: ScopeValue = None,
    file_name: ScopeValue = None,
    document_id: DocumentIdScope = None,
):
    workspace_ids = _normalize_scope_values(workspace_id)
    file_names = _normalize_scope_values(file_name)
    document_ids = (document_id if isinstance(document_id, SelectBase)
                   else [document_id] if isinstance(document_id, str) else list(document_id or []))

    if user_id:
        stmt = stmt.where(LogicalDocument.user_id == user_id)
    if workspace_id is not None:
        stmt = stmt.where(LogicalDocument.workspace_id.in_(workspace_ids))
    if file_name is not None:
        stmt = stmt.where(LogicalDocument.file_name.in_(file_names))
    if document_id is not None:
        stmt = stmt.where(LogicalDocument.id.in_(document_ids))
    return stmt


def get_document_by_internal_id(
    session: Session,
    document_id: DocumentId,
    workspace_id: ScopeValue = None,
) -> Optional[LogicalDocument]:
    stmt = select(LogicalDocument).where(LogicalDocument.id == document_id)
    stmt = _apply_document_filters(stmt, workspace_id=workspace_id)
    return session.execute(stmt).scalar_one_or_none()


def search_document_metadata(
    session: Session,
    query: str,
    user_id: Optional[str] = None,
    workspace_id: ScopeValue = None,
    file_name: ScopeValue = None,
    document_id: DocumentIdScope = None,
) -> List[Dict[str, Any]]:
    """Return scoped documents whose file name, source, or overview matches the query."""
    stmt = select(LogicalDocument)
    stmt = _apply_document_filters(
        stmt,
        user_id=user_id,
        workspace_id=workspace_id,
        file_name=file_name,
        document_id=document_id,
    )
    documents = session.execute(stmt).scalars().all()

    normalized_query = " ".join(query.casefold().split())
    query_tokens = set(re.findall(r"\w+", normalized_query, flags=re.UNICODE))
    results = []
    for document in documents:
        fields = {
            "file_name": document.file_name or "",
            "source": _source_value(document.source) or "",
            "overview": document.overview or "",
        }
        normalized_fields = {
            name: " ".join(value.casefold().split())
            for name, value in fields.items()
        }
        matched_fields = []
        token_matches = 0
        searchable_text = " ".join(normalized_fields.values())
        if normalized_query and normalized_query in searchable_text:
            matched_fields.extend([
                name for name, value in normalized_fields.items()
                if normalized_query in value
            ])
        if query_tokens:
            searchable_tokens = set(re.findall(r"\w+", searchable_text, flags=re.UNICODE))
            token_matches = len(query_tokens & searchable_tokens)
            for name, value in normalized_fields.items():
                if query_tokens & set(re.findall(r"\w+", value, flags=re.UNICODE)):
                    matched_fields.append(name)

        # Metadata is only a document-level hit when the complete query phrase
        # or every query token is present. Matching one generic word from a
        # multi-word query (for example "recette" without "couscous") must
        # not promote an otherwise unrelated document.
        complete_token_match = bool(query_tokens) and token_matches == len(query_tokens)
        phrase_match = bool(normalized_query) and normalized_query in searchable_text
        if not phrase_match and not complete_token_match:
            continue

        exact_bonus = 1.0 if normalized_query in normalized_fields["file_name"] else 0.0
        token_ratio = token_matches / max(len(query_tokens), 1)
        relevance = min(1.0, 0.65 * token_ratio + 0.35 * exact_bonus)
        results.append({
            "document_id": document.id,
            "file_name": document.file_name,
            "workspace_id": document.workspace_id,
            "source": _source_value(document.source),
            "total_pages": document.total_pages,
            "overview": document.overview,
            "metadata_score": round(relevance, 4),
            "matched_metadata_fields": sorted(set(matched_fields)),
        })

    return sorted(results, key=lambda item: item["metadata_score"], reverse=True)


def get_document_by_file_name(
    session: Session,
    file_name: str,
    user_id: Optional[str] = None,
    workspace_id: ScopeValue = None,
) -> Optional[LogicalDocument]:
    stmt = select(LogicalDocument)
    stmt = _apply_document_filters(stmt, user_id=user_id, workspace_id=workspace_id, file_name=file_name)
    return session.execute(stmt).scalars().first()


def get_document_total_pages(
    session: Session,
    file_name: Optional[str] = None,
    user_id: Optional[str] = None,
    workspace_id: ScopeValue = None,
    document_id: DocumentIdScope = None,
) -> Optional[Dict[str, Any]]:
    stmt = select(
        LogicalDocument.id.label("document_id"),
        LogicalDocument.total_pages,
        LogicalDocument.user_id,
        LogicalDocument.file_name,
        LogicalDocument.workspace_id,
    )
    stmt = _apply_document_filters(stmt, user_id=user_id, workspace_id=workspace_id, file_name=file_name, document_id=document_id)
    row = session.execute(stmt).first()
    if not row:
        return None
    return {
        "document_id": row.document_id,
        "user_id": row.user_id,
        "file_name": row.file_name,
        "workspace_id": row.workspace_id,
        "total_pages": row.total_pages,
    }


def read_full_document_content(
    session: Session,
    file_name: Optional[str] = None,
    user_id: Optional[str] = None,
    workspace_id: ScopeValue = None,
    document_id: DocumentIdScope = None,
) -> Optional[Dict[str, Any]]:
    """Read all indexed text and images as section-grouped content chunks."""
    doc_stmt = select(LogicalDocument)
    doc_stmt = _apply_document_filters(doc_stmt, user_id=user_id, workspace_id=workspace_id, file_name=file_name, document_id=document_id)
    doc = session.execute(doc_stmt).scalars().first()
    if not doc:
        return None

    blocks_stmt = (
        select(LogicalBlock).options(load_only(
            LogicalBlock.id, LogicalBlock.block_id, LogicalBlock.block_type,
            LogicalBlock.content, LogicalBlock.page_number, LogicalBlock.section_id,
        ))
        .where(LogicalBlock.document_id == doc.id, LogicalBlock.workspace_id == doc.workspace_id)
        .order_by(LogicalBlock.page_number, LogicalBlock.id)
    )
    blocks = list(session.execute(blocks_stmt).scalars().all())

    source = _source_value(doc.source)
    sections_stmt = (
        select(LogicalSection).options(load_only(
            LogicalSection.id, LogicalSection.section_id, LogicalSection.title,
        ))
        .where(LogicalSection.document_id == doc.id, LogicalSection.workspace_id == doc.workspace_id)
        .order_by(LogicalSection.id)
    )
    images_stmt = (
        select(LogicalImage).options(*bounded_image_options(), load_only(
            LogicalImage.id, LogicalImage.section_id, LogicalImage.page_number,
        ))
        .where(LogicalImage.document_id == doc.id)
        .order_by(LogicalImage.page_number, LogicalImage.id)
    )
    images = list(session.execute(images_stmt).scalars().all())
    sections = session.execute(sections_stmt).scalars().all()
    section_by_key = {section.section_id: section for section in sections}

    chunks = {}
    entries = [("block", block) for block in blocks] + [("image", image) for image in images]
    entries.sort(key=lambda entry: (
        entry[1].page_number is None, entry[1].page_number or 0,
        entry[0] == "image", entry[1].id,
    ))
    for kind, item in entries:
        section = section_by_key.get(item.section_id)
        chunk = chunks.setdefault(item.section_id, {
            "content": [section.title] if section and section.title else [],
            "images": [],
        })
        if kind == "block":
            chunk["content"].append(f"[block_id: {item.id}]\n{item.content or ''}")
        else:
            chunk["images"].append(_serialize_image(item))
    # Headings without direct evidence are still part of the full document.
    for section in sections:
        chunks.setdefault(section.section_id, {
            "content": [section.title] if section.title else [], "images": [],
        })
    content = [
        {"content": "\n\n".join(chunk["content"]), "images": chunk["images"]}
        for chunk in chunks.values()
    ]

    return {
        "document_id": doc.id,
        "user_id": doc.user_id,
        "file_name": doc.file_name,
        "workspace_id": doc.workspace_id,
        "source": source,
        "total_pages": doc.total_pages,
        "content": content,
    }


def list_documents(
    session: Session,
    limit: int = 50,
    offset: int = 0,
    user_id: Optional[str] = None,
    workspace_id: ScopeValue = None,
) -> List[LogicalDocument]:
    stmt = select(LogicalDocument)
    stmt = _apply_document_filters(stmt, user_id=user_id, workspace_id=workspace_id)
    stmt = stmt.order_by(LogicalDocument.created_at.desc()).limit(limit).offset(offset)
    return list(session.execute(stmt).scalars().all())


def get_scoped_document_refs(
    session: Session,
    *,
    workspace_id: ScopeValue,
    file_name: ScopeValue = None,
) -> List[Dict[str, Any]]:
    """Return canonical document identities inside an already-authorized scope."""
    stmt = select(
        LogicalDocument.id,
        LogicalDocument.file_name,
        LogicalDocument.workspace_id,
    )
    stmt = _apply_document_filters(
        stmt,
        workspace_id=workspace_id,
        file_name=file_name,
    ).order_by(LogicalDocument.id)
    return [
        {
            "document_id": document_id,
            "file_name": document_file_name,
            "workspace_id": document_workspace_id,
        }
        for document_id, document_file_name, document_workspace_id
        in session.execute(stmt).all()
    ]


def search_documents(
    session: Session,
    query: str,
    limit: int = 10,
    user_id: Optional[str] = None,
    workspace_id: ScopeValue = None,
    file_name: ScopeValue = None,
) -> List[Dict[str, Any]]:
    ts_config = get_pg_ts_config(query)
    search_text = func.concat_ws(
        " ",
        func.coalesce(LogicalDocument.user_id, ""),
        func.coalesce(LogicalDocument.file_name, ""),
        func.coalesce(LogicalDocument.workspace_id, ""),
        func.coalesce(LogicalDocument.source, ""),
        func.coalesce(LogicalDocument.overview, ""),
    )
    search_vector = func.to_tsvector(ts_config, search_text)
    ts_query = func.plainto_tsquery(ts_config, query)

    stmt = select(
        LogicalDocument,
        func.ts_rank(search_vector, ts_query).label("rank"),
    ).where(
        search_vector.op("@@")(ts_query)
    )

    stmt = _apply_document_filters(stmt, user_id=user_id, workspace_id=workspace_id, file_name=file_name)
    stmt = stmt.order_by(text("rank DESC"), LogicalDocument.created_at.desc()).limit(limit)

    results = session.execute(stmt).all()
    return [
        {
            "user_id": doc.user_id,
            "file_name": doc.file_name,
            "workspace_id": doc.workspace_id,
            "source": doc.source,
            "total_pages": doc.total_pages,
            "overview_preview": doc.overview[:500] if doc.overview else None,
            "rank": float(rank),
            "created_at": str(doc.created_at),
            "updated_at": str(doc.updated_at),
        }
        for doc, rank in results
    ]


def get_blocks_for_document(
    session: Session,
    document_id: DocumentId,
    page_number: Optional[int] = None,
    section_id: Optional[str] = None,
    limit: int = 100,
    offset: int = 0
) -> List[LogicalBlock]:
    stmt = select(LogicalBlock).options(defer(LogicalBlock.embedding, raiseload=True)).where(
        LogicalBlock.document_id == document_id
    )
    if page_number is not None:
        stmt = stmt.where(LogicalBlock.page_number == page_number)
    if section_id:
        stmt = stmt.where(LogicalBlock.section_id == section_id)
    stmt = stmt.order_by(LogicalBlock.id).limit(limit).offset(offset)
    return list(session.execute(stmt).scalars().all())


def get_block_by_internal_id(session: Session, block_internal_id: int) -> Optional[LogicalBlock]:
    stmt = select(LogicalBlock).where(LogicalBlock.id == block_internal_id)
    return session.execute(stmt).scalar_one_or_none()


_MAX_IMAGE_DIM = 800
_JPEG_QUALITY = 70


def _open_safe_image(img_bytes):
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        img = Image.open(io.BytesIO(img_bytes))
    if img.width * img.height > settings.IMAGE_MAX_PIXELS:
        img.close()
        raise ValueError("Image exceeds the configured pixel limit")
    return img


def _compress_image_base64(raw: str) -> str:
    if len(raw) > settings.IMAGE_MAX_ENCODED_BYTES:
        raise ValueError("Image exceeds the configured encoded byte limit")
    # Strip optional data-URL prefix and detect format
    if raw.startswith("data:"):
        header, raw = raw.split(",", 1)
        fmt = header.split(";")[0].split("/")[-1].upper()
        if fmt == "JPG":
            fmt = "JPEG"
    else:
        fmt = "JPEG"

    img_bytes = _decode_image_base64(raw)
    if img_bytes is None:
        raise ValueError("Image exceeds the byte limit or is not valid base64")
    img = _open_safe_image(img_bytes)

    if img.width > _MAX_IMAGE_DIM or img.height > _MAX_IMAGE_DIM:
        img.thumbnail((_MAX_IMAGE_DIM, _MAX_IMAGE_DIM), Image.LANCZOS)

    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
        fmt = "JPEG"

    buf = io.BytesIO()
    save_fmt = fmt if fmt in ("JPEG", "PNG", "WEBP") else "JPEG"
    save_kwargs = {"quality": _JPEG_QUALITY, "optimize": True} if save_fmt == "JPEG" else {}
    img.save(buf, format=save_fmt, **save_kwargs)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _decode_image_base64(raw: str) -> Optional[bytes]:
    if not raw:
        return None
    try:
        if len(raw) > settings.IMAGE_MAX_ENCODED_BYTES:
            return None
        if raw.startswith("data:"):
            _, raw = raw.split(",", 1)
        if (len(raw) // 4) * 3 > settings.IMAGE_MAX_DECODED_BYTES + 2:
            return None
        decoded = base64.b64decode(raw)
        return decoded if len(decoded) <= settings.IMAGE_MAX_DECODED_BYTES else None
    except Exception:
        return None


def _first_decodable_image_base64(*values: Optional[str]) -> str:
    for value in values:
        if not value:
            continue
        img_bytes = _decode_image_base64(value)
        if not img_bytes:
            continue
        try:
            with _open_safe_image(img_bytes) as img:
                img.verify()
            return value
        except Exception:
            continue
    return ""


def _image_content_raw(image: LogicalImage) -> str:
    content = image.content or ""
    if content.startswith("data:image/") or content == getattr(image, "image_base64", None) or len(content) > settings.IMAGE_MAX_ENCODED_BYTES:
        return ""
    decoded = _decode_image_base64(content)
    if decoded and decoded.startswith((b"\x89PNG", b"\xff\xd8\xff", b"GIF8", b"RIFF", b"II*\x00", b"MM\x00*")):
        return ""
    return "" if content and _first_decodable_image_base64(content) else content


def _image_dimensions_from_base64(raw: str) -> Optional[Tuple[int, int]]:
    img_bytes = _decode_image_base64(raw)
    if not img_bytes:
        return None
    try:
        with _open_safe_image(img_bytes) as img:
            return img.width, img.height
    except Exception:
        return None


def _serialize_image(image: LogicalImage) -> Dict[str, Any]:
    raw_content = _image_content_raw(image)
    raw_image = _first_decodable_image_base64(image.content, image.image_base64)
    compressed_image = _compress_image_base64(raw_image) if raw_image else ""
    return {
        "image_id": image.id,
        "content": raw_content,
        "image_base64": compressed_image,
    }


def _serialize_image_metadata(image: LogicalImage) -> Dict[str, Any]:
    return {
        "image_id": image.id,
        "content": _image_content_raw(image),
    }


def _get_section_image_records(
    session: Session,
    doc_id: DocumentId,
    section_id: Optional[str],
    offset: int = 0,
) -> List[LogicalImage]:
    if not section_id:
        return []

    stmt = select(LogicalImage).options(*bounded_image_options()).where(
        LogicalImage.document_id == doc_id,
        LogicalImage.section_id == section_id,
    ).order_by(LogicalImage.page_number, LogicalImage.id).offset(offset).limit(
        settings.READ_IMAGE_PAGE_SIZE + 1
    )
    return list(session.execute(stmt).scalars().all())


def _image_block_match_key(
    page_number: Optional[int],
    content: Optional[str],
    bbox: Any,
) -> Tuple[Optional[int], str, str]:
    return (
        page_number,
        "" if bbox is not None else content or "",
        json.dumps(bbox, sort_keys=True, separators=(",", ":")),
    )


def _get_image_counts_by_section(
    session: Session,
    doc_ids: List[DocumentId],
    section_keys: Optional[List[Tuple[DocumentId, str]]] = None,
) -> Dict[Tuple[DocumentId, str], int]:
    if not doc_ids:
        return {}
    stmt = select(
        LogicalImage.document_id,
        LogicalImage.section_id,
        func.count(LogicalImage.id).label("cnt"),
    ).where(
        LogicalImage.document_id.in_(doc_ids),
        LogicalImage.section_id.isnot(None),
    )
    if section_keys is not None:
        if not section_keys:
            return {}
        stmt = stmt.where(
            tuple_(LogicalImage.document_id, LogicalImage.section_id).in_(section_keys)
        )
    stmt = stmt.group_by(LogicalImage.document_id, LogicalImage.section_id)
    return {(row[0], row[1]): row[2] for row in session.execute(stmt).all()}


def semantic_search_sections(
    session: Session,
    query_embedding: List[float],
    limit: int = 5,
    user_id: Optional[str] = None,
    workspace_id: ScopeValue = None,
    file_name: ScopeValue = None,
) -> List[Dict[str, Any]]:
    doc_stmt = select(LogicalDocument.id, LogicalDocument.source)
    doc_stmt = _apply_document_filters(doc_stmt, user_id=user_id, workspace_id=workspace_id, file_name=file_name)
    doc_rows = session.execute(doc_stmt).all()

    if not doc_rows:
        return []

    doc_id_map = {row[0]: _source_value(row[1]) for row in doc_rows}
    doc_ids = list(doc_id_map.keys())

    raw_score = (1 - LogicalSection.embedding.cosine_distance(query_embedding))
    score = func.coalesce(raw_score, 0.0)

    stmt = select(
        LogicalSection,
        LogicalSection.document_id.label("doc_internal_id"),
        score.label("score"),
    ).where(
        LogicalSection.document_id.in_(doc_ids),
        LogicalSection.embedding.isnot(None),
    ).order_by(text("score DESC")).limit(limit)

    results = session.execute(stmt).all()

    return [
        {
            "content": section.title,
            "section_id": section.id,
            "score": round(float(s), 4),
            "source": doc_id_map.get(doc_internal_id),
        }
        for section, doc_internal_id, s in results
    ]


def hybrid_search_blocks(
    session: Session,
    document_id: DocumentId,
    query: str,
    query_embedding: List[float],
    limit: int = 50,
    alpha: float = 0.8
) -> List[Dict[str, Any]]:
    ts_config = get_pg_ts_config(query)
    raw_vector_score = (1 - LogicalBlock.embedding.cosine_distance(query_embedding))
    vector_score = func.coalesce(raw_vector_score, 0.0)

    fts_rank = func.ts_rank(
        LogicalBlock.content_tsv,
        func.plainto_tsquery(ts_config, query)
    )
    fts_score = func.coalesce(fts_rank * 10, 0.0)

    combined_score = (alpha * vector_score) + ((1 - alpha) * fts_score)

    stmt = select(
        LogicalBlock,
        vector_score.label('vector_score'),
        fts_score.label('fts_score'),
        combined_score.label('combined_score')
    ).where(
        LogicalBlock.document_id == document_id,
        or_(
            LogicalBlock.content_tsv.op('@@')(func.plainto_tsquery(ts_config, query)),
            LogicalBlock.embedding.isnot(None)
        )
    )

    stmt = stmt.order_by(text('combined_score DESC')).limit(limit)
    results = session.execute(stmt).all()
    blocks = [block for block, _, _, _ in results]
    section_public_ids = _public_section_ids_for_blocks(session, blocks)

    return [
        {
            "content": block.content,
            "id": block.id,
            "section_id": section_public_ids.get((block.document_id, block.section_id)),
            "page": block.page_number,
            "score": round(float(c_score), 4),
        }
        for block, v_score, f_score, c_score in results
    ]


def global_hybrid_search_blocks(
    session: Session,
    query: str,
    query_embedding: List[float],
    limit: int = 10,
    alpha: float = 0.8,
    user_id: Optional[str] = None,
    workspace_id: ScopeValue = None,
    file_name: ScopeValue = None,
) -> List[Dict[str, Any]]:
    ts_config = get_pg_ts_config(query)
    doc_stmt = select(LogicalDocument.id, LogicalDocument.source)
    doc_stmt = _apply_document_filters(doc_stmt, user_id=user_id, workspace_id=workspace_id, file_name=file_name)
    doc_rows = session.execute(doc_stmt).all()

    if not doc_rows:
        return []

    doc_id_map = {row[0]: _source_value(row[1]) for row in doc_rows}
    doc_ids = list(doc_id_map.keys())

    raw_vector_score = (1 - LogicalBlock.embedding.cosine_distance(query_embedding))
    vector_score = func.coalesce(raw_vector_score, 0.0)

    fts_rank = func.ts_rank(
        LogicalBlock.content_tsv,
        func.plainto_tsquery(ts_config, query)
    )
    fts_score = func.coalesce(fts_rank * 10, 0.0)

    combined_score = (alpha * vector_score) + ((1 - alpha) * fts_score)

    stmt = select(
        LogicalBlock,
        LogicalBlock.document_id.label('doc_internal_id'),
        combined_score.label('combined_score')
    ).where(
        LogicalBlock.document_id.in_(doc_ids),
        or_(
            LogicalBlock.content_tsv.op('@@')(func.plainto_tsquery(ts_config, query)),
            LogicalBlock.embedding.isnot(None)
        )
    )

    stmt = stmt.order_by(text('combined_score DESC')).limit(limit)
    results = session.execute(stmt).all()
    blocks = [block for block, _, _ in results]
    section_public_ids = _public_section_ids_for_blocks(session, blocks)

    return [
        {
            "content": block.content,
            "id": block.id,
            "section_id": section_public_ids.get((block.document_id, block.section_id)),
            "page": block.page_number,
            "source": doc_id_map.get(doc_internal_id),
            "score": round(float(c_score), 4),
        }
        for block, doc_internal_id, c_score in results
    ]


def get_blocks_from_sections(
    session: Session,
    section_ids: List[str],
    query: str,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    if not section_ids:
        return []

    ts_config = get_pg_ts_config(query)
    stmt = select(
        LogicalBlock,
        LogicalDocument.source,
        func.ts_rank(
            LogicalBlock.content_tsv,
            func.plainto_tsquery(ts_config, query)
        ).label('rank')
    ).join(
        LogicalDocument, LogicalBlock.document_id == LogicalDocument.id
    ).where(
        LogicalBlock.section_id.in_(section_ids),
        LogicalBlock.content_tsv.op('@@')(func.plainto_tsquery(ts_config, query))
    ).order_by(text('rank DESC')).limit(limit)

    results = session.execute(stmt).all()
    blocks = [block for block, _, _ in results]
    section_public_ids = _public_section_ids_for_blocks(session, blocks)

    return [
        {
            "content": block.content,
            "id": block.id,
            "section_id": section_public_ids.get((block.document_id, block.section_id)),
            "page": block.page_number,
            "source": _source_value(source),
            "score": round(float(rank), 4),
        }
        for block, source, rank in results
    ]


def get_blocks_by_section_ids(
    session: Session,
    document_id: DocumentId,
    section_ids: List[str],
) -> List[LogicalBlock]:
    stmt = select(LogicalBlock).where(
        LogicalBlock.document_id == document_id,
        LogicalBlock.section_id.in_(section_ids),
    ).order_by(LogicalBlock.id)
    return list(session.execute(stmt).scalars().all())


def get_document_summary_outline(
    session: Session,
    file_name: str,
    user_id: Optional[str] = None,
    workspace_id: ScopeValue = None,
) -> Optional[Dict[str, Any]]:
    """Return the compact outline exposed by the document summary endpoint."""
    doc_stmt = select(LogicalDocument)
    doc_stmt = _apply_document_filters(
        stmt=doc_stmt,
        user_id=user_id,
        workspace_id=workspace_id,
        file_name=file_name,
    )
    doc = session.execute(doc_stmt).scalars().first()
    if not doc:
        return None

    sections = get_sections_for_document(session, doc.id, limit=10000)
    previews: Dict[str, str] = {}
    if doc.total_pages < SUMMARY_PREVIEW_PAGE_THRESHOLD:
        internal_section_ids = [
            section.section_id for section in sections if section.section_id
        ]
        if internal_section_ids:
            block_rows = session.execute(
                select(LogicalBlock.section_id, LogicalBlock.content)
                .where(
                    LogicalBlock.document_id == doc.id,
                    LogicalBlock.section_id.in_(internal_section_ids),
                    LogicalBlock.content.isnot(None),
                    func.btrim(LogicalBlock.content) != "",
                )
                .order_by(LogicalBlock.id)
            ).all()
            for internal_section_id, content in block_rows:
                if internal_section_id in previews:
                    continue
                normalized = re.sub(r"\s+", " ", content or "").strip()
                if len(normalized) > SUMMARY_PREVIEW_MAX_CHARS:
                    normalized = normalized[:SUMMARY_PREVIEW_MAX_CHARS - 3].rstrip() + "..."
                previews[internal_section_id] = normalized

    section_items = []
    outline_lines = []
    for section in sections:
        title = section.title or ""
        preview = previews.get(section.section_id or "", "")
        section_item = {
            "section_id": section.id,
            "title": title,
        }
        if preview:
            section_item["preview"] = preview
        section_items.append(section_item)
        outline_lines.append(f"{title} — {preview}" if preview else title)

    return {
        "document_id": doc.id,
        "file_name": doc.file_name,
        "workspace_id": doc.workspace_id,
        "total_pages": doc.total_pages,
        "sections": section_items,
        "table_of_contents": "\n".join(outline_lines),
    }


def get_document_table_of_contents(
    session: Session,
    file_name: str,
    user_id: Optional[str] = None,
    workspace_id: ScopeValue = None,
) -> Optional[Dict[str, Any]]:
    """Compatibility wrapper returning the public summary-outline payload."""
    outline = get_document_summary_outline(
        session,
        file_name,
        user_id=user_id,
        workspace_id=workspace_id,
    )
    if not outline:
        return None
    return {"table_of_contents": outline["table_of_contents"]}


def _sample_routing_section_content(contents: List[str]) -> str:
    """Keep representative beginning, middle, and ending text for one section."""
    normalized_parts = [
        re.sub(r"\s+", " ", content or "").strip()
        for content in contents
    ]
    combined = "\n".join(part for part in normalized_parts if part)
    if len(combined) <= ROUTING_SECTION_CONTENT_MAX_CHARS:
        return combined

    separator = "\n[...]\n"
    sample_size = (ROUTING_SECTION_CONTENT_MAX_CHARS - (2 * len(separator))) // 3
    middle_start = max(0, (len(combined) - sample_size) // 2)
    return separator.join((
        combined[:sample_size].rstrip(),
        combined[middle_start:middle_start + sample_size].strip(),
        combined[-sample_size:].lstrip(),
    ))


def get_document_routing_source(
    session: Session,
    file_name: str,
    user_id: Optional[str] = None,
    workspace_id: ScopeValue = None,
) -> Optional[Dict[str, Any]]:
    """Return representative content from every section for routing summarization."""
    doc_stmt = select(LogicalDocument)
    doc_stmt = _apply_document_filters(
        stmt=doc_stmt,
        user_id=user_id,
        workspace_id=workspace_id,
        file_name=file_name,
    )
    doc = session.execute(doc_stmt).scalars().first()
    if not doc:
        return None

    sections = get_sections_for_document(session, doc.id, limit=10000)
    block_rows = session.execute(
        select(LogicalBlock.section_id, LogicalBlock.content)
        .where(
            LogicalBlock.document_id == doc.id,
            LogicalBlock.content.isnot(None),
            func.btrim(LogicalBlock.content) != "",
        )
        .order_by(LogicalBlock.id)
    ).all()

    content_by_section: Dict[Optional[str], List[str]] = {}
    for section_id, content in block_rows:
        content_by_section.setdefault(section_id, []).append(content)

    section_items = []
    known_section_ids = set()
    for section in sections:
        internal_section_id = section.section_id
        known_section_ids.add(internal_section_id)
        section_items.append({
            "title": str(section.title or "").strip(),
            "content": _sample_routing_section_content(
                content_by_section.get(internal_section_id, [])
            ),
        })

    unmatched_content = [
        content
        for section_id, contents in content_by_section.items()
        if section_id not in known_section_ids
        for content in contents
    ]
    if unmatched_content:
        section_items.append({
            "title": "Document content",
            "content": _sample_routing_section_content(unmatched_content),
        })

    return {
        "document_id": doc.id,
        "file_name": doc.file_name,
        "workspace_id": doc.workspace_id,
        "total_pages": doc.total_pages,
        "sections": section_items,
    }


def get_sections_for_document(
    session: Session,
    document_id: DocumentId,
    limit: int = 100,
    offset: int = 0,
) -> List[LogicalSection]:
    stmt = select(LogicalSection).where(
        LogicalSection.document_id == document_id
    ).order_by(LogicalSection.id).limit(limit).offset(offset)
    return list(session.execute(stmt).scalars().all())


def get_section_by_id(session: Session, document_id: DocumentId, section_id: str) -> Optional[LogicalSection]:
    try:
        public_section_id = int(str(section_id).strip())
    except (TypeError, ValueError):
        return None

    stmt = select(LogicalSection).where(
        LogicalSection.document_id == document_id,
        LogicalSection.id == public_section_id
    )
    return session.execute(stmt).scalar_one_or_none()


def search_sections_fulltext(
    session: Session,
    document_id: DocumentId,
    query: str,
    limit: int = 50,
    doc=None
) -> List[Dict[str, Any]]:
    ts_config = get_pg_ts_config(query)
    stmt = select(
        LogicalSection,
        func.ts_rank(
            LogicalSection.title_tsv,
            func.plainto_tsquery(ts_config, query)
        ).label('rank')
    ).where(
        LogicalSection.document_id == document_id,
        LogicalSection.title_tsv.op('@@')(func.plainto_tsquery(ts_config, query))
    ).order_by(text('rank DESC')).limit(limit)

    results = session.execute(stmt).all()

    source = _source_value(doc.source) if doc else None

    return [
        {
            "content": section.title,
            "section_id": section.id,
            "source": source,
            "score": round(float(rank), 4),
        }
        for section, rank in results
    ]


def global_search_sections_fulltext(
    session: Session,
    query: str,
    limit: int = 10,
    user_id: Optional[str] = None,
    workspace_id: ScopeValue = None,
    file_name: ScopeValue = None,
) -> List[Dict[str, Any]]:
    ts_config = get_pg_ts_config(query)
    doc_stmt = select(LogicalDocument.id, LogicalDocument.source)
    doc_stmt = _apply_document_filters(doc_stmt, user_id=user_id, workspace_id=workspace_id, file_name=file_name)
    doc_rows = session.execute(doc_stmt).all()

    if not doc_rows:
        return []

    doc_id_map = {row[0]: _source_value(row[1]) for row in doc_rows}
    doc_ids = list(doc_id_map.keys())

    stmt = select(
        LogicalSection,
        LogicalSection.document_id.label('doc_internal_id'),
        func.ts_rank(
            LogicalSection.title_tsv,
            func.plainto_tsquery(ts_config, query)
        ).label('rank')
    ).where(
        LogicalSection.document_id.in_(doc_ids),
        LogicalSection.title_tsv.op('@@')(func.plainto_tsquery(ts_config, query))
    ).order_by(text('rank DESC')).limit(limit)

    results = session.execute(stmt).all()

    return [
        {
            "content": section.title,
            "section_id": section.id,
            "source": doc_id_map.get(doc_internal_id),
            "score": round(float(rank), 4),
        }
        for section, doc_internal_id, rank in results
    ]


def get_page_blocks(session: Session, document_id: DocumentId, page_number: int) -> List[LogicalBlock]:
    return get_blocks_for_document(
        session,
        document_id,
        page_number=page_number,
        limit=1000
    )


def get_search_document_metadata(
    session: Session, user_id=None, workspace_id=None, file_name=None, document_id=None,
) -> Dict[DocumentId, Dict[str, Any]]:
    """Load scoped metadata once for one request; never a cross-request cache."""
    stmt = _apply_document_filters(
        select(LogicalDocument.id, LogicalDocument.user_id, LogicalDocument.file_name,
               LogicalDocument.workspace_id, LogicalDocument.source, LogicalDocument.fts_config),
        user_id=user_id, workspace_id=workspace_id, file_name=file_name, document_id=document_id,
    )
    return {row[0]: {"user_id": row[1], "file_name": row[2], "workspace_id": row[3],
                     "source": _source_value(row[4]), "fts_config": row[5]}
            for row in session.execute(stmt).all()}


def unified_search(
    session: Session,
    query: str,
    query_embedding: Optional[List[float]],
    user_id: Optional[str] = None,
    workspace_id: ScopeValue = None,
    file_name: ScopeValue = None,
    document_id: DocumentIdScope = None,
    limit: int = 5,
    fts_query_variants: FtsQueryVariants = None,
    exclude_section_ids: Optional[List[int]] = None,
    include_lexical: bool = True,
    per_document_limit: Optional[int] = None,
    block_content_cache: Optional[Dict[int, Tuple[str, str]]] = None,
    filename_query: Optional[str] = None,
    filename_semantic_scores: Optional[Dict[DocumentId, float]] = None,
    scoped_documents: Optional[Union[SearchScope, Dict[DocumentId, Dict[str, Any]]]] = None,
    include_block_ids: bool = True,
) -> List[Dict[str, Any]]:
    """
    Unified section-level search.

    Pipeline:
    1. Scope documents
    2. Hybrid section search (cosine on title embedding + FTS on titles) -> top candidates
    3. Hybrid block search (cosine + BM25 on content) -> collect section_ids
    4. Exact normalized filename tokens provide document context; confidently
       matched issuer_YEAR filenames narrow discovery to those issuer documents
    5. Fuse block RRF, section RRF, filename text and semantic ranks using
       configured weights (defaults: 75%, 20%, 3%, 2% when filename semantics is enabled)
    6. Validate a bounded fallback window and select the requested winners
    7. Batch-load block ids, pages, matching previews, and image counts for winners

    Image descriptions use block text/BM25 retrieval; logical_images.image_embedding
    supplies a separate visual vector channel with equal vector weight. Both
    contribute to the existing content share through normalized RRF.
    exclude_section_ids contains public LogicalSection.id
    values already returned by earlier passes. Exclusion is applied inside all
    section and block candidate queries so excluded sections cannot consume a
    candidate slot or re-enter through one of their blocks. A missing
    query_embedding selects lexical-only retrieval; include_lexical=False
    selects vector-only retrieval.
    """
    if query_embedding is None and not include_lexical:
        raise ValueError("unified_search requires at least one retrieval channel")

    min_score = settings.SEARCH_MIN_SCORE
    # The filename budget stays intact: 60/40 text/semantic when enabled,
    # entirely text when disabled. No separate environment share setting.
    filename_semantic_weight = settings.SEARCH_FILENAME_WEIGHT * (
        0.4 if settings.SEARCH_FILENAME_SEMANTIC_ENABLED else 0.0)
    filename_text_weight = settings.SEARCH_FILENAME_WEIGHT - filename_semantic_weight
    if not settings.SEARCH_FILENAME_SEMANTIC_ENABLED:
        filename_semantic_scores = None

    # This optional snapshot is produced only by the same request's scoped loader.
    doc_map = (get_search_document_metadata(session, user_id, workspace_id, file_name, document_id)
               if scoped_documents is None else scoped_documents if isinstance(scoped_documents, SearchScope)
               else dict(scoped_documents))
    if not doc_map:
        return []

    if isinstance(doc_map, SearchScope):
        filename_scores, filename_issuer_ids = {}, set()
    else:
        filename_scores, filename_issuer_ids = filename_relevance(
            query if filename_query is None else filename_query, doc_map, settings.HYBRID_RRF_K)
        if filename_issuer_ids:
            doc_map = {key: value for key, value in doc_map.items() if key in filename_issuer_ids}

    # A diversity quota is useful only when multiple scoped documents compete.
    if (doc_map.single_document if isinstance(doc_map, SearchScope) else len(doc_map) == 1):
        per_document_limit = None
    fts_groups = _document_fts_groups(doc_map, query)
    candidate_limit = max(limit * 3, 30)
    excluded_ids = list(dict.fromkeys(
        section_id for section_id in (exclude_section_ids or [])
        if isinstance(section_id, int) and not isinstance(section_id, bool)
    ))
    excluded_section_keys: List[Tuple[DocumentId, str]] = []
    if excluded_ids:
        excluded_section_keys = [
            (document_id, section_id)
            for document_id, section_id in session.execute(
                _apply_workspace_partition_filter(
                    select(LogicalSection.document_id, LogicalSection.section_id).where(
                        LogicalSection.document_id.in_(_search_document_ids(doc_map)),
                        LogicalSection.id.in_(excluded_ids),
                    ),
                    LogicalSection,
                    doc_map,
                )
            ).all()
            if section_id
        ]

    # --- 1. Hybrid section search (cosine on title embedding + FTS on titles) ---
    section_score_map: Dict[Tuple[DocumentId, str], float] = {}
    section_sources: Dict[Tuple[DocumentId, str], Dict[str, Any]] = {}

    section_candidates: Dict[Tuple[DocumentId, str], Tuple[float, float]] = {}
    section_vector_ranks = {}
    if query_embedding is not None:
        raw_sec_cosine = (1 - LogicalSection.embedding.cosine_distance(query_embedding))
        sec_cosine_score = func.coalesce(raw_sec_cosine, 0.0)
        section_vector_stmt = select(
            LogicalSection.document_id,
            LogicalSection.section_id,
            sec_cosine_score.label("vector_score"),
        ).where(
            _search_document_predicate(LogicalSection, doc_map),
            LogicalSection.embedding.isnot(None),
        )
        section_vector_stmt = _apply_workspace_partition_filter(
            section_vector_stmt, LogicalSection, doc_map
        )
        if excluded_ids:
            section_vector_stmt = section_vector_stmt.where(
                LogicalSection.id.not_in(excluded_ids)
            )
        section_vector_stmt = section_vector_stmt.order_by(
            LogicalSection.embedding.cosine_distance(query_embedding)
        ).limit(candidate_limit)

        for rank, (doc_internal_id, sid, v_score) in enumerate(
            session.execute(section_vector_stmt).all(), start=1
        ):
            if not sid:
                continue
            key = (doc_internal_id, sid)
            section_candidates[key] = (float(v_score or 0.0), 0.0)
            section_vector_ranks[key] = rank
    section_bm25_candidates, section_bm25_ranks = ({}, {})
    if include_lexical:
        section_bm25_candidates, section_bm25_ranks = _bm25_section_candidates(
            session, doc_map, query, fts_query_variants, candidate_limit,
            fts_groups=fts_groups,
            exclude_section_ids=excluded_ids,
        )
    for key, bm25_score in section_bm25_candidates.items():
        current = section_candidates.get(key)
        vector_value = current[0] if current else 0.0
        section_candidates[key] = (vector_value, bm25_score)

    for (doc_internal_id, sid), (v_score, bm25_score) in section_candidates.items():
        key = (doc_internal_id, sid)
        vector_rank = section_vector_ranks.get(key) if v_score >= min_score else None
        bm25_rank = section_bm25_ranks.get(key)
        if vector_rank is None and bm25_rank is None:
            continue
        score = round(_rrf_score(vector_rank, bm25_rank), 4)
        section_key = key
        section_score_map[section_key] = score
        d = doc_map.get(doc_internal_id, {})
        section_sources[section_key] = d

    # --- 2. Shared eligible top-k block-vector candidates ---
    content_score_map: Dict[Tuple[DocumentId, str], float] = {}
    block_vector_scores: Dict[int, float] = {}
    eligible_block_vector_rows = []
    if query_embedding is not None:
        raw_vec_score = (1 - LogicalBlock.embedding.cosine_distance(query_embedding))
        vec_score = func.coalesce(raw_vec_score, 0.0)
        content_block_stmt = select(
            LogicalBlock.id,
            LogicalBlock.document_id,
            LogicalBlock.section_id,
            vec_score.label("score"),
        ).where(
            _search_document_predicate(LogicalBlock, doc_map),
            LogicalBlock.section_id.isnot(None),
            LogicalBlock.embedding.isnot(None),
        )
        content_block_stmt = _apply_workspace_partition_filter(
            content_block_stmt, LogicalBlock, doc_map
        )
        if excluded_section_keys:
            content_block_stmt = content_block_stmt.where(
                tuple_(LogicalBlock.document_id, LogicalBlock.section_id).not_in(
                    excluded_section_keys
                )
            )
        content_block_stmt = content_block_stmt.order_by(
            LogicalBlock.embedding.cosine_distance(query_embedding)
        ).limit(candidate_limit)

        eligible_block_vector_rows = session.execute(content_block_stmt).all()
    relevant_block_ranks: Dict[Tuple[DocumentId, str], Dict[int, int]] = defaultdict(dict)
    for rank, row in enumerate(eligible_block_vector_rows, start=1):
        block_id, doc_internal_id, sid, raw_score = row
        score = round(float(raw_score), 4)
        if not sid or score < min_score:
            continue
        section_key = (doc_internal_id, sid)
        content_score_map[section_key] = max(content_score_map.get(section_key, 0.0), score)
        section_sources.setdefault(section_key, doc_map.get(doc_internal_id, {}))
        relevant_block_ranks[section_key][block_id] = rank
        block_vector_scores[block_id] = score

    image_ranks = {}
    image_scores = {}
    matched_images = {}
    if query_embedding is not None:
        for rank, (image_id, doc_id, sid, raw_score) in enumerate(_image_vector_candidates(
                session, doc_map, query_embedding, candidate_limit, excluded_section_keys), start=1):
            score = float(raw_score or 0.0)
            if score < min_score:
                continue
            key = (doc_id, sid)
            image_ranks.setdefault(key, rank)
            image_scores[key] = max(image_scores.get(key, 0.0), score)
            matched_images.setdefault(key, image_id)
            content_score_map[key] = max(content_score_map.get(key, 0.0), score)
            section_sources.setdefault(key, doc_map.get(doc_id, {}))

    # --- 3. Hybrid block search reusing the vector pool and adding FTS candidates ---
    block_section_keys = set()
    block_score_map: Dict[Tuple[DocumentId, str], float] = {}
    block_candidates: Dict[Tuple[DocumentId, str], Tuple[float, float]] = {}
    block_vector_ranks = {}
    for rank, (_, doc_internal_id, sid, v_score) in enumerate(eligible_block_vector_rows, start=1):
        if sid:
            key = (doc_internal_id, sid)
            vector_value = float(v_score or 0.0)
            current = block_candidates.get(key, (0.0, 0.0))
            block_candidates[key] = (
                max(current[0], vector_value),
                0.0,
            )
            block_vector_ranks.setdefault(key, rank)
    block_bm25_candidates, block_bm25_ranks_by_id = ({}, {})
    if include_lexical:
        block_bm25_candidates, block_bm25_ranks_by_id = _bm25_block_candidates(
            session, doc_map, query, fts_query_variants, candidate_limit,
            fts_groups=fts_groups,
            exclude_section_keys=excluded_section_keys,
        )
    block_bm25_ranks = {}
    for block_id, (doc_internal_id, sid, bm25_score) in block_bm25_candidates.items():
        if not sid:
            continue
        key = (doc_internal_id, sid)
        current = block_candidates.get(key, (0.0, 0.0))
        block_candidates[key] = (current[0], max(current[1], bm25_score))
        rank = block_bm25_ranks_by_id[block_id]
        block_bm25_ranks[key] = min(block_bm25_ranks.get(key, rank), rank)
        relevant_block_ranks[key][block_id] = min(
            relevant_block_ranks[key].get(block_id, rank), rank
        )

    for section_key in image_ranks:
        block_candidates.setdefault(section_key, (0.0, 0.0))
    for section_key, (v_score, bm25_score) in block_candidates.items():
        vector_rank = block_vector_ranks.get(section_key) if v_score >= min_score else None
        bm25_rank = block_bm25_ranks.get(section_key)
        image_rank = image_ranks.get(section_key)
        if vector_rank is None and bm25_rank is None and image_rank is None:
            continue
        score = round(_rrf_score(vector_rank, bm25_rank, image_rank,
                                 include_images=bool(image_ranks)), 4)
        block_section_keys.add(section_key)
        block_score_map[section_key] = max(block_score_map.get(section_key, 0.0), score)

    # --- 4. Merge section IDs from all 3 signals ---
    all_section_keys = set(section_score_map.keys()) | set(content_score_map.keys()) | block_section_keys

    if not all_section_keys:
        return []

    if isinstance(doc_map, SearchScope):
        candidate_documents = {key[0] for key in all_section_keys}
        doc_map.hydrate(session, candidate_documents)
        filename_scores = doc_map.scores(session, candidate_documents, settings.HYBRID_RRF_K)
        filename_issuer_ids = candidate_documents if doc_map.has_issuers else set()
        section_sources = {key: doc_map.get(key[0], {}) for key in all_section_keys}

    for sk in set(content_score_map.keys()) | block_section_keys:
        section_sources.setdefault(sk, doc_map.get(sk[0], {}))
        section_score_map.setdefault(sk, 0.0)

    def _final_score(sk: Tuple[DocumentId, str]) -> float:
        ss = section_score_map.get(sk, 0.0)
        bs = block_score_map.get(sk, 0.0)
        fs = filename_scores.get(sk[0], 0.0)
        semantic = (filename_semantic_scores or {}).get(sk[0], 0.0)
        return (settings.SEARCH_BLOCK_WEIGHT * bs
                + settings.SEARCH_SECTION_WEIGHT * ss
                + filename_text_weight * fs
                + filename_semantic_weight * semantic)

    ranked_keys = sorted(all_section_keys, key=lambda sk: (-_final_score(sk), str(sk[0]), str(sk[1])))
    fallback_keys = ranked_keys[:candidate_limit]
    section_metadata = _resolve_section_metadata(session, fallback_keys)
    selected_keys = []
    selected_per_document: Dict[DocumentId, int] = defaultdict(int)
    for key in fallback_keys:
        if key not in section_metadata:
            continue
        document_id = key[0]
        if (
            per_document_limit is not None
            and selected_per_document[document_id] >= per_document_limit
        ):
            continue
        selected_keys.append(key)
        selected_per_document[document_id] += 1
        if len(selected_keys) >= limit:
            break
    if not selected_keys:
        return []

    block_rows = session.execute(
        _apply_workspace_partition_filter(
            select(
                LogicalBlock.id,
                LogicalBlock.document_id,
                LogicalBlock.section_id,
                LogicalBlock.page_number,
            ).where(
                tuple_(LogicalBlock.document_id, LogicalBlock.section_id).in_(selected_keys)
            ).order_by(
                LogicalBlock.document_id,
                LogicalBlock.section_id,
                LogicalBlock.id,
            ),
            LogicalBlock,
            doc_map,
        )
    ).all() if include_block_ids else []
    blocks_by_section: Dict[Tuple[DocumentId, str], List[Tuple[int, Optional[int]]]] = defaultdict(list)
    for block_id, doc_internal_id, sid, page_number in block_rows:
        blocks_by_section[(doc_internal_id, sid)].append((block_id, page_number))

    # MCP search returns bounded evidence, so count/pages can stay in SQL. The
    # native full-section reader retains every block ID through the default path.
    block_summaries = {}
    if not include_block_ids:
        rows = session.execute(_apply_workspace_partition_filter(
            select(LogicalBlock.document_id, LogicalBlock.section_id,
                   func.count(LogicalBlock.id), func.min(LogicalBlock.page_number),
                   func.max(LogicalBlock.page_number)).where(
                tuple_(LogicalBlock.document_id, LogicalBlock.section_id).in_(selected_keys)
            ).group_by(LogicalBlock.document_id, LogicalBlock.section_id),
            LogicalBlock, doc_map)).all()
        block_summaries = {(doc, sid): (count, first, last) for doc, sid, count, first, last in rows}

    selected_hit_ids_by_section = {
        key: sorted(
            relevant_block_ranks.get(key, {}),
            key=relevant_block_ranks[key].get,
        )[:10]
        for key in selected_keys
    }
    hit_contents = _get_block_contents_by_internal_ids(
        session,
        {block_id for block_ids in selected_hit_ids_by_section.values() for block_id in block_ids},
        **({"version_cache": block_content_cache} if block_content_cache is not None else {}),
    )
    image_counts = _get_image_counts_by_section(
        session, list({key[0] for key in selected_keys}), section_keys=selected_keys,
    )
    results = []
    for section_key in selected_keys:
        doc_internal_id, sid = section_key
        blocks = blocks_by_section.get(section_key, [])
        if not blocks and not block_summaries.get(section_key, (0,))[0] and not image_counts.get(section_key, 0):
            continue
        public_section_id, section_title = section_metadata[section_key]

        block_ids = [block_id for block_id, _ in blocks]

        pages = [page for _, page in blocks if page is not None] if include_block_ids else [
            page for page in block_summaries.get(section_key, (0, None, None))[1:] if page is not None]
        if pages:
            p_min, p_max = min(pages), max(pages)
            page_range = str(p_min) if p_min == p_max else f"{p_min}-{p_max}"
        else:
            page_range = None

        d = section_sources.get(section_key, {})
        cnt = image_counts.get(section_key, 0)
        score = round(_final_score(section_key), 4)
        preview_section = _get_section_preview(
            [hit_contents.get(block_id) for block_id in selected_hit_ids_by_section[section_key]],
            max_chars=settings.SEARCH_PREVIEW_MAX_CHARS,
        )
        matched_block_id = next(
            (block_id for block_id in selected_hit_ids_by_section[section_key]
             if hit_contents.get(block_id)),
            None,
        )
        matched_block = None
        if matched_block_id is not None:
            bm25_match = block_bm25_candidates.get(matched_block_id)
            matched_block = {
                "block_id": matched_block_id,
                "content": hit_contents[matched_block_id],
                "retrieval_scores": {
                    "vector": block_vector_scores.get(matched_block_id),
                    "bm25": round(float(bm25_match[2]), 4) if bm25_match else None,
                },
            }
        results.append({
            "section_id": public_section_id,
            "section_title": section_title,
            "block_ids": block_ids,
            "matched_block": matched_block,
            "matched_image": ({"image_id": matched_images[section_key], "block_type": "image",
                               "content": ""} if section_key in matched_images else None),
            "score": score,
            "retrieval_scores": {
                "section_title_hybrid": round(section_score_map.get(section_key, 0.0), 4),
                "content_vector": round(content_score_map.get(section_key, 0.0), 4),
                "block_hybrid": round(block_score_map.get(section_key, 0.0), 4),
                "image_vector": round(image_scores.get(section_key, 0.0), 4),
                "filename_text": round(filename_scores.get(doc_internal_id, 0.0), 4),
                "filename_semantic": round((filename_semantic_scores or {}).get(doc_internal_id, 0.0), 4),
                "filename_issuer_match": doc_internal_id in filename_issuer_ids,
                # Keep keyword provenance separate from the fused RRF score.
                # A positive hybrid score can otherwise be vector-only.
                "section_keyword_match": section_key in section_bm25_ranks,
                "block_keyword_match": section_key in block_bm25_ranks,
            },
            "preview_section": preview_section,
            "page_range": page_range,
            "source": d.get("source"),
            "user_id": d.get("user_id"),
            "file_name": d.get("file_name"),
            "workspace_id": d.get("workspace_id"),
            "document_id": doc_internal_id,
            "image_count": cnt,
        })

    return results


def _resolve_section_public_ids(
    session: Session,
    section_keys: List[Tuple[DocumentId, str]],
) -> Dict[Tuple[DocumentId, str], int]:
    if not section_keys:
        return {}

    stmt = select(
        LogicalSection.document_id,
        LogicalSection.section_id,
        LogicalSection.id,
    ).where(
        tuple_(LogicalSection.document_id, LogicalSection.section_id).in_(section_keys),
    )
    return {(row[0], row[1]): row[2] for row in session.execute(stmt).all()}


def _resolve_section_metadata(
    session: Session,
    section_keys: List[Tuple[DocumentId, str]],
) -> Dict[Tuple[DocumentId, str], Tuple[int, Optional[str]]]:
    if not section_keys:
        return {}
    stmt = select(
        LogicalSection.document_id,
        LogicalSection.section_id,
        LogicalSection.id,
        LogicalSection.title,
    ).where(
        tuple_(LogicalSection.document_id, LogicalSection.section_id).in_(section_keys),
        or_(select(LogicalBlock.id).where(
            LogicalBlock.document_id == LogicalSection.document_id,
            LogicalBlock.section_id == LogicalSection.section_id,
        ).exists(), select(LogicalImage.id).where(
            LogicalImage.document_id == LogicalSection.document_id,
            LogicalImage.section_id == LogicalSection.section_id,
        ).exists()),
    )
    return {
        (doc_id, section_id): (public_id, title)
        for doc_id, section_id, public_id, title in session.execute(stmt).all()
    }


def _get_block_contents_by_internal_ids(
    session: Session,
    block_ids,
    version_cache=None,
) -> Dict[int, str]:
    if not block_ids:
        return {}
    columns = [LogicalBlock.id, LogicalBlock.content]
    if version_cache is not None:
        columns.append(cast(literal_column("logical_blocks.xmin"), String))
    stmt = select(*columns).where(
        LogicalBlock.id.in_(block_ids),
        LogicalBlock.content.isnot(None),
    )
    rows = session.execute(stmt).all()
    if version_cache is not None:
        version_cache.update({row[0]: (row[1], row[2]) for row in rows if row[1]})
    return {row[0]: row[1] for row in rows if row[1]}


def get_block_contents_by_ids(
    session: Session,
    block_ids: List[int],
) -> Dict[int, str]:
    if not block_ids:
        return {}

    stmt = select(LogicalBlock.id, LogicalBlock.content).where(
        LogicalBlock.id.in_(block_ids),
    )
    return {row[0]: row[1] for row in session.execute(stmt).all() if row[1]}


def _public_section_ids_for_blocks(
    session: Session,
    blocks: List[LogicalBlock],
) -> Dict[Tuple[DocumentId, str], int]:
    section_keys = [
        (block.document_id, block.section_id)
        for block in blocks
        if block.section_id
    ]
    return _resolve_section_public_ids(session, section_keys)


def _resolve_document_id(
    session: Session,
    user_id: Optional[str] = None,
    workspace_id: ScopeValue = None,
    file_name: ScopeValue = None,
    defer: bool = False,
) -> List[DocumentId]:
    stmt = select(LogicalDocument.id)
    stmt = _apply_document_filters(stmt, user_id=user_id, workspace_id=workspace_id, file_name=file_name)
    return stmt if defer else [row[0] for row in session.execute(stmt).all()]


def _block_identity_predicate(requested_ids):
    # Preserve alias/canonical-ID collisions without casting the indexed PK.
    numeric_ids = []
    for value in requested_ids:
        if re.fullmatch(r"-?[0-9]{1,10}", value):
            number = int(value)
            if str(number) == value and -(2**31) <= number < 2**31:
                numeric_ids.append(number)
    return or_(LogicalBlock.id.in_(numeric_ids), LogicalBlock.block_id.in_(requested_ids))


def _resolve_section(
    session: Session,
    section_id: str,
    doc_ids: List[DocumentId],
) -> Optional[Tuple[LogicalSection, DocumentId]]:
    section_ref = str(section_id or "").strip()
    if not section_ref:
        return None

    try:
        public_section_id = int(section_ref)
    except (TypeError, ValueError):
        public_section_id = None

    # Numeric references always identify public IDs, never legacy local keys.
    predicate = (
        LogicalSection.id == public_section_id
        if public_section_id is not None
        else LogicalSection.section_id == section_ref
    )

    stmt = select(
        LogicalSection,
        LogicalSection.document_id,
    ).where(
        predicate,
        LogicalSection.document_id.in_(doc_ids),
    ).limit(2)
    rows = session.execute(stmt).all()
    if not rows:
        return None
    if len(rows) > 1:
        raise ValueError("Ambiguous section reference; use the numeric public section ID")
    return rows[0][0], rows[0][1]


def _normalize_section_ref_list(value: Any) -> List[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item or "").strip()]
    if isinstance(value, tuple):
        return [str(item).strip() for item in value if str(item or "").strip()]
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return []
        try:
            decoded = json.loads(stripped)
        except json.JSONDecodeError:
            return [stripped]
        return _normalize_section_ref_list(decoded)
    return []


def _get_section_hierarchy_refs(
    session: Session,
    section_pk: int,
) -> Tuple[List[str], List[str]]:
    columns = _logical_sections_columns(session)
    ancestors_column = "ancestors" if "ancestors" in columns else None
    descendants_column = (
        "descendants"
        if "descendants" in columns
        else "decendants" if "decendants" in columns else None
    )

    if not ancestors_column and not descendants_column:
        return [], []

    selected = []
    selected.append(f"{ancestors_column} AS ancestors" if ancestors_column else "NULL AS ancestors")
    selected.append(f"{descendants_column} AS descendants" if descendants_column else "NULL AS descendants")

    row = session.execute(
        text(f"SELECT {', '.join(selected)} FROM logical_sections WHERE id = :section_pk"),
        {"section_pk": section_pk},
    ).mappings().first()
    if not row:
        return [], []

    return (
        _normalize_section_ref_list(row.get("ancestors")),
        _normalize_section_ref_list(row.get("descendants")),
    )


def _logical_sections_columns(session: Session) -> set[str]:
    cache_key = "logical_sections_columns"
    cached = session.info.get(cache_key)
    if cached is not None:
        return cached

    column_rows = session.execute(text("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'logical_sections'
          AND table_schema = current_schema()
          AND column_name IN (
              'ancestors',
              'descendants',
              'decendants',
              'parent_sec_id',
              'parent_section_id',
              'previous_section_id',
              'next_section_id',
              'level',
              'position',
              'previous_sec_id',
              'next_sec_id'
          )
    """)).all()
    columns = {row[0] for row in column_rows}
    session.info[cache_key] = columns
    return columns


def _get_section_parent_and_level(
    session: Session,
    section_pk: int,
) -> Tuple[Optional[int], Optional[int]]:
    refs = _get_section_context_refs(session, section_pk)
    return refs.get("parent_sec_id"), refs.get("level")


def _get_section_context_refs(
    session: Session,
    section_pk: int,
) -> Dict[str, Optional[int]]:
    columns = _logical_sections_columns(session)
    aliases = {
        "parent_sec_id": "parent_section_id",
        "previous_sec_id": "previous_section_id",
        "next_sec_id": "next_section_id",
        "level": "level",
        "position": "position",
    }
    available = {alias: canonical if canonical in columns else alias
                 for alias, canonical in aliases.items()
                 if canonical in columns or alias in columns}
    selectable = list(available)
    if not selectable:
        return {}
    selected = [f'"{column}" AS "{alias}"' for alias, column in available.items()]
    row = session.execute(
        text(f"SELECT {', '.join(selected)} FROM logical_sections WHERE id = :section_pk"),
        {"section_pk": section_pk},
    ).mappings().first()
    if not row:
        return {}

    refs: Dict[str, Optional[int]] = {}
    for column in selectable:
        value = row.get(column)
        try:
            refs[column] = int(value) if value not in (None, "") else None
        except (TypeError, ValueError):
            refs[column] = None
    return refs


def _get_sections_by_ids(
    session: Session,
    doc_id: DocumentId,
    section_ids: List[int],
) -> List[LogicalSection]:
    ordered_ids = [section_id for section_id in dict.fromkeys(section_ids) if section_id]
    if not ordered_ids:
        return []

    stmt = select(LogicalSection).options(load_only(
        LogicalSection.id, LogicalSection.section_id, LogicalSection.title,
    )).where(
        LogicalSection.document_id == doc_id,
        LogicalSection.id.in_(ordered_ids),
    )
    section_map = {
        section.id: section
        for section in session.execute(stmt).scalars().all()
    }
    return [section_map[section_id] for section_id in ordered_ids if section_id in section_map]


def _get_sections_by_hierarchy_refs(
    session: Session,
    doc_id: DocumentId,
    section_refs: List[str],
) -> Tuple[List[LogicalSection], List[str]]:
    ordered_refs = [ref for ref in dict.fromkeys(section_refs) if ref]
    if not ordered_refs:
        return [], []
    numeric_ids = [
        int(ref)
        for ref in ordered_refs
        if ref.isdigit()
    ]

    stmt = select(LogicalSection).where(
        LogicalSection.document_id == doc_id,
        or_(
            LogicalSection.section_id.in_(ordered_refs),
            LogicalSection.id.in_(numeric_ids) if numeric_ids else False,
        ),
    )
    sections = list(session.execute(stmt).scalars().all())
    section_map: Dict[str, LogicalSection] = {}
    for section in sections:
        section_map[str(section.id)] = section
        section_map[section.section_id] = section
    ordered_sections = [section_map[ref] for ref in ordered_refs if ref in section_map]
    missing_ids = [ref for ref in ordered_refs if ref not in section_map]
    return ordered_sections, missing_ids


def _section_level(session: Session, section: LogicalSection) -> int:
    ancestors, _ = _get_section_hierarchy_refs(session, section.id)
    return len(ancestors) + 1


def _section_levels(
    session: Session,
    sections: List[LogicalSection],
) -> Dict[int, int]:
    if not sections:
        return {}

    section_ids = [section.id for section in sections]
    levels: Dict[int, int] = {}
    if "level" in _logical_sections_columns(session):
        rows = session.execute(
            text("""
                SELECT id, "level"
                FROM logical_sections
                WHERE id IN :section_ids
            """).bindparams(bindparam("section_ids", expanding=True)),
            {"section_ids": section_ids},
        ).all()
        for section_id, level in rows:
            try:
                if level is not None:
                    levels[int(section_id)] = int(level)
            except (TypeError, ValueError):
                continue

    for section in sections:
        if section.id not in levels:
            levels[section.id] = _section_level(session, section)
    return levels


def _same_parent_sections(
    session: Session,
    doc_id: DocumentId,
    target_section: LogicalSection,
    target_ancestors: List[str],
    target_level: int,
    limit: Optional[int] = None,
) -> List[LogicalSection]:
    parent_sec_id, stored_level = _get_section_parent_and_level(session, target_section.id)
    if parent_sec_id is not None:
        parent_column = ("parent_section_id" if "parent_section_id" in _logical_sections_columns(session)
                         else "parent_sec_id")
        sql = f"""
            SELECT *
            FROM logical_sections
            WHERE document_id = :doc_id
              AND CAST({parent_column} AS TEXT) = :parent_sec_id
              AND "level" = :level
              AND id <> :target_id
            ORDER BY id
        """
        params = {
            "doc_id": doc_id,
            "parent_sec_id": str(parent_sec_id),
            "level": stored_level or target_level,
            "target_id": target_section.id,
        }
        if limit and limit > 0:
            sql += "\nLIMIT :limit"
            params["limit"] = limit
        stmt = select(LogicalSection).from_statement(text(sql))
        return list(session.execute(stmt, params).scalars().all())

    parent_ref = target_ancestors[-1] if target_ancestors else None
    if parent_ref is None:
        return []

    sections = get_sections_for_document(session, doc_id, limit=10000)
    siblings: List[LogicalSection] = []

    for section in sections:
        if limit and limit > 0 and len(siblings) >= limit:
            break
        if section.id == target_section.id:
            continue

        section_ancestors, _ = _get_section_hierarchy_refs(session, section.id)
        if len(section_ancestors) + 1 != target_level:
            continue

        section_parent_ref = section_ancestors[-1] if section_ancestors else None
        if section_parent_ref == parent_ref:
            siblings.append(section)

    return siblings


def _get_page_ranges_by_section(
    session: Session,
    doc_id: DocumentId,
    section_ids: Optional[List[str]] = None,
) -> Dict[str, Optional[str]]:
    stmt = select(
        LogicalBlock.section_id,
        func.min(LogicalBlock.page_number).label("min_page"),
        func.max(LogicalBlock.page_number).label("max_page"),
    ).where(
        LogicalBlock.document_id == doc_id,
        LogicalBlock.section_id.isnot(None),
    )

    if section_ids:
        stmt = stmt.where(LogicalBlock.section_id.in_(section_ids))

    stmt = stmt.group_by(LogicalBlock.section_id)

    page_ranges: Dict[str, Optional[str]] = {}
    for sid, min_page, max_page in session.execute(stmt).all():
        if sid is None or min_page is None or max_page is None:
            continue
        page_ranges[sid] = str(min_page) if min_page == max_page else f"{min_page}-{max_page}"

    return page_ranges


def _get_page_ranges_for_section_keys(
    session: Session,
    section_keys: List[Tuple[DocumentId, str]],
) -> Dict[Tuple[DocumentId, str], Optional[str]]:
    if not section_keys:
        return {}
    stmt = select(
        LogicalBlock.document_id,
        LogicalBlock.section_id,
        func.min(LogicalBlock.page_number),
        func.max(LogicalBlock.page_number),
    ).where(
        tuple_(LogicalBlock.document_id, LogicalBlock.section_id).in_(section_keys),
    ).group_by(LogicalBlock.document_id, LogicalBlock.section_id)
    return {
        (doc_id, section_id): (
            str(min_page) if min_page == max_page else f"{min_page}-{max_page}"
        )
        for doc_id, section_id, min_page, max_page in session.execute(stmt).all()
        if min_page is not None and max_page is not None
    }


def _get_section_preview(
    parts: List[Optional[str]],
    max_chars: int = settings.SEARCH_PREVIEW_MAX_CHARS,
) -> Optional[str]:
    parts = [part for part in parts if part]
    if not parts:
        return None
    text = " ".join(parts)
    return text[:max_chars] + "..." if len(text) > max_chars else text


def search_sections_hybrid(
    session: Session,
    query: str,
    query_embedding: List[float],
    user_id: Optional[str] = None,
    workspace_id: ScopeValue = None,
    file_name: ScopeValue = None,
    limit: int = 5,
    fts_query_variants: FtsQueryVariants = None,
) -> List[Dict[str, Any]]:
    doc_stmt = select(
        LogicalDocument.id,
        LogicalDocument.user_id,
        LogicalDocument.file_name,
        LogicalDocument.workspace_id,
        LogicalDocument.source,
        LogicalDocument.fts_config,
    )
    doc_stmt = _apply_document_filters(doc_stmt, user_id=user_id, workspace_id=workspace_id, file_name=file_name)
    doc_rows = session.execute(doc_stmt).all()
    if not doc_rows:
        return []

    doc_map = {}
    for row in doc_rows:
        doc_map[row[0]] = {
            "user_id": row[1],
            "file_name": row[2],
            "workspace_id": row[3],
            "source": _source_value(row[4]),
            "fts_config": row[5],
        }
    doc_ids = list(doc_map.keys())

    fts_groups = _document_fts_groups(doc_map, query)
    candidate_limit = max(limit * 3, 30)
    min_score = settings.SEARCH_MIN_SCORE
    raw_cosine = (1 - LogicalSection.embedding.cosine_distance(query_embedding))
    cosine_score = func.coalesce(raw_cosine, 0.0)

    vector_stmt = select(
        LogicalSection.document_id,
        LogicalSection.section_id,
        cosine_score.label("vector_score"),
    ).where(
        LogicalSection.document_id.in_(doc_ids),
        LogicalSection.embedding.isnot(None),
    )
    vector_stmt = _apply_workspace_partition_filter(
        vector_stmt, LogicalSection, doc_map
    ).order_by(
        LogicalSection.embedding.cosine_distance(query_embedding)
    ).limit(candidate_limit)

    title_candidates: Dict[Tuple[DocumentId, str], Tuple[float, float]] = {}
    title_vector_ranks = {}
    for rank, (doc_internal_id, section_id, v_score) in enumerate(
        session.execute(vector_stmt).all(), start=1
    ):
        if section_id:
            key = (doc_internal_id, section_id)
            title_candidates[key] = (float(v_score or 0.0), 0.0)
            title_vector_ranks[key] = rank
    title_bm25_candidates, title_bm25_ranks = _bm25_section_candidates(
        session, doc_map, query, fts_query_variants, candidate_limit,
        fts_groups=fts_groups,
    )
    for key, bm25_score in title_bm25_candidates.items():
        current = title_candidates.get(key)
        vector_value = current[0] if current else 0.0
        title_candidates[key] = (vector_value, bm25_score)

    # Content section search from top indexed block-vector candidates.
    block_vec_score = func.coalesce((1 - LogicalBlock.embedding.cosine_distance(query_embedding)), 0.0)
    content_block_stmt = select(
        LogicalBlock.id,
        LogicalBlock.document_id,
        LogicalBlock.section_id,
        block_vec_score.label("score"),
    ).where(
        LogicalBlock.document_id.in_(doc_ids),
        LogicalBlock.section_id.isnot(None),
        LogicalBlock.embedding.isnot(None),
    )
    content_block_stmt = _apply_workspace_partition_filter(
        content_block_stmt, LogicalBlock, doc_map
    ).order_by(
        LogicalBlock.embedding.cosine_distance(query_embedding)
    ).limit(candidate_limit)

    content_score_map: Dict[Tuple[DocumentId, str], float] = {}
    content_vector_ranks = {}
    relevant_block_ranks: Dict[Tuple[DocumentId, str], Dict[int, int]] = defaultdict(dict)
    for rank, row in enumerate(session.execute(content_block_stmt).all(), start=1):
        block_id, doc_internal_id, sid, raw_score = row
        score = round(float(raw_score), 4)
        if sid:
            key = (doc_internal_id, sid)
            content_score_map[key] = max(content_score_map.get(key, 0.0), score)
            content_vector_ranks.setdefault(key, rank)
            if score >= min_score:
                relevant_block_ranks[key][block_id] = rank

    content_bm25_candidates, content_bm25_ranks_by_id = _bm25_block_candidates(
        session, doc_map, query, fts_query_variants, candidate_limit,
        fts_groups=fts_groups,
    )
    content_bm25_scores = {}
    content_bm25_ranks = {}
    for block_id, (doc_internal_id, sid, bm25_score) in content_bm25_candidates.items():
        if not sid:
            continue
        key = (doc_internal_id, sid)
        content_bm25_scores[key] = max(content_bm25_scores.get(key, 0.0), bm25_score)
        rank = content_bm25_ranks_by_id[block_id]
        content_bm25_ranks[key] = min(content_bm25_ranks.get(key, rank), rank)
        relevant_block_ranks[key][block_id] = min(
            relevant_block_ranks[key].get(block_id, rank), rank
        )

    all_keys = (
        set(title_candidates)
        | set(content_score_map)
        | set(content_bm25_scores)
    )

    fused_scores = {}
    for key in all_keys:
        title_vector_score = title_candidates.get(key, (0.0, 0.0))[0]
        vector_ranks = []
        if title_vector_score >= min_score and key in title_vector_ranks:
            vector_ranks.append(title_vector_ranks[key])
        if content_score_map.get(key, 0.0) >= min_score and key in content_vector_ranks:
            vector_ranks.append(content_vector_ranks[key])
        bm25_ranks = [
            rank for rank in (title_bm25_ranks.get(key), content_bm25_ranks.get(key))
            if rank is not None
        ]
        vector_rank = min(vector_ranks) if vector_ranks else None
        bm25_rank = min(bm25_ranks) if bm25_ranks else None
        if vector_rank is not None or bm25_rank is not None:
            fused_scores[key] = _rrf_score(vector_rank, bm25_rank)

    fallback_keys = sorted(
        fused_scores,
        key=fused_scores.get,
        reverse=True,
    )[:candidate_limit]
    section_metadata = _resolve_section_metadata(session, fallback_keys)
    scored_keys = [key for key in fallback_keys if key in section_metadata][:limit]
    selected_hit_ids_by_section = {
        key: sorted(
            relevant_block_ranks.get(key, {}),
            key=relevant_block_ranks[key].get,
        )[:10]
        for key in scored_keys
    }
    hit_contents = _get_block_contents_by_internal_ids(
        session,
        {block_id for block_ids in selected_hit_ids_by_section.values() for block_id in block_ids},
    )
    page_ranges = _get_page_ranges_for_section_keys(session, scored_keys)
    image_counts = _get_image_counts_by_section(
        session, doc_ids, section_keys=scored_keys,
    )

    output = []
    for key in scored_keys:
        doc_internal_id, section_id = key
        public_section_id, section_title = section_metadata[key]
        score = round(fused_scores[key], 4)
        d = doc_map.get(doc_internal_id, {})

        preview = _get_section_preview(
            [hit_contents.get(block_id) for block_id in selected_hit_ids_by_section[key]],
            max_chars=settings.SEARCH_PREVIEW_MAX_CHARS,
        )
        page_range = page_ranges.get(key)

        cnt = image_counts.get(key, 0)
        output.append({
            "section_id": public_section_id,
            "section_title": section_title,
            "user_id": d.get("user_id"),
            "file_name": d.get("file_name"),
            "workspace_id": d.get("workspace_id"),
            "source": d.get("source"),
            "score": score,
            "retrieval_scores": {
                "vector": round(max(
                    title_candidates.get(key, (0.0, 0.0))[0],
                    content_score_map.get(key, 0.0),
                ), 4),
                "bm25": round(max(
                    title_candidates.get(key, (0.0, 0.0))[1],
                    content_bm25_scores.get(key, 0.0),
                ), 4),
            },
            "page_range": page_range,
            "preview": preview,
            "image_count": cnt,
        })

    return output


def search_blocks_hybrid(
    session: Session,
    query: str,
    query_embedding: List[float],
    user_id: Optional[str] = None,
    workspace_id: ScopeValue = None,
    file_name: ScopeValue = None,
    document_id: DocumentIdScope = None,
    section_id: Optional[str] = None,
    limit: int = 5,
    fts_query_variants: FtsQueryVariants = None,
    include_section_context: bool = True,
    include_document_id: bool = False,
    per_document_limit: Optional[int] = None,
) -> List[Dict[str, Any]]:
    doc_stmt = select(
        LogicalDocument.id,
        LogicalDocument.user_id,
        LogicalDocument.file_name,
        LogicalDocument.workspace_id,
        LogicalDocument.source,
        LogicalDocument.fts_config,
    )
    doc_stmt = _apply_document_filters(
        doc_stmt,
        user_id=user_id,
        workspace_id=workspace_id,
        file_name=file_name,
        document_id=document_id,
    )
    doc_rows = session.execute(doc_stmt).all()
    if not doc_rows:
        return []

    doc_map = {}
    for row in doc_rows:
        doc_map[row[0]] = {
            "user_id": row[1],
            "file_name": row[2],
            "workspace_id": row[3],
            "source": _source_value(row[4]),
            "fts_config": row[5],
        }
    doc_ids = list(doc_map.keys())

    internal_section_id = None
    if section_id:
        resolved_section = _resolve_section(session, section_id, doc_ids)
        if not resolved_section:
            return []
        section, owning_document_id = resolved_section
        internal_section_id = section.section_id
        doc_ids = [owning_document_id]
        doc_map = {owning_document_id: doc_map[owning_document_id]}

    candidate_limit = max(limit * 3, 30)
    min_score = settings.SEARCH_MIN_SCORE
    raw_vec = (1 - LogicalBlock.embedding.cosine_distance(query_embedding))
    vec_score = func.coalesce(raw_vec, 0.0)

    vector_stmt = select(
        LogicalBlock.id,
        LogicalBlock.document_id,
        LogicalBlock.section_id,
        vec_score.label("vector_score"),
    ).where(
        LogicalBlock.document_id.in_(doc_ids),
        LogicalBlock.embedding.isnot(None),
    )
    vector_stmt = _apply_workspace_partition_filter(
        vector_stmt, LogicalBlock, doc_map
    )

    if internal_section_id:
        vector_stmt = vector_stmt.where(LogicalBlock.section_id == internal_section_id)

    vector_stmt = vector_stmt.order_by(
        LogicalBlock.embedding.cosine_distance(query_embedding)
    ).limit(candidate_limit)

    merged: Dict[int, Tuple[int, Optional[str], float, float]] = {}
    vector_ranks = {}
    for rank, (block_id, doc_internal_id, block_section_id, v_score) in enumerate(
        session.execute(vector_stmt).all(), start=1
    ):
        vector_value = float(v_score or 0.0)
        if vector_value < min_score:
            continue
        merged[block_id] = (doc_internal_id, block_section_id, vector_value, 0.0)
        vector_ranks[block_id] = rank

    bm25_candidates, bm25_ranks = _bm25_block_candidates(
        session,
        doc_map,
        query,
        fts_query_variants,
        candidate_limit,
        section_id=internal_section_id,
    )
    for block_id, (doc_internal_id, block_section_id, bm25_score) in bm25_candidates.items():
        current = merged.get(block_id)
        vector_value = current[2] if current else 0.0
        merged[block_id] = (doc_internal_id, block_section_id, vector_value, bm25_score)

    fallback_block_ids = sorted(
        merged,
        key=lambda block_id: _rrf_score(
            vector_ranks.get(block_id), bm25_ranks.get(block_id),
        ),
        reverse=True,
    )[:candidate_limit]
    selected_block_rows = session.execute(
        _apply_workspace_partition_filter(
            select(
                LogicalBlock.id,
                LogicalBlock.document_id,
                LogicalBlock.section_id,
                LogicalBlock.block_type,
                LogicalBlock.content,
                LogicalBlock.page_number,
            ).where(LogicalBlock.id.in_(fallback_block_ids)),
            LogicalBlock,
            doc_map,
        )
    ).all() if fallback_block_ids else []
    block_rows_by_id = {row[0]: row for row in selected_block_rows}
    selected_block_ids = []
    selected_per_document: Dict[DocumentId, int] = defaultdict(int)
    for block_id in fallback_block_ids:
        row = block_rows_by_id.get(block_id)
        if row is None:
            continue
        block_document_id = row[1]
        if (
            per_document_limit is not None
            and selected_per_document[block_document_id] >= per_document_limit
        ):
            continue
        selected_block_ids.append(block_id)
        selected_per_document[block_document_id] += 1
        if len(selected_block_ids) >= limit:
            break
    selected_section_keys = [
        (block_rows_by_id[block_id][1], block_rows_by_id[block_id][2])
        for block_id in selected_block_ids
        if block_rows_by_id[block_id][2]
    ]
    image_counts = (
        _get_image_counts_by_section(session, doc_ids, section_keys=selected_section_keys)
        if include_section_context else {}
    )
    section_public_ids = (
        _resolve_section_public_ids(session, selected_section_keys)
        if include_section_context else {}
    )

    output = []
    for block_id in selected_block_ids:
        _, doc_internal_id, block_section_id, block_type, content, page_number = block_rows_by_id[block_id]
        _, _, v_score, bm25_score = merged[block_id]
        c_score = _rrf_score(vector_ranks.get(block_id), bm25_ranks.get(block_id))
        d = doc_map.get(doc_internal_id, {})
        section_key = (doc_internal_id, block_section_id)
        cnt = image_counts.get(section_key, 0)
        public_section_id = section_public_ids.get(section_key)
        result = {
            "block_id": block_id,
            "block_type": block_type,
            "content": content,
            "score": round(float(c_score), 4),
            "retrieval_scores": {
                "vector": round(float(v_score), 4) if block_id in vector_ranks else None,
                "bm25": round(float(bm25_score), 4) if block_id in bm25_ranks else None,
            },
            "page_number": page_number,
            "source": d.get("source"),
            "user_id": d.get("user_id"),
            "file_name": d.get("file_name"),
            "workspace_id": d.get("workspace_id"),
        }
        if include_document_id:
            result["document_id"] = doc_internal_id
        if include_section_context:
            result.update({
                "section_id": public_section_id,
                "image_count": cnt,
            })
        output.append(result)

    return output


def read_section_with_blocks(
    session: Session,
    section_id: str,
    doc_ids: List[DocumentId],
    include_blocks: bool = True,
    block_offset: int = 0,
    image_offset: int = 0,
) -> Optional[Dict[str, Any]]:
    resolved = _resolve_section(session, section_id, doc_ids)
    if not resolved:
        return None
    section, doc_id = resolved
    internal_section_id = section.section_id

    doc = get_document_by_internal_id(session, doc_id)
    image_records = _get_section_image_records(session, doc_id, internal_section_id, offset=image_offset)
    blocks = get_blocks_for_document(
        session, doc_id, section_id=internal_section_id,
        limit=settings.READ_BLOCK_PAGE_SIZE + 1, offset=block_offset,
    ) if include_blocks else []
    return _format_section_read(section, doc, blocks, image_records, include_blocks,
                                block_offset, image_offset)


def _format_section_read(section, doc, blocks, image_records, include_blocks,
                         block_offset, image_offset, query=None, include_images=True):
    from src.mcp_server.evidence import excerpt
    source = _source_value(doc.source) if doc else None
    blocks_data = []
    more_images = len(image_records) > settings.READ_IMAGE_PAGE_SIZE
    image_records = image_records[:settings.READ_IMAGE_PAGE_SIZE]
    more_blocks = False
    block_count = 0
    matched_image_ids = set()

    if include_blocks:
        more_blocks = len(blocks) > settings.READ_BLOCK_PAGE_SIZE
        blocks = blocks[:settings.READ_BLOCK_PAGE_SIZE]
        block_count = len(blocks)
        images_by_key: Dict[Tuple[Optional[int], str, str], List[LogicalImage]] = defaultdict(list)
        for image in image_records:
            images_by_key[_image_block_match_key(
                image.page_number,
                image.content,
                image.bbox,
            )].append(image)

        for b in blocks:
            block_data = {
                "block_id": b.id,
                "block_type": b.block_type,
                "content": b.content,
                "source": source,
            }
            if str(b.block_type or "").startswith("image/") or b.block_type in ("image", "figure", "chart"):
                matching_images = images_by_key.get(_image_block_match_key(
                    b.page_number,
                    b.content,
                    b.bbox,
                ))
                if matching_images:
                    image = matching_images.pop(0)
                    serialized_image = (_serialize_image(image) if include_images
                                        else _serialize_image_metadata(image))
                    block_data.update({
                        "image_id": serialized_image["image_id"],
                    })
                    if include_images:
                        block_data["image_base64"] = serialized_image["image_base64"]
                    matched_image_ids.add(image.id)
            if isinstance(b.content, str) and len(b.content) > 1000:
                block_data.update(excerpt(b.content, query, 1000))
                block_data["required_next_tool_call"] = {
                    "tool": "read_blocks",
                    "arguments": {
                        "block_id": str(b.id),
                        "workspace_id": doc.workspace_id if doc else None,
                    },
                }
            blocks_data.append(block_data)

    images = [
        (_serialize_image(image) if include_images else _serialize_image_metadata(image))
        for image in image_records
        if image.id not in matched_image_ids
    ]

    result = {
        "section_id": section.id,
        "title": section.title,
        "source": source,
        "user_id": doc.user_id if doc else None,
        "document_id": doc.id if doc else None,
        "file_name": doc.file_name if doc else None,
        "workspace_id": doc.workspace_id if doc else None,
    }

    if include_blocks:
        result["blocks"] = blocks_data
    result["images"] = images
    result["truncated"] = more_blocks or more_images
    result["retrieval_complete"] = not (
        more_blocks or more_images or block_offset or image_offset
        or any(block.get("content_truncated") for block in blocks_data)
        or not include_blocks
    )
    if more_blocks or more_images:
        result["required_next_tool_call"] = {
            "tool": "read_sections",
            "arguments": {
                "section_id": str(section.id),
                "workspace_id": doc.workspace_id if doc else None,
                "include_blocks": include_blocks,
                "block_offset": block_offset + block_count,
                "image_offset": image_offset + len(image_records),
            },
        }

    return result


def read_sections_with_blocks(session, section_ids, workspace_id, include_blocks=True,
                              block_offset=0, image_offset=0, query=None, include_images=True):
    """Resolve scope once and fetch bounded rows for every selected section."""
    public_ids, legacy_keys = [], []
    for reference in section_ids:
        try:
            public_ids.append(int(reference))
        except ValueError:
            legacy_keys.append(reference)
    stmt = select(LogicalSection, LogicalDocument).join(
        LogicalDocument, LogicalSection.document_id == LogicalDocument.id,
    ).options(
        Load(LogicalSection).load_only(LogicalSection.id, LogicalSection.section_id, LogicalSection.title),
        Load(LogicalDocument).load_only(LogicalDocument.id, LogicalDocument.workspace_id,
            LogicalDocument.file_name, LogicalDocument.user_id, LogicalDocument.source),
    ).where(or_(LogicalSection.id.in_(public_ids), LogicalSection.section_id.in_(legacy_keys)))
    stmt = _apply_document_filters(stmt, workspace_id=workspace_id)
    sections = session.execute(stmt).all()
    by_public = {section.id: (section, doc) for section, doc in sections}
    by_legacy = defaultdict(list)
    for section, doc in sections:
        by_legacy[section.section_id].append((section, doc))
    resolved = []
    for reference in section_ids:
        try:
            item = by_public.get(int(reference))
        except ValueError:
            matches = by_legacy.get(reference, [])
            if len(matches) > 1:
                raise ValueError("Ambiguous section reference; use the numeric public section ID")
            item = matches[0] if matches else None
        resolved.append(item)
    unique = {item[0].id: item for item in resolved if item is not None}
    if not unique:
        return [None for _ in section_ids]
    keys = [(doc.id, section.section_id) for section, doc in unique.values()]
    workspaces = list({doc.workspace_id for section, doc in unique.values()})

    def fetch_pages(model, columns, offset, limit, order):
        check_db_deadline()
        ranked = select(*columns, func.row_number().over(
            partition_by=(model.document_id, model.section_id), order_by=order,
        ).label("position")).where(tuple_(model.document_id, model.section_id).in_(keys))
        if model is LogicalBlock:
            ranked = ranked.where(LogicalBlock.workspace_id.in_(workspaces))
        ranked = ranked.subquery()
        rows = session.execute(select(ranked).where(
            ranked.c.position > offset, ranked.c.position <= offset + limit + 1,
        ).order_by(ranked.c.document_id, ranked.c.section_id, ranked.c.position)).all()
        grouped = defaultdict(list)
        for row in rows:
            grouped[(row.document_id, row.section_id)].append(row)
        return grouped

    blocks = fetch_pages(LogicalBlock, [LogicalBlock.id, LogicalBlock.document_id,
        LogicalBlock.section_id, LogicalBlock.block_type, LogicalBlock.content,
        LogicalBlock.page_number, LogicalBlock.bbox], block_offset, settings.READ_BLOCK_PAGE_SIZE,
        LogicalBlock.id) if include_blocks else {}
    image_columns = [LogicalImage.id, LogicalImage.document_id,
        LogicalImage.section_id, bounded_image_column(LogicalImage.content),
        *([bounded_image_column(LogicalImage.image_base64)] if include_images else []),
        LogicalImage.page_number, LogicalImage.bbox]
    images = fetch_pages(LogicalImage, image_columns, image_offset, settings.READ_IMAGE_PAGE_SIZE,
        (LogicalImage.page_number, LogicalImage.id))
    payloads = {}
    for public_id, (section, doc) in unique.items():
        check_db_deadline()
        key = (doc.id, section.section_id)
        payloads[public_id] = _format_section_read(section, doc, blocks.get(key, []),
            images.get(key, []), include_blocks, block_offset, image_offset, query, include_images)
    return [payloads[item[0].id] if item else None for item in resolved]


def read_section_blocks(
    session: Session,
    section_id: str,
    doc_ids: List[DocumentId],
) -> Optional[Dict[str, Any]]:
    resolved = _resolve_section(session, section_id, doc_ids)
    if not resolved:
        return None
    section, doc_id = resolved
    internal_section_id = section.section_id

    doc = get_document_by_internal_id(session, doc_id)

    blocks = get_blocks_for_document(
        session, doc_id, section_id=internal_section_id, limit=10000,
    )

    source = _source_value(doc.source) if doc else None
    return [
        {
            "block_id": b.id,
            "block_type": b.block_type,
            "content": b.content,
            "page_number": b.page_number,
            "section_id": section.id,
            "source": source,
            "user_id": doc.user_id if doc else None,
            "document_id": doc_id,
        "file_name": doc.file_name if doc else None,
            "workspace_id": doc.workspace_id if doc else None,
        }
        for b in blocks
    ]


def read_blocks_by_ids(
    session: Session,
    block_ids: List[str],
    doc_ids: List[DocumentId],
) -> List[Dict[str, Any]]:
    if not block_ids:
        return []

    requested_ids = [str(block_id) for block_id in block_ids if str(block_id).strip()]
    if not requested_ids:
        return []

    stmt = select(LogicalBlock).options(load_only(
        LogicalBlock.id, LogicalBlock.document_id, LogicalBlock.block_id,
        LogicalBlock.section_id, LogicalBlock.block_type, LogicalBlock.content,
    )).where(
        LogicalBlock.document_id.in_(doc_ids),
        _block_identity_predicate(requested_ids),
    )
    blocks = list(session.execute(stmt).scalars().all())

    order_map = {block_id: index for index, block_id in enumerate(requested_ids)}

    def _order(block: LogicalBlock) -> int:
        internal_key = str(block.id)
        external_key = str(block.block_id) if block.block_id else None
        return min(
            order_map.get(internal_key, len(order_map)),
            order_map.get(external_key, len(order_map)),
        )

    blocks.sort(key=_order)
    section_public_ids = _public_section_ids_for_blocks(session, blocks)

    doc_ids_for_blocks = {block.document_id for block in blocks}
    doc_map = {
        doc.id: doc
        for doc in session.execute(
            select(LogicalDocument).where(LogicalDocument.id.in_(doc_ids_for_blocks))
        ).scalars().all()
    } if doc_ids_for_blocks else {}

    return [
        {
            "block_id": block.id,
            "external_block_id": block.block_id,
            "section_id": section_public_ids.get((block.document_id, block.section_id)),
            "block_type": block.block_type,
            "content": block.content,
            "source": _source_value(doc_map[block.document_id].source) if block.document_id in doc_map else None,
            "user_id": doc_map[block.document_id].user_id if block.document_id in doc_map else None,
            "document_id": block.document_id,
            "file_name": doc_map[block.document_id].file_name if block.document_id in doc_map else None,
            "workspace_id": doc_map[block.document_id].workspace_id if block.document_id in doc_map else None,
        }
        for block in blocks
    ]


class ContextContentLimitError(ValueError):
    """The selected context requires smaller section reads."""


def _bounded_context_rows(session, statement, params, max_bytes):
    """Stream bounded text rows; oversized values never cross the wire in full."""
    remaining = max_bytes
    result = session.execute(statement.execution_options(stream_results=True, yield_per=1), params)
    try:
        for row in result.mappings():
            check_db_deadline()
            remaining -= (row["content_bytes"] or 0) + 256
            if remaining < 0:
                raise ContextContentLimitError("Context content exceeds the load budget")
            yield row, remaining
    finally:
        result.close()


def _section_content_batch(
    session: Session,
    doc: Optional[LogicalDocument],
    doc_id: DocumentId,
    sections: List[LogicalSection],
    include_image_bytes: bool = False,
    max_bytes: Optional[int] = None,
) -> Dict[int, Dict[str, Any]]:
    if not sections:
        return {}

    source = _source_value(doc.source) if doc else None
    internal_section_ids = [section.section_id for section in sections if section.section_id]
    if not internal_section_ids:
        return {}

    total_start = time.perf_counter()

    page_ranges_start = time.perf_counter()
    page_ranges = _get_page_ranges_by_section(session, doc_id, internal_section_ids)
    page_ranges_ms = round((time.perf_counter() - page_ranges_start) * 1000, 3)

    blocks_by_section: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    blocks_start = time.perf_counter()
    if max_bytes is None:
        block_rows = session.execute(
            text("""
                SELECT id, section_id, block_type, content, page_number
                FROM logical_blocks
                WHERE document_id = :doc_id
                  AND section_id IN :section_ids
                ORDER BY section_id, id
            """).bindparams(bindparam("section_ids", expanding=True)),
            {
                "doc_id": doc_id,
                "section_ids": internal_section_ids,
            },
        ).mappings().all()
    else:
        if max_bytes <= 0:
            raise ContextContentLimitError("Context content exceeds the load budget")
        statement = select(LogicalBlock.id, LogicalBlock.section_id, LogicalBlock.block_type,
            func.left(LogicalBlock.content, max_bytes).label("content"),
            func.octet_length(LogicalBlock.content).label("content_bytes"), LogicalBlock.page_number).where(
                LogicalBlock.document_id == doc_id,
                LogicalBlock.workspace_id == doc.workspace_id,
                LogicalBlock.section_id.in_(internal_section_ids)).order_by(LogicalBlock.id)
        block_rows = _bounded_context_rows(session, statement, {}, max_bytes)
    for row in block_rows:
        if max_bytes is not None:
            row, max_bytes = row
        section_ref = row.get("section_id")
        if section_ref:
            blocks_by_section[section_ref].append({
                "block_id": row.get("id"),
                "block_type": row.get("block_type"),
                "content": row.get("content"),
                "page_number": row.get("page_number"),
                "source": source,
            })
    blocks_ms = round((time.perf_counter() - blocks_start) * 1000, 3)

    images_by_section: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    images_start = time.perf_counter()
    image_columns = [LogicalImage.id, LogicalImage.section_id, bounded_image_column(LogicalImage.content), LogicalImage.page_number]
    if include_image_bytes:
        image_columns.append(bounded_image_column(LogicalImage.image_base64))
    images_stmt = (
        select(*image_columns)
        .where(
            LogicalImage.document_id == doc_id,
            LogicalImage.section_id.in_(internal_section_ids),
        )
        .order_by(LogicalImage.section_id, LogicalImage.page_number, LogicalImage.id)
    )
    if max_bytes is None:
        for image in session.execute(images_stmt).all():
            if image.section_id:
                serializer = _serialize_image if include_image_bytes else _serialize_image_metadata
                images_by_section[image.section_id].append({**serializer(image), "page_number": image.page_number})
    else:
        images_stmt = select(LogicalImage.id, LogicalImage.section_id,
            func.left(LogicalImage.content, max_bytes).label("content"),
            func.octet_length(LogicalImage.content).label("content_bytes"), LogicalImage.page_number).where(
                LogicalImage.document_id == doc_id,
                LogicalImage.section_id.in_(internal_section_ids)).order_by(LogicalImage.id)
        for image, max_bytes in _bounded_context_rows(session, images_stmt, {}, max_bytes):
            if image["section_id"]:
                images_by_section[image["section_id"]].append({
                    "image_id": image["id"], "content": image["content"], "page_number": image["page_number"]})
    images_ms = round((time.perf_counter() - images_start) * 1000, 3)

    shaping_start = time.perf_counter()
    payloads: Dict[int, Dict[str, Any]] = {}
    for section in sections:
        payloads[section.id] = {
            "section_id": section.id,
            "title": section.title,
            "images": images_by_section.get(section.section_id, []),
            "page_range": page_ranges.get(section.section_id),
            "source": source,
            "user_id": doc.user_id if doc else None,
            "blocks": blocks_by_section.get(section.section_id, []),
        }
    shaping_ms = round((time.perf_counter() - shaping_start) * 1000, 3)
    total_ms = round((time.perf_counter() - total_start) * 1000, 3)
    _log_expand_context_timing({
        "phase": "section_content_batch",
        "total_ms": total_ms,
        "page_ranges_ms": page_ranges_ms,
        "blocks_ms": blocks_ms,
        "images_ms": images_ms,
        "shaping_ms": shaping_ms,
        "section_count": len(sections),
        "internal_section_id_count": len(internal_section_ids),
        "include_image_bytes": include_image_bytes,
        "returned_block_count": sum(len(blocks) for blocks in blocks_by_section.values()),
        "image_count": sum(len(images) for images in images_by_section.values()),
    })
    return payloads


def expand_section_context(
    session: Session,
    section_id: str,
    doc_ids: List[DocumentId],
    include_content: bool = True,
    batch_cache: Optional[Dict] = None,
) -> Optional[Dict[str, Any]]:
    """Read ancestor blocks and the entire selected subtree, without a depth cap."""
    from src.mcp_server.context_navigation import load_hierarchy, combine_content

    resolved = _resolve_section(session, section_id, doc_ids)
    if not resolved:
        return None
    target, doc_id = resolved
    # Cache is owned by this authorized request, never shared across calls/users.
    cache = batch_cache if batch_cache is not None else {}
    if doc_id not in cache:
        cache[doc_id] = {
            "doc": get_document_by_internal_id(session, doc_id),
            "hierarchy": load_hierarchy(session, doc_id),
            "payloads": {}, "loaded_ids": set(), "checked_ids": set(),
        }
    cached = cache[doc_id]
    doc, hierarchy = cached["doc"], cached["hierarchy"]
    ordered, ancestors, issues, boundary = hierarchy.select(str(target.id))
    rows = [hierarchy.rows[sid] for sid in ordered]
    response = {
        "target_section_id": target.id,
        "document_id": doc_id,
        "file_name": doc.file_name if doc else None,
        "workspace_id": doc.workspace_id if doc else None,
        "section_count": len(rows),
        "ancestor_count": len(ancestors),
        "hierarchy_issues": issues,
        "boundary": boundary,
    }
    if not include_content:
        response.update(sections=[hierarchy.brief(sid) for sid in ordered],
                        context_complete=False, stop_reason="navigation_only")
        return response
    check_db_deadline()
    missing = [row["id"] for row in rows if row["id"] not in cached["checked_ids"]]
    if missing:
        sections = _get_sections_by_ids(session, doc_id, missing)
        # ponytail: bound each request's materialized context; large subtrees use
        # section readers until a database cursor protocol is needed for expansion.
        from src.mcp_server.evidence import serialized_bytes
        remaining = settings.READ_CONTENT_BATCH_MAX_BYTES - serialized_bytes(cached["payloads"])
        try:
            payloads = _section_content_batch(
                session, doc, doc_id, sections, include_image_bytes=False, max_bytes=remaining)
        except ContextContentLimitError:
            selected = [row["id"] for row in rows[:settings.REQUEST_COLLECTION_MAX_ITEMS]]
            response.update(error="Context exceeds the content load budget. Read selected sections or expand smaller subtrees.",
                context_complete=False, stop_reason="content_load_budget", section_ids=selected,
                section_ids_truncated=len(selected) < len(rows),
                required_next_tool_call={"tool": "read_sections", "arguments": {
                    "section_id": [str(value) for value in selected], "workspace_id": response["workspace_id"],
                    "include_images": False}})
            return response
        cached["loaded_ids"].update(section.id for section in sections)
        cached["payloads"].update(payloads)
        cached["checked_ids"].update(missing)
    for row in rows:
        if row["id"] not in cached["loaded_ids"]:
            issues.append({"section_id": row["id"], "reason": "section_disappeared_during_read"})
    response["content"] = combine_content(rows, cached["payloads"])
    return response


_PUNCT_TRANSLATION = str.maketrans({
    "\u2018": "'",
    "\u2019": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u2013": "-",
    "\u2014": "-",
    "\u00a0": " ",
})


def _collapse_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _raw_tokens(value: str) -> List[str]:
    return _collapse_spaces(value).lower().split()


def _normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "").translate(_PUNCT_TRANSLATION)
    value = "".join(
        char
        for char in unicodedata.normalize("NFKD", value)
        if not unicodedata.combining(char)
    )
    value = value.lower()
    value = re.sub(r"[^\w]+", " ", value)
    return _collapse_spaces(value)


def _normalized_tokens(value: str) -> List[str]:
    normalized = _normalize_text(value)
    return normalized.split() if normalized else []


def _valid_bbox(value: Any) -> Optional[List[float]]:
    if isinstance(value, dict):
        try:
            return [
                float(value["x1"]),
                float(value["y1"]),
                float(value["x2"]),
                float(value["y2"]),
            ]
        except (KeyError, TypeError, ValueError):
            return None

    if not isinstance(value, list) or len(value) != 4:
        return None
    try:
        return [float(item) for item in value]
    except (TypeError, ValueError):
        return None


def _merge_bboxes(bboxes: List[List[float]]) -> Optional[List[float]]:
    if not bboxes:
        return None
    return _xyxy_to_xywh([
        min(b[0] for b in bboxes),
        min(b[1] for b in bboxes),
        max(b[2] for b in bboxes),
        max(b[3] for b in bboxes),
    ])


def _xyxy_to_xywh(bbox: Optional[List[float]]) -> Optional[List[float]]:
    if not bbox:
        return None
    x1, y1, x2, y2 = bbox
    return [x1, y1, max(0.0, x2 - x1), max(0.0, y2 - y1)]


def _xyxy_pixels_to_pdf_xywh(
    bbox: Optional[List[float]],
    dpi: int,
) -> Optional[List[float]]:
    if not bbox:
        return None
    if dpi <= 0:
        raise ValueError(f"dpi must be positive, got {dpi}")
    x1, y1, x2, y2 = bbox
    scale = 72.0 / dpi
    return [
        x1 * scale,
        y1 * scale,
        max(0.0, x2 - x1) * scale,
        max(0.0, y2 - y1) * scale,
    ]


def _image_local_bbox_to_page_pixels(
    local_bbox: Optional[List[float]],
    image_bbox: Optional[List[float]],
    image_dimensions: Optional[Tuple[int, int]],
) -> Optional[List[float]]:
    if not local_bbox or not image_bbox:
        return None

    img_x1, img_y1, img_x2, img_y2 = image_bbox
    local_x1, local_y1, local_x2, local_y2 = local_bbox
    target_width = max(0.0, img_x2 - img_x1)
    target_height = max(0.0, img_y2 - img_y1)
    source_width = float(image_dimensions[0]) if image_dimensions and image_dimensions[0] > 0 else target_width
    source_height = float(image_dimensions[1]) if image_dimensions and image_dimensions[1] > 0 else target_height
    if source_width <= 0 or source_height <= 0:
        return None

    scale_x = target_width / source_width
    scale_y = target_height / source_height
    return [
        img_x1 + (local_x1 * scale_x),
        img_y1 + (local_y1 * scale_y),
        img_x1 + (local_x2 * scale_x),
        img_y1 + (local_y2 * scale_y),
    ]


def _image_local_bboxes_to_pdf_xywh(
    local_bboxes: List[List[float]],
    image_bbox: Optional[List[float]],
    image_dimensions: Optional[Tuple[int, int]],
) -> Optional[List[float]]:
    page_bboxes = [
        page_bbox
        for bbox in local_bboxes
        if (page_bbox := _image_local_bbox_to_page_pixels(bbox, image_bbox, image_dimensions))
    ]
    if not page_bboxes:
        return _xyxy_pixels_to_pdf_xywh(image_bbox, settings.IMAGE_BBOX_DPI)
    return _xyxy_pixels_to_pdf_xywh([
        min(b[0] for b in page_bboxes),
        min(b[1] for b in page_bboxes),
        max(b[2] for b in page_bboxes),
        max(b[3] for b in page_bboxes),
    ], settings.IMAGE_BBOX_DPI)


def _find_subsequence(haystack: List[str], needle: List[str]) -> Optional[Tuple[int, int]]:
    if not needle or len(needle) > len(haystack):
        return None
    width = len(needle)
    for start in range(0, len(haystack) - width + 1):
        if all(haystack[start + offset] == needle[offset] for offset in range(width)):
            return start, start + width
    return None


def _build_normalized_search_index(tokens: List[str]) -> Dict[str, Any]:
    text_parts: List[str] = []
    token_start_offsets: List[int] = []
    offset = 0
    for index, token in enumerate(tokens):
        if index:
            text_parts.append(" ")
            offset += 1
        token_start_offsets.append(offset)
        text_parts.append(token)
        offset += len(token)
    return {
        "text": "".join(text_parts),
        "token_start_offsets": token_start_offsets,
    }


def _find_normalized_string_match(
    search_index: Dict[str, Any],
    evidence_tokens: List[str],
) -> Optional[Tuple[int, int]]:
    normalized_text = search_index.get("text") or ""
    token_start_offsets = search_index.get("token_start_offsets") or []
    if not normalized_text or not token_start_offsets or not evidence_tokens:
        return None

    needle = " ".join(evidence_tokens)
    if not needle:
        return None

    offset = f" {normalized_text} ".find(f" {needle} ")
    if offset < 0:
        return None

    end_offset = offset + len(needle) - 1
    start_token = bisect_right(token_start_offsets, offset) - 1
    end_token = bisect_right(token_start_offsets, end_offset)
    if start_token < 0 or end_token <= start_token:
        return None
    return start_token, end_token


def _token_similarity(left: List[str], right: List[str]) -> float:
    if not left or not right:
        return 0.0
    left_text = " ".join(left)
    right_text = " ".join(right)
    sequence_score = fuzz.ratio(left_text, right_text) / 100.0
    left_set = set(left)
    right_set = set(right)
    overlap_score = len(left_set & right_set) / max(len(left_set | right_set), 1)
    return (0.7 * sequence_score) + (0.3 * overlap_score)


def _iter_anchor_windows(
    words: List[str],
    evidence: List[str],
    min_width: int,
    max_width: int,
) -> List[Tuple[int, int]]:
    postings: Dict[str, List[int]] = defaultdict(list)
    for index, token in enumerate(words):
        postings[token].append(index)

    evidence_positions: Dict[str, List[int]] = defaultdict(list)
    for index, token in enumerate(evidence):
        if len(token) > 2:
            evidence_positions[token].append(index)

    anchors = [
        (len(postings[token]), token, positions)
        for token, positions in evidence_positions.items()
        if token in postings
    ]
    anchors.sort(key=lambda item: (item[0], item[1]))

    windows = set()
    target_width = len(evidence)
    for _, token, evidence_indexes in anchors[:3]:
        for evidence_index in evidence_indexes:
            for word_index in postings[token]:
                for width in range(min_width, max_width + 1):
                    anchor_offset = min(width - 1, round(evidence_index * width / max(target_width, 1)))
                    start = word_index - anchor_offset
                    if 0 <= start <= len(words) - width:
                        windows.add((start, start + width))
                        if len(windows) >= MAX_FUZZY_WINDOWS:
                            return sorted(windows)

    return sorted(windows)


def _fuzzy_window_count(word_count: int, min_width: int, max_width: int) -> int:
    return sum(max(0, word_count - width + 1) for width in range(min_width, max_width + 1))


def _find_fuzzy_window(
    words: List[str],
    evidence: List[str],
    stats: Optional[Dict[str, Any]] = None,
) -> Optional[Tuple[int, int, float]]:
    if not words or not evidence:
        return None

    target_width = len(evidence)
    min_width = max(1, int(target_width * 0.75))
    max_width = min(len(words), max(target_width + 3, int(target_width * 1.35)))
    if min_width > max_width:
        return None

    total_windows = _fuzzy_window_count(len(words), min_width, max_width)
    if stats is not None:
        stats["fuzzy_windows_available"] = stats.get("fuzzy_windows_available", 0) + total_windows

    if total_windows > MAX_FUZZY_WINDOWS:
        candidate_windows = _iter_anchor_windows(words, evidence, min_width, max_width)
        if stats is not None:
            stats["fuzzy_window_cap_hits"] = stats.get("fuzzy_window_cap_hits", 0) + 1
            stats["fuzzy_anchor_windows"] = stats.get("fuzzy_anchor_windows", 0) + len(candidate_windows)
        if not candidate_windows:
            if stats is not None:
                stats["fuzzy_skipped_no_anchor"] = stats.get("fuzzy_skipped_no_anchor", 0) + 1
            return None
    else:
        candidate_windows = [
            (start, start + width)
            for width in range(min_width, max_width + 1)
            for start in range(0, len(words) - width + 1)
        ]

    best: Optional[Tuple[int, int, float]] = None
    for start, end in candidate_windows[:MAX_FUZZY_WINDOWS]:
        score = _token_similarity(words[start:end], evidence)
        if stats is not None:
            stats["fuzzy_windows_scored"] = stats.get("fuzzy_windows_scored", 0) + 1
        if best is None or score > best[2]:
            best = (start, end, score)
            if score >= FUZZY_EARLY_EXIT_THRESHOLD:
                if stats is not None:
                    stats["fuzzy_early_exits"] = stats.get("fuzzy_early_exits", 0) + 1
                break

    if best and best[2] >= FUZZY_MATCH_THRESHOLD:
        return best
    return None


def _word_records(words: Any) -> List[Dict[str, Any]]:
    if not isinstance(words, list):
        return []

    indexed = []
    for offset, item in enumerate(words):
        if not isinstance(item, dict):
            continue
        text_value = str(item.get("text") or "")
        if not text_value.strip():
            continue
        bbox = _valid_bbox(item.get("bbox"))
        sort_index = item.get("word_index", offset)
        try:
            sort_index = int(sort_index)
        except (TypeError, ValueError):
            sort_index = offset
        indexed.append({
            "text": text_value,
            "bbox": bbox,
            "sort_index": sort_index,
        })

    return sorted(indexed, key=lambda item: item["sort_index"])


def _build_position_match_index(word_records: List[Dict[str, Any]]) -> Dict[str, Any]:
    normalized_pairs = [
        (index, token)
        for index, item in enumerate(word_records)
        for token in _normalized_tokens(item["text"])
    ]
    normalized_pairs = [(index, token) for index, token in normalized_pairs if token]
    normalized_word_tokens = [token for _, token in normalized_pairs]
    return {
        "raw_word_tokens": [_collapse_spaces(item["text"]).lower() for item in word_records],
        "normalized_pairs": normalized_pairs,
        "normalized_word_tokens": normalized_word_tokens,
        "normalized_search_index": _build_normalized_search_index(normalized_word_tokens),
    }


def _match_words(
    word_records: List[Dict[str, Any]],
    position_match_index: Dict[str, Any],
    block_text: str,
    evidence_text: str,
) -> Tuple[Optional[Tuple[int, int]], str, float, Dict[str, Any]]:
    stats: Dict[str, Any] = {
        "word_count": len(word_records),
        "evidence_token_count": 0,
        "raw_exact_ms": 0.0,
        "normalized_build_ms": 0.0,
        "normalized_exact_ms": 0.0,
        "block_exact_ms": 0.0,
        "fuzzy_ms": 0.0,
        "fuzzy_windows_available": 0,
        "fuzzy_windows_scored": 0,
        "fuzzy_window_cap_hits": 0,
        "fuzzy_anchor_windows": 0,
        "fuzzy_skipped_no_anchor": 0,
        "fuzzy_early_exits": 0,
    }

    stage_start = time.perf_counter()
    raw_word_tokens = position_match_index.get("raw_word_tokens") or []
    raw_evidence_tokens = _raw_tokens(evidence_text)
    stats["evidence_token_count"] = len(raw_evidence_tokens)

    exact = _find_subsequence(raw_word_tokens, raw_evidence_tokens)
    stats["raw_exact_ms"] = round((time.perf_counter() - stage_start) * 1000, 3)
    if exact:
        stats["method"] = "exact"
        return exact, "exact", 1.0, stats

    stage_start = time.perf_counter()
    normalized_pairs = position_match_index.get("normalized_pairs") or []
    normalized_word_tokens = position_match_index.get("normalized_word_tokens") or []
    normalized_search_index = position_match_index.get("normalized_search_index") or {}
    normalized_evidence_tokens = _normalized_tokens(evidence_text)
    stats["evidence_token_count"] = len(normalized_evidence_tokens)
    stats["normalized_build_ms"] = round((time.perf_counter() - stage_start) * 1000, 3)

    stage_start = time.perf_counter()
    normalized_exact = _find_normalized_string_match(normalized_search_index, normalized_evidence_tokens)
    stats["normalized_exact_ms"] = round((time.perf_counter() - stage_start) * 1000, 3)
    if normalized_exact:
        start, end = normalized_exact
        stats["method"] = "normalized_exact"
        return (
            (normalized_pairs[start][0], normalized_pairs[end - 1][0] + 1),
            "normalized_exact",
            0.95,
            stats,
        )

    stage_start = time.perf_counter()
    normalized_block_tokens = _normalized_tokens(block_text)
    block_exact = None
    if normalized_block_tokens and normalized_evidence_tokens:
        block_search_index = _build_normalized_search_index(normalized_block_tokens)
        block_exact = _find_normalized_string_match(block_search_index, normalized_evidence_tokens)
    stats["block_exact_ms"] = round((time.perf_counter() - stage_start) * 1000, 3)

    stage_start = time.perf_counter()
    fuzzy = _find_fuzzy_window(normalized_word_tokens, normalized_evidence_tokens, stats)
    stats["fuzzy_ms"] = round((time.perf_counter() - stage_start) * 1000, 3)
    if fuzzy:
        method = "fuzzy_block_confirmed" if block_exact else "fuzzy"
        stats["method"] = method
        return (
            (normalized_pairs[fuzzy[0]][0], normalized_pairs[fuzzy[1] - 1][0] + 1),
            method,
            round(fuzzy[2], 4),
            stats,
        )

    stats["method"] = "match_failed"
    return None, "match_failed", 0.0, stats


def _format_reference(value: Any) -> Optional[str]:
    if value is None or value == "":
        return None
    text_value = str(value).strip()
    if text_value.startswith("[") and text_value.endswith("]"):
        return text_value
    return f"[{text_value}]"


def _citation_result(
    citation: Dict[str, Any],
    document_id: DocumentId,
    section_id: Optional[str],
    block_id: str,
    source: Optional[str],
    page_number: int,
    highlight_text: str,
    highlight_bbox: Optional[List[float]],
) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "source": source,
        "page_number": page_number,
        "highlight_text": highlight_text,
        "highlight_bbox": highlight_bbox,
        "document_id": document_id,
        "section_id": section_id,
        "block_id": block_id,
    }
    reference = _format_reference(citation.get("reference"))
    if reference:
        result = {"reference": reference, **result}
    return result


def _verified_evidence_text(source: str, evidence: str) -> Optional[str]:
    """Return source text matching the evidence, allowing whitespace differences.

    Unlike OCR highlighting heuristics, validation preserves punctuation, signs,
    numbers, and negation. Do not accept fragments of words or decimal numbers.
    """
    parts = evidence.split()
    if not parts:
        return None
    pattern = r"(?<![\w+\-−])(?<!\d[.,])" + r"\s+".join(map(re.escape, parts)) + r"(?!\w|[.,]\d)"
    match = re.search(pattern, source or "", flags=re.IGNORECASE)
    return match.group(0) if match else None


def _image_citation_result(
    citation: Dict[str, Any],
    image: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    records = _word_records(image.get("words"))
    evidence_text = str(citation.get("evidence_text") or "")
    ocr_text = " ".join(record["text"] for record in records)
    highlight_text = ((image.get("content") or ocr_text) if citation.get("evidence_text") == ""
                      else (_verified_evidence_text(image.get("content") or "", evidence_text)
                            or _verified_evidence_text(ocr_text, evidence_text)))
    if highlight_text is None:
        return None
    highlight_bbox = None
    if records and citation.get("evidence_text"):
        match_index = _build_position_match_index(records)
        match_range, _, _, _ = _match_words(
            records,
            match_index,
            "",
            citation.get("evidence_text") or "",
        )
        if match_range:
            start, end = match_range
            matched_records = records[start:end]
            matched_text = " ".join(record["text"] for record in matched_records)
            if _verified_evidence_text(matched_text, evidence_text) is not None:
                highlight_text = matched_text
                matched_bboxes = [record["bbox"] for record in matched_records if record["bbox"]]
                highlight_bbox = _image_local_bboxes_to_pdf_xywh(
                    matched_bboxes,
                    image.get("bbox"),
                    image.get("image_dimensions"),
                )

    if highlight_bbox is None:
        highlight_bbox = _xyxy_pixels_to_pdf_xywh(image.get("bbox"), settings.IMAGE_BBOX_DPI)

    result: Dict[str, Any] = {
        "source": image.get("source"),
        "page_number": image.get("page_number"),
        "highlight_text": highlight_text,
        "highlight_bbox": highlight_bbox,
        "document_id": image.get("document_id"),
        "section_id": image.get("section_id"),
        "image_id": image.get("image_id"),
    }
    reference = _format_reference(citation.get("reference"))
    if reference:
        result = {"reference": reference, **result}
    return result


def _block_bbox_citation_result(
    citation: Dict[str, Any],
    block_id: str,
    metadata: Dict[str, Any],
    bbox_dpi: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    if not metadata:
        return None

    block_text = metadata.get("block_text") or ""
    highlight_text = (block_text if citation.get("evidence_text") == "" else
                      _verified_evidence_text(block_text, str(citation.get("evidence_text") or "")))
    if highlight_text is None:
        return None

    block_bbox = metadata.get("block_bbox")
    highlight_bbox = (
        _xyxy_pixels_to_pdf_xywh(block_bbox, bbox_dpi)
        if bbox_dpi is not None
        else _xyxy_to_xywh(block_bbox)
    )

    return _citation_result(
        citation,
        document_id=metadata["document_id"],
        section_id=metadata.get("section_id"),
        block_id=block_id,
        source=metadata.get("source"),
        page_number=metadata.get("page_number") or 0,
        highlight_text=highlight_text,
        highlight_bbox=highlight_bbox,
    )


def _get_image_citation_metadata_batch(
    session: Session,
    image_ids: List[str],
    user_id: Optional[str],
    workspace_id: ScopeValue,
    file_name: ScopeValue,
) -> Dict[str, Dict[str, Any]]:
    if not image_ids:
        return {}

    stmt = select(
        LogicalImage.id,
        LogicalImage.document_id,
        LogicalImage.section_id,
        LogicalImage.page_number,
        LogicalImage.bbox,
        bounded_image_column(LogicalImage.content),
        bounded_image_column(LogicalImage.image_base64),
        LogicalImage.words,
        LogicalDocument.source,
    ).join(
        LogicalDocument, LogicalImage.document_id == LogicalDocument.id,
    ).where(
        LogicalImage.id.in_(image_ids),
    )
    stmt = _apply_document_filters(stmt, user_id=user_id, workspace_id=workspace_id, file_name=file_name)

    metadata: Dict[str, Dict[str, Any]] = {}
    for row in session.execute(stmt).all():
        image_id = str(row[0])
        raw_image = _first_decodable_image_base64(row[5], row[6])
        metadata[image_id] = {
            "image_id": image_id,
            "document_id": row[1],
            "section_id": row[2],
            "page_number": row[3] or 0,
            "bbox": _valid_bbox(row[4]),
            "content": row[5] or "",
            "image_dimensions": _image_dimensions_from_base64(raw_image),
            "words": row[7],
            "source": _source_value(row[8]),
        }
    return metadata


def _get_block_metadata_batch(
    session: Session,
    block_ids: List[str],
    user_id: Optional[str],
    workspace_id: ScopeValue,
    file_name: ScopeValue,
) -> Dict[str, Dict[str, Any]]:
    if not block_ids:
        return {}

    stmt = select(
        LogicalBlock.id,
        LogicalBlock.document_id,
        LogicalBlock.section_id,
        LogicalBlock.page_number,
        LogicalDocument.file_name,
        LogicalDocument.source,
        LogicalBlock.bbox,
        LogicalBlock.block_id,
        LogicalBlock.content,
    ).join(
        LogicalDocument, LogicalBlock.document_id == LogicalDocument.id,
    ).where(
        _block_identity_predicate(block_ids),
    )
    stmt = _apply_document_filters(stmt, user_id=user_id, workspace_id=workspace_id, file_name=file_name)

    matches = defaultdict(dict)
    requested_ids = set(block_ids)
    for row in session.execute(stmt).all():
        payload = {
            "internal_block_id": str(row[0]),
            "document_id": row[1],
            "section_id": row[2],
            "page_number": row[3] or 0,
            "file_name": row[4],
            "source": _source_value(row[5]),
            "block_bbox": _valid_bbox(row[6]),
            "position_block_id": row[7],
            "external_block_id": row[7],
            "block_text": row[8] or "",
        }
        internal_key = str(row[0])
        external_key = str(row[7]) if row[7] else None
        if internal_key in requested_ids:
            matches[internal_key][internal_key] = payload
        if external_key and external_key in requested_ids:
            matches[external_key][internal_key] = payload
    # Aliases need not be globally unique, and can collide with numeric IDs.
    # Fail closed instead of selecting a document by database row order.
    return {key: next(iter(rows.values())) for key, rows in matches.items() if len(rows) == 1}


def _get_block_metadata(
    session: Session,
    block_id: str,
    user_id: Optional[str],
    workspace_id: ScopeValue,
    file_name: ScopeValue,
) -> Optional[Dict[str, Any]]:
    return _get_block_metadata_batch(
        session, [str(block_id)], user_id, workspace_id, file_name,
    ).get(str(block_id))


def _get_candidate_text_positions_batch(
    session: Session,
    block_ids: List[str],
    user_id: Optional[str],
    workspace_id: ScopeValue,
    file_name: ScopeValue,
    metadata_by_block_id: Dict[str, Dict[str, Any]],
) -> Dict[str, List[Tuple[LogicalTextPosition, Optional[str]]]]:
    rows_by_position_id = defaultdict(list)
    position_keys_by_block = {}
    for block_id in block_ids:
        metadata = metadata_by_block_id.get(block_id)
        if not metadata:
            continue
        # Positions use parser IDs when present. Never mix an internal numeric
        # block ID with a different block's parser alias in the same document.
        alias = metadata.get("position_block_id") or metadata.get("internal_block_id") or block_id
        position_keys_by_block[block_id] = (metadata["document_id"], str(alias))

    if position_keys_by_block:
        stmt = select(
            LogicalTextPosition,
            LogicalDocument.source,
        ).join(
            LogicalDocument, LogicalTextPosition.document_id == LogicalDocument.id,
        ).where(
            tuple_(LogicalTextPosition.document_id, LogicalTextPosition.block_id).in_(
                list(set(position_keys_by_block.values()))),
        )
        stmt = _apply_document_filters(stmt, user_id=user_id, workspace_id=workspace_id, file_name=file_name)
        stmt = stmt.order_by(LogicalTextPosition.block_id, LogicalTextPosition.page_number, LogicalTextPosition.id)
        for position, resolved_source in session.execute(stmt).all():
            rows_by_position_id[(position.document_id, str(position.block_id))].append((position, resolved_source))

    rows_by_block_id: Dict[str, List[Tuple[LogicalTextPosition, Optional[str]]]] = {}
    fallback_keys = set()
    fallback_key_by_block_id: Dict[str, Tuple[int, str, int]] = {}

    for block_id in block_ids:
        metadata = metadata_by_block_id.get(block_id)
        if not metadata:
            continue
        candidate_rows = rows_by_position_id.get(position_keys_by_block[block_id], [])

        if candidate_rows:
            rows_by_block_id[block_id] = candidate_rows
            continue

        document_id = metadata.get("document_id")
        section_id = metadata.get("section_id")
        page_number = metadata.get("page_number")
        if document_id and section_id and page_number:
            key = (document_id, section_id, page_number)
            fallback_keys.add(key)
            fallback_key_by_block_id[block_id] = key

    fallback_rows_by_key: Dict[Tuple[int, str, int], List[Tuple[LogicalTextPosition, Optional[str]]]] = defaultdict(list)
    if fallback_keys:
        fallback_stmt = select(
            LogicalTextPosition,
            LogicalDocument.source,
        ).join(
            LogicalDocument, LogicalTextPosition.document_id == LogicalDocument.id,
        ).where(
            tuple_(
                LogicalTextPosition.document_id,
                LogicalTextPosition.section_id,
                LogicalTextPosition.page_number,
            ).in_(list(fallback_keys)),
        )
        fallback_stmt = _apply_document_filters(
            fallback_stmt,
            user_id=user_id,
            workspace_id=workspace_id,
            file_name=file_name,
        )
        fallback_stmt = fallback_stmt.order_by(
            LogicalTextPosition.document_id,
            LogicalTextPosition.section_id,
            LogicalTextPosition.page_number,
            LogicalTextPosition.id,
        )
        for position, resolved_source in session.execute(fallback_stmt).all():
            key = (position.document_id, position.section_id, position.page_number)
            fallback_rows_by_key[key].append((position, resolved_source))

    for block_id, key in fallback_key_by_block_id.items():
        rows_by_block_id[block_id] = fallback_rows_by_key.get(key, [])

    return rows_by_block_id


def _get_candidate_text_positions(
    session: Session,
    block_id: str,
    user_id: Optional[str],
    workspace_id: ScopeValue,
    file_name: ScopeValue,
    metadata: Dict[str, Any],
) -> List[Tuple[LogicalTextPosition, Optional[str]]]:
    return _get_candidate_text_positions_batch(
        session, [str(block_id)], user_id, workspace_id, file_name,
        {str(block_id): metadata} if metadata else {},
    ).get(str(block_id), [])


def _position_match_payload(
    position: LogicalTextPosition,
    resolved_source: Optional[str],
    records_by_position_id: Dict[int, List[Dict[str, Any]]],
    match_index_by_position_id: Dict[int, Dict[str, Any]],
) -> Dict[str, Any]:
    records = records_by_position_id.get(position.id)
    if records is None:
        records = _word_records(position.words)
        records_by_position_id[position.id] = records
    match_index = match_index_by_position_id.get(position.id)
    if match_index is None:
        match_index = _build_position_match_index(records)
        match_index_by_position_id[position.id] = match_index
    return {
        "position_id": position.id,
        "document_id": position.document_id,
        "section_id": position.section_id,
        "page_number": position.page_number,
        "source": _source_value(resolved_source),
        "records": records,
        "match_index": match_index,
    }


def _summarize_match_stats(match_stats: List[Dict[str, Any]]) -> Dict[str, Any]:
    timed_fields = [
        "raw_exact_ms",
        "normalized_build_ms",
        "normalized_exact_ms",
        "block_exact_ms",
        "fuzzy_ms",
    ]
    counted_fields = [
        "fuzzy_windows_available",
        "fuzzy_windows_scored",
        "fuzzy_window_cap_hits",
        "fuzzy_anchor_windows",
        "fuzzy_skipped_no_anchor",
        "fuzzy_early_exits",
    ]

    summary: Dict[str, Any] = {
        "match_attempt_count": len(match_stats),
        "max_word_count": max((item.get("word_count", 0) for item in match_stats), default=0),
        "max_evidence_token_count": max((item.get("evidence_token_count", 0) for item in match_stats), default=0),
        "match_method_counts": dict(sorted({
            method: sum(1 for item in match_stats if item.get("method") == method)
            for method in {str(item.get("method") or "unknown") for item in match_stats}
        }.items())),
    }

    for field in timed_fields:
        values = [float(item.get(field, 0.0) or 0.0) for item in match_stats]
        summary[f"{field}_total"] = round(sum(values), 3)
        summary[f"{field}_max"] = round(max(values, default=0.0), 3)

    for field in counted_fields:
        summary[field] = sum(int(item.get(field, 0) or 0) for item in match_stats)

    return summary


def _locate_single_citation(
    citation: Dict[str, Any],
    rows: List[Dict[str, Any]],
) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, Any]]]:
    block_id = str(citation.get("block_id") or "")
    best_result: Optional[Dict[str, Any]] = None
    match_stats: List[Dict[str, Any]] = []
    evidence_text = str(citation.get("evidence_text") or "")
    if _verified_evidence_text(citation.get("block_text") or "", evidence_text) is None:
        return None, match_stats

    for row in rows:
        records = row["records"]
        match_range, method, confidence, stats = _match_words(
            records,
            row["match_index"],
            citation.get("block_text") or "",
            citation.get("evidence_text") or "",
        )
        match_stats.append(stats)
        if not match_range:
            continue

        start, end = match_range
        matched_records = records[start:end]
        highlight_text = " ".join(record["text"] for record in matched_records)
        if _verified_evidence_text(highlight_text, evidence_text) is None:
            continue
        matched_bboxes = [record["bbox"] for record in matched_records if record["bbox"]]
        highlight_bbox = _merge_bboxes(matched_bboxes)
        candidate = {
            "result": _citation_result(
                citation,
                document_id=row["document_id"],
                section_id=row["section_id"],
                block_id=block_id,
                source=row["source"],
                page_number=row["page_number"],
                highlight_text=highlight_text,
                highlight_bbox=highlight_bbox,
            ),
            "confidence": confidence,
        }
        if best_result is None or candidate["confidence"] > best_result["confidence"]:
            best_result = candidate
            if confidence >= 1.0:
                break

    return best_result["result"] if best_result is not None else None, match_stats


def _log_citation_timing(payload: Dict[str, Any]) -> None:
    if not request_logging_enabled():
        return
    log_json_line(get_tool_file_logger(), {
        "event": "citation_lookup_timing",
        **current_tool_call_context(),
        **payload,
    })


def locate_answer_citation_positions(
    session: Session,
    citations: List[Dict[str, Any]],
    user_id: Optional[str],
    workspace_id: ScopeValue,
    file_name: ScopeValue = None,
) -> Dict[str, List[Dict[str, Any]]]:
    total_start = time.perf_counter()
    def is_image_citation(citation: Dict[str, Any]) -> bool:
        return citation.get("type") == "image"

    block_ids = [
        str(citation.get("block_id") or "")
        for citation in citations
        if not is_image_citation(citation)
    ]
    block_ids = [block_id for block_id in dict.fromkeys(block_ids) if block_id]
    image_ids = [
        str(citation.get("image_id") or "")
        for citation in citations
        if is_image_citation(citation)
    ]
    image_ids = [image_id for image_id in dict.fromkeys(image_ids) if image_id]
    metadata_start = time.perf_counter()
    metadata_by_block_id = _get_block_metadata_batch(
        session,
        block_ids,
        user_id,
        workspace_id,
        file_name,
    )
    metadata_by_image_id = _get_image_citation_metadata_batch(
        session,
        image_ids,
        user_id,
        workspace_id,
        file_name,
    )
    metadata_ms = round((time.perf_counter() - metadata_start) * 1000, 3)
    hydrated_citations: List[Dict[str, Any]] = []
    for citation in citations:
        if is_image_citation(citation) or citation.get("evidence_text") == "":
            continue
        block_id = str(citation.get("block_id") or "")
        metadata = metadata_by_block_id.get(block_id) or {}
        hydrated_citation = dict(citation)
        hydrated_citation["block_text"] = metadata.get("block_text") or ""
        hydrated_citations.append(hydrated_citation)

    positions_start = time.perf_counter()
    rows_by_block_id = _get_candidate_text_positions_batch(
        session,
        list(dict.fromkeys(str(citation.get("block_id") or "") for citation in hydrated_citations)),
        user_id,
        workspace_id,
        file_name,
        metadata_by_block_id,
    )
    positions_ms = round((time.perf_counter() - positions_start) * 1000, 3)

    payload_start = time.perf_counter()
    records_by_position_id: Dict[int, List[Dict[str, Any]]] = {}
    match_index_by_position_id: Dict[int, Dict[str, Any]] = {}
    payloads_by_block_id: Dict[str, List[Dict[str, Any]]] = {}
    for block_id, rows in rows_by_block_id.items():
        payloads_by_block_id[block_id] = [
            _position_match_payload(position, resolved_source, records_by_position_id, match_index_by_position_id)
            for position, resolved_source in rows
        ]
    payload_ms = round((time.perf_counter() - payload_start) * 1000, 3)

    match_inputs = [
        (
            citation,
            payloads_by_block_id.get(str(citation.get("block_id") or ""), []),
        )
        for citation in hydrated_citations
    ]

    matching_start = time.perf_counter()
    if len(match_inputs) <= 1:
        located_with_stats = [_locate_single_citation(citation, rows) for citation, rows in match_inputs]
    else:
        max_workers = min(8, len(match_inputs))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            located_with_stats = list(executor.map(
                lambda item: _locate_single_citation(item[0], item[1]),
                match_inputs,
            ))
    matching_ms = round((time.perf_counter() - matching_start) * 1000, 3)

    located = [result for result, _ in located_with_stats]
    match_stats = [
        stats
        for _, citation_stats in located_with_stats
        for stats in citation_stats
    ]
    results: List[Dict[str, Any]] = []
    located_iter = iter(located)
    for citation in citations:
        if is_image_citation(citation):
            image_id = str(citation.get("image_id") or "")
            image_metadata = metadata_by_image_id.get(image_id)
            if image_metadata:
                result = _image_citation_result(citation, image_metadata)
                if result:
                    results.append(result)
            continue

        if citation.get("evidence_text") == "":
            block_id = str(citation.get("block_id") or "")
            result = _block_bbox_citation_result(citation, block_id,
                metadata_by_block_id.get(block_id) or {}, bbox_dpi=settings.IMAGE_BBOX_DPI)
            if result:
                results.append(result)
            continue

        result = next(located_iter, None)
        if result:
            results.append(result)

    total_ms = round((time.perf_counter() - total_start) * 1000, 3)
    _log_citation_timing({
        "citation_count": len(citations),
        "unique_block_count": len(block_ids),
        "unique_image_count": len(image_ids),
        "text_position_row_count": sum(len(rows) for rows in rows_by_block_id.values()),
        "metadata_ms": metadata_ms,
        "positions_ms": positions_ms,
        "payload_ms": payload_ms,
        "matching_ms": matching_ms,
        "total_ms": total_ms,
        "located_count": len(results),
        **_summarize_match_stats(match_stats),
    })

    return {"citations": results}


def locate_answer_citation_positions_mistral(
    session: Session,
    citations: List[Dict[str, Any]],
    user_id: Optional[str],
    workspace_id: ScopeValue,
    file_name: ScopeValue = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Locate citations from logical_blocks only.

    Mistral extraction does not populate logical_text_positions word bboxes or
    logical_images OCR words, so this path resolves each citation target against
    LogicalBlock.id / LogicalBlock.block_id and uses the block's original bbox as
    the page highlight.
    """
    target_ids = []
    for citation in citations:
        target_id = citation.get("image_id") if citation.get("type") == "image" else citation.get("block_id")
        if target_id:
            target_ids.append(str(target_id))
    target_ids = [target_id for target_id in dict.fromkeys(target_ids) if target_id]

    metadata_by_target_id = _get_block_metadata_batch(
        session,
        target_ids,
        user_id,
        workspace_id,
        file_name,
    )

    results: List[Dict[str, Any]] = []
    for citation in citations:
        target_id = citation.get("image_id") if citation.get("type") == "image" else citation.get("block_id")
        if not target_id:
            continue
        target_id = str(target_id)
        result = _block_bbox_citation_result(
            citation,
            block_id=target_id,
            metadata=metadata_by_target_id.get(target_id) or {},
            bbox_dpi=settings.MISTRAL_BBOX_DPI,
        )
        if result:
            results.append(result)

    return {"citations": results}
