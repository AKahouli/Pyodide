from __future__ import annotations

import os
import uuid

import asyncpg
import pytest

from app.population.age_projection import (compile_projection, drop_projection,
                                            project_revision, projection_counts,
                                            projection_exists, validate_projection)

DSN = os.environ.get("SEMANTIC_AGEGRAPH_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="SEMANTIC_AGEGRAPH_TEST_DATABASE_URL not set")


@pytest.mark.asyncio
async def test_live_projection_round_trip() -> None:
    graph = f"pop_test_{uuid.uuid4().hex[:20]}"
    connection = await asyncpg.connect(
        DSN,
        command_timeout=30,
        server_settings={"search_path": 'ag_catalog, "$user", public'},
    )
    plan = compile_projection(
        [
            {"entityId": "customer:1", "conceptId": "customer", "label": "One"},
            {"entityId": "customer:2", "conceptId": "customer", "label": "Two"},
        ],
        [{"sourceEntityId": "customer:1", "targetEntityId": "customer:2",
          "relationId": "knows"}],
    )
    try:
        await project_revision(connection, graph=graph, plan=plan)
        counts = await projection_counts(connection, graph)
        assert validate_projection({"vertices": 2, "edges": 1}, counts) == []
    finally:
        if await projection_exists(connection, graph):
            await drop_projection(connection, graph)
        assert await projection_exists(connection, graph) is False
        await connection.close()


class ScriptedPool:
    def __init__(self, script: list) -> None:
        self.script = list(script)

    async def fetchval(self, _sql: str, *_params):  # type: ignore[no-untyped-def]
        return self.script.pop(0)

    async def fetchrow(self, _sql: str, *_params):  # type: ignore[no-untyped-def]
        return self.script.pop(0)

    async def fetch(self, _sql: str, *_params):  # type: ignore[no-untyped-def]
        return self.script.pop(0)

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


class FailingProjectionPool(ScriptedPool):
    async def fetchrow(self, sql: str, *params):  # type: ignore[no-untyped-def]
        if "SET projection_ref" in sql:
            raise RuntimeError("injected persistence failure")
        return await super().fetchrow(sql, *params)


async def _age_connection():  # type: ignore[no-untyped-def]
    return await asyncpg.connect(
        DSN,
        command_timeout=30,
        server_settings={"search_path": 'ag_catalog, "$user", public'},
    )


async def _remove_graph(graph: str) -> None:
    connection = await _age_connection()
    try:
        if await projection_exists(connection, graph):
            await drop_projection(connection, graph)
        assert await projection_exists(connection, graph) is False
    finally:
        await connection.close()


def test_live_project_and_activate_routes(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    from fastapi.testclient import TestClient

    from app.main import create_app

    revision_id = f"dr_smoke_{uuid.uuid4().hex[:20]}"
    graph = f"pop_{revision_id}"
    revision = {"id": revision_id, "model_id": "smoke-model", "model_version_id": "v1",
                "spec_hash": "sha256:" + "a" * 64,
                "validation_state": "valid", "projection_ref": None,
                "correction_sequence": 0}
    entities = [
        {"id": "customer:1", "concept_id": "customer", "namespace": "customer",
         "label": "One", "attributes": {}},
        {"id": "customer:2", "concept_id": "customer", "namespace": "customer",
         "label": "Two", "attributes": {}},
    ]
    relationships = [{"relation_id": "knows", "source_entity_id": "customer:1",
                      "target_entity_id": "customer:2", "matching_strategy": "exact"}]
    monkeypatch.setenv("SEMANTIC_AGEGRAPH_DATABASE_URL", DSN or "")
    monkeypatch.setenv("SEMANTIC_RUNTIME_SERVICE_KEY", "smoke-key")
    monkeypatch.setenv("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED", "true")
    monkeypatch.delenv("SEMANTIC_RUNTIME_DATABASE_URL", raising=False)
    monkeypatch.delenv("SEMANTIC_INDEX_DATABASE_URL", raising=False)
    headers = {"X-Semantic-Service-Key": "smoke-key"}
    asyncio.run(_seed_orphan(graph))
    try:
        app = create_app()
        with TestClient(app) as client:
            app.state.population_pool = ScriptedPool([
                revision, revision, {"entities": 2, "assertions": 0, "relationships": 1},
                entities, relationships, {"id": revision_id},
            ])
            projected = client.post(
                f"/v1/semantic-model-population/revisions/{revision_id}/project",
                headers=headers,
            )
            assert projected.status_code == 200
            assert projected.json()["vertices"] == 2
            assert projected.json()["edges"] == 1

            projection_ref = f"age:v1:{graph}"
            projected_revision = {**revision, "projection_ref": projection_ref}
            active = {"model_id": "smoke-model", "environment": "test",
                      "model_version_id": "v1", "data_revision_id": revision_id,
                      "projection_ref": projection_ref, "correction_sequence": 0,
                      "version": 1}
            app.state.population_pool = ScriptedPool([
                projected_revision, 0, None, {"version": 1}, active,
            ])
            activated = client.post(
                f"/v1/semantic-model-population/revisions/{revision_id}/activate",
                headers=headers,
                json={"actorUserId": "smoke", "modelId": "smoke-model",
                      "modelVersionId": "v1", "expectedCorrectionSequence": 0,
                      "environment": "test"},
            )
            assert activated.status_code == 200
            assert activated.json()["active"]["data_revision_id"] == revision_id
    finally:
        if DSN:
            asyncio.run(_remove_graph(graph))


async def _seed_orphan(graph: str) -> None:
    connection = await _age_connection()
    try:
        await project_revision(connection, graph=graph, plan={
            "vertices": [{"record_id": "orphan"}], "edges": [],
        })
    finally:
        await connection.close()


def test_live_route_rolls_back_and_compensates_failures(
        monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    from fastapi.testclient import TestClient

    from app.population import age_projection
    from app.main import create_app

    monkeypatch.setenv("SEMANTIC_AGEGRAPH_DATABASE_URL", DSN or "")
    monkeypatch.setenv("SEMANTIC_RUNTIME_SERVICE_KEY", "smoke-key")
    monkeypatch.setenv("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED", "true")
    monkeypatch.delenv("SEMANTIC_RUNTIME_DATABASE_URL", raising=False)
    monkeypatch.delenv("SEMANTIC_INDEX_DATABASE_URL", raising=False)
    headers = {"X-Semantic-Service-Key": "smoke-key"}
    entities = [{"id": "e1", "concept_id": "c1", "namespace": "n",
                 "label": "One", "attributes": {}}]

    mismatch_id = f"dr_mismatch_{uuid.uuid4().hex[:16]}"
    mismatch_graph = f"pop_{mismatch_id}"
    mismatch_revision = {"id": mismatch_id, "model_id": "m", "validation_state": "valid",
                         "projection_ref": None, "correction_sequence": 0}
    original_counts = age_projection.projection_counts

    async def mismatched_counts(_connection, _graph):  # type: ignore[no-untyped-def]
        return {"vertices": 0, "edges": 0}

    persistence_id = f"dr_persist_{uuid.uuid4().hex[:16]}"
    persistence_graph = f"pop_{persistence_id}"
    persistence_revision = {**mismatch_revision, "id": persistence_id}
    committed_id = f"dr_committed_{uuid.uuid4().hex[:16]}"
    committed_graph = f"pop_{committed_id}"
    committed_ref = f"age:v1:{committed_graph}"
    committed_revision = {**mismatch_revision, "id": committed_id}
    try:
        app = create_app()
        with TestClient(app) as client:
            app.state.population_pool = ScriptedPool([
                mismatch_revision, mismatch_revision,
                {"entities": 1, "assertions": 0, "relationships": 0}, entities, [],
            ])
            monkeypatch.setattr(age_projection, "projection_counts", mismatched_counts)
            mismatch = client.post(
                f"/v1/semantic-model-population/revisions/{mismatch_id}/project",
                headers=headers,
            )
            assert mismatch.status_code == 409
            assert mismatch.json()["detail"] == "projection_validation_failed"
            assert asyncio.run(_graph_absent(mismatch_graph))

            monkeypatch.setattr(age_projection, "projection_counts", original_counts)
            app.state.population_pool = FailingProjectionPool([
                persistence_revision, persistence_revision,
                {"entities": 1, "assertions": 0, "relationships": 0}, entities, [],
                persistence_revision,
            ])
            persistence = client.post(
                f"/v1/semantic-model-population/revisions/{persistence_id}/project",
                headers=headers,
            )
            assert persistence.status_code == 503
            assert persistence.json()["detail"] == "projection_persistence_failed"
            assert asyncio.run(_graph_absent(persistence_graph))

            app.state.population_pool = FailingProjectionPool([
                committed_revision, committed_revision,
                {"entities": 1, "assertions": 0, "relationships": 0}, entities, [],
                {**committed_revision, "projection_ref": committed_ref},
            ])
            committed = client.post(
                f"/v1/semantic-model-population/revisions/{committed_id}/project",
                headers=headers,
            )
            assert committed.status_code == 200
            assert committed.json()["projectionRef"] == committed_ref
            assert not asyncio.run(_graph_absent(committed_graph))
    finally:
        if DSN:
            asyncio.run(_remove_graph(mismatch_graph))
            asyncio.run(_remove_graph(persistence_graph))
            asyncio.run(_remove_graph(committed_graph))


async def _graph_absent(graph: str) -> bool:
    connection = await _age_connection()
    try:
        return not await projection_exists(connection, graph)
    finally:
        await connection.close()
