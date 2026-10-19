"""Bounded evidence retrieval within authorized, already selected sections."""

from sqlalchemy import String, case, cast, exists, func, literal, literal_column, or_, select, union_all
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import aliased

from src.config.settings import get_settings
from src.db.models import LogicalBlock, LogicalDocument, LogicalImage, LogicalSection
from src.db.session import check_db_deadline
from src.mcp_server.db_helpers import _apply_document_filters
from src.mcp_server.evidence import excerpt, query_terms


def _is_image(block):
    return or_(block.block_type.like("image/%"),
               block.block_type.in_(["image", "figure", "chart"]))


def _same_image(block, image):
    return (
        block.document_id == image.document_id,
        block.section_id == image.section_id,
        block.page_number.is_not_distinct_from(image.page_number),
        # Descriptions may live only in blocks. A positioned image does not
        # need a duplicate description to establish the same source identity.
        or_(cast(image.bbox, JSONB) != literal_column("'null'::jsonb"),
            func.coalesce(block.content, "") == func.coalesce(image.content, "")),
        cast(block.bbox, JSONB).is_not_distinct_from(cast(image.bbox, JSONB)),
        _is_image(block),
    )


def search_section_evidence(session, section_ids, workspace_id, query,
                            query_embedding=None, top_k=3, preferred_blocks=None,
                            include_neighbors=False, block_content_cache=None,
                            preferred_images=None):
    """Rank scoped blocks and image descriptions with section title context.

    No minimum block score: a selected section supplies subject context. Lexical
    scoring uses PostgreSQL full text over title + content, and semantic scoring
    uses block text embeddings and image visual embeddings. Linked image/block
    evidence is returned once, including when the description is empty.
    Candidate scores are heuristics, not answer confidence. No image bytes or
    embeddings are loaded into Python. All candidate pools are section-scoped.
    """
    settings = get_settings()
    ids = list(dict.fromkeys(int(value) for value in section_ids))
    scope = _apply_document_filters(select(
        LogicalSection.id.label("section_id"),
        LogicalSection.section_id.label("local_id"),
        LogicalSection.title,
        LogicalDocument.id.label("document_id"),
        LogicalDocument.file_name,
        LogicalDocument.workspace_id,
    ).join(LogicalDocument, LogicalSection.document_id == LogicalDocument.id).where(
        LogicalSection.id.in_(ids)), workspace_id=workspace_id)
    metadata = {row.section_id: dict(row._mapping) for row in session.execute(scope).all()}
    if not metadata:
        return [{"section_id": value, "error": "Section not found"} for value in ids]
    scoped = scope.cte("evidence_scope")
    terms = query_terms(query)
    lexical_query = func.websearch_to_tsquery("simple", " OR ".join(terms))

    def lexical(content):
        # Title participation preserves the subject even when details omit it.
        document = func.concat(func.coalesce(scoped.c.title, ""), " ", func.coalesce(content, ""))
        rank = func.ts_rank_cd(func.to_tsvector("simple", document), lexical_query)
        return rank / (1.0 + rank)

    b = LogicalBlock
    i = LogicalImage
    preferred_image_ids = list((preferred_images or {}).values())
    linked_image = select(i.id).where(*_same_image(b, i)).order_by(i.id).limit(1).correlate(b).scalar_subquery()
    semantic = (func.greatest(0.0, 1 - b.embedding.cosine_distance(query_embedding))
                if query_embedding is not None else literal(0.0))
    image_semantic = (func.greatest(0.0, 1 - i.embedding.cosine_distance(query_embedding))
                      if query_embedding is not None else literal(0.0))
    linked_semantic = (select(func.max(image_semantic)).where(*_same_image(b, i))
                       .correlate(b).scalar_subquery() if query_embedding is not None else literal(0.0))
    semantic = func.greatest(func.coalesce(semantic, 0.0), func.coalesce(linked_semantic, 0.0))
    score = 0.7 * func.coalesce(semantic, 0.0) + 0.3 * lexical(b.content)
    preferred = list((preferred_blocks or {}).values())
    block_candidates = select(
        scoped.c.section_id, b.id.label("block_id"),
        cast(literal(None), String).label("image_id"),
        b.page_number, score.label("score"),
        case((or_(b.id.in_(preferred), linked_image.in_(preferred_image_ids)), 1), else_=0).label("preferred"),
    ).select_from(scoped).join(b, (b.document_id == scoped.c.document_id)
        & (b.section_id == scoped.c.local_id) & (b.workspace_id == scoped.c.workspace_id))
    duplicate = aliased(LogicalBlock)
    image_candidates = select(
        scoped.c.section_id, cast(literal(None), b.id.type).label("block_id"),
        i.id.label("image_id"), i.page_number,
        (0.7 * func.coalesce(image_semantic, 0.0) + 0.3 * lexical(i.content)).label("score"),
        case((i.id.in_(preferred_image_ids), 1), else_=0).label("preferred"),
    ).select_from(scoped).join(i, (i.document_id == scoped.c.document_id)
        & (i.section_id == scoped.c.local_id)).where(~exists(select(duplicate.id).where(
            *_same_image(duplicate, i), duplicate.workspace_id == scoped.c.workspace_id)))
    candidates = union_all(block_candidates, image_candidates).subquery()
    ranked = select(candidates, func.row_number().over(
        partition_by=candidates.c.section_id,
        order_by=(candidates.c.preferred.desc(), candidates.c.score.desc(),
                  candidates.c.page_number.asc().nulls_last(),
                  candidates.c.block_id.asc().nulls_last(), candidates.c.image_id),
    ).label("position"), func.count().over(
        partition_by=candidates.c.section_id).label("total_count")).subquery()
    # Fetch one bounded page of winners per section; content stays out of the window sort.
    winners = session.execute(select(ranked).where(ranked.c.position <= top_k).order_by(
        ranked.c.section_id, ranked.c.position)).all()
    block_ids = [row.block_id for row in winners if row.block_id is not None]
    image_ids = [row.image_id for row in winners if row.image_id is not None]
    check_db_deadline()
    blocks = {}
    cached_content = block_content_cache or {}
    if block_ids:
        # This read-only request can see concurrent commits under READ COMMITTED.
        # Reuse text only if the row's PostgreSQL insertion/update transaction
        # still matches discovery; otherwise fetch fresh content in this query.
        reused = ((cast(literal_column("logical_blocks.xmin"), String) == case(
            {key: value[1] for key, value in cached_content.items()}, value=b.id))
            if cached_content else literal(False))
        content_column = (case((reused, literal(None)), else_=b.content).label("content")
                          if cached_content else b.content)
        rows = session.execute(select(b.id, content_column, b.block_type, b.page_number,
            linked_image.label("image_id"), reused.label("content_reused")).where(
                b.id.in_(block_ids), b.document_id.in_([m["document_id"] for m in metadata.values()]),
                b.workspace_id.in_([m["workspace_id"] for m in metadata.values()]))).all()
        blocks = {row.id: row for row in rows}
    images = {}
    if image_ids:
        rows = session.execute(select(i.id, i.content, i.page_number).where(
            i.id.in_(image_ids), i.document_id.in_([m["document_id"] for m in metadata.values()]))).all()
        images = {row.id: row for row in rows}
    results = {key: {"section_id": key, "title": m["title"], "document_id": m["document_id"],
        "file_name": m["file_name"], "workspace_id": m["workspace_id"],
        "blocks": [], "has_more_blocks": False} for key, m in metadata.items()}
    for winner in winners:
        section = results[winner.section_id]
        section["has_more_blocks"] = winner.total_count > top_k
        row = blocks.get(winner.block_id) if winner.block_id is not None else images.get(winner.image_id)
        if row is None:
            section["has_more_blocks"] = True
            continue
        item = {"score": round(float(winner.score or 0), 4), "page_number": row.page_number,
                "_selection_rank": winner.position}
        if winner.block_id is not None:
            item.update(block_id=row.id, block_type=row.block_type)
            if row.image_id is not None:
                item["image_id"] = row.image_id
        else:
            item.update(image_id=row.id, block_type="image")
        content = (cached_content[winner.block_id][0]
                   if winner.block_id in cached_content and row.content_reused else row.content)
        item.update(excerpt(content, query, settings.SEARCH_EVIDENCE_MAX_CHARS))
        section["blocks"].append(item)
    if include_neighbors:
        # One preceding and following block per selected text block, inside the
        # exact same section. This avoids silently dropping adjacent exceptions.
        previous = aliased(LogicalBlock)
        following = aliased(LogicalBlock)
        def adjacent_id(other, before):
            return select(other.id).where(other.document_id == b.document_id,
                other.workspace_id == b.workspace_id, other.section_id == b.section_id,
                other.id < b.id if before else other.id > b.id).order_by(
                    other.id.desc() if before else other.id).limit(1).correlate(b).scalar_subquery()
        adjacency = session.execute(select(b.id,
            adjacent_id(previous, True).label("previous"),
            adjacent_id(following, False).label("following")).where(
                b.id.in_(block_ids), b.document_id.in_([m["document_id"] for m in metadata.values()]),
                b.workspace_id.in_([m["workspace_id"] for m in metadata.values()]))).all() if block_ids else []
        adjacent_by_id = {row.id: (row.previous, row.following) for row in adjacency}
        for key, section in results.items():
            known = {entry.get("block_id") for entry in section["blocks"]}
            metadata_row = metadata[key]
            neighbors = set()
            for block_id in sorted(value for value in known if value is not None):
                for neighbor in adjacent_by_id.get(block_id, ()):
                    if neighbor is not None and neighbor not in known:
                        neighbors.add(neighbor)
            if neighbors:
                rows = session.execute(select(b.id, b.content, b.block_type, b.page_number,
                    linked_image.label("image_id")).where(b.id.in_(neighbors),
                    b.document_id == metadata_row["document_id"],
                    b.workspace_id == metadata_row["workspace_id"],
                    b.section_id == metadata_row["local_id"])).all()
                for row in rows:
                    item = {"block_id": row.id, "block_type": row.block_type,
                            "page_number": row.page_number, "selection": "adjacent"}
                    if row.image_id is not None:
                        item["image_id"] = row.image_id
                    item.update(excerpt(row.content, query, settings.SEARCH_EVIDENCE_MAX_CHARS))
                    section["blocks"].append(item)
    for section in results.values():
        section["blocks"].sort(key=lambda item: (
            item.get("page_number") is None, item.get("page_number") or 0,
            item.get("block_id") is None, item.get("block_id") or 0, str(item.get("image_id", ""))))
    return [results.get(value, {"section_id": value, "error": "Section not found"}) for value in ids]
