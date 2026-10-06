"""Revision-specific AGE projection (Phase 6C, P6.16-P6.19).

Builds a separate immutable graph per accepted data revision and leaves the
active graph untouched until activation swaps the serving tuple.

Typed graphs (``age:v2:``): one vertex label per concept and one edge label per
relationship, named from the concept and relation ids (``concept_label`` /
``relation_label``), so a query on one concept or relationship reads only its
table. Every vertex label has a btree index on ``record_id``; AGE indexes the
edges' ends itself. Vertices keep ``concept_id`` and edges ``relation_id``, and
each vertex carries ``workspace_ids``, the workspaces its record was read from,
so visibility can be checked inside a Cypher query. Graphs built before
(``age:v1:``) hold ``Entity`` vertices and ``RELATED_TO`` edges; readers match
without labels so both serve until ``reproject_revision`` rebuilds them.

Business labels render from the specification, never from mutable user labels
in executable Cypher. Graph and label names are server-generated and checked;
values travel as escaped literals inside allowlisted query shapes (P6.19).
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Any

from .compiler import PopulationError

MAX_BATCH_VERTICES = 500
MAX_BATCH_EDGES = 500
MAX_PROJECTED_LINKS = 500_000
LIVE_PROJECTION_PREFIX = "age:v1:"  # Entity / RELATED_TO graphs, served until re-projected
TYPED_PROJECTION_PREFIX = "age:v2:"  # a label per concept and per relationship
_PROJECTION_PREFIXES = (TYPED_PROJECTION_PREFIX, LIVE_PROJECTION_PREFIX)
WORKSPACES_PROPERTY = "workspace_ids"
_CYPHER_TAG = "$agecypher$"
_GRAPH_RE = re.compile(r"^pop_[a-z0-9_]{1,64}$")
_LABEL_RE = re.compile(r"^[cr]_[a-z0-9_]{1,60}$")
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
    """The reference of a typed graph built now."""
    return TYPED_PROJECTION_PREFIX + _check_graph(graph)


def is_live_projection_ref(value: Any) -> bool:
    try:
        projection_graph(value)
    except PopulationError:
        return False
    return True


def projection_graph(projection_ref: Any) -> str:
    """The graph name of a projection reference, typed or not."""
    if isinstance(projection_ref, str):
        for prefix in _PROJECTION_PREFIXES:
            if projection_ref.startswith(prefix):
                return _check_graph(projection_ref[len(prefix):])
    raise PopulationError("revision_not_projected")


def is_typed_projection(projection_ref: Any) -> bool:
    """A graph with a label per concept and relationship, and workspaces on its vertices."""
    return isinstance(projection_ref, str) and projection_ref.startswith(TYPED_PROJECTION_PREFIX)


def _type_label(kind: str, ident: Any) -> str:
    text = str(ident or "")
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:40]
    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:8]
    return f"{kind}_{slug}_{digest}" if slug else f"{kind}_{digest}"


def concept_label(concept_id: Any) -> str:
    """The vertex label of a concept: readable, and distinct for distinct ids."""
    return _type_label("c", concept_id)


def relation_label(relation_id: Any) -> str:
    """The edge label of a relationship."""
    return _type_label("r", relation_id)


def _check_label(label: str) -> str:
    if not _LABEL_RE.match(label):
        raise PopulationError("invalid_label")
    return label


def _check_graph(graph: str) -> str:
    if not _GRAPH_RE.match(graph):
        raise PopulationError("invalid_graph_name")
    return graph


def _escape(value: Any) -> str:
    """A Cypher literal: scalars as themselves, a list of scalars as a list (so a vertex's
    workspaces can be tested in a query), anything else as its text."""
    if value is None:
        return "null"
    if isinstance(value, (list, tuple)) and all(item is None or isinstance(item, (str, int, float, bool))
                                                for item in value):
        return "[" + ", ".join(_escape(item) for item in value) + "]"
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


def _workspaces(entity: dict[str, Any]) -> list[str]:
    sources = (entity.get("provenance") or {}).get("sources") or []
    return sorted({str(((source or {}).get("assetRef") or {}).get("workspaceId"))
                   for source in sources if ((source or {}).get("assetRef") or {}).get("workspaceId")})


def compile_projection(entities: list[dict[str, Any]],
                       relationships: list[dict[str, Any]]) -> dict[str, Any]:
    """Compile canonical rows to a plan of vertices and edges (P6.17-P6.18). A record or
    a link given twice is projected once."""
    vertices: dict[str, dict[str, Any]] = {}
    for entity in entities:
        properties: dict[str, Any] = {}
        # Key fields live in the identity, not the attributes; the graph shows them as
        # properties too, so a Customer node shows its customer number.
        for values in (entity.get("identity"), entity.get("attributes")):
            for key, value in (values or {}).items():
                if isinstance(key, str) and key:
                    properties[_safe_key(key)] = value
        # Set last: a field named like these never replaces the node's own id, label or workspaces.
        properties.update({"record_id": entity["entityId"], "concept_id": entity.get("conceptId", ""),
                           "label": entity.get("label", ""), WORKSPACES_PROPERTY: _workspaces(entity)})
        vertices[entity["entityId"]] = properties
    edges: dict[tuple[str, str, str], dict[str, Any]] = {}
    for relationship in relationships:
        source, target = relationship["sourceEntityId"], relationship["targetEntityId"]
        edges[(relationship["relationId"], source, target)] = {
            "source": source, "target": target, "relation": relationship["relationId"],
            "sourceConcept": (vertices.get(source) or {}).get("concept_id", ""),
            "targetConcept": (vertices.get(target) or {}).get("concept_id", "")}
    return {"vertices": list(vertices.values()), "edges": list(edges.values())}


def _map_literal(properties: dict[str, Any]) -> str:
    return "{" + ", ".join(f"{name}: {_escape(value)}"
                           for name, value in properties.items()) + "}"


def render_vertex_batch(graph: str, label: str, vertices: list[dict[str, Any]]) -> str:
    """Records of one concept, created under its label (``compile_projection`` made them unique)."""
    if not vertices or len(vertices) > MAX_BATCH_VERTICES:
        raise PopulationError("invalid_batch")
    rows = ", ".join(_map_literal(vertex) for vertex in vertices)
    return _cypher(graph, f"UNWIND [{rows}] AS row "
                          f"CREATE (n:{_check_label(label)}) SET n = row", "v ag_catalog.agtype")


def render_edge_batch(graph: str, label: str, source_label: str, target_label: str,
                      edges: list[dict[str, Any]]) -> str:
    """Links of one relationship between records of two concepts; each end is found through
    its label's record_id index."""
    if not edges or len(edges) > MAX_BATCH_EDGES:
        raise PopulationError("invalid_batch")
    rows = ", ".join(_map_literal({"source": edge["source"], "target": edge["target"],
                                   "relation": edge["relation"]}) for edge in edges)
    return _cypher(graph, f"UNWIND [{rows}] AS row "
                          f"MATCH (s:{_check_label(source_label)}), (t:{_check_label(target_label)}) "
                          "WHERE s.record_id = row.source AND t.record_id = row.target "
                          f"CREATE (s)-[:{_check_label(label)} {{relation_id: row.relation}}]->(t)",
                   "e ag_catalog.agtype")


def create_label_sql(graph: str, label: str, kind: str) -> str:
    function = {"vertex": "create_vlabel", "edge": "create_elabel"}[kind]
    return f"SELECT ag_catalog.{function}('{_check_graph(graph)}', '{_check_label(label)}')"


def record_index_sql(graph: str, label: str) -> str:
    """The btree index Cypher uses for ``n.record_id = ...`` and ``n.record_id IN ...``."""
    return (f'CREATE INDEX IF NOT EXISTS "{_check_label(label)}_record_id" ON "{_check_graph(graph)}"."{label}" '
            "USING btree (ag_catalog.agtype_access_operator(VARIADIC ARRAY[properties, "
            "'\"record_id\"'::ag_catalog.agtype]))")


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
    """Create the typed graph and stream inserts in bounded batches (P6.16, P6.29): a label
    and its record_id index per concept, then the records, then a label per relationship and
    the links; the label tables are analysed so the planner uses their indexes."""
    _check_graph(graph)
    vertices = plan.get("vertices", [])
    edges = plan.get("edges", [])
    await connection.execute(create_graph_sql(graph))
    by_concept: dict[str, list[dict[str, Any]]] = {}
    for vertex in vertices:
        by_concept.setdefault(concept_label(vertex.get("concept_id")), []).append(vertex)
    for label, members in by_concept.items():
        await connection.execute(create_label_sql(graph, label, "vertex"))
        await connection.execute(record_index_sql(graph, label))
        for batch in _chunks(members, MAX_BATCH_VERTICES):
            await connection.execute(render_vertex_batch(graph, label, batch))
    by_relation: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for edge in edges:
        key = (relation_label(edge["relation"]), concept_label(edge.get("sourceConcept")),
               concept_label(edge.get("targetConcept")))
        by_relation.setdefault(key, []).append(edge)
    created: set[str] = set()
    for (label, source_label, target_label), members in by_relation.items():
        if label not in created:
            await connection.execute(create_label_sql(graph, label, "edge"))
            created.add(label)
        for batch in _chunks(members, MAX_BATCH_EDGES):
            await connection.execute(render_edge_batch(graph, label, source_label, target_label, batch))
    for label in [*by_concept, *sorted(created)]:
        await connection.execute(f'ANALYZE "{graph}"."{_check_label(label)}"')
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
    graph = projection_graph(projection_ref)
    async with age_pool.acquire() as connection:
        # Without labels: a typed graph and an older Entity / RELATED_TO one read alike.
        nodes = await connection.fetch(_cypher(
            graph,
            "MATCH (n) RETURN n.record_id, n.concept_id, n.label, properties(n)",
            "record_id ag_catalog.agtype, concept_id ag_catalog.agtype, "
            "label ag_catalog.agtype, properties ag_catalog.agtype",
        ))
        edges = await connection.fetch(_cypher(
            graph,
            "MATCH (s)-[r]->(t) "
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


async def _project_stored_rows(pool: Any, connection: Any, revision_id: str, graph: str) -> dict[str, int]:
    """Build ``graph`` from the revision's stored records and links, and check its counts."""
    from app.persistence import population_store as store

    stored = await store.count_revision_rows(pool, revision_id)
    entities = await store.list_revision_entities(pool, revision_id)
    relationships = await store.list_revision_relationships(pool, revision_id, limit=MAX_PROJECTED_LINKS)
    if stored["entities"] != len(entities) or stored["relationships"] != len(relationships):
        raise PopulationError("projection_too_large")
    known_ids = {entity["entityId"] for entity in entities}
    if any(relationship["sourceEntityId"] not in known_ids
           or relationship["targetEntityId"] not in known_ids
           for relationship in relationships):
        raise PopulationError("projection_incoherent")
    # Only accepted links are facts; a suppressed or retracted one is never followed.
    plan = compile_projection(entities, [relationship for relationship in relationships
                                         if relationship.get("state", "accepted") == "accepted"])
    expected = {"vertices": len(plan["vertices"]), "edges": len(plan["edges"])}
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
    return expected


async def _build_revision_projection(pool: Any, connection: Any, revision_id: str,
                                     graph: str, previous_ref: str | None) -> dict[str, Any]:
    from app.persistence import population_store as store

    expected = await _project_stored_rows(pool, connection, revision_id, graph)
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


async def reproject_revision(pool: Any, age_pool: Any, revision_id: str) -> dict[str, Any]:
    """Rebuild a revision's older ``Entity`` graph as a typed one from its stored records and
    links (no source is read again), then move the revision, its bindings and its search
    index to it at once and drop the old graph. A typed graph is left as it is."""
    from app.persistence import population_store as store

    revision = await store.get_data_revision(pool, revision_id)
    if revision is None:
        raise PopulationError("revision_not_found")
    old_ref = revision["projection_ref"]
    if is_typed_projection(old_ref):
        return {"revisionId": revision_id, "projectionRef": old_ref, "reprojected": False}
    old_graph = projection_graph(old_ref)
    graph = _check_graph(f"{projection_graph_name(revision_id)}_t2")
    async with age_pool.acquire() as connection:
        await connection.fetchval("SELECT pg_advisory_lock(hashtextextended($1, 0))", graph)
        try:
            expected = await _project_stored_rows(pool, connection, revision_id, graph)
            new_ref = live_projection_ref(graph)
            if not await store.replace_revision_projection(pool, revision_id, old_ref, new_ref):
                await _discard_projection(connection, graph, revision_id)
                raise PopulationError("projection_record_conflict")
            await _discard_projection(connection, old_graph, revision_id)
        finally:
            await connection.fetchval("SELECT pg_advisory_unlock(hashtextextended($1, 0))", graph)
    return {"revisionId": revision_id, "projectionRef": new_ref, "reprojected": True, **expected}


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
