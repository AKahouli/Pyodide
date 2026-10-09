"""Bounded, workspace-scoped reads of a revision's graph: which records a window shows, how many
there are, and the links among them. Everything is decided over the canonical revision rows with
the same visibility rule as every other scoped reader (``visible_entity_clause``), pushed into
SQL with the limit, so a graph of hundreds of thousands of records is never read whole."""

from __future__ import annotations

from typing import Any

from app.persistence.population_store import visible_entity_clause

_ENTITIES = "semantic_population.entities"
_LINKS = "semantic_population.relationships"


def allocate_quotas(counts: dict[str, int], limit: int) -> dict[str, int]:
    """Share ``limit`` records among concepts as evenly as their sizes allow: a small concept
    takes all it has and the rest is shared by the others. Ids sort by concept, so without this
    the first records by id would all belong to the first concepts."""
    quotas = {concept: 0 for concept, count in counts.items() if count > 0}
    remaining = limit
    open_concepts = sorted(quotas)
    while remaining > 0 and open_concepts:
        share = max(1, remaining // len(open_concepts))
        still_open = []
        for concept in open_concepts:
            grant = min(share, counts[concept] - quotas[concept], remaining)
            quotas[concept] += grant
            remaining -= grant
            if quotas[concept] < counts[concept]:
                still_open.append(concept)
        open_concepts = still_open
    return {concept: quota for concept, quota in quotas.items() if quota > 0}


async def count_visible_overview(pool: Any, revision_id: str,
                                 allowed_workspace_ids: list[str]) -> dict[str, dict[str, int]]:
    """Visible records per concept and visible links per relationship. A link counts when both of
    its ends are visible; hidden records never appear in a count, nor does a concept or a
    relationship that has none visible. The links are counted against the (usually few) hidden
    records instead of joining the visible ones, which is several times faster."""
    allowed = list(allowed_workspace_ids)
    concept_rows = await pool.fetch(
        f"SELECT concept_id, count(*) AS records FROM {_ENTITIES} e "
        f"WHERE e.data_revision_id = $1 AND {visible_entity_clause('e', '$2')} GROUP BY concept_id",
        revision_id, allowed)
    link_rows = await pool.fetch(
        f"WITH hidden AS MATERIALIZED (SELECT e.id FROM {_ENTITIES} e "
        f"WHERE e.data_revision_id = $1 AND NOT {visible_entity_clause('e', '$2')}) "
        f"SELECT r.relation_id, count(*) AS links FROM {_LINKS} r "
        "WHERE r.data_revision_id = $1 AND r.state = 'accepted' "
        "AND NOT EXISTS (SELECT 1 FROM hidden h WHERE h.id = r.source_entity_id) "
        "AND NOT EXISTS (SELECT 1 FROM hidden h WHERE h.id = r.target_entity_id) "
        "GROUP BY r.relation_id",
        revision_id, allowed)
    return {"concepts": {str(row["concept_id"]): int(row["records"]) for row in concept_rows},
            "relations": {str(row["relation_id"]): int(row["links"]) for row in link_rows}}


async def select_visible_records(pool: Any, revision_id: str, allowed_workspace_ids: list[str],
                                 quotas: dict[str, int]) -> list[tuple[str, str]]:
    """(record id, concept id) of the first visible records of each concept in id order, as many
    as its quota, in one statement."""
    if not quotas:
        return []
    concepts = sorted(quotas)
    rows = await pool.fetch(
        "SELECT x.id, x.concept_id FROM unnest($3::text[], $4::int[]) AS q(concept_id, quota) "
        f"CROSS JOIN LATERAL (SELECT e.id, e.concept_id FROM {_ENTITIES} e "
        f"WHERE e.data_revision_id = $1 AND e.concept_id = q.concept_id AND {visible_entity_clause('e', '$2')} "
        "ORDER BY e.id LIMIT q.quota) x ORDER BY x.id",
        revision_id, list(allowed_workspace_ids), concepts, [quotas[concept] for concept in concepts])
    return [(str(row["id"]), str(row["concept_id"])) for row in rows]


async def select_focus_records(pool: Any, revision_id: str, allowed_workspace_ids: list[str],
                               focus_ids: list[str], *, neighbours: bool,
                               limit: int) -> tuple[list[tuple[str, str]], bool]:
    """The visible ones among ``focus_ids`` and, with ``neighbours``, the visible records linked
    to them (either direction, accepted links), at most ``limit`` in all, the focus first.
    Returns the records and whether more were left out."""
    allowed = list(allowed_workspace_ids)
    focus_rows = await pool.fetch(
        f"SELECT e.id, e.concept_id FROM {_ENTITIES} e WHERE e.data_revision_id = $1 AND e.id = ANY($3::text[]) "
        f"AND {visible_entity_clause('e', '$2')} ORDER BY e.id LIMIT $4",
        revision_id, allowed, list(focus_ids), limit + 1)
    records = [(str(row["id"]), str(row["concept_id"])) for row in focus_rows]
    truncated = len(records) > limit
    records = records[:limit]
    if not neighbours or not records or truncated:
        return records, truncated
    focus = [record_id for record_id, _concept in records]
    room = limit - len(records)
    rows = await pool.fetch(
        f"SELECT e.id, e.concept_id FROM {_ENTITIES} e WHERE e.data_revision_id = $1 "
        f"AND {visible_entity_clause('e', '$2')} AND NOT (e.id = ANY($3::text[])) AND e.id IN ("
        f"SELECT r.target_entity_id FROM {_LINKS} r WHERE r.data_revision_id = $1 AND r.state = 'accepted' "
        "AND r.source_entity_id = ANY($3::text[]) UNION "
        f"SELECT r.source_entity_id FROM {_LINKS} r WHERE r.data_revision_id = $1 AND r.state = 'accepted' "
        "AND r.target_entity_id = ANY($3::text[])) ORDER BY e.id LIMIT $4",
        revision_id, allowed, focus, room + 1)
    around = [(str(row["id"]), str(row["concept_id"])) for row in rows]
    return records + around[:room], len(around) > room


async def list_links_among(pool: Any, revision_id: str, record_ids: list[str]) -> list[dict[str, str]]:
    """The accepted links whose two ends are both in ``record_ids`` (already visible, so the
    links are too)."""
    if not record_ids:
        return []
    rows = await pool.fetch(
        f"SELECT r.relation_id, r.source_entity_id, r.target_entity_id FROM {_LINKS} r "
        "WHERE r.data_revision_id = $1 AND r.state = 'accepted' "
        "AND r.source_entity_id = ANY($2::text[]) AND r.target_entity_id = ANY($2::text[]) "
        "ORDER BY r.relation_id, r.source_entity_id, r.target_entity_id",
        revision_id, list(record_ids))
    return [{"relationId": str(row["relation_id"]), "sourceId": str(row["source_entity_id"]),
             "targetId": str(row["target_entity_id"])} for row in rows]
