"""Relationship expansion over a revision's AGE graph.

One Cypher query per step (per relationship on a typed graph, through its edge
label), from fixed query shapes; record ids are written as escaped literals so the
planner starts from the record_id indexes, the graph name comes from the pinned
projection reference. On a typed graph each row carries the neighbour's concept and
workspaces, so the concept scope and visibility are applied as the rows are read;
every new record is also checked in SQL between steps, so a hidden record never
serves as a bridge to the next step. Neighbours are included because a stored edge
links them, never because they resemble the request.

Besides the walk: the exact number of records linked to the seeds per
relationship (``link_counts``, from the stored links, visible and hidden apart)
and, on request, the field values of the records returned.
"""

from __future__ import annotations

import time
from typing import Any

import asyncpg

from app.persistence import graph_search_store as search_store
from app.population.age_projection import (WORKSPACES_PROPERTY, _agtype_value, _check_graph, _check_label,
                                           _escape, is_typed_projection, projection_graph, relation_label)
from app.population.compiler import PopulationError

from .retrieval import describe_entity, is_visible

MAX_STEPS = 2
STEP_TIMEOUT = "5s"
# Rows read per step, as a multiple of the records still allowed in the result.
ROWS_PER_NODE = 10
MAX_ROWS_PER_STEP = 2000
# Field values returned with the records are cut like query_records values.
VALUE_CHARS = 1500
_CYPHER_TAG = "$agesearch$"

_SHAPES = {
    # (frontier record) -[relation]-> (neighbour); no label, so typed and Entity graphs read alike
    "outgoing": "MATCH (s)-[r]->(t)",
    # (neighbour) -[relation]-> (frontier record)
    "incoming": "MATCH (t)-[r]->(s)",
}


async def init_age_connection(connection: Any) -> None:
    """Pool ``init``: lets ``agtype`` parameters bind as text (AGE prepared parameter maps)."""
    await connection.set_type_codec("agtype", schema="ag_catalog", encoder=str, decoder=str,
                                    format="text")


def _list(values: list[str]) -> str:
    return "[" + ", ".join(_escape(str(value)) for value in values) + "]"


def step_query(graph: str, direction: str, row_limit: int, *, frontier: list[str],
               relations: list[str] | None = None, edge_label: str | None = None) -> str:
    """The SQL of one step, from a fixed shape. Ids are written as escaped literals, not
    bound: AGE hands a parameter map to the planner as an opaque value, so with
    ``$frontier`` it scans every edge, while a literal list starts from each label's
    record_id index. On a typed graph a relationship is its edge label (``edge_label``),
    which keeps that plan; on an Entity graph ``relations`` filters the edges' relation_id.
    Conditions on the neighbour would turn the plan around, so its concept and workspaces
    are returned and checked by the caller."""
    if direction not in _SHAPES or not 1 <= row_limit <= MAX_ROWS_PER_STEP or not frontier:
        raise PopulationError("invalid_step")
    shape = _SHAPES[direction]
    if edge_label is not None:
        shape = shape.replace("[r]", f"[r:{_check_label(edge_label)}]")
    conditions = [f"s.record_id IN {_list(frontier)}"]
    if relations and edge_label is None:
        conditions.append(f"r.relation_id IN {_list(relations)}")
    cypher = (f"{shape} WHERE {' AND '.join(conditions)} "
              f"RETURN s.record_id, r.relation_id, t.record_id, t.concept_id, t.{WORKSPACES_PROPERTY} "
              f"LIMIT {int(row_limit)}")
    if _CYPHER_TAG in cypher:  # a value can never close the dollar-quoted query
        raise PopulationError("invalid_step")
    return (f"SELECT * FROM ag_catalog.cypher('{_check_graph(graph)}', {_CYPHER_TAG}{cypher}{_CYPHER_TAG}) "
            "AS (source_id ag_catalog.agtype, relation_id ag_catalog.agtype, target_id ag_catalog.agtype, "
            "concept_id ag_catalog.agtype, workspaces ag_catalog.agtype)")


def graph_of(projection_ref: str) -> str:
    return projection_graph(projection_ref)


async def _read_step(age_pool: Any, graph: str, direction: str, frontier: list[str],
                     relations: list[str] | None, row_limit: int, *, typed: bool,
                     concepts: list[str] | None, allowed: list[str] | None) -> tuple[list[tuple[str, str, str]], bool]:
    """The links of one step and whether a query hit its row limit. On a typed graph the
    neighbours outside ``concepts`` or not readable are dropped here, from the concept and
    workspaces each row carries (an Entity graph's are checked in SQL only)."""
    if typed and relations:
        queries = [step_query(graph, direction, row_limit, frontier=frontier, edge_label=relation_label(relation))
                   for relation in relations]
    else:
        queries = [step_query(graph, direction, row_limit, frontier=frontier, relations=relations)]
    found: list[tuple[str, str, str]] = []
    full = False
    readable = None if allowed is None else set(allowed)
    async with age_pool.acquire() as connection:
        async with connection.transaction():
            await connection.execute(f"SET LOCAL statement_timeout = '{STEP_TIMEOUT}'")
            for sql in queries:
                try:
                    async with connection.transaction():  # a savepoint: one missing label spoils nothing
                        rows = await connection.fetch(sql)
                except asyncpg.UndefinedTableError:
                    rows = []  # no link of that relationship was ever stored: AGE has no label for it
                full = full or len(rows) >= row_limit
                for row in rows:
                    if typed:
                        if concepts and str(_agtype_value(row["concept_id"])) not in concepts:
                            continue
                        workspaces = _agtype_value(row["workspaces"]) or []
                        if readable is not None and not set(workspaces) <= readable:
                            continue
                    found.append((str(_agtype_value(row["source_id"])), str(_agtype_value(row["relation_id"])),
                                  str(_agtype_value(row["target_id"]))))
    return found, full


def _values(attributes: dict[str, Any], keys: list[str]) -> tuple[dict[str, Any], list[str]]:
    values: dict[str, Any] = {}
    cut: list[str] = []
    for key in keys:
        value = attributes.get(key)
        if value is None:
            continue
        if isinstance(value, str) and len(value) > VALUE_CHARS:
            value = value[:VALUE_CHARS]
            cut.append(key)
        values[key] = value
    return values, cut


async def _attach_values(pool: Any, revision_id: str, nodes: dict[str, dict[str, Any]],
                         field_keys: dict[str, list[str]]) -> None:
    """Field values of the returned records: ``field_keys`` gives, per concept id, the field
    keys asked for (resolved by the caller)."""
    wanted = [entity_id for entity_id, node in nodes.items() if field_keys.get(node["conceptId"])]
    attributes = await search_store.entity_attributes(pool, revision_id, wanted)
    for entity_id in wanted:
        node = nodes[entity_id]
        values, cut = _values(attributes.get(entity_id) or {}, field_keys[node["conceptId"]])
        node["values"] = values
        if cut:
            node["truncatedFields"] = cut


async def expand(pool: Any, age_pool: Any, *, revision_id: str, projection_ref: str,
                 compiled: dict[str, Any], seed_ids: list[str], steps: list[dict[str, Any]],
                 max_nodes: int, allowed_workspaces: list[str] | None,
                 field_keys: dict[str, list[str]] | None = None) -> dict[str, Any]:
    """``steps``: [{relations: [relation ids] | None, direction, conceptIds: [...] | None}].
    ``field_keys``: per concept id, the fields to return with its records (none by default)."""
    started = time.perf_counter()
    graph = graph_of(projection_ref)
    typed = is_typed_projection(projection_ref)
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
        concept_ids = step.get("conceptIds")
        found: list[tuple[str, str, str, str]] = []  # (frontier id, relation, neighbour id, direction)
        for direction in directions:
            rows, full = await _read_step(age_pool, graph, direction, frontier, step.get("relations"), row_limit,
                                          typed=typed, concepts=concept_ids, allowed=allowed_workspaces)
            truncated = truncated or full
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
    if field_keys:
        await _attach_values(pool, revision_id, nodes, field_keys)
    first = steps[0] if steps else {}
    counts = await link_counts(pool, revision_id=revision_id, compiled=compiled, seed_ids=visible_seeds,
                               relations=first.get("relations"), direction=first.get("direction", "both"),
                               allowed_workspaces=allowed_workspaces,
                               concept_ids=first.get("conceptIds")) if visible_seeds else []
    return {"nodes": list(nodes.values()),
            "edges": [edge for edge in edges.values()
                      if edge["sourceEntityId"] in nodes and edge["targetEntityId"] in nodes],
            "linkCounts": counts,
            "hiddenSeeds": len(dict.fromkeys(seed_ids)) - len(visible_seeds),
            "truncated": truncated,
            "graphLayout": "typed" if typed else "entity",
            "timings": {"expandMs": round((time.perf_counter() - started) * 1000)}}


async def link_counts(pool: Any, *, revision_id: str, compiled: dict[str, Any], seed_ids: list[str],
                      relations: list[str] | None, direction: str, allowed_workspaces: list[str] | None,
                      concept_ids: list[str] | None = None) -> list[dict[str, Any]]:
    """How many distinct records are linked to the seeds, one step away, per relationship,
    direction and linked concept (the first step's scope): ``count`` the user may see,
    ``hidden`` the others. Exact: read from the stored accepted links, not from the walk."""
    rows = await search_store.link_counts(pool, revision_id, seed_ids, relations, direction, allowed_workspaces,
                                          concept_ids)
    result = []
    for row in rows:
        relation = compiled["relations"].get(row["relationId"]) or {}
        concept = compiled["concepts"].get(row["conceptId"]) or {}
        result.append({"relationId": row["relationId"], "relationKey": relation.get("key", ""),
                       "direction": row["direction"], "conceptId": row["conceptId"],
                       "conceptLabel": concept.get("label", ""), "count": row["visible"],
                       "hidden": row["total"] - row["visible"]})
    return result
