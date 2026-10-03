from __future__ import annotations

import json

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

    def acquire(self):  # type: ignore[no-untyped-def]
        return AsyncContext(self)

    def transaction(self):  # type: ignore[no-untyped-def]
        return AsyncContext(self)


class AsyncContext:
    def __init__(self, value) -> None:  # type: ignore[no-untyped-def]
        self.value = value

    async def __aenter__(self):  # type: ignore[no-untyped-def]
        return self.value

    async def __aexit__(self, *_args) -> None:  # type: ignore[no-untyped-def]
        return None


class FakeAgeConnection:
    def __init__(self, vertices: int = 1, edges: int = 1,
                 graph_rows: list[list[dict]] | None = None) -> None:
        self.vertices = vertices
        self.edges = edges
        self.graph_rows = list(graph_rows or [])
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

    async def fetch(self, sql: str, *_params):  # type: ignore[no-untyped-def]
        self.statements.append(sql)
        return self.graph_rows.pop(0)


class FakeAgePool:
    def __init__(self, vertices: int = 1, edges: int = 1,
                 graph_rows: list[list[dict]] | None = None) -> None:
        self.connection = FakeAgeConnection(vertices, edges, graph_rows)

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


def test_bound_records_and_graph_share_the_draft_revision(client: TestClient):
    binding = {"model_id": "m1", "model_version_id": "v1",
               "data_revision_id": "dr_1", "projection_ref": "age:v1:pop_dr_1"}
    counts = {"entities": 1, "assertions": 1, "relationships": 1}
    entity = {"id": "crm::1", "concept_id": "c1", "namespace": "crm", "label": "Acme",
              "attributes": {"name": "Acme"}, "provenance": {}}
    relationship = {"relation_id": "r1", "source_entity_id": "crm::1",
                    "target_entity_id": "crm::1", "matching_strategy": "exact"}
    specification = {"concepts": [{"conceptId": "c1", "label": "Customer",
                                    "allowedFields": ["name"]}],
                     "relations": [{"relationId": "r1", "label": "knows"}]}
    origins = [{"entity_id": "crm::1", "attribute": "name", "origin": "source",
                "evidence": {"assetRef": {"assetId": "a1"}, "rowNumber": 4,
                             "column": "name"}}]
    gaps = {"missingValues": [{"conceptId": "c1", "attribute": "city", "missing": 1,
                               "total": 1}], "unresolvedLinks": [], "other": []}
    revision = {"id": "dr_1", "coverage": json.dumps({"gaps": gaps}), "execution_fingerprint": "sha256:run"}
    _inject(client, ScriptedPool([binding, counts, [{"concept_id": "c1", "entities": 1}],
                                  [entity], origins, revision,
                                  [relationship], {"specification": specification}]))
    records = client.get("/v1/semantic-model-population/models/m1/records?limit=25",
                         headers=AUTH)
    assert records.status_code == 200
    assert records.json()["dataRevisionId"] == "dr_1"
    assert records.json()["entities"][0]["entityId"] == "crm::1"
    assert records.json()["entities"][0]["origins"]["name"] == {
        "kind": "source", "assetId": "a1", "rowNumber": 4, "column": "name"}
    assert records.json()["gaps"] == gaps
    assert records.json()["conceptCounts"] == {"c1": 1}
    assert records.json()["executionFingerprint"] == "sha256:run"

    graph_rows = [
        [{"record_id": '"crm::1"', "concept_id": '"c1"', "label": '"Acme"',
          "properties": '{"record_id":"crm::1","concept_id":"c1","label":"Acme"}'}],
        [{"relation_id": '"r1"', "source_id": '"crm::1"', "target_id": '"crm::1"',
          "properties": '{"relation_id":"r1"}'}],
    ]
    _inject(client, ScriptedPool([binding, {"specification": specification}]),
            FakeAgePool(graph_rows=graph_rows))
    graph = client.get("/v1/semantic-model-population/models/m1/graph", headers=AUTH)
    assert graph.status_code == 200
    assert graph.json()["dataRevisionId"] == "dr_1"
    assert graph.json()["nodes"][0]["id"] == "crm::1"
    assert graph.json()["nodes"][0]["properties"]["record_label"] == "Acme"

    _inject(client, ScriptedPool([binding]))
    stale = client.get(
        "/v1/semantic-model-population/models/m1/records?dataRevisionId=dr_old",
        headers=AUTH,
    )
    assert stale.status_code == 409
    assert stale.json()["detail"] == "active_binding_changed"


class RecordingPool(ScriptedPool):
    def __init__(self, script: list) -> None:
        super().__init__(script)
        self.calls: list[tuple] = []

    async def fetchval(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.calls.append((sql, params))
        return await super().fetchval(sql, *params)

    async def fetch(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.calls.append((sql, params))
        return await super().fetch(sql, *params)


def test_concept_records_are_searched_a_page_at_a_time(client: TestClient):
    binding = {"model_id": "m1", "model_version_id": "v1", "data_revision_id": "dr_1"}
    entity = {"id": "crm::1", "concept_id": "c1", "namespace": "crm", "label": "Acme 50%",
              "attributes": {"name": "Acme"}, "provenance": {}}
    origins = [{"entity_id": "crm::1", "attribute": "name", "origin": "source",
                "evidence": {"assetRef": {"assetId": "a1"}, "rowNumber": 4}}]
    pool = RecordingPool([binding, 120, [entity], origins])
    _inject(client, pool)
    response = client.get(
        "/v1/semantic-model-population/models/m1/concepts/c1/records?q=50%25&limit=20&offset=40",
        headers=AUTH)
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 120 and body["offset"] == 40 and body["limit"] == 20
    assert body["entities"][0]["origins"]["name"]["rowNumber"] == 4
    count_params = next(params for sql, params in pool.calls if "count(*)" in sql)
    assert count_params == ("dr_1", "c1", r"%50\%%")
    page_params = next(params for sql, params in pool.calls if "OFFSET" in sql)
    assert page_params[-2:] == (20, 40)
    assert client.get("/v1/semantic-model-population/models/m1/concepts/c1/records?limit=500",
                      headers=AUTH).status_code == 422


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
    revision = {"id": "dr_1", "model_id": "m1", "spec_hash": "sha256:" + "a" * 64,
                "validation_state": "valid",
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
    class CapturingPool(ScriptedPool):
        statements: list[str] = []

        async def fetchrow(self, sql: str, *params):  # type: ignore[no-untyped-def]
            self.statements.append(sql)
            return await super().fetchrow(sql, *params)

    reused_pool = CapturingPool([{"id": "s1", "spec_hash": body["specHash"]}, {"id": "s1"}])
    _inject(client, reused_pool)
    again = client.post("/v1/semantic-model-population/specifications",
                        headers=AUTH, json=body)
    assert again.json()["reused"] is True
    assert any("selected_at = clock_timestamp()" in sql for sql in reused_pool.statements)

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


def test_publish_promotes_the_draft_revision_of_the_published_version(client: TestClient):
    revision = {"id": "dr_1", "model_id": "m1", "spec_hash": "sha256:" + "a" * 64,
                "validation_state": "valid",
                "projection_ref": "age:v1:pop_dr_1", "correction_sequence": 0}
    draft = {"model_id": "m1", "environment": "draft", "model_version_id": "v1",
             "data_revision_id": "dr_1", "version": 3, "projection_ref": "age:v1:pop_dr_1"}
    production = {**draft, "environment": "production", "version": 1}
    body = {"actorUserId": "u1", "modelVersionId": "v1"}
    _inject(client, ScriptedPool([draft, revision, revision, None, {"version": 1}, production]), FakeAgePool())
    response = client.post("/v1/semantic-model-population/models/m1/publish", headers=AUTH, json=body)
    assert response.status_code == 200
    assert response.json()["active"]["environment"] == "production"
    assert response.json()["reused"] is False

    _inject(client, ScriptedPool([draft, revision, revision, production]), FakeAgePool())
    again = client.post("/v1/semantic-model-population/models/m1/publish", headers=AUTH, json=body)
    assert again.json()["reused"] is True

    _inject(client, ScriptedPool([{**draft, "model_version_id": "v0"}]))
    outdated = client.post("/v1/semantic-model-population/models/m1/publish", headers=AUTH, json=body)
    assert outdated.status_code == 409
    assert outdated.json()["detail"] == "draft_data_outdated"

    _inject(client, ScriptedPool([None]))
    missing = client.post("/v1/semantic-model-population/models/m1/publish", headers=AUTH, json=body)
    assert missing.json()["detail"] == "no_draft_data"


def test_published_binding_is_readable_and_404_when_unpublished(client: TestClient):
    production = {"model_id": "m1", "model_version_id": "v1", "data_revision_id": "dr_1",
                  "projection_ref": "age:v1:pop_dr_1", "version": 1}
    _inject(client, ScriptedPool([production]))
    response = client.get("/v1/semantic-model-population/models/m1/published", headers=AUTH)
    assert response.json()["projectionRef"] == "age:v1:pop_dr_1"
    _inject(client, ScriptedPool([None]))
    assert client.get("/v1/semantic-model-population/models/m1/published",
                      headers=AUTH).status_code == 404


def test_data_summary_counts_draft_and_published_records(client: TestClient):
    draft = {"model_id": "m1", "model_version_id": "v2", "data_revision_id": "dr_2", "version": 1}
    counts = {"entities": 12, "assertions": 30, "relationships": 4}
    _inject(client, ScriptedPool([draft, counts, None]))
    response = client.get("/v1/semantic-model-population/models/m1/data-summary", headers=AUTH)
    assert response.status_code == 200
    assert response.json() == {"modelId": "m1", "production": None,
                               "draft": {"modelVersionId": "v2", "records": 12, "links": 4}}


def test_corrections_list_hides_undone_fixes(client: TestClient):
    rows = [
        {"sequence": 1, "model_version_id": "v1", "actor_user_id": "u1", "reason": "",
         "target_identity": {"entityId": "e1"}, "action": "remove_entity", "payload": {},
         "created_at": None},
        {"sequence": 2, "model_version_id": "v1", "actor_user_id": "u1", "reason": "",
         "target_identity": {"entityId": "e2"}, "action": "remove_entity", "payload": {},
         "created_at": None},
        {"sequence": 3, "model_version_id": "v1", "actor_user_id": "u1", "reason": "",
         "target_identity": {"entityId": "e1"}, "action": "revert", "payload": {"sequence": 1},
         "created_at": None},
    ]
    _inject(client, ScriptedPool([rows, 3]))
    response = client.get("/v1/semantic-model-population/models/m1/corrections", headers=AUTH)
    assert response.status_code == 200
    body = response.json()
    assert body["correctionSequence"] == 3
    assert [item["sequence"] for item in body["corrections"]] == [2]


def test_revert_must_name_an_existing_correction(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED", "true")
    body = {**CORRECTION, "action": "revert", "payload": {"sequence": 9}}
    _inject(client, ScriptedPool([2]))
    response = client.post("/v1/semantic-model-population/corrections", headers=AUTH, json=body)
    assert response.status_code == 422
    assert response.json()["detail"] == "invalid_revert_target"


class _GraphsPool:
    """An AGE database holding the graphs named in ``existing``."""

    def __init__(self, existing: set[str]) -> None:
        self.existing = existing
        self.dropped: list[str] = []

    def acquire(self) -> AsyncContext:
        return AsyncContext(self)

    async def fetchval(self, sql: str, *params):  # type: ignore[no-untyped-def]
        return params[0] in self.existing

    async def execute(self, sql: str, *_params):  # type: ignore[no-untyped-def]
        self.dropped.append(sql)


def test_purge_clears_data_and_drops_its_graphs(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    from app.persistence import population_store as store

    seen: dict = {}

    async def purge(pool, model_id, *, forget_document_reading, emit_signal):  # type: ignore[no-untyped-def]
        seen.update(model=model_id, forget=forget_document_reading)
        return {"modelId": model_id, "resetGeneration": 1, "revisions": 2, "keptRevisions": 0,
                "reviewItems": 0, "jobs": 1, "documentReadings": 0,
                "projections": ["age:v1:pop_dr_a", "age:v1:pop_dr_gone"]}

    monkeypatch.setattr(store, "purge_model_data", purge)
    graphs = _GraphsPool({"pop_dr_a"})
    _inject(client, ScriptedPool([]), graphs)
    response = client.post("/v1/semantic-model-population/models/m1/purge", headers=AUTH,
                           json={"forgetDocumentReading": True})
    assert response.status_code == 200
    assert response.json()["projectionsDropped"] == 1
    assert "projections" not in response.json()
    assert seen == {"model": "m1", "forget": True}
    assert len(graphs.dropped) == 1 and "pop_dr_a" in graphs.dropped[0]


def test_purge_waits_for_a_running_build(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    from app.persistence import population_store as store

    async def purge(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise store.PopulationRunning("m1")

    monkeypatch.setattr(store, "purge_model_data", purge)
    _inject(client, ScriptedPool([]))
    response = client.post("/v1/semantic-model-population/models/m1/purge", headers=AUTH, json={})
    assert response.status_code == 409
    assert response.json()["detail"] == "population_running"


def test_delete_model_drops_its_graphs_and_returns_no_content(client: TestClient,
                                                              monkeypatch: pytest.MonkeyPatch):
    from app.persistence import population_store as store

    seen: list[str] = []

    async def delete(pool, model_id):  # type: ignore[no-untyped-def]
        seen.append(model_id)
        return {"modelId": model_id, "deleted": {},
                "projections": ["age:v1:pop_dr_a", "age:v1:pop_dr_gone"]}

    monkeypatch.setattr(store, "delete_model", delete)
    graphs = _GraphsPool({"pop_dr_a"})
    _inject(client, ScriptedPool([]), graphs)
    response = client.delete("/v1/semantic-model-population/models/m1", headers=AUTH)
    assert response.status_code == 204
    assert seen == ["m1"]
    assert len(graphs.dropped) == 1 and "pop_dr_a" in graphs.dropped[0]


def test_delete_model_refuses_while_a_job_runs(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    from app.persistence import population_store as store

    async def delete(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise store.ModelJobsRunning("m1")

    monkeypatch.setattr(store, "delete_model", delete)
    _inject(client, ScriptedPool([]))
    response = client.delete("/v1/semantic-model-population/models/m1", headers=AUTH)
    assert response.status_code == 409
    assert response.json()["detail"] == "model_jobs_running"


def test_delete_model_needs_the_service_key(client: TestClient):
    _inject(client, ScriptedPool([]))
    assert client.delete("/v1/semantic-model-population/models/m1").status_code in (401, 403)
