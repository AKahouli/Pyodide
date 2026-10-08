"""How two records are connected: the shortest chains of stored links between them.

A breadth-first search from both records at once over the revision's AGE graph: one
whole level at a time, from the side with fewer records to expand, with the step
queries of ``traversal`` (record_id indexes, one typed edge label per relationship).
The search stops at the first level where the two sides meet, so every chain found is
a shortest one; links are followed both ways. A record the actor cannot read is never
used as a bridge. When a level reads more links than a query returns, or a side grows
too large, the search is cut and says so: "not connected" is then not a proof.
"""

from __future__ import annotations

import time
from typing import Any

from app.persistence import graph_search_store as search_store
from app.population.age_projection import is_typed_projection

from .retrieval import describe_entity, is_visible
from .traversal import MAX_ROWS_PER_STEP, _read_step, graph_of

MAX_LINKS = 6
MAX_PATHS = 10
# Records one side may expand at once (their ids are written into the step query).
MAX_FRONTIER = 1000
MAX_VISITED = 20000

Parents = dict[str, list[tuple[str, str, str]]]  # record -> [(record before, relation id, direction walked)]


def _chains(parents: Parents, node: str, limit: int) -> list[list[tuple[str, str, str, str]]]:
    """The chains from a side's starting record to ``node``: [(from, relation, direction, to)]."""
    if not parents[node]:
        return [[]]
    chains: list[list[tuple[str, str, str, str]]] = []
    for origin, relation, direction in parents[node]:
        for chain in _chains(parents, origin, limit):
            chains.append([*chain, (origin, relation, direction, node)])
            if len(chains) >= limit:
                return chains
    return chains


def _flip(direction: str) -> str:
    return "incoming" if direction == "outgoing" else "outgoing"


async def connect(pool: Any, age_pool: Any, *, revision_id: str, projection_ref: str, compiled: dict[str, Any],
                  from_id: str, to_id: str, max_links: int, max_paths: int, relations: list[str] | None,
                  allowed_workspaces: list[str] | None) -> dict[str, Any]:
    started = time.perf_counter()
    graph = graph_of(projection_ref)
    typed = is_typed_projection(projection_ref)
    ends = await search_store.entity_rows(pool, revision_id, [from_id, to_id])
    unknown = [entity_id for entity_id in dict.fromkeys([from_id, to_id])
               if entity_id not in ends or not is_visible(ends[entity_id], allowed_workspaces)]
    base = {"graphLayout": "typed" if typed else "entity", "maxLinks": max_links}
    if unknown:
        # A record that does not exist and one the actor may not read look the same.
        return {**base, "status": "not_found", "unknownRecords": unknown, "paths": [], "records": [],
                "searchedLinks": 0, "truncated": False}
    if from_id == to_id:
        return {**base, "status": "same_record", "links": 0, "paths": [], "searchedLinks": 0, "truncated": False,
                "records": [describe_entity(ends[from_id], compiled)]}
    sides: list[Parents] = [{from_id: []}, {to_id: []}]
    frontiers = [[from_id], [to_id]]
    depth = [0, 0]
    truncated = False
    meet: list[str] = []
    while depth[0] + depth[1] < max_links and frontiers[0] and frontiers[1]:
        side = 0 if len(frontiers[0]) <= len(frontiers[1]) else 1
        frontier = frontiers[side]
        if len(frontier) > MAX_FRONTIER:
            truncated = True
            break
        found: list[tuple[str, str, str, str]] = []
        for direction in ("outgoing", "incoming"):
            rows, full = await _read_step(age_pool, graph, direction, frontier, relations, MAX_ROWS_PER_STEP,
                                          typed=typed, concepts=None, allowed=allowed_workspaces)
            truncated = truncated or full
            found += [(source, relation, target, direction) for source, relation, target in rows]
        visited = sides[side]
        candidates = sorted({target for _, _, target, _ in found if target not in visited})
        # Checked in SQL as well: an Entity graph's rows carry no workspaces.
        readable = {entity_id for entity_id, entity in (await search_store.entity_rows(
            pool, revision_id, candidates)).items() if is_visible(entity, allowed_workspaces)}
        level: Parents = {}
        for origin, relation, neighbour, direction in sorted(found):
            if neighbour in visited or neighbour not in readable:
                continue
            parents = level.setdefault(neighbour, [])
            if (origin, relation, direction) not in parents:
                parents.append((origin, relation, direction))
        visited.update(level)
        frontiers[side] = list(level)
        depth[side] += 1
        meet = sorted(node for node in level if node in sides[1 - side])
        if meet:
            break
        if len(sides[0]) + len(sides[1]) > MAX_VISITED:
            truncated = True
            break
    searched = depth[0] + depth[1]
    if not meet:
        return {**base, "status": "not_connected", "paths": [], "records": [], "searchedLinks": searched,
                "truncated": truncated,
                "timings": {"connectMs": round((time.perf_counter() - started) * 1000)}}
    paths: list[list[tuple[str, str, str, str]]] = []
    more = False
    for node in meet:
        for left in _chains(sides[0], node, max_paths + 1):
            for right in _chains(sides[1], node, max_paths + 1):
                # The second side was walked from the other record: read it back towards it.
                back = [(to, relation, _flip(direction), origin) for origin, relation, direction, to in reversed(right)]
                if len(paths) >= max_paths:
                    more = True
                    break
                paths.append(left + back)
    records = await search_store.entity_rows(pool, revision_id,
                                             sorted({hop[0] for path in paths for hop in path} | {to_id}))
    relation_key = {key: value.get("key", "") for key, value in compiled["relations"].items()}
    return {
        **base, "status": "connected", "links": searched, "searchedLinks": searched,
        "paths": [{"records": [path[0][0], *(hop[3] for hop in path)],
                   "steps": [{"fromEntityId": origin, "relationId": relation, "relationKey": relation_key.get(relation, ""),
                              "direction": direction, "toEntityId": to}
                             for origin, relation, direction, to in path]} for path in paths],
        "records": [describe_entity(records[entity_id], compiled) for entity_id in sorted(records)],
        "morePaths": more, "truncated": truncated,
        "timings": {"connectMs": round((time.perf_counter() - started) * 1000)},
    }
