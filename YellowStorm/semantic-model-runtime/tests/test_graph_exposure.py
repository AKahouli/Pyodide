"""The fields a concept shows in its graph: left out of the vertices, given back to readers from the stored
records, and a change of them rebuilds the graph only (no new data revision, no source read)."""

from __future__ import annotations

import json

import pytest

from app.persistence import graph_search_store as search_store
from app.persistence import population_store as store
from app.population import age_projection
from app.population.age_projection import (PROTECTED_PROPERTIES, PopulationError, compile_projection,
                                            ensure_revision_projection, normalize_graph_exposure,
                                            reproject_revision, restore_hidden_values, stored_graph_exposure)
from test_population_task import command, run_population_for_payload

ENTITY = {"entityId": "mail:1", "conceptId": "c-mail", "label": "Offer", "identity": {"cle_message": "msg_1"},
          "attributes": {"objet": "Offer", "corps": "x" * 50, "corps_complet": "y" * 500, "label": "shadow"},
          "provenance": {"sources": [{"assetRef": {"workspaceId": "w1"}}]}}


def test_hidden_fields_are_not_vertex_properties_and_the_node_keeps_what_readers_need():
    plan = compile_projection([ENTITY], [], {"c-mail": {"hidden": ["corps_complet", "corps"]}})
    vertex = plan["vertices"][0]
    assert "corps_complet" not in vertex and "corps" not in vertex
    # Key fields and the other fields stay by default; the node keeps its id, concept, label and workspaces.
    assert vertex["cle_message"] == "msg_1" and vertex["objet"] == "Offer"
    assert vertex["record_id"] == "mail:1" and vertex["concept_id"] == "c-mail"
    assert vertex["label"] == "Offer" and vertex["workspace_ids"] == ["w1"]
    assert PROTECTED_PROPERTIES <= set(vertex)


def test_a_concept_without_a_rule_and_the_default_show_every_field():
    everything = compile_projection([ENTITY], [])["vertices"][0]
    assert compile_projection([ENTITY], [], {})["vertices"][0] == everything
    assert compile_projection([ENTITY], [], {"other": {"hidden": ["objet"]}})["vertices"][0] == everything
    assert everything["corps_complet"] == "y" * 500


def test_a_long_text_is_cut_not_dropped_and_a_key_can_be_hidden_without_losing_the_label():
    plan = compile_projection([ENTITY], [], {"c-mail": {"hidden": ["cle_message"], "maxChars": {"corps_complet": 20, "objet": 3}}})
    vertex = plan["vertices"][0]
    assert vertex["corps_complet"] == "y" * 20 and vertex["objet"] == "Off"
    assert "cle_message" not in vertex and vertex["label"] == "Offer"


def test_exposure_is_validated_and_normalized():
    assert normalize_graph_exposure(None) == {} and normalize_graph_exposure({}) == {}
    assert normalize_graph_exposure({"c": {"hidden": ["b", "a", "a"], "maxChars": {"t": 10, "a": 5}}, "d": {"hidden": []}}) == {
        "c": {"hidden": ["a", "b"], "maxChars": {"t": 10}}}
    for bad in ([], {"c": []}, {"c": {"hidden": "a"}}, {"c": {"hidden": [1]}}, {"c": {"maxChars": {"t": 0}}},
                {"c": {"maxChars": {"t": "9"}}}, {"c": {"maxChars": {"t": True}}}, {"": {"hidden": ["a"]}}):
        with pytest.raises(PopulationError):
            normalize_graph_exposure(bad)
    assert stored_graph_exposure({"graphExposure": {"c": {"hidden": ["a"]}}}) == {"c": {"hidden": ["a"]}}
    assert stored_graph_exposure(json.dumps({"graphExposure": {"c": {"hidden": ["a"]}}})) == {"c": {"hidden": ["a"]}}
    assert stored_graph_exposure({"graphExposure": "garbage"}) == {} and stored_graph_exposure(None) == {}


@pytest.mark.asyncio
async def test_readers_get_hidden_and_cut_values_back_from_the_stored_records(monkeypatch: pytest.MonkeyPatch):
    asked: list = []

    async def attributes(_pool, revision_id, ids):  # type: ignore[no-untyped-def]
        asked.append((revision_id, list(ids)))
        return {"mail:1": {"cle_message": "msg_1", "corps_complet": "y" * 500, "corps": None, "9x": 7}}

    monkeypatch.setattr(search_store, "entity_attributes", attributes)
    nodes = [{"id": "mail:1", "label": "c-mail", "properties": {"objet": "Offer", "corps_complet": "y" * 20,
                                                                  "record_label": "Offer"}},
             {"id": "p:1", "label": "c-person", "properties": {"name": "A"}}]
    await restore_hidden_values(object(), "dr_1", nodes, {"c-mail": {"hidden": ["corps", "9x", "label"],
                                                                      "maxChars": {"corps_complet": 20}}})
    assert asked == [("dr_1", ["mail:1"])]  # only the records of a concept that limits fields
    properties = nodes[0]["properties"]
    assert properties["corps_complet"] == "y" * 500 and properties["_9x"] == 7
    assert "corps" not in properties  # null stays absent
    # A hidden field named like a protected property never replaces it.
    assert "label" not in properties and properties["record_label"] == "Offer"
    assert nodes[1]["properties"] == {"name": "A"}
    asked.clear()
    await restore_hidden_values(object(), "dr_1", nodes, {})
    assert asked == []


@pytest.mark.asyncio
async def test_a_graph_built_with_another_exposure_is_rebuilt_only_and_the_same_one_is_reused(monkeypatch: pytest.MonkeyPatch):
    revision = {"validation_state": "valid", "projection_ref": "age:v2:pop_dr_1",
                "coverage": {"graphExposure": {"c": {"hidden": ["a"]}}}}
    rebuilt: list = []

    async def get_revision(_pool, _revision_id):  # type: ignore[no-untyped-def]
        return revision

    async def reproject(_pool, _age_pool, revision_id, *, force=False, exposure=None):  # type: ignore[no-untyped-def]
        rebuilt.append((revision_id, force, exposure))
        return {"revisionId": revision_id, "projectionRef": "age:v2:pop_dr_1_t2", "reprojected": True}

    monkeypatch.setattr(store, "get_data_revision", get_revision)
    monkeypatch.setattr(age_projection, "reproject_revision", reproject)
    same = await ensure_revision_projection(object(), object(), "dr_1", exposure={"c": {"hidden": ["a"]}})
    assert same["reused"] is True and rebuilt == []
    # Not told: the graph keeps what it has.
    assert (await ensure_revision_projection(object(), object(), "dr_1"))["reused"] is True and rebuilt == []
    other = await ensure_revision_projection(object(), object(), "dr_1", exposure={"c": {"hidden": ["a", "b"]}})
    assert other["reprojected"] is True and rebuilt == [("dr_1", True, {"c": {"hidden": ["a", "b"]}})]
    await ensure_revision_projection(object(), object(), "dr_1", exposure={})
    assert rebuilt[-1][2] == {}


class _AgeConnection:
    async def fetchval(self, sql: str, *params):  # type: ignore[no-untyped-def]
        return 1


class _AgePool:
    def acquire(self):  # type: ignore[no-untyped-def]
        connection = _AgeConnection()

        class Held:
            async def __aenter__(self):  # type: ignore[no-untyped-def]
                return connection

            async def __aexit__(self, *exc):  # type: ignore[no-untyped-def]
                return False

        return Held()


@pytest.mark.asyncio
async def test_reprojecting_builds_with_the_asked_exposure_and_stores_it_with_the_new_graph(monkeypatch: pytest.MonkeyPatch):
    seen: dict = {}

    async def get_revision(_pool, _revision_id):  # type: ignore[no-untyped-def]
        return {"projection_ref": "age:v2:pop_dr_1", "coverage": {"graphExposure": {"old": {"hidden": ["x"]}}}}

    async def project(_pool, _connection, revision_id, graph, report=None, batch_rows=0, exposure=None):  # type: ignore[no-untyped-def]
        seen["built"] = (graph, exposure)
        return {"vertices": 2, "edges": 1}

    async def replace(_pool, revision_id, old_ref, new_ref, graph_exposure=None):  # type: ignore[no-untyped-def]
        seen["stored"] = (old_ref, new_ref, graph_exposure)
        return True

    async def discard(_connection, graph, _revision_id):  # type: ignore[no-untyped-def]
        seen["dropped"] = graph

    monkeypatch.setattr(store, "get_data_revision", get_revision)
    monkeypatch.setattr(store, "replace_revision_projection", replace)
    monkeypatch.setattr(age_projection, "_project_stored_rows", project)
    monkeypatch.setattr(age_projection, "_discard_projection", discard)
    result = await reproject_revision(object(), _AgePool(), "dr_1", force=True, exposure={"c": {"hidden": ["a"]}})
    assert result["reprojected"] is True
    assert seen["built"][1] == {"c": {"hidden": ["a"]}} and seen["stored"][2] == {"c": {"hidden": ["a"]}}
    assert seen["dropped"] == "pop_dr_1"
    # Without an exposure the stored one is kept.
    await reproject_revision(object(), _AgePool(), "dr_1", force=True)
    assert seen["built"][1] == {"old": {"hidden": ["x"]}}


def test_the_exposure_changes_neither_the_specification_nor_the_execution_fingerprint():
    plain = command()
    exposed = command()
    exposed["payload"]["graphExposure"] = {"c1": {"hidden": ["name"]}}
    assert (run_population_for_payload(exposed)["executionFingerprint"]
            == run_population_for_payload(plain)["executionFingerprint"])
    assert exposed["payload"]["specHash"] == plain["payload"]["specHash"]


def test_a_run_command_carries_a_valid_exposure_only():
    from pydantic import ValidationError

    from app.jobs.models import PopulationPayload

    body = command()["payload"]
    assert "graphExposure" not in PopulationPayload.model_validate(body).model_dump(by_alias=True)
    kept = PopulationPayload.model_validate({**body, "graphExposure": {"c1": {"hidden": ["name"]}}})
    assert kept.model_dump(by_alias=True)["graphExposure"] == {"c1": {"hidden": ["name"]}}
    with pytest.raises(ValidationError):
        PopulationPayload.model_validate({**body, "graphExposure": {"c1": {"hidden": "name"}}})


class _RecordingPool:
    def __init__(self) -> None:
        self.statements: list[tuple[str, tuple]] = []

    async def fetchrow(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.statements.append((sql, params))
        return {"id": "dr_1"}

    async def execute(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.statements.append((sql, params))


@pytest.mark.asyncio
async def test_the_exposure_is_stored_with_the_projection_and_survives_a_coverage_update():
    pool = _RecordingPool()
    assert await store.set_revision_projection(pool, "dr_1", "age:v2:pop_dr_1", None, graph_exposure={"c": {"hidden": ["a"]}})
    sql, params = pool.statements[-1]
    assert "graphExposure" in sql and json.loads(params[3]) == {"c": {"hidden": ["a"]}}
    # Without one, the revision's coverage is untouched.
    await store.set_revision_projection(pool, "dr_1", "age:v2:pop_dr_1", None)
    assert "graphExposure" not in pool.statements[-1][0]
    # A run keeping a projected revision rewrites its coverage; the exposure it was built with stays.
    await store.update_revision_reading(pool, "dr_1", coverage={"completeEnumeration": True}, source_observations=[])
    assert "coverage -> 'graphExposure'" in pool.statements[-1][0]


@pytest.mark.asyncio
async def test_graph_reads_restore_values_only_for_a_graph_with_an_exposure(monkeypatch: pytest.MonkeyPatch):
    from app.api import population_routes

    calls: list = []

    async def restore(_pool, revision_id, nodes, exposure):  # type: ignore[no-untyped-def]
        calls.append((revision_id, exposure))

    monkeypatch.setattr(population_routes, "restore_hidden_values", restore)
    # The draft binding carries the exposure its graph was built with (json text, as the database gives it).
    await population_routes._restore_graph_values(
        object(), {"data_revision_id": "dr_hidden", "graph_exposure": json.dumps({"c": {"hidden": ["a"]}})}, [])
    await population_routes._restore_graph_values(object(), {"data_revision_id": "dr_plain", "graph_exposure": None}, [])
    await population_routes._restore_graph_values(object(), {"data_revision_id": "dr_old"}, [])
    assert calls == [("dr_hidden", {"c": {"hidden": ["a"]}})]


@pytest.mark.asyncio
async def test_the_draft_binding_is_read_with_the_exposure_of_its_graph():
    class Pool:
        sql = ""

        async def fetchrow(self, sql, *params):  # type: ignore[no-untyped-def]
            Pool.sql = sql
            return {"data_revision_id": "dr_1", "graph_exposure": "{}"}

    assert (await store.get_active_binding(Pool(), "m", "draft"))["data_revision_id"] == "dr_1"
    assert "coverage -> 'graphExposure'" in Pool.sql
