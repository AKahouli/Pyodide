"""Workspace-scoped population reads (P0-GRAPH).

NestJS computes the actor's allowed workspaces; the runtime hides every record read from a
workspace outside that scope before serializing anything — nodes, edges, pages, counts and
gap samples. A missing, null or malformed scope is a validation failure, never "all
workspaces"; the old unscoped GET routes answer 410 Gone.
"""

from __future__ import annotations

import pytest

fastapi = pytest.importorskip("fastapi")
TestClient = pytest.importorskip("starlette.testclient", reason="starlette TestClient required").TestClient

from app.api import population_routes as routes  # noqa: E402
from app.api.population_routes import router  # noqa: E402

AUTH = {"X-Semantic-Service-Key": "test-key"}
BINDING = {"data_revision_id": "dr-1", "model_version_id": "v-1", "projection_ref": "age:v2:pop_dr_1"}
SPECIFICATION = {"concepts": [], "relations": []}

GRAPH = {
    "nodes": [
        {"id": "a-only", "label": "c", "properties": {"record_id": "a-only"}},
        {"id": "b-only", "label": "c", "properties": {"record_id": "b-only"}},
        {"id": "manual-1", "label": "c", "properties": {"record_id": "manual-1"}},
    ],
    "edges": [
        {"id": "r:a-only:b-only", "label": "r", "sourceId": "a-only", "targetId": "b-only", "properties": {}},
        {"id": "r:a-only:manual-1", "label": "r", "sourceId": "a-only", "targetId": "manual-1", "properties": {}},
    ],
}


class FakePool:
    pass


def _client(monkeypatch, *, hidden: set[str], coverage: dict | None = None) -> TestClient:
    hidden_arg = hidden
    """The routes against fake pools and the canonical store answering ``hidden``."""
    app = fastapi.FastAPI()
    app.include_router(router)
    app.state.population_pool = FakePool()
    app.state.age_pool = FakePool()

    async def get_active_binding(pool, model_id, environment):
        assert environment == "draft"
        return dict(BINDING)

    async def split_entity_visibility(pool, revision_id, allowed):
        assert revision_id == "dr-1"
        assert isinstance(allowed, list), "the scope must arrive as a list, never null"
        hidden = set(hidden_arg)
        return {node["id"] for node in GRAPH["nodes"]} - hidden, hidden

    async def get_revision_specification(pool, revision_id):
        return dict(SPECIFICATION)

    async def read_projection_graph(age_pool, projection_ref):
        return {**GRAPH, "nodes": [dict(node) for node in GRAPH["nodes"]],
                "edges": [dict(edge) for edge in GRAPH["edges"]]}

    monkeypatch.setattr(routes.store, "get_active_binding", get_active_binding)
    monkeypatch.setattr(routes.store, "split_entity_visibility", split_entity_visibility)
    monkeypatch.setattr(routes.store, "get_revision_specification", get_revision_specification)
    monkeypatch.setattr(routes, "read_projection_graph", read_projection_graph)
    if coverage is not None:
        async def get_data_revision(pool, revision_id):
            return {"coverage": coverage, "execution_fingerprint": "sha256:f"}

        monkeypatch.setattr(routes.store, "get_data_revision", get_data_revision)
    return TestClient(app)


def body(**over: object) -> dict:
    return {"actorUserId": "u-1", "environment": "draft", "allowedWorkspaceIds": ["ws-a"], **over}


def test_scoped_graph_hides_records_from_forbidden_workspaces(monkeypatch):
    client = _client(monkeypatch, hidden={"b-only"})
    data = client.post("/v1/semantic-model-population/models/m-1/graph/read", json=body(), headers=AUTH).json()
    ids = {node["id"] for node in data["nodes"]}
    assert ids == {"a-only", "manual-1"}
    # A link to a hidden record is not a link at all: no endpoint of the hidden node remains.
    assert [edge["id"] for edge in data["edges"]] == ["r:a-only:manual-1"]
    assert data["dataRevisionId"] == "dr-1"


def test_scoped_graph_full_visibility_and_manual_only_scope(monkeypatch):
    full = _client(monkeypatch, hidden=set())
    assert {node["id"] for node in full.post(
        "/v1/semantic-model-population/models/m-1/graph/read", json=body(), headers=AUTH).json()["nodes"]} \
        == {"a-only", "b-only", "manual-1"}

    # An empty scope is honest: the caller's answer stays empty of source-derived records,
    # and the runtime does not secretly widen it.
    empty = _client(monkeypatch, hidden={"a-only", "b-only"})
    data = empty.post("/v1/semantic-model-population/models/m-1/graph/read",
                      json=body(allowedWorkspaceIds=[]), headers=AUTH).json()
    assert {node["id"] for node in data["nodes"]} == {"manual-1"}
    assert data["edges"] == []


def test_missing_or_null_scope_is_a_validation_failure(monkeypatch):
    client = _client(monkeypatch, hidden=set())
    missing = client.post("/v1/semantic-model-population/models/m-1/graph/read",
                          json={"actorUserId": "u-1", "environment": "draft"}, headers=AUTH)
    assert missing.status_code == 422
    null = client.post("/v1/semantic-model-population/models/m-1/graph/read",
                       json=body(allowedWorkspaceIds=None), headers=AUTH)
    assert null.status_code == 422
    extra = client.post("/v1/semantic-model-population/models/m-1/graph/read",
                        json=body(unexpected="x"), headers=AUTH)
    assert extra.status_code == 422


def test_old_unscoped_reads_are_gone(monkeypatch):
    client = _client(monkeypatch, hidden=set())
    for path in ("/v1/semantic-model-population/models/m-1/graph",
                 "/v1/semantic-model-population/models/m-1/records",
                 "/v1/semantic-model-population/models/m-1/concepts/c-1/records"):
        response = client.get(path, headers=AUTH)
        assert response.status_code == 410, path
        assert "endpoint_removed" in response.text


def test_pinned_revision_conflict_and_missing_binding(monkeypatch):
    client = _client(monkeypatch, hidden=set())
    moved = client.post("/v1/semantic-model-population/models/m-1/graph/read",
                        json=body(dataRevisionId="dr-old"), headers=AUTH)
    assert moved.status_code == 409


def test_scoped_records_page_counts_and_gaps(monkeypatch):
    """The records page shows only visible records, and the stored gap groups (whole-revision
    counts) go when anything is hidden: they would count hidden records."""
    coverage = {"gaps": {
        "missingValues": [{"conceptId": "c-1", "attribute": "city", "missing": 7, "total": 99}],
        "unresolvedLinks": [{"relationId": "r-1", "kind": "unmatched", "count": 4}],
        "other": [{"conceptId": "c-1", "kind": "missing_identity", "count": 2}],
        "rowSamples": [
            {"conceptId": "c-1", "kind": "unreadable_row", "asset": {"workspaceId": "ws-a", "assetId": "doc-a"}, "values": {"q": "shown"}},
            {"conceptId": "c-1", "kind": "unreadable_row", "asset": {"workspaceId": "ws-b", "assetId": "doc-b"}, "values": {"q": "secret"}},
            {"conceptId": "c-1", "kind": "manual_row", "values": {"q": "typed by hand"}},
        ],
        "linkSamples": [{"relationId": "r-1", "kind": "unmatched", "sourceEntityId": "a-only"},
                        {"relationId": "r-1", "kind": "unmatched", "sourceEntityId": "b-only"}],
    }}

    async def list_visible(pool, revision_id, limit, concept_id, allowed):
        assert allowed == ["ws-a"]
        return [{"entityId": "a-only", "conceptId": "c-1", "label": "A", "attributes": {}, "provenance": {}, "origins": {}, "identity": {}}]

    async def counts_visible(pool, revision_id, allowed):
        return {"entities": 1, "assertions": 1, "relationships": 0}

    async def concept_counts_visible(pool, revision_id, allowed):
        return {"c-1": 1}

    async def relationships_visible(pool, revision_id, allowed, limit=20000):
        return []

    async def origins(pool, revision_id, entity_ids):
        return {entity_id: {} for entity_id in entity_ids}

    client = _client(monkeypatch, hidden={"b-only"}, coverage=coverage)
    monkeypatch.setattr(routes.store, "list_revision_entities_visible", list_visible)
    monkeypatch.setattr(routes.store, "count_revision_rows_visible", counts_visible)
    monkeypatch.setattr(routes.store, "count_revision_entities_by_concept_visible", concept_counts_visible)
    monkeypatch.setattr(routes.store, "list_revision_relationships_visible", relationships_visible)
    monkeypatch.setattr(routes.store, "list_entity_origins", origins)

    data = client.post("/v1/semantic-model-population/models/m-1/records/read",
                       json=body(limit=25, conceptId="c-1"), headers=AUTH).json()
    assert [entity["entityId"] for entity in data["entities"]] == ["a-only"]
    assert data["counts"] == {"entities": 1, "assertions": 1, "relationships": 0}
    assert data["conceptCounts"] == {"c-1": 1}
    # Samples of visible sources stay; the hidden workspace's row and endpoint go.
    samples = data["gaps"]["rowSamples"]
    assert [sample["values"]["q"] for sample in samples] == ["shown", "typed by hand"]
    assert [sample["sourceEntityId"] for sample in data["gaps"]["linkSamples"]] == ["a-only"]
    # The whole-revision counts are gone: they would reveal how many hidden records exist.
    assert data["gaps"]["missingValues"] == []
    assert data["gaps"]["unresolvedLinks"] == []
    assert data["gaps"]["other"] == []


def test_scoped_gaps_stay_untouched_when_nothing_is_hidden(monkeypatch):
    gaps = {"missingValues": [{"conceptId": "c", "attribute": "a", "missing": 1, "total": 3}]}
    assert routes._scoped_gaps(gaps, ["ws-a"], set()) is gaps
    empty = routes._scoped_gaps(None, ["ws-a"], set())
    assert empty == {"missingValues": [], "unresolvedLinks": [], "other": []}


def test_scoped_concept_records_page(monkeypatch):
    async def search_entities(pool, revision_id, concept_id, *, query=None, limit=50, offset=0,
                              filters=None, allowed_workspace_ids=None):
        assert allowed_workspace_ids == ["ws-a"], "the page must carry the scope into SQL"
        assert (query, limit, offset) == ("acme", 10, 5)
        return 1, [{"entityId": "a-only", "conceptId": concept_id, "label": "Acme",
                    "attributes": {"city": "Paris"}, "provenance": {}, "identity": {}}]

    async def origins(pool, revision_id, entity_ids):
        return {entity_id: {"city": {"kind": "source"}} for entity_id in entity_ids}

    client = _client(monkeypatch, hidden={"b-only"})
    monkeypatch.setattr(routes.store, "search_revision_entities", search_entities)
    monkeypatch.setattr(routes.store, "list_entity_origins", origins)
    data = client.post("/v1/semantic-model-population/models/m-1/concepts/c-1/records/read",
                       json=body(q="acme", limit=10, offset=5, filters={"city": "Paris"}), headers=AUTH).json()
    assert data["total"] == 1
    assert data["entities"][0]["origins"] == {"city": {"kind": "source"}}
    assert data["offset"] == 5


def test_workspace_id_bounds_are_enforced(monkeypatch):
    client = _client(monkeypatch, hidden=set())
    oversized = client.post("/v1/semantic-model-population/models/m-1/graph/read",
                            json=body(allowedWorkspaceIds=["w" * 201]), headers=AUTH)
    assert oversized.status_code == 422
