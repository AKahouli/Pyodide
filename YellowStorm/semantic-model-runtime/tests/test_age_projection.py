from __future__ import annotations

import pytest

from app.population.age_projection import (PopulationError, compile_projection, concept_label, create_graph_sql,
                                            drop_graph_sql, drop_projection, finalize_draft_revision,
                                            is_live_projection_ref, is_typed_projection, live_projection_ref,
                                            project_revision, projection_counts, projection_graph,
                                            projection_graph_name, relation_label, render_edge_batch,
                                            render_vertex_batch, validate_projection)


class FakeConnection:
    def __init__(self) -> None:
        self.statements: list[str] = []

    async def execute(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.statements.append(sql)
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


def test_compile_and_render_escapes_values():
    plan = compile_projection(
        [{"entityId": "crm:1", "conceptId": "c1", "label": "O'Brien",
          "attributes": {"name": "O'Brien\\Co", "9lives": "x"}}],
        [{"sourceEntityId": "crm:1", "targetEntityId": "crm:2", "relationId": "r1"}])
    assert plan["vertices"][0]["_9lives"] == "x"
    customer, knows = concept_label("c1"), relation_label("r1")
    vertex_sql = render_vertex_batch("pop_dr_1", customer, plan["vertices"])
    assert "O\\'Brien\\\\Co" in vertex_sql
    assert f"CREATE (n:{customer}) SET n = row" in vertex_sql
    edge_sql = render_edge_batch("pop_dr_1", knows, customer, customer, plan["edges"])
    assert f"MATCH (s:{customer}), (t:{customer}) WHERE s.record_id = row.source AND t.record_id = row.target" in edge_sql
    assert f"CREATE (s)-[:{knows} {{relation_id: row.relation}}]->(t)" in edge_sql
    with pytest.raises(PopulationError):
        render_vertex_batch("pop_dr_1", customer, [])
    with pytest.raises(PopulationError):
        render_edge_batch("pop_dr_1", knows, customer, customer, plan["edges"] * 501)
    with pytest.raises(PopulationError):
        render_vertex_batch("pop_dr_1", "Entity) DETACH DELETE (n", plan["vertices"])


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
                                   "workspace_ids": []}


def test_validate_projection_compares_counts():
    assert validate_projection({"vertices": 2, "edges": 1}, {"vertices": 2, "edges": 1}) == []
    issues = validate_projection({"vertices": 2, "edges": 1}, {"vertices": 1, "edges": 1})
    assert [i["code"] for i in issues] == ["vertex_count_mismatch"]


@pytest.mark.asyncio
async def test_project_revision_batches_and_drops():
    conn = FakeConnection()
    plan = {"vertices": [{"record_id": f"e{i}", "concept_id": "c"} for i in range(600)],
            "edges": [{"source": "e1", "target": "e2", "relation": "r", "sourceConcept": "c", "targetConcept": "c"}]}
    result = await project_revision(conn, graph="pop_dr_1", plan=plan)
    assert result == {"graph": "pop_dr_1", "vertices": 600, "edges": 1}
    assert conn.statements[0] == create_graph_sql("pop_dr_1")
    label, link = concept_label("c"), relation_label("r")
    assert conn.statements[1] == f"SELECT ag_catalog.create_vlabel('pop_dr_1', '{label}')"
    assert conn.statements[2].startswith(f'CREATE INDEX IF NOT EXISTS "{label}_record_id"')
    assert conn.statements[5] == f"SELECT ag_catalog.create_elabel('pop_dr_1', '{link}')"
    # create graph, label, index, 2 vertex batches, edge label, 1 edge batch, 2 ANALYZE
    assert len(conn.statements) == 9 and conn.statements[-1] == f'ANALYZE "pop_dr_1"."{link}"'
    await drop_projection(conn, "pop_dr_1")
    assert conn.statements[-1] == drop_graph_sql("pop_dr_1")


@pytest.mark.asyncio
async def test_project_revision_reports_the_elements_written_of_all_of_them():
    told: list[tuple] = []

    async def report(unit, done, total):  # type: ignore[no-untyped-def]
        told.append((unit, done, total))

    plan = {"vertices": [{"record_id": f"e{i}", "concept_id": "c"} for i in range(600)],
            "edges": [{"source": "e1", "target": "e2", "relation": "r", "sourceConcept": "c", "targetConcept": "c"}]}
    await project_revision(FakeConnection(), graph="pop_dr_1", plan=plan, report=report)
    # Two vertex batches, then the one edge batch: links count with the records in one bar.
    assert told == [("elements", 500, 601), ("elements", 600, 601), ("elements", 601, 601)]


@pytest.mark.asyncio
async def test_finalize_passes_its_report_to_the_projection(monkeypatch: pytest.MonkeyPatch):
    from app.persistence import population_store as store
    from app.population import age_projection

    seen = {}

    async def projected(_pool, _age_pool, _revision_id, report=None):  # type: ignore[no-untyped-def]
        seen["report"] = report
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
    await finalize_draft_revision(object(), object(), "dr_1", report)
    assert seen["report"] is report


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

    async def projected(_pool, _age_pool, _revision_id, _report=None):  # type: ignore[no-untyped-def]
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
