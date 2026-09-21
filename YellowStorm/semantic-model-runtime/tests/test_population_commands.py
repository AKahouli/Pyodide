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


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SEMANTIC_RUNTIME_SERVICE_KEY", "test-key")
    monkeypatch.setenv("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED", "true")
    monkeypatch.delenv("SEMANTIC_RUNTIME_DATABASE_URL", raising=False)
    monkeypatch.delenv("SEMANTIC_INDEX_DATABASE_URL", raising=False)
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client


def _inject(client: TestClient, pool: ScriptedPool) -> None:
    client.app.state.population_pool = pool


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
    _inject(client, ScriptedPool([revision, stored, entities, relationships, {"id": "dr_1"}]))
    response = client.post("/v1/semantic-model-population/revisions/dr_1/project",
                           headers=AUTH)
    assert response.status_code == 200
    body = response.json()
    assert body["graph"] == "pop_dr_1"
    assert body["vertices"] == 1 and body["edges"] == 1
    assert body["reused"] is False

    _inject(client, ScriptedPool([{**revision, "projection_ref": "graph:pop_dr_1"}]))
    again = client.post("/v1/semantic-model-population/revisions/dr_1/project",
                        headers=AUTH)
    assert again.status_code == 200
    assert again.json()["reused"] is True

    dangling = [{"relation_id": "r1", "source_entity_id": "crm:aaa",
                 "target_entity_id": "missing", "matching_strategy": "exact"}]
    _inject(client, ScriptedPool([revision, stored, entities, dangling]))
    assert client.post("/v1/semantic-model-population/revisions/dr_1/project",
                       headers=AUTH).status_code == 409


def test_project_rejects_truncated_listing(client: TestClient):
    revision = {"id": "dr_9", "model_id": "m1", "validation_state": "valid",
                "projection_ref": None, "correction_sequence": 0}
    entities = [{"id": "e1", "concept_id": "c1", "namespace": "n", "label": "E",
                 "attributes": {}}]
    stored = {"entities": 10000, "assertions": 0, "relationships": 0}
    _inject(client, ScriptedPool([revision, stored, entities, []]))
    response = client.post("/v1/semantic-model-population/revisions/dr_9/project",
                           headers=AUTH)
    assert response.status_code == 409
    assert response.json()["detail"] == "projection_too_large"


def test_activation_swaps_binding_only_on_expected_tuple(client: TestClient):
    revision = {"id": "dr_1", "model_id": "m1", "validation_state": "valid",
                "projection_ref": "graph:pop_dr_1", "correction_sequence": 2}
    binding = {"model_id": "m1", "environment": "production", "data_revision_id": "dr_1",
               "version": 4, "projection_ref": "revision:dr_2"}
    body = {"actorUserId": "u1", "modelId": "m1", "modelVersionId": "v1",
            "expectedCorrectionSequence": 2, "expectedActiveDataRevisionId": "dr_1"}
    _inject(client, ScriptedPool([revision, 2, binding, {"version": 5}, binding]))
    response = client.post("/v1/semantic-model-population/revisions/dr_2/activate",
                           headers=AUTH, json=body)
    assert response.status_code == 200
    assert response.json()["active"]["data_revision_id"] == "dr_1"

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


def _mirror_body(spec_hash: str | None = None) -> dict:
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
        "sourceScope": [{"workspaceId": "w1", "assetId": "a1"}],
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

    _inject(client, ScriptedPool([{"id": "s1", "spec_hash": "sha256:" + "b" * 64}]))
    assert client.post("/v1/semantic-model-population/specifications",
                       headers=AUTH, json=body).status_code == 409

    bad = _mirror_body(spec_hash="sha256:" + "0" * 64)
    _inject(client, ScriptedPool([]))
    assert client.post("/v1/semantic-model-population/specifications",
                       headers=AUTH, json=bad).status_code == 422

    # Lost-insert race: pre-check saw nothing, the store insert conflicted,
    # and the winner holds different content.
    raced = _mirror_body()
    _inject(client, ScriptedPool([None, None,
                                  {"id": "s1", "spec_hash": "sha256:" + "b" * 64}]))
    assert client.post("/v1/semantic-model-population/specifications",
                       headers=AUTH, json=raced).status_code == 409


def test_commands_require_service_key_and_store(client: TestClient):
    assert client.post("/v1/semantic-model-population/corrections",
                       json=CORRECTION).status_code == 401
