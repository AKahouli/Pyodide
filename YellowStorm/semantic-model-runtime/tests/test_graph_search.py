from __future__ import annotations

import pytest

fastapi = pytest.importorskip("fastapi")
TestClient = pytest.importorskip("starlette.testclient", reason="starlette TestClient required").TestClient

from app.main import create_app  # noqa: E402
from app.search.fused import graph_projection_ref, query_terms, rank_results, SearchError  # noqa: E402

BINDING = {"model_id": "m1", "model_version_id": "v2", "data_revision_id": "dr_1"}
ENTITIES = [
    {"id": "c1", "concept_id": "customer", "label": "Acme Corp", "attributes": {"city": "Lyon", "_entity_key": "x"},
     "provenance": {"sources": [{"sourceName": "customers.xlsx"}]}},
    {"id": "k1", "concept_id": "contract", "label": "Contract 12", "attributes": {"client": "Acme"},
     "provenance": {}},
    {"id": "z9", "concept_id": "customer", "label": "Other", "attributes": {}, "provenance": {}},
]
RELS = [{"relation_id": "signs", "source_entity_id": "c1", "target_entity_id": "k1",
         "source_concept_id": "customer", "source_label": "Acme Corp",
         "target_concept_id": "contract", "target_label": "Contract 12"}]


class FakePool:
    def __init__(self, binding=BINDING) -> None:
        self.binding = binding
        self.calls: list[tuple[str, tuple]] = []

    async def fetchrow(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.calls.append((sql, params))
        return self.binding

    async def fetch(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.calls.append((sql, params))
        return RELS if "relationships" in sql else ENTITIES


def make_client(monkeypatch, pool):  # type: ignore[no-untyped-def]
    monkeypatch.setenv("SEMANTIC_RUNTIME_SERVICE_KEY", "test-key")
    monkeypatch.setenv("SEMANTIC_MODEL_RUNTIME_ENABLED", "true")
    app = create_app()
    app.state.population_pool = pool
    return TestClient(app)


def test_query_terms_and_graph_ref():
    assert query_terms("Which contracts does ACME hold? a") == ["contracts", "which", "does", "acme", "hold"]
    assert graph_projection_ref("pop_dr_1") == "age:v1:pop_dr_1"
    with pytest.raises(SearchError):
        graph_projection_ref("sem_legacy")


def test_rank_results_orders_by_score_and_hides_internal_fields():
    results = rank_results(ENTITIES, RELS, ["acme"])
    assert [r["entityId"] for r in results] == ["c1", "k1"]
    assert results[0]["attributes"] == {"city": "Lyon"}
    assert results[0]["relationships"][0] == {"relation": "signs", "direction": "outgoing",
                                               "entityId": "k1", "concept": "contract", "label": "Contract 12"}


def test_fused_search_reads_published_revision_with_bearer(monkeypatch):
    pool = FakePool()
    with make_client(monkeypatch, pool) as client:
        response = client.post("/v1/graphs/search/fused", headers={"Authorization": "Bearer test-key"},
                               json={"schema_name": "pop_dr_1", "query": "acme"})
    assert response.status_code == 200
    body = response.json()
    assert body["dataRevisionId"] == "dr_1"
    assert body["results"][0]["label"] == "Acme Corp"
    assert body["retrieval_scope"] == {"file_names": ["customers.xlsx"]}
    assert pool.calls[0][1] == ("age:v1:pop_dr_1",)
    assert "environment = 'production'" in pool.calls[0][0]


def test_fused_search_refuses_unpublished_graph(monkeypatch):
    with make_client(monkeypatch, FakePool(binding=None)) as client:
        response = client.post("/v1/graphs/search/fused", headers={"Authorization": "Bearer test-key"},
                               json={"schema_name": "pop_draft", "query": "acme"})
    assert response.status_code == 404
    assert response.json()["detail"] == "model_not_published"


def test_bearer_is_only_accepted_on_graph_routes(monkeypatch):
    with make_client(monkeypatch, FakePool()) as client:
        denied = client.post("/v1/graphs/search/fused", headers={"Authorization": "Bearer wrong"},
                             json={"schema_name": "pop_dr_1", "query": "acme"})
        other = client.get("/v1/semantic-model-jobs/j1", headers={"Authorization": "Bearer test-key"})
    assert denied.status_code == 401
    assert other.status_code == 401
