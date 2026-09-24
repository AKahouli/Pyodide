from __future__ import annotations

import pytest

from app.population.age_projection import (PopulationError, compile_projection, create_graph_sql,
                                            drop_graph_sql, drop_projection, finalize_draft_revision,
                                            project_revision,
                                            projection_counts, projection_graph_name, render_edge_batch,
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
    vertex_sql = render_vertex_batch("pop_dr_1", plan["vertices"])
    assert "O\\'Brien\\\\Co" in vertex_sql
    assert "MERGE (n:Entity {record_id: row.record_id})" in vertex_sql
    edge_sql = render_edge_batch("pop_dr_1", plan["edges"])
    assert "MATCH (s:Entity {record_id: row.source})" in edge_sql
    assert "MERGE (s)-[r:RELATED_TO {relation_id: row.relation}]->(t)" in edge_sql
    with pytest.raises(PopulationError):
        render_vertex_batch("pop_dr_1", [])
    with pytest.raises(PopulationError):
        render_edge_batch("pop_dr_1", plan["edges"] * 501)


def test_validate_projection_compares_counts():
    assert validate_projection({"vertices": 2, "edges": 1}, {"vertices": 2, "edges": 1}) == []
    issues = validate_projection({"vertices": 2, "edges": 1}, {"vertices": 1, "edges": 1})
    assert [i["code"] for i in issues] == ["vertex_count_mismatch"]


@pytest.mark.asyncio
async def test_project_revision_batches_and_drops():
    conn = FakeConnection()
    plan = {"vertices": [{"record_id": f"e{i}"} for i in range(600)], "edges": []}
    result = await project_revision(conn, graph="pop_dr_1", plan=plan)
    assert result == {"graph": "pop_dr_1", "vertices": 600, "edges": 0}
    assert conn.statements[0] == create_graph_sql("pop_dr_1")
    assert len(conn.statements) == 3  # create + 2 vertex batches
    await drop_projection(conn, "pop_dr_1")
    assert conn.statements[-1] == drop_graph_sql("pop_dr_1")


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

    async def projected(_pool, _age_pool, _revision_id):  # type: ignore[no-untyped-def]
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
    assert is_whole_model_build({"payload": {"purpose": "refresh",
                                               "scope": {"kind": "model"}}}) is False
