"""Relationship expansion over a revision's AGE graph.

One Cypher query per step, from fixed query shapes; record ids and relation
ids travel as a bound parameter map, the graph name comes from the pinned
projection reference. Between steps the new records are checked in SQL
(concept scope, readable workspaces), so a hidden record never serves as a
bridge to the next step. Neighbours are included because a stored edge links
them, never because they resemble the request.
"""

from __future__ import annotations

import json
import time
from typing import Any

from app.persistence import graph_search_store as search_store
from app.population.age_projection import LIVE_PROJECTION_PREFIX, _check_graph, _agtype_value
from app.population.compiler import PopulationError

from .retrieval import describe_entity, is_visible

MAX_STEPS = 2
STEP_TIMEOUT = "5s"
# Rows read per step, as a multiple of the records still allowed in the result.
ROWS_PER_NODE = 10
MAX_ROWS_PER_STEP = 2000
_CYPHER_TAG = "$agesearch$"

_SHAPES = {
    # (frontier record) -[relation]-> (neighbour)
    "outgoing": "MATCH (s:Entity)-[r:RELATED_TO]->(t:Entity)",
    # (neighbour) -[relation]-> (frontier record)
    "incoming": "MATCH (t:Entity)-[r:RELATED_TO]->(s:Entity)",
}


async def init_age_connection(connection: Any) -> None:
    """Pool ``init``: lets ``agtype`` parameters bind as text (AGE prepared parameter maps)."""
    await connection.set_type_codec("agtype", schema="ag_catalog", encoder=str, decoder=str,
                                    format="text")


def step_query(graph: str, direction: str, with_relations: bool, row_limit: int) -> str:
    """The SQL of one step; the only interpolated parts are validated constants."""
    if direction not in _SHAPES or not 1 <= row_limit <= MAX_ROWS_PER_STEP:
        raise PopulationError("invalid_step")
    relation_filter = " AND r.relation_id IN $relations" if with_relations else ""
    cypher = (f"{_SHAPES[direction]} WHERE s.record_id IN $frontier{relation_filter} "
              f"RETURN s.record_id, r.relation_id, t.record_id LIMIT {int(row_limit)}")
    return (f"SELECT * FROM ag_catalog.cypher('{_check_graph(graph)}', {_CYPHER_TAG}{cypher}{_CYPHER_TAG}, $1) "
            "AS (source_id ag_catalog.agtype, relation_id ag_catalog.agtype, target_id ag_catalog.agtype)")


def graph_of(projection_ref: str) -> str:
    if not isinstance(projection_ref, str) or not projection_ref.startswith(LIVE_PROJECTION_PREFIX):
        raise PopulationError("revision_not_projected")
    return _check_graph(projection_ref[len(LIVE_PROJECTION_PREFIX):])


async def _read_step(age_pool: Any, graph: str, direction: str, frontier: list[str],
                     relations: list[str] | None, row_limit: int) -> list[tuple[str, str, str]]:
    params = {"frontier": frontier, **({"relations": relations} if relations else {})}
    async with age_pool.acquire() as connection:
        async with connection.transaction():
            await connection.execute(f"SET LOCAL statement_timeout = '{STEP_TIMEOUT}'")
            rows = await connection.fetch(step_query(graph, direction, bool(relations), row_limit),
                                          json.dumps(params))
    return [(str(_agtype_value(row["source_id"])), str(_agtype_value(row["relation_id"])),
             str(_agtype_value(row["target_id"]))) for row in rows]


async def expand(pool: Any, age_pool: Any, *, revision_id: str, projection_ref: str,
                 compiled: dict[str, Any], seed_ids: list[str], steps: list[dict[str, Any]],
                 max_nodes: int, allowed_workspaces: list[str] | None) -> dict[str, Any]:
    """``steps``: [{relations: [relation ids] | None, direction, conceptIds: [...] | None}]."""
    started = time.perf_counter()
    graph = graph_of(projection_ref)
    seeds = await search_store.entity_rows(pool, revision_id, seed_ids)
    visible_seeds = [entity_id for entity_id in dict.fromkeys(seed_ids)
                     if entity_id in seeds and is_visible(seeds[entity_id], allowed_workspaces)]
    nodes: dict[str, dict[str, Any]] = {
        entity_id: {**describe_entity(seeds[entity_id], compiled), "inclusionReason": "seed", "path": []}
        for entity_id in visible_seeds[:max_nodes]}
    edges: dict[tuple[str, str, str], dict[str, Any]] = {}
    truncated = len(visible_seeds) > max_nodes
    frontier = list(nodes)
    for step in steps[:MAX_STEPS]:
        if not frontier or len(nodes) >= max_nodes:
            truncated = truncated or bool(frontier)
            break
        directions = ["outgoing", "incoming"] if step.get("direction", "both") == "both" \
            else [step["direction"]]
        row_limit = min(MAX_ROWS_PER_STEP, (max_nodes - len(nodes)) * ROWS_PER_NODE + 1)
        found: list[tuple[str, str, str, str]] = []  # (frontier id, relation, neighbour id, direction)
        for direction in directions:
            rows = await _read_step(age_pool, graph, direction, frontier, step.get("relations"), row_limit)
            truncated = truncated or len(rows) >= row_limit
            found += [(source, relation, target, direction) for source, relation, target in rows]
        candidates = await search_store.entity_rows(
            pool, revision_id, sorted({target for _, _, target, _ in found if target not in nodes}))
        concept_scope = set(step.get("conceptIds") or [])
        next_frontier: list[str] = []
        for origin, relation_id, neighbour, direction in sorted(found):
            known = neighbour in nodes
            entity = candidates.get(neighbour)
            if not known:
                if (entity is None or not is_visible(entity, allowed_workspaces)
                        or (concept_scope and entity["conceptId"] not in concept_scope)):
                    continue
                if len(nodes) >= max_nodes:
                    truncated = True
                    continue
                relation = compiled["relations"].get(relation_id) or {}
                nodes[neighbour] = {
                    **describe_entity(entity, compiled), "inclusionReason": "relationship",
                    "path": nodes[origin]["path"] + [{
                        "fromEntityId": origin, "relationId": relation_id,
                        "relationKey": relation.get("key", ""), "direction": direction,
                        "toEntityId": neighbour}]}
                next_frontier.append(neighbour)
            source, target = (origin, neighbour) if direction == "outgoing" else (neighbour, origin)
            edges[(relation_id, source, target)] = {
                "relationId": relation_id,
                "relationKey": (compiled["relations"].get(relation_id) or {}).get("key", ""),
                "sourceEntityId": source, "targetEntityId": target}
        frontier = next_frontier
    return {"nodes": list(nodes.values()),
            "edges": [edge for edge in edges.values()
                      if edge["sourceEntityId"] in nodes and edge["targetEntityId"] in nodes],
            "hiddenSeeds": len(dict.fromkeys(seed_ids)) - len(visible_seeds),
            "truncated": truncated,
            "timings": {"expandMs": round((time.perf_counter() - started) * 1000)}}
