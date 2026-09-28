"""Revision-specific AGE projection (Phase 6C, P6.16-P6.19).

Builds a separate immutable graph per accepted data revision and leaves the
active graph untouched until activation swaps the serving tuple. R1 uses the
plan's simple representation: ``Entity`` vertices carrying ``concept_id`` and
``RELATED_TO`` edges carrying ``relation_id``; business labels render from the
specification, never from mutable user labels in executable Cypher. Graph
names are server-generated from the revision id and sanitized; values travel
as escaped literals inside allowlisted query shapes (P6.19).
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from .compiler import PopulationError

MAX_BATCH_VERTICES = 500
MAX_BATCH_EDGES = 500
LIVE_PROJECTION_PREFIX = "age:v1:"
_CYPHER_TAG = "$agecypher$"
_GRAPH_RE = re.compile(r"^pop_[a-z0-9_]{1,64}$")
_KEY_RE = re.compile(r"[^a-zA-Z0-9_]")
logger = logging.getLogger(__name__)


class ProjectionUnavailable(RuntimeError):
    pass


def projection_graph_name(revision_id: Any) -> str:
    """Server-generated graph name for a revision id (P6.16 step 3)."""
    slug = re.sub(r"[^a-z0-9_]", "_", str(revision_id or "").lower())
    if not slug or len(slug) > 60:
        raise PopulationError("invalid_revision_id")
    if slug[0].isdigit():
        slug = "g_" + slug
    return f"pop_{slug}"


def live_projection_ref(graph: str) -> str:
    return LIVE_PROJECTION_PREFIX + _check_graph(graph)


def is_live_projection_ref(value: Any) -> bool:
    if not isinstance(value, str) or not value.startswith(LIVE_PROJECTION_PREFIX):
        return False
    try:
        _check_graph(value[len(LIVE_PROJECTION_PREFIX):])
    except PopulationError:
        return False
    return True


def _check_graph(graph: str) -> str:
    if not _GRAPH_RE.match(graph):
        raise PopulationError("invalid_graph_name")
    return graph


def _escape(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value) if value == value else "null"
    text = value if isinstance(value, str) else str(value)
    return "'" + text.replace("\\", "\\\\").replace("'", "\\'") + "'"


def _safe_key(name: str) -> str:
    safe = _KEY_RE.sub("_", name)
    if not safe:
        raise PopulationError("invalid_attribute_name")
    return "_" + safe if safe[0].isdigit() else safe


def _cypher(graph: str, query: str, columns: str) -> str:
    if _CYPHER_TAG in query:
        raise PopulationError("invalid_cypher")
    return (f"SELECT * FROM ag_catalog.cypher('{_check_graph(graph)}', "
            f"{_CYPHER_TAG}{query}{_CYPHER_TAG}) AS ({columns})")


def compile_projection(entities: list[dict[str, Any]],
                       relationships: list[dict[str, Any]]) -> dict[str, Any]:
    """Compile canonical rows to a plan of vertices and edges (P6.17-P6.18)."""
    vertices = []
    for entity in entities:
        properties: dict[str, Any] = {}
        # Key fields live in the identity, not the attributes; the graph shows them as
        # properties too, so a Customer node shows its customer number.
        for values in (entity.get("identity"), entity.get("attributes")):
            for key, value in (values or {}).items():
                if isinstance(key, str) and key:
                    properties[_safe_key(key)] = value
        # Set last: a field named like these never replaces the node's own id or label.
        properties.update({"record_id": entity["entityId"], "concept_id": entity.get("conceptId", ""),
                           "label": entity.get("label", "")})
        vertices.append(properties)
    edges = []
    for relationship in relationships:
        edges.append({"source": relationship["sourceEntityId"],
                      "target": relationship["targetEntityId"],
                      "relation": relationship["relationId"]})
    return {"vertices": vertices, "edges": edges}


def _map_literal(properties: dict[str, Any]) -> str:
    return "{" + ", ".join(f"{name}: {_escape(value)}"
                           for name, value in properties.items()) + "}"


def render_vertex_batch(graph: str, vertices: list[dict[str, Any]]) -> str:
    if not vertices or len(vertices) > MAX_BATCH_VERTICES:
        raise PopulationError("invalid_batch")
    rows = ", ".join(_map_literal(vertex) for vertex in vertices)
    return _cypher(graph, f"UNWIND [{rows}] AS row "
                          "MERGE (n:Entity {record_id: row.record_id}) "
                          "SET n += row", "v ag_catalog.agtype")


def render_edge_batch(graph: str, edges: list[dict[str, Any]]) -> str:
    if not edges or len(edges) > MAX_BATCH_EDGES:
        raise PopulationError("invalid_batch")
    rows = ", ".join(_map_literal(edge) for edge in edges)
    return _cypher(graph, f"UNWIND [{rows}] AS row "
                          "MATCH (s:Entity {record_id: row.source}), "
                          "(t:Entity {record_id: row.target}) "
                          "MERGE (s)-[r:RELATED_TO {relation_id: row.relation}]->(t)",
                   "e ag_catalog.agtype")


def create_graph_sql(graph: str) -> str:
    return f"SELECT ag_catalog.create_graph('{_check_graph(graph)}')"


def drop_graph_sql(graph: str) -> str:
    return f"SELECT ag_catalog.drop_graph('{_check_graph(graph)}', true)"


def validate_projection(expected: dict[str, int], actual: dict[str, int]) -> list[dict[str, str]]:
    """Count/endpoint validation before activation (P6.16 step 4)."""
    issues = []
    if actual.get("vertices", 0) != expected.get("vertices", 0):
        issues.append({"code": "vertex_count_mismatch",
                       "message": "Projected vertex count differs from the accepted snapshot."})
    if actual.get("edges", 0) != expected.get("edges", 0):
        issues.append({"code": "edge_count_mismatch",
                       "message": "Projected edge count differs from the accepted snapshot."})
    return issues


def _chunks(items: list[Any], size: int) -> list[list[Any]]:
    return [items[index:index + size] for index in range(0, len(items), size)]


async def project_revision(connection: Any, *, graph: str,
                           plan: dict[str, Any]) -> dict[str, Any]:
    """Create the graph and stream inserts in bounded batches (P6.16, P6.29)."""
    _check_graph(graph)
    vertices = plan.get("vertices", [])
    edges = plan.get("edges", [])
    await connection.execute(create_graph_sql(graph))
    for batch in _chunks(list(vertices), MAX_BATCH_VERTICES):
        await connection.execute(render_vertex_batch(graph, batch))
    for batch in _chunks(list(edges), MAX_BATCH_EDGES):
        await connection.execute(render_edge_batch(graph, batch))
    return {"graph": graph, "vertices": len(vertices), "edges": len(edges)}


async def projection_exists(connection: Any, graph: str) -> bool:
    return bool(await connection.fetchval(
        "SELECT EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = $1)",
        _check_graph(graph),
    ))


def _agtype_count(value: Any) -> int:
    parsed = json.loads(value) if isinstance(value, str) else value
    if isinstance(parsed, bool) or not isinstance(parsed, int) or parsed < 0:
        raise PopulationError("invalid_projection_count")
    return parsed


def _agtype_value(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    return json.loads(re.sub(r"::(?:vertex|edge|path)$", "", value))


async def read_projection_graph(age_pool: Any, projection_ref: str) -> dict[str, Any]:
    """Read one immutable projection without rebuilding or indexing it."""
    if not is_live_projection_ref(projection_ref):
        raise PopulationError("revision_not_projected")
    graph = projection_ref[len(LIVE_PROJECTION_PREFIX):]
    async with age_pool.acquire() as connection:
        nodes = await connection.fetch(_cypher(
            graph,
            "MATCH (n:Entity) RETURN n.record_id, n.concept_id, n.label, properties(n)",
            "record_id ag_catalog.agtype, concept_id ag_catalog.agtype, "
            "label ag_catalog.agtype, properties ag_catalog.agtype",
        ))
        edges = await connection.fetch(_cypher(
            graph,
            "MATCH (s:Entity)-[r:RELATED_TO]->(t:Entity) "
            "RETURN r.relation_id, s.record_id, t.record_id, properties(r)",
            "relation_id ag_catalog.agtype, source_id ag_catalog.agtype, "
            "target_id ag_catalog.agtype, properties ag_catalog.agtype",
        ))
    return {
        "nodes": [{
            "id": str(_agtype_value(row["record_id"])),
            "label": str(_agtype_value(row["concept_id"])),
            "properties": {
                **(_agtype_value(row["properties"]) or {}),
                "record_label": _agtype_value(row["label"]),
            },
        } for row in nodes],
        "edges": [{
            "id": f"{_agtype_value(row['relation_id'])}:"
                  f"{_agtype_value(row['source_id'])}:{_agtype_value(row['target_id'])}",
            "label": str(_agtype_value(row["relation_id"])),
            "sourceId": str(_agtype_value(row["source_id"])),
            "targetId": str(_agtype_value(row["target_id"])),
            "properties": _agtype_value(row["properties"]) or {},
        } for row in edges],
    }


async def projection_counts(connection: Any, graph: str) -> dict[str, int]:
    vertices = await connection.fetchval(_cypher(
        graph, "MATCH (n) RETURN count(n)", "value ag_catalog.agtype"))
    edges = await connection.fetchval(_cypher(
        graph, "MATCH ()-[r]->() RETURN count(r)", "value ag_catalog.agtype"))
    return {"vertices": _agtype_count(vertices), "edges": _agtype_count(edges)}


async def drop_projection(connection: Any, graph: str) -> None:
    await connection.execute(drop_graph_sql(_check_graph(graph)))


async def ensure_revision_projection(pool: Any, age_pool: Any,
                                     revision_id: str) -> dict[str, Any]:
    """Build, validate and record one immutable revision projection."""
    from app.persistence import population_store as store

    revision = await store.get_data_revision(pool, revision_id)
    if revision is None:
        raise PopulationError("revision_not_found")
    if revision["validation_state"] != "valid":
        raise PopulationError("revision_not_valid")
    if is_live_projection_ref(revision["projection_ref"]):
        return {"revisionId": revision_id, "projectionRef": revision["projection_ref"],
                "reused": True}
    graph = projection_graph_name(revision_id)
    async with age_pool.acquire() as connection:
        await connection.fetchval("SELECT pg_advisory_lock(hashtextextended($1, 0))", graph)
        try:
            current = await store.get_data_revision(pool, revision_id)
            if current is None:
                raise PopulationError("revision_not_found")
            if is_live_projection_ref(current["projection_ref"]):
                return {"revisionId": revision_id, "projectionRef": current["projection_ref"],
                        "reused": True}
            return await _build_revision_projection(
                pool, connection, revision_id, graph, current["projection_ref"])
        finally:
            await connection.fetchval("SELECT pg_advisory_unlock(hashtextextended($1, 0))", graph)


async def _build_revision_projection(pool: Any, connection: Any, revision_id: str,
                                     graph: str, previous_ref: str | None) -> dict[str, Any]:
    from app.persistence import population_store as store

    stored = await store.count_revision_rows(pool, revision_id)
    entities = await store.list_revision_entities(pool, revision_id)
    relationships = await store.list_revision_relationships(pool, revision_id)
    if stored["entities"] != len(entities) or stored["relationships"] != len(relationships):
        raise PopulationError("projection_too_large")
    known_ids = {entity["entityId"] for entity in entities}
    if any(relationship["sourceEntityId"] not in known_ids
           or relationship["targetEntityId"] not in known_ids
           for relationship in relationships):
        raise PopulationError("projection_incoherent")
    plan = compile_projection(entities, relationships)
    expected = {"vertices": len(entities), "edges": len(relationships)}
    try:
        async with connection.transaction():
            if await projection_exists(connection, graph):
                await drop_projection(connection, graph)
            await project_revision(connection, graph=graph, plan=plan)
            if validate_projection(expected, await projection_counts(connection, graph)):
                raise PopulationError("projection_validation_failed")
    except PopulationError:
        raise
    except Exception as exc:
        logger.warning("AGE projection failed for revision %s: %s",
                       revision_id, type(exc).__name__)
        raise ProjectionUnavailable("age_projection_failed") from exc
    projection_ref = live_projection_ref(graph)
    try:
        recorded = await store.set_revision_projection(
            pool, revision_id, projection_ref, previous_ref)
    except Exception as exc:
        logger.warning("Projection persistence failed for revision %s: %s",
                       revision_id, type(exc).__name__)
        current = await _revision_after_persistence_error(pool, revision_id)
        if current is not None and current["projection_ref"] == projection_ref:
            recorded = True
        else:
            if current is not None and current["projection_ref"] == previous_ref:
                await _discard_projection(connection, graph, revision_id)
            raise ProjectionUnavailable("projection_persistence_failed") from exc
    if not recorded:
        current = await store.get_data_revision(pool, revision_id)
        if current is None or current["projection_ref"] != projection_ref:
            await _discard_projection(connection, graph, revision_id)
            raise PopulationError("projection_record_conflict")
    return {"revisionId": revision_id, "projectionRef": projection_ref,
            "graph": graph, **expected, "reused": not recorded}


async def _revision_after_persistence_error(pool: Any, revision_id: str):  # type: ignore[no-untyped-def]
    from app.persistence import population_store as store

    try:
        return await store.get_data_revision(pool, revision_id)
    except Exception as exc:
        logger.error("Could not reconcile projection persistence for revision %s: %s",
                     revision_id, type(exc).__name__)
        return None


async def _discard_projection(connection: Any, graph: str, revision_id: str) -> None:
    try:
        if await projection_exists(connection, graph):
            await drop_projection(connection, graph)
    except Exception as exc:
        logger.error("Failed to discard AGE graph for revision %s: %s",
                     revision_id, type(exc).__name__)


async def finalize_draft_revision(pool: Any, age_pool: Any,
                                  revision_id: str) -> dict[str, Any]:
    """Project and atomically move only the draft serving binding."""
    from app.persistence import population_store as store

    projected = await ensure_revision_projection(pool, age_pool, revision_id)
    revision = await store.get_data_revision(pool, revision_id)
    if revision is None:
        raise PopulationError("revision_not_found")
    sequence = await store.model_correction_sequence(pool, revision["model_id"])
    if revision["correction_sequence"] != sequence:
        raise PopulationError("stale_revision_watermark")
    current = await store.get_active_binding(pool, revision["model_id"], "draft")
    swapped = await store.cas_active_binding(
        pool, model_id=revision["model_id"], environment="draft",
        expected_version=current["version"] if current else None,
        model_version_id=revision["model_version_id"], data_revision_id=revision_id,
        projection_ref=projected["projectionRef"], correction_sequence=sequence,
        spec_hash=revision["spec_hash"],
    )
    if not swapped:
        raise PopulationError("stale_model_definition")
    return {**projected, "environment": "draft"}
