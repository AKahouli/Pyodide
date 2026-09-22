"""Candidate search primitives over the logical index (Phase 4B, P4.7-P4.13).

Similarity locates evidence; it is not calibrated extraction confidence. Every
query is scoped to one authorized ``document_pk`` (P4.11); there is no global
top-k across documents and no query rewriting or translation (P4.13). Lexical
and vector paths are capability-gated so an absent facility disables that path
instead of prompting a schema change (P4.8-P4.9).
"""

from __future__ import annotations

from typing import Any

MAX_SEARCH_HITS = 100


class LogicalSearchError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _document_pk(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise LogicalSearchError("invalid_document_pk")
    return value


def _limit(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= MAX_SEARCH_HITS:
        raise LogicalSearchError("invalid_search_limit")
    return value


def _rows_to_hits(rows: list[Any], method: str) -> list[dict[str, Any]]:
    """Group raw rows by section identity and deduplicate (P4.10)."""
    grouped: dict[int, dict[str, Any]] = {}
    for row in rows:
        section_pk = row["section_pk"]
        hit = grouped.get(section_pk)
        if hit is None:
            hit = {"sectionPk": section_pk, "sectionKey": row["section_key"],
                   "title": row["section_title"], "method": method, "rank": 0.0, "blocks": []}
            grouped[section_pk] = hit
        rank = row.get("rank")
        if isinstance(rank, (int, float)) and not isinstance(rank, bool):
            hit["rank"] = max(hit["rank"], float(rank))
        elif method == "exact":
            hit["rank"] = max(hit["rank"], 1.0)
        if row.get("block_pk") is not None:
            hit["blocks"].append({"blockPk": row["block_pk"], "blockKey": row.get("block_key"),
                                  "blockType": row.get("block_type"),
                                  "pageNumber": row.get("page_number")})
    return sorted(grouped.values(), key=lambda item: (-item["rank"], item["sectionPk"]))


def combine_hits(*hit_lists: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge method results, keeping the best rank per section (P4.10)."""
    merged: dict[int, dict[str, Any]] = {}
    for hits in hit_lists:
        for hit in hits:
            existing = merged.get(hit["sectionPk"])
            if existing is None or hit["rank"] > existing["rank"]:
                merged[hit["sectionPk"]] = hit
    return sorted(merged.values(), key=lambda item: (-item["rank"], item["sectionPk"]))


async def search_exact(connection: Any, *, document_pk: Any, value: Any,
                       limit: int = 25) -> dict[str, Any]:
    """Exact identifier/label match over section titles and block content (P4.7).

    Exact occurrence proves the string is present; it does not prove a business
    role, so hits stay candidate evidence (P5.9).
    """
    document = _document_pk(document_pk)
    if not isinstance(value, str) or not value.strip():
        raise LogicalSearchError("invalid_search_value")
    bound = _limit(limit)
    # +1 row detects a joined-row limit cut before section dedupe (a section
    # with many joined block rows must not silently drop other sections).
    rows = list(await connection.fetch(
        "SELECT s.id AS section_pk, s.section_id AS section_key, s.title AS section_title, "
        "b.id AS block_pk, b.block_id AS block_key, b.block_type, b.page_number "
        "FROM logical_sections s "
        "LEFT JOIN logical_blocks b "
        "  ON b.document_id = s.document_id AND b.section_id = s.section_id "
        "WHERE s.document_id = $1 AND (s.title = $2 OR b.content = $2) "
        "ORDER BY s.id, b.page_number NULLS LAST, b.id LIMIT $3",
        document, value, bound + 1,
    ))
    truncated = len(rows) > bound
    hits = _rows_to_hits(rows[:bound], "exact")
    return {"documentPk": document, "method": "exact", "hits": hits,
            "returnedHits": len(hits), "truncated": truncated}


async def search_lexical(connection: Any, *, document_pk: Any, query: Any,
                         capabilities: dict[str, Any], limit: int = 25) -> dict[str, Any]:
    """GIN tsvector match over titles and block content (P4.8).

    Fails closed when no usable lexical column exists; BM25 detection alone is
    not a query path the adapter implements.
    """
    document = _document_pk(document_pk)
    if not isinstance(query, str) or not query.strip():
        raise LogicalSearchError("invalid_search_value")
    bound = _limit(limit)
    if not capabilities.get("lexical"):
        raise LogicalSearchError("lexical_capability_unavailable")
    rows = list(await connection.fetch(
        "SELECT s.id AS section_pk, s.section_id AS section_key, s.title AS section_title, "
        "b.id AS block_pk, b.block_id AS block_key, b.block_type, b.page_number, "
        "GREATEST(ts_rank(s.title_tsv, plainto_tsquery($2)), "
        "ts_rank(b.content_tsv, plainto_tsquery($2))) AS rank "
        "FROM logical_sections s "
        "LEFT JOIN logical_blocks b "
        "  ON b.document_id = s.document_id AND b.section_id = s.section_id "
        "WHERE s.document_id = $1 "
        "  AND (s.title_tsv @@ plainto_tsquery($2) OR b.content_tsv @@ plainto_tsquery($2)) "
        "ORDER BY rank DESC NULLS LAST, s.id, b.page_number NULLS LAST, b.id LIMIT $3",
        document, query, bound + 1,
    ))
    truncated = len(rows) > bound
    hits = _rows_to_hits(rows[:bound], "lexical")
    return {"documentPk": document, "method": "lexical", "hits": hits,
            "returnedHits": len(hits), "truncated": truncated}


# Vector ANN probes are intentionally absent: the deployment's embedding model
# is unverified (P4.9), so only deterministic exact and lexical retrieval are
# wired. Add the probe here once the model fingerprint is pinned and tested.
