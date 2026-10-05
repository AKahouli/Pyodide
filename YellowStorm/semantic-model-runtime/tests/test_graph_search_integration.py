"""Graph search end to end on the real databases: a population run requests the
search index, the real index worker builds it, and the search API finds records
by key, words and vectors, then follows the revision's real AGE links.

Only the embedding model is replaced, by a deterministic bag-of-words vector, so
the test measures the wiring (Postgres, pgvector, AGE, jobs), not model quality.
Needs SEMANTIC_RUNTIME_TEST_DATABASE_URL (dropped and rebuilt) and
SEMANTIC_AGEGRAPH_TEST_DATABASE_URL (only this run's graph is created and dropped).
"""

from __future__ import annotations

import hashlib
import json
import math
import re

import asyncpg
import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI

from app.api.graph_search_routes import router as search_router
from app.api.job_routes import router as job_router
from app.api.population_routes import router as population_router
from app.graph_search.embeddings import STORAGE_DIMENSION
from app.graph_search.traversal import init_age_connection
from app.jobs.service import JobService
from app.persistence import graph_search_store as search_store
from app.persistence.postgres_jobs import PostgresJobRepository
from app.population.age_projection import drop_projection, projection_exists, projection_graph_name
from test_population_graph_mvp_integration import (AGE_DSN, AGE_SETTINGS, CONTRACTS_ASSET,  # noqa: E402
                                                   CONTRACTS_CSV, CUSTOMERS_ASSET, MIGRATIONS, MODEL_ID,
                                                   RUNTIME_DSN, WORKSPACE_ID, customers_xlsx, run_request)

pytestmark = pytest.mark.skipif(not (RUNTIME_DSN and AGE_DSN),
                                reason="SEMANTIC_RUNTIME_TEST_DATABASE_URL and SEMANTIC_AGEGRAPH_TEST_DATABASE_URL not set")


def word_vector(text: str) -> list[float]:
    vector = [0.0] * STORAGE_DIMENSION
    for word in re.findall(r"[a-z0-9]+", text.lower()):
        vector[int(hashlib.sha1(word.encode()).hexdigest(), 16) % STORAGE_DIMENSION] += 1.0
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [value / norm for value in vector]


@pytest_asyncio.fixture
async def pools():
    assert RUNTIME_DSN and AGE_DSN
    connection = await asyncpg.connect(RUNTIME_DSN)
    try:
        for schema in ("semantic_jobs", "semantic_datasource", "semantic_runtime",
                       "semantic_population", "semantic_graph_search", "semantic_model"):
            await connection.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        for migration in MIGRATIONS:
            await connection.execute(migration.read_text(encoding="utf-8"))
    finally:
        await connection.close()
    runtime = await asyncpg.create_pool(RUNTIME_DSN, min_size=1, max_size=6)
    age = await asyncpg.create_pool(AGE_DSN, min_size=1, max_size=2, server_settings=AGE_SETTINGS,
                                    init=init_age_connection)
    graphs: list[str] = []
    yield runtime, age, graphs
    async with age.acquire() as age_connection:
        for graph in graphs:
            if await projection_exists(age_connection, graph):
                await drop_projection(age_connection, graph)
    await age.close()
    await runtime.close()


@pytest.mark.asyncio
async def test_records_are_found_and_their_real_links_followed(pools, monkeypatch: pytest.MonkeyPatch):
    runtime, age, graphs = pools
    import app.datasource.asset_delivery as asset_delivery
    import app.graph_search.indexer as indexer
    import app.graph_search.retrieval as retrieval
    import app.workers.graph_search_tasks as search_tasks
    import app.workers.population_tasks as population_tasks

    files = {CUSTOMERS_ASSET: customers_xlsx(), CONTRACTS_ASSET: CONTRACTS_CSV}

    async def fetch(source: dict, _actor: str, **_kwargs) -> bytes:
        return files[source["assetId"]]

    calls: list[int] = []

    async def fake_embed(_profile, texts: list[str], *, query: bool = False, client=None):  # type: ignore[no-untyped-def]
        calls.append(len(texts))
        return [word_vector(text) for text in texts]

    monkeypatch.setattr(asset_delivery, "fetch_workspace_asset", fetch)
    monkeypatch.setattr(indexer, "embed", fake_embed)
    monkeypatch.setattr(retrieval, "embed", fake_embed)
    monkeypatch.setenv("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED", "true")
    monkeypatch.setenv("SEMANTIC_RUNTIME_DATABASE_URL", RUNTIME_DSN)
    monkeypatch.setenv("SEMANTIC_AGEGRAPH_DATABASE_URL", AGE_DSN)
    monkeypatch.setenv("SEMANTIC_EMBEDDING_BASE_URL", "http://embeddings.invalid")
    monkeypatch.setenv("SEMANTIC_EMBEDDING_MODEL", "fake-words")
    monkeypatch.setenv("SEMANTIC_SEARCH_MIN_SIMILARITY", "0.2")

    app = FastAPI()
    for router in (population_router, job_router, search_router):
        app.include_router(router)
    app.state.job_service = JobService(PostgresJobRepository(runtime))
    app.state.population_pool = runtime
    app.state.age_pool = age
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://runtime") as client:
        admitted = await client.post("/v1/semantic-model-population/runs", json=run_request(),
                                     headers={"Idempotency-Key": "search-e2e-run"})
        assert admitted.status_code == 202, admitted.text
        task_id = await runtime.fetchval("SELECT id FROM semantic_jobs.tasks WHERE job_id = $1",
                                         admitted.json()["jobId"])
        await population_tasks._run_task(task_id, "e2e-population")
        result = json.loads(await runtime.fetchval(
            "SELECT result FROM semantic_jobs.jobs WHERE id = $1", admitted.json()["jobId"]))
        revision_id = result["dataRevisionId"]
        graphs.append(projection_graph_name(revision_id))

        # 1. The build requested the search index as its own durable job; nothing is searchable yet.
        index_task = await runtime.fetchrow(
            "SELECT id, queue_name FROM semantic_jobs.tasks WHERE task_name = 'semantic-model-search.index'")
        assert index_task["queue_name"] == "semantic-model-search.index"
        pending = (await client.post("/v1/semantic-model-search/query", json={
            "actorUserId": "user-e2e", "modelId": MODEL_ID, "environment": "draft",
            "query": "support agreement"})).json()
        assert pending["index"]["state"] == "queued" and pending["status"] == "index_not_ready"
        exact_before = (await client.post("/v1/semantic-model-search/query", json={
            "actorUserId": "user-e2e", "modelId": MODEL_ID, "environment": "draft",
            "query": "CT003"})).json()
        assert [seed["label"] for seed in exact_before["seeds"]] == ["CT003"]  # labels are the key values here
        assert exact_before["modeUsed"] == "exact_only"

        # 2. The real index worker builds every record's document and vector.
        outcome = await search_tasks._run_task(index_task["id"], "e2e-search")
        assert outcome["ok"] and outcome["state"] == "ready", outcome
        status = (await client.get(f"/v1/semantic-model-search/models/{MODEL_ID}/index")).json()
        assert status["dataRevisionId"] == revision_id
        assert status["index"]["state"] == "ready"
        assert status["index"]["expectedCount"] == 5
        assert status["index"]["indexedCount"] + status["index"]["exactOnlyCount"] == 5
        embedded_once = sum(calls)

        # 3. Asking again is free: the generation is ready and reused.
        again = (await client.post("/v1/semantic-model-search/indexes", json={
            "actorUserId": "user-e2e", "modelId": MODEL_ID, "environment": "draft"})).json()
        assert again["index"]["state"] == "ready" and again["index"]["indexId"] == status["index"]["indexId"]

        # 4. Words and vectors rank the support contract first; the key wins outright.
        def query(text: str, **extra) -> dict:  # type: ignore[no-untyped-def]
            return {"actorUserId": "user-e2e", "modelId": MODEL_ID, "environment": "draft",
                    "query": text, **extra}

        found = (await client.post("/v1/semantic-model-search/query", json=query("support agreement"))).json()
        assert found["status"] == "found" and found["modeUsed"] == "hybrid"
        assert found["seeds"][0]["label"] == "CT002"
        assert found["seeds"][0]["matchClass"] in ("hybrid", "lexical", "vector")
        assert found["seeds"][0]["provenance"][0]["assetId"] == CONTRACTS_ASSET
        exact = (await client.post("/v1/semantic-model-search/query", json=query("CT001"))).json()
        assert exact["seeds"][0]["matchClass"] == "exact"
        assert exact["seeds"][0]["label"] == "CT001"
        scoped = (await client.post("/v1/semantic-model-search/query",
                                    json=query("sony", concepts=["customer"]))).json()
        assert [seed["conceptId"] for seed in scoped["seeds"]] == ["c-customer"]
        absent = (await client.post("/v1/semantic-model-search/query",
                                    json=query("penalty", concepts=["penalty clause"]))).json()
        assert absent["status"] == "not_represented" and absent["unknownConcepts"] == ["penalty clause"]
        # Records read from a workspace the actor cannot read are never returned or ranked.
        hidden = (await client.post("/v1/semantic-model-search/query",
                                    json=query("support agreement", allowedWorkspaceIds=[]))).json()
        assert hidden["seeds"] == []
        visible = (await client.post("/v1/semantic-model-search/query",
                                     json=query("support agreement", allowedWorkspaceIds=[WORKSPACE_ID]))).json()
        assert visible["seeds"][0]["label"] == "CT002"

        # 5. From the customer, the real has_contract edges reach exactly its two contracts.
        sony = scoped["seeds"][0]["entityId"]
        expanded = (await client.post("/v1/semantic-model-search/expand", json={
            "actorUserId": "user-e2e", "modelId": MODEL_ID, "environment": "draft",
            "seedEntityIds": [sony], "steps": [{"relations": ["has_contract"], "direction": "outgoing"}]})).json()
        assert expanded["status"] == "found", expanded
        related = {node["label"]: node for node in expanded["nodes"] if node["inclusionReason"] == "relationship"}
        assert set(related) == {"CT001", "CT002"}
        assert related["CT001"]["path"][0]["relationKey"] == "has_contract"
        assert {(edge["sourceEntityId"], edge["relationKey"]) for edge in expanded["edges"]} == {(sony, "has_contract")}
        # Incoming from a contract finds its customer; the wrong direction finds nothing.
        contract = related["CT002"]["entityId"]
        back = (await client.post("/v1/semantic-model-search/expand", json={
            "actorUserId": "user-e2e", "modelId": MODEL_ID, "environment": "draft",
            "seedEntityIds": [contract], "steps": [{"direction": "incoming"}]})).json()
        assert [node["entityId"] for node in back["nodes"] if node["inclusionReason"] == "relationship"] == [sony]
        wrong = (await client.post("/v1/semantic-model-search/expand", json={
            "actorUserId": "user-e2e", "modelId": MODEL_ID, "environment": "draft",
            "seedEntityIds": [contract], "steps": [{"direction": "outgoing"}]})).json()
        assert [node["inclusionReason"] for node in wrong["nodes"]] == ["seed"]
        # Contract -> customer -> other contracts only when the second step names its relation.
        two_steps = {"actorUserId": "user-e2e", "modelId": MODEL_ID, "environment": "draft",
                     "seedEntityIds": [contract], "steps": [{"direction": "incoming"}, {"direction": "outgoing"}]}
        refused = await client.post("/v1/semantic-model-search/expand", json=two_steps)
        assert refused.status_code == 422 and refused.json()["detail"] == "relations_required_for_second_step"
        two_steps["steps"][1]["relations"] = ["has_contract"]
        siblings = (await client.post("/v1/semantic-model-search/expand", json=two_steps)).json()
        assert {node["label"] for node in siblings["nodes"]} == {
            "CT002", "C001", "CT001"}
        capped = (await client.post("/v1/semantic-model-search/expand", json={**two_steps, "maxNodes": 2})).json()
        assert capped["truncated"] is True and capped["status"] == "partial" and len(capped["nodes"]) == 2
        unknown = await client.post("/v1/semantic-model-search/expand", json={
            **two_steps, "steps": [{"relations": ["owns"]}]})
        assert unknown.status_code == 422 and unknown.json()["detail"] == "unknown_relation"
        # Nothing is published yet: production search says so.
        unpublished = await client.post("/v1/semantic-model-search/query",
                                        json={**query("sony"), "environment": "production"})
        assert unpublished.status_code == 404 and unpublished.json()["detail"] == "model_not_published"

    # 6. A rebuild of the same texts under a new generation reuses every vector: no model call.
    generation = await search_store.get_generation_by_id(runtime, status["index"]["indexId"])
    await runtime.execute("DELETE FROM semantic_graph_search.index_generations WHERE index_id = $1::uuid",
                          generation["index_id"])
    rebuilt = await search_store.create_generation(
        runtime, model_id=MODEL_ID, data_revision_id=revision_id, projection_ref=generation["projection_ref"],
        spec_hash=generation["spec_hash"], fingerprint=generation["embedding_fingerprint"])

    async def report(_progress: dict) -> None:
        return None

    outcome = await indexer.build_index(runtime, index_id=rebuilt["index_id"], owner="e2e-rebuild",
                                        report=report)
    assert outcome["state"] == "ready" and outcome["embedded"] == 0
    assert outcome["reused"] == status["index"]["indexedCount"]
    assert sum(calls) == embedded_once + 5  # only the query embeddings of step 4
