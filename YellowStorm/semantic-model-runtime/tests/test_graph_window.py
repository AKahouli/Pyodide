"""Bounded graph window: the graph view reads a limited part of a large graph, chosen and counted
over the records the caller's workspaces may see. The route is tested against fake stores for
wiring and shape; the SQL (visibility, limits, quotas, links) against a real database when
SEMANTIC_RUNTIME_TEST_DATABASE_URL is set."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
import pytest_asyncio

from app.persistence import graph_window_store as window_store

fastapi = pytest.importorskip("fastapi")
TestClient = pytest.importorskip("starlette.testclient", reason="starlette TestClient required").TestClient

from app.api import population_routes as routes  # noqa: E402
from app.api.population_routes import router  # noqa: E402

AUTH = {"X-Semantic-Service-Key": "test-key"}
URL = "/v1/semantic-model-population/models/m-1/graph/window"
BINDING = {"data_revision_id": "dr-1", "model_version_id": "v-1", "projection_ref": "age:v2:pop_dr_1"}


def test_quotas_share_the_limit_evenly_and_let_small_concepts_take_all():
    assert window_store.allocate_quotas({"a": 50, "b": 25000, "c": 99900}, 2000) == {"a": 50, "b": 975, "c": 975}
    assert window_store.allocate_quotas({"a": 3, "b": 4}, 100) == {"a": 3, "b": 4}
    assert window_store.allocate_quotas({"a": 10, "b": 10, "c": 10}, 10) == {"a": 4, "b": 3, "c": 3}
    assert window_store.allocate_quotas({"a": 0, "b": 5}, 2) == {"b": 2}
    assert window_store.allocate_quotas({}, 2000) == {}
    quotas = window_store.allocate_quotas({str(i): 1000 for i in range(37)}, 2000)
    assert sum(quotas.values()) == 2000 and max(quotas.values()) - min(quotas.values()) <= 1


class Calls:
    def __init__(self) -> None:
        self.scopes: list[list[str]] = []
        self.quotas: dict[str, int] | None = None
        self.focus: dict | None = None
        self.links_asked: list[list[str]] = []


def _client(monkeypatch, *, concepts: dict[str, int], calls: Calls,
            missing_in_graph: set[str] | None = None) -> TestClient:
    app = fastapi.FastAPI()
    app.include_router(router)
    app.state.population_pool = object()
    app.state.age_pool = object()
    records = {"a": [("a:1", "a"), ("a:2", "a")], "b": [("b:1", "b")]}

    async def get_active_binding(pool, model_id, environment):
        return dict(BINDING)

    async def count_visible_overview(pool, revision_id, allowed):
        calls.scopes.append(allowed)
        return {"concepts": dict(concepts), "relations": {"r": 4}}

    async def select_visible_records(pool, revision_id, allowed, quotas):
        calls.scopes.append(allowed)
        calls.quotas = quotas
        chosen = [record for concept in sorted(quotas) for record in records.get(concept, [])[:quotas[concept]]]
        return chosen

    async def select_focus_records(pool, revision_id, allowed, focus_ids, *, neighbours, limit):
        calls.scopes.append(allowed)
        calls.focus = {"ids": focus_ids, "neighbours": neighbours, "limit": limit}
        return [("a:1", "a"), ("b:1", "b")], True

    async def list_links_among(pool, revision_id, record_ids):
        calls.links_asked.append(record_ids)
        return [{"relationId": "r", "sourceId": "a:1", "targetId": "b:1"}]

    async def read_nodes(age_pool, projection_ref, record_ids):
        return [{"id": record_id, "label": record_id[0], "properties": {"record_id": record_id}}
                for record_id in record_ids if record_id not in (missing_in_graph or set())]

    async def get_revision_specification(pool, revision_id):
        return {"concepts": [], "relations": []}

    monkeypatch.setattr(routes.store, "get_active_binding", get_active_binding)
    monkeypatch.setattr(routes.store, "get_revision_specification", get_revision_specification)
    monkeypatch.setattr(window_store, "count_visible_overview", count_visible_overview)
    monkeypatch.setattr(window_store, "select_visible_records", select_visible_records)
    monkeypatch.setattr(window_store, "select_focus_records", select_focus_records)
    monkeypatch.setattr(window_store, "list_links_among", list_links_among)
    monkeypatch.setattr(routes, "read_projection_nodes", read_nodes)
    return TestClient(app)


def body(**over: object) -> dict:
    return {"actorUserId": "u-1", "environment": "draft", "allowedWorkspaceIds": ["ws-a"], **over}


def test_window_is_bounded_scoped_and_reports_visible_totals(monkeypatch):
    calls = Calls()
    client = _client(monkeypatch, concepts={"a": 2, "b": 1}, calls=calls)
    data = client.post(URL, json=body(nodeLimit=2), headers=AUTH).json()
    assert calls.quotas == {"a": 1, "b": 1}
    assert [node["id"] for node in data["nodes"]] == ["a:1", "b:1"]
    assert data["truncated"] is True and data["nodeLimit"] == 2
    assert data["totals"] == {"records": 3, "links": 4, "concepts": {"a": 2, "b": 1}, "relations": {"r": 4}}
    assert data["edges"] == [{"id": "r:a:1:b:1", "label": "r", "sourceId": "a:1", "targetId": "b:1",
                              "properties": {"relation_id": "r"}}]
    # The scope reaches every store call, as a list, never null.
    assert calls.scopes and all(scope == ["ws-a"] for scope in calls.scopes)

    whole = client.post(URL, json=body(), headers=AUTH).json()
    assert whole["truncated"] is False and whole["nodeLimit"] == 2000


def test_window_by_concept_counts_only_that_concept(monkeypatch):
    calls = Calls()
    client = _client(monkeypatch, concepts={"a": 2, "b": 1}, calls=calls)
    data = client.post(URL, json=body(conceptId="a", nodeLimit=1), headers=AUTH).json()
    assert calls.quotas == {"a": 1}
    assert data["truncated"] is True
    # A concept with no visible record yields an empty, complete window.
    none = client.post(URL, json=body(conceptId="zzz"), headers=AUTH).json()
    assert calls.quotas == {} and none["nodes"] == [] and none["truncated"] is False


def test_focus_window_reads_neighbours_without_totals(monkeypatch):
    calls = Calls()
    client = _client(monkeypatch, concepts={}, calls=calls)
    data = client.post(URL, json=body(focusIds=["a:1"], nodeLimit=50), headers=AUTH).json()
    assert calls.focus == {"ids": ["a:1"], "neighbours": True, "limit": 50}
    assert data["totals"] is None and data["truncated"] is True
    single = client.post(URL, json=body(focusIds=["a:1"], neighbours=False, nodeLimit=1), headers=AUTH)
    assert single.status_code == 200 and calls.focus["neighbours"] is False


def test_links_only_among_records_the_graph_returned(monkeypatch):
    calls = Calls()
    client = _client(monkeypatch, concepts={"a": 2, "b": 1}, calls=calls, missing_in_graph={"b:1"})
    data = client.post(URL, json=body(nodeLimit=2), headers=AUTH).json()
    assert [node["id"] for node in data["nodes"]] == ["a:1"]
    assert calls.links_asked == [["a:1"]]


@pytest.mark.parametrize("override", [
    {"nodeLimit": 0}, {"nodeLimit": 5001}, {"focusIds": [""]}, {"focusIds": ["x"] * 51},
    {"unexpected": 1}, {"allowedWorkspaceIds": None}, {"conceptId": "x" * 201},
])
def test_window_request_is_validated(monkeypatch, override):
    client = _client(monkeypatch, concepts={}, calls=Calls())
    assert client.post(URL, json=body(**override), headers=AUTH).status_code == 422


def test_window_requires_a_scope_and_a_pinned_revision(monkeypatch):
    client = _client(monkeypatch, concepts={}, calls=Calls())
    assert client.post(URL, json={"actorUserId": "u-1"}, headers=AUTH).status_code == 422
    assert client.post(URL, json=body(dataRevisionId="dr-old"), headers=AUTH).status_code == 409


class _FakeAgePool:
    """Records the SQL sent and answers every row with one fixed record."""

    def __init__(self) -> None:
        self.queries: list[str] = []

    def acquire(self):
        pool = self

        class _Connection:
            async def fetch(self, sql):
                pool.queries.append(sql)
                return [{"record_id": '"p:1"', "concept_id": '"person"', "label": '"One"',
                         "properties": '{"record_id": "p:1", "name": "One"}::vertex'}]

        class _Context:
            async def __aenter__(self):
                return _Connection()

            async def __aexit__(self, *exc):
                return False

        return _Context()


@pytest.mark.asyncio
async def test_nodes_are_read_by_id_literals_in_bounded_statements():
    from app.population.age_projection import NODE_READ_CHUNK, read_projection_nodes

    pool = _FakeAgePool()
    ids = [f"p:{index}" for index in range(NODE_READ_CHUNK + 1)] + ["it's"]
    nodes = await read_projection_nodes(pool, "age:v2:pop_dr_1", ids)
    assert len(pool.queries) == 2 and len(nodes) == 2
    assert "n.record_id IN ['p:0'," in pool.queries[0]
    assert "'it\\'s'" in pool.queries[1]  # a quote in an id cannot end the literal
    assert nodes[0] == {"id": "p:1", "label": "person",
                        "properties": {"record_id": "p:1", "name": "One", "record_label": "One"}}
    assert await read_projection_nodes(pool, "age:v2:pop_dr_1", []) == []
    assert len(pool.queries) == 2


# SQL against a real database ----------------------------------------------------------------------

DSN = os.environ.get("SEMANTIC_RUNTIME_TEST_DATABASE_URL")
ROOT = Path(__file__).resolve().parents[1]
integration = pytest.mark.skipif(not DSN, reason="SEMANTIC_RUNTIME_TEST_DATABASE_URL not set")


def _entity(entity_id: str, concept: str, *workspaces: str) -> dict:
    sources = [{"assetRef": {"workspaceId": workspace}} for workspace in workspaces]
    return {"entityId": entity_id, "conceptId": concept, "namespace": "ns", "identity": {"k": entity_id},
            "label": entity_id, "attributes": {}, "provenance": {"sources": sources}}


@pytest_asyncio.fixture
async def seeded_pool():
    import asyncpg
    from app.persistence import population_store as store

    assert DSN
    connection = await asyncpg.connect(DSN)
    try:
        await connection.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
        for schema in ("semantic_jobs", "semantic_population", "semantic_runtime", "semantic_graph_search"):
            await connection.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
        for name in ("001_durable_jobs.sql", "005_runtime_store.sql", "006_population_store.sql",
                     "008_versioned_specification_mirrors.sql", "009_invalidate_unverified_age_projections.sql",
                     "010_ui_signal_outbox.sql", "015_population_execution_fingerprint.sql",
                     "016_draft_population_binding.sql", "017_current_specification_selection.sql",
                     "029_assertion_candidates.sql", "022_graph_search.sql", "031_partition_revision_tables.sql"):
            await connection.execute((ROOT / "migrations" / name).read_text(encoding="utf-8"))
    finally:
        await connection.close()
    pool = await asyncpg.create_pool(DSN, min_size=1, max_size=4)
    await store.mirror_specification(pool, home_workspace_id="ws1", model_id="m1", model_version_id="v1",
                                     spec_hash="sha256:" + "a" * 64, specification={"concepts": []})
    await store.create_data_revision(pool, revision_id="dr_w", model_id="m1", model_version_id="v1",
                                     spec_hash="sha256:" + "a" * 64, execution_fingerprint="sha256:" + "b" * 64,
                                     source_observations=[], correction_sequence=0, coverage={})
    entities = [
        _entity("p:1", "person", "ws-a"), _entity("p:2", "person", "ws-a"), _entity("p:3", "person", "ws-b"),
        _entity("p:4", "person", "ws-a", "ws-b"),  # one source outside the scope hides the whole record
        _entity("p:5", "person"),  # typed by hand: no workspace, shown to any scope
        _entity("m:1", "mail", "ws-a"), _entity("m:2", "mail", "ws-b"), _entity("m:3", "mail", "ws-a"),
    ]
    await store.store_entities(pool, model_id="m1", revision_id="dr_w", entities=entities)
    links = [("sent", "p:1", "m:1"), ("sent", "p:2", "m:3"), ("sent", "p:3", "m:2"),
             ("sent", "p:4", "m:1"), ("sent", "p:1", "m:2"), ("knows", "p:1", "p:2"), ("knows", "p:5", "p:1")]
    await store.store_relationships(pool, model_id="m1", revision_id="dr_w", relationships=[
        {"relationId": relation, "sourceEntityId": source, "targetEntityId": target}
        for relation, source, target in links])
    await pool.execute(
        "UPDATE semantic_population.relationships SET state = 'suppressed' "
        "WHERE relation_id = 'knows' AND source_entity_id = 'p:5'")
    yield pool
    await pool.close()


@integration
@pytest.mark.asyncio
async def test_overview_counts_only_visible_records_and_links(seeded_pool):
    overview = await window_store.count_visible_overview(seeded_pool, "dr_w", ["ws-a"])
    # sent: p:1-m:1 and p:2-m:3 only (p:3, p:4, m:2 are hidden, and so are the links touching them);
    # the suppressed link is no fact.
    assert overview == {"concepts": {"person": 3, "mail": 2}, "relations": {"sent": 2, "knows": 1}}
    everything = await window_store.count_visible_overview(seeded_pool, "dr_w", ["ws-a", "ws-b"])
    assert everything["concepts"] == {"person": 5, "mail": 3}
    assert everything["relations"] == {"sent": 5, "knows": 1}
    only_manual = await window_store.count_visible_overview(seeded_pool, "dr_w", [])
    assert only_manual == {"concepts": {"person": 1}, "relations": {}}


@integration
@pytest.mark.asyncio
async def test_window_selects_visible_records_within_quotas_and_links(seeded_pool):
    allowed = ["ws-a"]
    records = await window_store.select_visible_records(seeded_pool, "dr_w", allowed, {"person": 2, "mail": 1})
    assert records == [("m:1", "mail"), ("p:1", "person"), ("p:2", "person")]
    every = await window_store.select_visible_records(seeded_pool, "dr_w", allowed, {"person": 10, "mail": 10})
    ids = {record_id for record_id, _concept in every}
    assert ids == {"p:1", "p:2", "p:5", "m:1", "m:3"}  # never p:3, p:4 or m:2
    links = await window_store.list_links_among(seeded_pool, "dr_w", sorted(ids))
    assert {(link["relationId"], link["sourceId"], link["targetId"]) for link in links} == {
        ("sent", "p:1", "m:1"), ("sent", "p:2", "m:3"), ("knows", "p:1", "p:2")}
    assert await window_store.select_visible_records(seeded_pool, "dr_w", allowed, {}) == []


@integration
@pytest.mark.asyncio
async def test_focus_expands_to_visible_neighbours_only(seeded_pool):
    records, truncated = await window_store.select_focus_records(
        seeded_pool, "dr_w", ["ws-a"], ["p:1"], neighbours=True, limit=50)
    # p:1 is linked to m:1 and p:2, and to the hidden m:2 (never shown) and, by a suppressed link, p:5.
    assert [record_id for record_id, _ in records] == ["p:1", "m:1", "p:2"] and truncated is False
    alone, _ = await window_store.select_focus_records(
        seeded_pool, "dr_w", ["ws-a"], ["p:1"], neighbours=False, limit=1)
    assert alone == [("p:1", "person")]
    # A hidden record asked for by id is not found, nor are its neighbours.
    hidden, _ = await window_store.select_focus_records(
        seeded_pool, "dr_w", ["ws-a"], ["p:3", "p:4"], neighbours=True, limit=50)
    assert hidden == []
    capped, truncated = await window_store.select_focus_records(
        seeded_pool, "dr_w", ["ws-a"], ["p:1"], neighbours=True, limit=2)
    assert len(capped) == 2 and truncated is True
