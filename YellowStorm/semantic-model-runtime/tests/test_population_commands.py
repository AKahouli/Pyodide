from __future__ import annotations

import pytest

fastapi = pytest.importorskip("fastapi")
TestClient = pytest.importorskip("starlette.testclient", reason="starlette TestClient required").TestClient

from app.main import create_app  # noqa: E402

AUTH = {"X-Semantic-Service-Key": "test-key"}
CORRECTION = {
    "actorUserId": "u1", "modelId": "m1", "modelVersionId": "v1",
    "action": "edit_entity", "targetIdentity": {"entityId": "crm:aaa"},
    "reason": "fix", "payload": {"attributes": {"name": "Y"}},
    "expectedCorrectionSequence": 2,
}


class ScriptedPool:
    def __init__(self, script: list) -> None:
        self.script = list(script)

    async def fetchval(self, sql: str, *params):  # type: ignore[no-untyped-def]
        return self.script.pop(0)

    async def fetchrow(self, sql: str, *params):  # type: ignore[no-untyped-def]
        return self.script.pop(0)

    async def fetch(self, sql: str, *params):  # type: ignore[no-untyped-def]
        return self.script.pop(0)

    async def executemany(self, sql: str, rows) -> None:  # type: ignore[no-untyped-def]
        self.script.pop(0)


class AsyncContext:
    def __init__(self, value) -> None:  # type: ignore[no-untyped-def]
        self.value = value

    async def __aenter__(self):  # type: ignore[no-untyped-def]
        return self.value

    async def __aexit__(self, *_args) -> None:  # type: ignore[no-untyped-def]
        return None


class FakeAgeConnection:
    def __init__(self, vertices: int = 1, edges: int = 1) -> None:
        self.vertices = vertices
        self.edges = edges
        self.statements: list[str] = []

    def transaction(self) -> AsyncContext:
        return AsyncContext(self)

    async def execute(self, sql: str, *_params):  # type: ignore[no-untyped-def]
        self.statements.append(sql)
        return "OK"

    async def fetchval(self, sql: str, *_params):  # type: ignore[no-untyped-def]
        self.statements.append(sql)
        if "ag_catalog.ag_graph" in sql:
            return False
        if "count(n)" in sql:
            return str(self.vertices)
        if "count(r)" in sql:
            return str(self.edges)
        return True


class FakeAgePool:
    def __init__(self, vertices: int = 1, edges: int = 1) -> None:
        self.connection = FakeAgeConnection(vertices, edges)

    def acquire(self) -> AsyncContext:
        return AsyncContext(self.connection)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SEMANTIC_RUNTIME_SERVICE_KEY", "test-key")
    monkeypatch.setenv("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED", "true")
    monkeypatch.delenv("SEMANTIC_RUNTIME_DATABASE_URL", raising=False)
    monkeypatch.delenv("SEMANTIC_INDEX_DATABASE_URL", raising=False)
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client


def _inject(client: TestClient, pool: ScriptedPool, age_pool: FakeAgePool | None = None) -> None:
    client.app.state.population_pool = pool
    if age_pool is not None:
        client.app.state.age_pool = age_pool


def test_correction_records_with_expected_sequence(client: TestClient):
    _inject(client, ScriptedPool([2, {"sequence": 3}]))
    response = client.post("/v1/semantic-model-population/corrections",
                           headers=AUTH, json=CORRECTION)
    assert response.status_code == 200
    assert response.json() == {"sequence": 3, "modelId": "m1", "state": "accepted"}


def test_correction_rejects_stale_sequence(client: TestClient):
    _inject(client, ScriptedPool([5]))
    response = client.post("/v1/semantic-model-population/corrections",
                           headers=AUTH, json=CORRECTION)
    assert response.status_code == 409


def test_review_resolve_is_fenced_and_idempotent(client: TestClient):
    open_item = {"id": "r1", "model_id": "m1", "state": "open", "resolution": None}
    _inject(client, ScriptedPool([open_item, {"id": "r1"}]))
    body = {"actorUserId": "u1", "modelId": "m1", "resolution": {"targetEntityId": "e1"}}
    response = client.post("/v1/semantic-model-population/reviews/r1/resolve",
                           headers=AUTH, json=body)
    assert response.status_code == 200
    assert response.json() == {"reviewId": "r1", "state": "resolved", "reused": False}

    resolved_same = {"id": "r1", "model_id": "m1", "state": "resolved",
                     "resolution": {"targetEntityId": "e1"}}
    _inject(client, ScriptedPool([resolved_same]))
    again = client.post("/v1/semantic-model-population/reviews/r1/resolve",
                        headers=AUTH, json=body)
    assert again.status_code == 200
    assert again.json()["reused"] is True

    resolved_other = {"id": "r1", "model_id": "m1", "state": "resolved",
                      "resolution": {"targetEntityId": "e2"}}
    _inject(client, ScriptedPool([resolved_other]))
    conflict = client.post("/v1/semantic-model-population/reviews/r1/resolve",
                           headers=AUTH, json=body)
    assert conflict.status_code == 409

    _inject(client, ScriptedPool([None]))
    assert client.post("/v1/semantic-model-population/reviews/r1/resolve",
                       headers=AUTH, json=body).status_code == 404


def test_project_compiles_and_records_graph(client: TestClient):
    revision = {"id": "dr_1", "model_id": "m1", "validation_state": "valid",
                "projection_ref": None, "correction_sequence": 0}
    entities = [{"id": "crm:aaa", "concept_id": "c1", "namespace": "crm", "label": "X",
                 "attributes": {"name": "X"}}]
    relationships = [{"relation_id": "r1", "source_entity_id": "crm:aaa",
                      "target_entity_id": "crm:aaa", "matching_strategy": "exact"}]
    stored = {"entities": 1, "assertions": 0, "relationships": 1}
    age_pool = FakeAgePool()
    _inject(client, ScriptedPool([
        revision, revision, stored, entities, relationships, {"id": "dr_1"},
    ]), age_pool)
    response = client.post("/v1/semantic-model-population/revisions/dr_1/project",
                           headers=AUTH)
    assert response.status_code == 200
    body = response.json()
    assert body["graph"] == "pop_dr_1"
    assert body["vertices"] == 1 and body["edges"] == 1
    assert body["reused"] is False
    assert any("ag_catalog.create_graph" in sql for sql in age_pool.connection.statements)
    assert any("count(n)" in sql for sql in age_pool.connection.statements)

    _inject(client, ScriptedPool([{**revision, "projection_ref": "age:v1:pop_dr_1"}]))
    again = client.post("/v1/semantic-model-population/revisions/dr_1/project",
                        headers=AUTH)
    assert again.status_code == 200
    assert again.json()["reused"] is True

    dangling = [{"relation_id": "r1", "source_entity_id": "crm:aaa",
                 "target_entity_id": "missing", "matching_strategy": "exact"}]
    _inject(client, ScriptedPool([revision, revision, stored, entities, dangling]), FakeAgePool())
    assert client.post("/v1/semantic-model-population/revisions/dr_1/project",
                       headers=AUTH).status_code == 409


def test_project_rejects_truncated_listing(client: TestClient):
    revision = {"id": "dr_9", "model_id": "m1", "validation_state": "valid",
                "projection_ref": None, "correction_sequence": 0}
    entities = [{"id": "e1", "concept_id": "c1", "namespace": "n", "label": "E",
                 "attributes": {}}]
    stored = {"entities": 10000, "assertions": 0, "relationships": 0}
    _inject(client, ScriptedPool([revision, revision, stored, entities, []]), FakeAgePool())
    response = client.post("/v1/semantic-model-population/revisions/dr_9/project",
                           headers=AUTH)
    assert response.status_code == 409
    assert response.json()["detail"] == "projection_too_large"


def test_project_requires_age_and_rejects_live_count_mismatch(client: TestClient):
    revision = {"id": "dr_1", "model_id": "m1", "validation_state": "valid",
                "projection_ref": None, "correction_sequence": 0}
    _inject(client, ScriptedPool([revision]))
    client.app.state.age_pool = None
    unavailable = client.post("/v1/semantic-model-population/revisions/dr_1/project",
                              headers=AUTH)
    assert unavailable.status_code == 503
    assert unavailable.json()["detail"] == "age_projection_unavailable"

    entities = [{"id": "e1", "concept_id": "c1", "namespace": "n", "label": "E",
                 "attributes": {}}]
    store_pool = ScriptedPool([
        revision, revision, {"entities": 1, "assertions": 0, "relationships": 0},
        entities, [], {"id": "must-not-be-recorded"},
    ])
    _inject(client, store_pool, FakeAgePool(vertices=0, edges=0))
    mismatch = client.post("/v1/semantic-model-population/revisions/dr_1/project",
                           headers=AUTH)
    assert mismatch.status_code == 409
    assert mismatch.json()["detail"] == "projection_validation_failed"
    assert store_pool.script == [{"id": "must-not-be-recorded"}]


def test_project_rebuilds_legacy_unverified_reference(client: TestClient):
    revision = {"id": "dr_1", "model_id": "m1", "validation_state": "valid",
                "projection_ref": "graph:pop_dr_1", "correction_sequence": 0}
    entities = [{"id": "e1", "concept_id": "c1", "namespace": "n", "label": "E",
                 "attributes": {}}]
    _inject(client, ScriptedPool([
        revision, revision, {"entities": 1, "assertions": 0, "relationships": 0},
        entities, [], {"id": "dr_1"},
    ]), FakeAgePool(vertices=1, edges=0))
    response = client.post("/v1/semantic-model-population/revisions/dr_1/project",
                           headers=AUTH)
    assert response.status_code == 200
    assert response.json()["projectionRef"] == "age:v1:pop_dr_1"


def test_activation_swaps_binding_only_on_expected_tuple(client: TestClient):
    revision = {"id": "dr_1", "model_id": "m1", "validation_state": "valid",
                "projection_ref": "age:v1:pop_dr_1", "correction_sequence": 2}
    binding = {"model_id": "m1", "environment": "production", "data_revision_id": "dr_1",
               "version": 4, "projection_ref": "revision:dr_2"}
    body = {"actorUserId": "u1", "modelId": "m1", "modelVersionId": "v1",
            "expectedCorrectionSequence": 2, "expectedActiveDataRevisionId": "dr_1"}
    _inject(client, ScriptedPool([revision, 2, binding, {"version": 5}, binding]))
    response = client.post("/v1/semantic-model-population/revisions/dr_2/activate",
                           headers=AUTH, json=body)
    assert response.status_code == 200
    assert response.json()["active"]["data_revision_id"] == "dr_1"

    _inject(client, ScriptedPool([{**revision, "projection_ref": "graph:pop_dr_1"}]))
    legacy = client.post("/v1/semantic-model-population/revisions/dr_2/activate",
                         headers=AUTH, json=body)
    assert legacy.status_code == 409
    assert legacy.json()["detail"] == "revision_not_projected"

    stale = dict(revision, correction_sequence=1)
    _inject(client, ScriptedPool([stale, 2]))
    conflict = client.post("/v1/semantic-model-population/revisions/dr_2/activate",
                           headers=AUTH, json=body)
    assert conflict.status_code == 409

    invalid = dict(revision, validation_state="pending")
    _inject(client, ScriptedPool([invalid]))
    assert client.post("/v1/semantic-model-population/revisions/dr_2/activate",
                       headers=AUTH, json=body).status_code == 409

    unprojected = dict(revision, projection_ref=None)
    _inject(client, ScriptedPool([unprojected]))
    assert client.post("/v1/semantic-model-population/revisions/dr_2/activate",
                       headers=AUTH, json=body).status_code == 409


def _mirror_body(spec_hash: str | None = None, asset_id: str = "a1") -> dict:
    from app.population.compiler import canonical_spec_hash

    spec = {
        "modelId": "m1", "modelVersionId": "v1", "homeWorkspaceId": "w1",
        "concepts": [{
            "conceptId": "c1", "key": "customer", "label": "Customer",
            "identity": {"namespace": "crm", "keyComponents": ["customer_id"]},
            "populationMode": "materialized",
            "allowedFields": ["customer_id"],
        }],
        "relations": [],
        "sourceScope": [{"workspaceId": "w1", "assetId": asset_id}],
    }
    return {"homeWorkspaceId": "w1", "modelId": "m1", "modelVersionId": "v1",
            "specHash": canonical_spec_hash(spec) if spec_hash is None else spec_hash,
            "specification": spec}


def test_mirror_specification_validates_and_reuses(client: TestClient):
    _inject(client, ScriptedPool([None, {"id": "s1"}]))
    first = client.post("/v1/semantic-model-population/specifications",
                        headers=AUTH, json=_mirror_body())
    assert first.status_code == 200
    assert first.json()["reused"] is False

    body = _mirror_body()
    _inject(client, ScriptedPool([{"id": "s1", "spec_hash": body["specHash"]}]))
    again = client.post("/v1/semantic-model-population/specifications",
                        headers=AUTH, json=body)
    assert again.json()["reused"] is True

    changed = _mirror_body(asset_id="a2")
    _inject(client, ScriptedPool([None, {"id": "s2"}]))
    changed_response = client.post("/v1/semantic-model-population/specifications",
                                   headers=AUTH, json=changed)
    assert changed_response.status_code == 200
    assert changed_response.json()["reused"] is False

    bad = _mirror_body(spec_hash="sha256:" + "0" * 64)
    _inject(client, ScriptedPool([]))
    assert client.post("/v1/semantic-model-population/specifications",
                       headers=AUTH, json=bad).status_code == 422

    # Lost-insert race: an identical concurrent insert wins and is reused.
    raced = _mirror_body()
    _inject(client, ScriptedPool([None, None,
                                  {"id": "s1", "spec_hash": raced["specHash"]}]))
    assert client.post("/v1/semantic-model-population/specifications",
                       headers=AUTH, json=raced).status_code == 200


def test_commands_require_service_key_and_store(client: TestClient):
    assert client.post("/v1/semantic-model-population/corrections",
                       json=CORRECTION).status_code == 401
