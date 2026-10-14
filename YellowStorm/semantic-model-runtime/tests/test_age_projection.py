from __future__ import annotations

import json

import pytest

from app.population.age_projection import (PopulationError, agtype_document, compile_projection, concept_label,
                                            create_graph_sql, drop_graph_sql, drop_projection,
                                            finalize_draft_revision, insert_edges_sql, insert_vertices_sql,
                                            is_live_projection_ref, is_typed_projection, live_projection_ref,
                                            project_revision, projection_counts, projection_graph,
                                            projection_graph_name, relation_label, validate_projection)
from app.population.run_limits import RUN_LIMIT_RANGES, identity_limits, run_limits


class FakeConnection:
    def __init__(self, edge_rows: int | None = None) -> None:
        self.statements: list[str] = []
        self.params: list[tuple] = []
        self.edge_rows = edge_rows

    async def execute(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.statements.append(sql)
        self.params.append(params)
        if self.edge_rows is not None and sql.startswith("INSERT INTO") and "unnest($1::text[], $2" in sql:
            return f"INSERT 0 {self.edge_rows}"
        return "OK"

    async def fetchval(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.statements.append(sql)
        return "2" if "count(n)" in sql else "1"


def test_graph_name_is_server_generated_and_safe():
    assert projection_graph_name("dr_0123456789abcdef01234567") == "pop_dr_0123456789abcdef01234567"
    assert projection_graph_name("Rev:1/X") == "pop_rev_1_x"
    for bad in ("", None, "x" * 61, 123):
        if bad == 123:
            assert projection_graph_name(bad) == "pop_g_123"
        else:
            with pytest.raises(PopulationError):
                projection_graph_name(bad)
    with pytest.raises(PopulationError):
        create_graph_sql("other_graph; DROP")


def test_compile_keeps_unusual_attribute_names_safe():
    plan = compile_projection(
        [{"entityId": "crm:1", "conceptId": "c1", "label": "O'Brien",
          "attributes": {"name": "O'Brien\\Co", "9lives": "x"}}],
        [{"sourceEntityId": "crm:1", "targetEntityId": "crm:2", "relationId": "r1"}])
    assert plan["vertices"][0]["_9lives"] == "x"


def test_agtype_document_matches_what_cypher_stores():
    document = json.loads(agtype_document({
        "name": "O'Brien\\Co \"q\" é", "n": 3, "f": 1.5, "ok": False, "nothing": None, "nan": float("nan"),
        "inf": float("inf"), "tags": ["a", None, 2], "mixed": [{"k": 1}], "obj": {"k": 1}, "big": 2 ** 70,
        "huge": 10 ** 400}))
    # Null (and a number agtype cannot hold) is left out, as ``SET n = row`` does.
    assert "nothing" not in document and "nan" not in document and "inf" not in document
    assert document["name"] == "O'Brien\\Co \"q\" é" and document["n"] == 3 and document["f"] == 1.5
    assert document["ok"] is False and document["tags"] == ["a", None, 2]
    # Not a list of scalars, or not a scalar: its text. An integer beyond 64 bits: a float.
    assert document["mixed"] == "[{'k': 1}]" and document["obj"] == "{'k': 1}"
    assert document["big"] == float(2 ** 70) and document["huge"] == str(10 ** 400)
    assert agtype_document({"a": 1}) == '{"a": 1}'


def test_bulk_sql_shapes():
    label, link = concept_label("c1"), relation_label("r1")
    plain = insert_vertices_sql("pop_dr_1", label, track_ids=False)
    assert plain == (f'INSERT INTO "pop_dr_1"."{label}" (properties) '
                     "SELECT doc::ag_catalog.agtype FROM unnest($1::text[]) AS docs(doc)")
    tracked = insert_vertices_sql("pop_dr_1", label, track_ids=True)
    assert tracked.startswith("WITH inserted AS (" + plain + " RETURNING id, properties) ")
    assert "INSERT INTO pg_temp.proj_vertex_ids (record_id, id)" in tracked
    edges = insert_edges_sql("pop_dr_1", link)
    assert edges.startswith(f'INSERT INTO "pop_dr_1"."{link}" (start_id, end_id, properties) ')
    assert "JOIN pg_temp.proj_vertex_ids s ON s.record_id = e.source" in edges
    assert "JOIN pg_temp.proj_vertex_ids t ON t.record_id = e.target" in edges
    for unsafe in ("Entity) DETACH DELETE (n", 'c_x"; drop'):
        with pytest.raises(PopulationError):
            insert_vertices_sql("pop_dr_1", unsafe, track_ids=False)
        with pytest.raises(PopulationError):
            insert_edges_sql("pop_dr_1", unsafe)
    with pytest.raises(PopulationError):
        insert_edges_sql("pop_dr_1; drop", link)


def test_source_documents_are_structured_reserved_metadata():
    sources = [
        {"assetRef": {"workspaceId": "ws-1", "assetId": "doc-1"}},
        {"assetRef": {"workspaceId": "ws-1", "assetId": "doc-1"}, "filename": "contrat été.pdf"},
        {"assetRef": {"workspaceId": "ws-2", "assetId": "doc-1"}, "filename": "copy.pdf"},
        {"assetRef": {"assetId": "manual"}},
    ]
    [vertex] = compile_projection([{
        "entityId": "record-1", "conceptId": "contract", "provenance": {"sources": sources},
        "identity": {"source_documents": "spoofed"},
        "attributes": {"source-documents": "also spoofed"},
    }], [], {"contract": {"hidden": ["source_documents"], "maxChars": {"source_documents": 1}}})["vertices"]
    expected = [
        {"workspaceId": "ws-1", "documentId": "doc-1", "filename": "contrat été.pdf"},
        {"workspaceId": "ws-2", "documentId": "doc-1", "filename": "copy.pdf"},
    ]
    assert vertex["source_documents"] == expected
    assert json.loads(agtype_document(vertex))["source_documents"] == expected
    assert vertex["workspace_ids"] == ["ws-1", "ws-2"]
    [manual] = compile_projection([{"entityId": "manual", "conceptId": "contract"}], [])["vertices"]
    assert json.loads(agtype_document(manual))["source_documents"] == []


def test_labels_are_safe_readable_and_distinct_per_id():
    assert concept_label("c-invoice").startswith("c_c_invoice_")
    assert relation_label("r-billed").startswith("r_r_billed_")
    assert concept_label("a-b") != concept_label("a_b")
    assert concept_label("Facture été") == concept_label("Facture été")
    assert concept_label("").startswith("c_") and len(concept_label("x" * 300)) <= 52


def test_references_name_typed_and_older_graphs():
    assert live_projection_ref("pop_dr_1") == "age:v2:pop_dr_1"
    assert is_typed_projection("age:v2:pop_dr_1") and not is_typed_projection("age:v1:pop_dr_1")
    assert projection_graph("age:v1:pop_dr_1") == projection_graph("age:v2:pop_dr_1") == "pop_dr_1"
    assert is_live_projection_ref("age:v1:pop_dr_1") and not is_live_projection_ref("age:v3:pop_dr_1")
    with pytest.raises(PopulationError):
        projection_graph("age:v2:pop_x'; drop")


def test_records_and_links_are_projected_once_with_their_workspaces():
    plan = compile_projection(
        [{"entityId": "m1", "conceptId": "message", "provenance": {"sources": [
            {"assetRef": {"assetId": "a", "workspaceId": "w2"}}, {"assetRef": {"assetId": "b", "workspaceId": "w1"}},
            {"assetRef": {"assetId": "c"}}]}},
         {"entityId": "m1", "conceptId": "message"},
         {"entityId": "f1", "conceptId": "fact"}],
        [{"sourceEntityId": "m1", "targetEntityId": "f1", "relationId": "states"},
         {"sourceEntityId": "m1", "targetEntityId": "f1", "relationId": "states"}])
    assert [vertex["record_id"] for vertex in plan["vertices"]] == ["m1", "f1"]
    assert plan["vertices"][0]["workspace_ids"] == []  # the later row wins
    assert plan["edges"] == [{"source": "m1", "target": "f1", "relation": "states",
                              "sourceConcept": "message", "targetConcept": "fact"}]
    once = compile_projection([{"entityId": "m1", "conceptId": "message", "provenance": {"sources": [
        {"assetRef": {"workspaceId": "w2"}}, {"assetRef": {"workspaceId": "w1"}}]}}], [])
    assert once["vertices"][0]["workspace_ids"] == ["w1", "w2"]


def test_graph_nodes_show_key_fields_and_keep_their_own_id():
    plan = compile_projection(
        [{"entityId": "crm:C00042", "conceptId": "customer", "label": "Sony France",
          "identity": {"customer_id": "C00042"},
          "attributes": {"name": "Sony France", "country": "France", "record_id": "spoofed", "label": "other"}}],
        [])
    assert plan["vertices"][0] == {"customer_id": "C00042", "name": "Sony France", "country": "France",
                                   "record_id": "crm:C00042", "concept_id": "customer", "label": "Sony France",
                                   "workspace_ids": [], "source_documents": []}


def test_validate_projection_compares_counts():
    assert validate_projection({"vertices": 2, "edges": 1}, {"vertices": 2, "edges": 1}) == []
    issues = validate_projection({"vertices": 2, "edges": 1}, {"vertices": 1, "edges": 1})
    assert [i["code"] for i in issues] == ["vertex_count_mismatch"]


def _plan(vertices: int = 600) -> dict:
    return {"vertices": [{"record_id": f"e{i}", "concept_id": "c"} for i in range(vertices)],
            "edges": [{"source": "e1", "target": "e2", "relation": "r", "sourceConcept": "c", "targetConcept": "c"}]}


@pytest.mark.asyncio
async def test_project_revision_bulk_loads_in_batches_and_drops():
    conn = FakeConnection()
    result = await project_revision(conn, graph="pop_dr_1", plan=_plan(), batch_rows=500)
    assert result == {"graph": "pop_dr_1", "vertices": 600, "edges": 1}
    label, link = concept_label("c"), relation_label("r")
    assert conn.statements[0] == create_graph_sql("pop_dr_1")
    # The id map comes first, then the concept's label and its records in two batches.
    assert conn.statements[1].startswith("DROP TABLE IF EXISTS") and conn.statements[2].startswith("CREATE TEMP TABLE")
    assert conn.statements[3] == f"SELECT ag_catalog.create_vlabel('pop_dr_1', '{label}')"
    tracked = insert_vertices_sql("pop_dr_1", label, track_ids=True)
    assert conn.statements[4:6] == [tracked, tracked]
    assert [len(params[0]) for params in conn.params[4:6]] == [500, 100]
    assert json.loads(conn.params[4][0][0]) == {"record_id": "e0", "concept_id": "c"}
    # Index and statistics after the load, never before it.
    assert conn.statements[6].startswith(f'CREATE INDEX IF NOT EXISTS "{label}_record_id"')
    assert conn.statements[7] == f'ANALYZE "pop_dr_1"."{label}"'
    assert conn.statements[8].startswith("CREATE UNIQUE INDEX") and conn.statements[9].startswith("ANALYZE pg_temp.")
    assert conn.statements[10] == f"SELECT ag_catalog.create_elabel('pop_dr_1', '{link}')"
    assert conn.statements[11] == insert_edges_sql("pop_dr_1", link)
    assert conn.params[11] == (["e1"], ["e2"], ['{"relation_id": "r"}'])
    assert conn.statements[12] == f'ANALYZE "pop_dr_1"."{link}"'
    assert len(conn.statements) == 14 and conn.statements[-1].startswith("DROP TABLE IF EXISTS")
    await drop_projection(conn, "pop_dr_1")
    assert conn.statements[-1] == drop_graph_sql("pop_dr_1")


@pytest.mark.asyncio
async def test_project_revision_without_links_builds_no_id_map():
    conn = FakeConnection()
    plan = {"vertices": [{"record_id": "e1", "concept_id": "c"}], "edges": []}
    await project_revision(conn, graph="pop_dr_1", plan=plan)
    assert not any("proj_vertex_ids" in statement for statement in conn.statements)
    assert insert_vertices_sql("pop_dr_1", concept_label("c"), track_ids=False) in conn.statements


@pytest.mark.asyncio
async def test_links_are_batched_per_relationship_and_endpoints_are_text():
    conn = FakeConnection()
    plan = {"vertices": [{"record_id": i, "concept_id": "c"} for i in range(3)],
            "edges": [{"source": 0, "target": 1, "relation": "r", "sourceConcept": "c", "targetConcept": "c"},
                      {"source": 1, "target": 2, "relation": "r", "sourceConcept": "c", "targetConcept": "c"},
                      {"source": 2, "target": 0, "relation": "r", "sourceConcept": "c", "targetConcept": "c"},
                      {"source": 0, "target": 2, "relation": "q", "sourceConcept": "c", "targetConcept": "c"}]}
    await project_revision(conn, graph="pop_dr_1", plan=plan, batch_rows=100)
    link_batches = [params for sql, params in zip(conn.statements, conn.params)
                    if sql.startswith("INSERT INTO") and "unnest($1::text[], $2" in sql]
    assert [(params[0], params[1]) for params in link_batches] == [(["0", "1", "2"], ["1", "2", "0"]), (["0"], ["2"])]
    assert link_batches[0][2] == ['{"relation_id": "r"}'] * 3


@pytest.mark.asyncio
async def test_a_link_whose_end_is_missing_fails_the_projection():
    # The statement reports one row inserted of two sent.
    conn = FakeConnection(edge_rows=1)
    plan = _plan(3)
    plan["edges"].append({"source": "e0", "target": "missing", "relation": "r",
                          "sourceConcept": "c", "targetConcept": "c"})
    with pytest.raises(PopulationError, match="projection_incoherent"):
        await project_revision(conn, graph="pop_dr_1", plan=plan)


@pytest.mark.asyncio
async def test_project_revision_rejects_a_batch_size_out_of_range():
    low, high = RUN_LIMIT_RANGES["projectionBatchRows"]
    for bad in (low - 1, high + 1, 0, True, "500", None):
        with pytest.raises(PopulationError, match="invalid_batch"):
            await project_revision(FakeConnection(), graph="pop_dr_1", plan=_plan(),
                                   batch_rows=bad)  # type: ignore[arg-type]


def test_projection_batch_size_is_a_bounded_run_limit_outside_the_identity():
    assert run_limits({})["projectionBatchRows"] == 5000
    assert run_limits({"limits": {"projectionBatchRows": 20000}})["projectionBatchRows"] == 20000
    for bad in (99, 20001, True, "500"):
        assert run_limits({"limits": {"projectionBatchRows": bad}})["projectionBatchRows"] == 5000
    assert identity_limits({"maxRunSources": 40, "projectionBatchRows": 1000}) == {"maxRunSources": 40}


@pytest.mark.asyncio
async def test_project_revision_reports_the_elements_written_of_all_of_them():
    told: list[tuple] = []

    async def report(unit, done, total):  # type: ignore[no-untyped-def]
        told.append((unit, done, total))

    await project_revision(FakeConnection(), graph="pop_dr_1", plan=_plan(), report=report, batch_rows=500)
    # Two vertex batches, then the one edge batch: links count with the records in one bar.
    assert told == [("elements", 500, 601), ("elements", 600, 601), ("elements", 601, 601)]


@pytest.mark.asyncio
async def test_finalize_passes_its_report_to_the_projection(monkeypatch: pytest.MonkeyPatch):
    from app.persistence import population_store as store
    from app.population import age_projection

    seen = {}

    async def projected(_pool, _age_pool, _revision_id, report=None, batch_rows=None):  # type: ignore[no-untyped-def]
        seen["report"] = report
        seen["batch_rows"] = batch_rows
        return {"projectionRef": "age:v1:pop_dr_1", "reused": False}

    async def get_revision(_pool, _revision_id):  # type: ignore[no-untyped-def]
        return {"model_id": "m1", "model_version_id": "v1", "spec_hash": "h", "correction_sequence": 0}

    async def sequence(_pool, _model_id):  # type: ignore[no-untyped-def]
        return 0

    async def binding(_pool, _model_id, environment):  # type: ignore[no-untyped-def]
        return None

    async def swap(_pool, **kwargs):  # type: ignore[no-untyped-def]
        return True

    async def report(unit, done, total):  # type: ignore[no-untyped-def]
        pass

    monkeypatch.setattr(age_projection, "ensure_revision_projection", projected)
    monkeypatch.setattr(store, "get_data_revision", get_revision)
    monkeypatch.setattr(store, "model_correction_sequence", sequence)
    monkeypatch.setattr(store, "get_active_binding", binding)
    monkeypatch.setattr(store, "cas_active_binding", swap)
    await finalize_draft_revision(object(), object(), "dr_1", report, batch_rows=1234)
    assert seen["report"] is report and seen["batch_rows"] == 1234


@pytest.mark.asyncio
async def test_projection_counts_reads_live_graph_counts():
    assert await projection_counts(FakeConnection(), "pop_dr_1") == {"vertices": 2, "edges": 1}


def test_drop_rejects_unsafe_names():
    with pytest.raises(PopulationError):
        drop_graph_sql("ag_catalog")


@pytest.mark.asyncio
async def test_finalize_moves_only_the_draft_binding(monkeypatch: pytest.MonkeyPatch):
    from app.persistence import population_store as store
    from app.population import age_projection

    revision = {"model_id": "m1", "model_version_id": "v1",
                "spec_hash": "sha256:" + "a" * 64, "correction_sequence": 2}
    captured = {}

    async def projected(_pool, _age_pool, _revision_id, _report=None, _batch_rows=None):  # type: ignore[no-untyped-def]
        return {"projectionRef": "age:v1:pop_dr_1", "reused": False}

    async def get_revision(_pool, _revision_id):  # type: ignore[no-untyped-def]
        return revision

    async def sequence(_pool, _model_id):  # type: ignore[no-untyped-def]
        return 2

    async def binding(_pool, _model_id, environment):  # type: ignore[no-untyped-def]
        assert environment == "draft"
        return {"version": 4, "data_revision_id": "dr_old"}

    async def swap(_pool, **kwargs):  # type: ignore[no-untyped-def]
        captured.update(kwargs)
        return True

    monkeypatch.setattr(age_projection, "ensure_revision_projection", projected)
    monkeypatch.setattr(store, "get_data_revision", get_revision)
    monkeypatch.setattr(store, "model_correction_sequence", sequence)
    monkeypatch.setattr(store, "get_active_binding", binding)
    monkeypatch.setattr(store, "cas_active_binding", swap)

    result = await finalize_draft_revision(object(), object(), "dr_1")
    assert result["environment"] == "draft"
    assert captured["environment"] == "draft"
    assert captured["expected_version"] == 4
    assert captured["spec_hash"] == revision["spec_hash"]


def test_only_whole_model_builds_finalize():
    from app.workers.population_tasks import is_whole_model_build

    assert is_whole_model_build({"payload": {"purpose": "build",
                                               "scope": {"kind": "model"}}}) is True
    assert is_whole_model_build({"payload": {"purpose": "build",
                                               "scope": {"kind": "mapping"}}}) is False
    # A concept refresh keeps every other concept, so its result is the whole model's data too.
    assert is_whole_model_build({"payload": {"purpose": "build",
                                               "scope": {"kind": "concept", "conceptId": "c1"}}}) is True
    assert is_whole_model_build({"payload": {"purpose": "refresh",
                                               "scope": {"kind": "model"}}}) is False
