"""The whole population MVP in one test: a run request, the real worker task, the
canonical revision, the AGE graph, the draft binding, and the Records and Graph
endpoints reading the same revision.

Only the Workspace asset download is replaced (it needs the YellowStorm back end);
the parsers, the population, Postgres and AGE are real. Needs both test databases:
SEMANTIC_RUNTIME_TEST_DATABASE_URL (dropped and rebuilt) and
SEMANTIC_AGEGRAPH_TEST_DATABASE_URL (only the graph of this run is created and dropped).
"""

from __future__ import annotations

import io
import json
import os
from pathlib import Path

import asyncpg
import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI

from app.api.job_routes import router as job_router
from app.api.population_routes import router as population_router
from app.jobs.service import JobService
from app.persistence import population_store as store
from app.persistence.postgres_jobs import PostgresJobRepository
from app.population.age_projection import (drop_projection, projection_exists,
                                           projection_graph_name, read_projection_graph)
from app.population.compiler import canonical_spec_hash

RUNTIME_DSN = os.environ.get("SEMANTIC_RUNTIME_TEST_DATABASE_URL")
AGE_DSN = os.environ.get("SEMANTIC_AGEGRAPH_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not (RUNTIME_DSN and AGE_DSN),
                                reason="SEMANTIC_RUNTIME_TEST_DATABASE_URL and SEMANTIC_AGEGRAPH_TEST_DATABASE_URL not set")
MIGRATIONS = sorted((Path(__file__).resolve().parents[1] / "migrations").glob("*.sql"))
AGE_SETTINGS = {"search_path": 'ag_catalog, "$user", public'}

MODEL_ID = "7f1d2c3b-0000-4000-8000-00000000e2e1"
WORKSPACE_ID = "6512f0a1c9e77a0012340001"
CUSTOMERS_ASSET = "6512f0a1c9e77a00123400c1"
CONTRACTS_ASSET = "6512f0a1c9e77a00123400c2"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

SPECIFICATION = {
    "modelId": MODEL_ID, "modelVersionId": "v-e2e", "homeWorkspaceId": WORKSPACE_ID,
    "concepts": [
        {"conceptId": "c-customer", "key": "customer", "label": "Customer",
         "identity": {"namespace": "crm", "keyComponents": ["customer_id"]},
         "populationMode": "materialized", "allowedFields": ["customer_id", "name"]},
        {"conceptId": "c-contract", "key": "contract", "label": "Contract",
         "identity": {"namespace": "contracts", "keyComponents": ["contract_id"]},
         "populationMode": "materialized", "allowedFields": ["contract_id", "customer_id", "title"]},
    ],
    "relations": [
        {"relationId": "r-has-contract", "key": "has_contract", "label": "has contract",
         "sourceConceptId": "c-customer", "targetConceptId": "c-contract",
         "cardinality": "one_to_many", "matchingStrategy": "normalized"},
    ],
    "sourceScope": [{"workspaceId": WORKSPACE_ID, "assetId": CUSTOMERS_ASSET},
                    {"workspaceId": WORKSPACE_ID, "assetId": CONTRACTS_ASSET}],
}


def customers_xlsx() -> bytes:
    from openpyxl import Workbook

    book = Workbook()
    sheet = book.active
    sheet.title = "Customers"
    for row in (["customer_id", "name"], ["C001", "Sony"], ["C002", "Carrefour"]):
        sheet.append(row)
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


CONTRACTS_CSV = ("contract_id,customer_id,title\n"
                 "CT001,C001,Sony Master Agreement\n"
                 "CT002,C001,Sony Support Agreement\n"
                 "CT003,C002,Carrefour Supply Agreement\n").encode()


def run_request() -> dict:
    return {
        "actorUserId": "user-e2e", "modelId": MODEL_ID, "workspaceId": WORKSPACE_ID,
        "payload": {
            "modelVersionId": "v-e2e", "specHash": canonical_spec_hash(SPECIFICATION),
            "purpose": "build", "scope": {"kind": "model"}, "specification": SPECIFICATION,
            "sources": [
                {"conceptId": "c-customer", "mappingVersion": "map-customers-v1", "options": {"sheetName": "Customers"},
                 "source": {"workspaceId": WORKSPACE_ID, "assetId": CUSTOMERS_ASSET, "mimeType": XLSX,
                            "originalName": "customers.xlsx", "contentHash": "sha256:" + "1" * 64},
                 "columnMapping": {"customer_id": "customer_id", "name": "name"}},
                {"conceptId": "c-contract", "mappingVersion": "map-contracts-v1", "options": {},
                 "source": {"workspaceId": WORKSPACE_ID, "assetId": CONTRACTS_ASSET, "mimeType": "text/csv",
                            "originalName": "contracts.csv", "contentHash": "sha256:" + "2" * 64},
                 "columnMapping": {"contract_id": "contract_id", "customer_id": "customer_id", "title": "title"}},
            ],
            # A join on a plain Contract field, not on its identity.
            "relationBindings": [{"relationId": "r-has-contract", "referenceField": "customer_id",
                                  "targetField": "customer_id"}],
        },
    }


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
    age = await asyncpg.create_pool(AGE_DSN, min_size=1, max_size=2, server_settings=AGE_SETTINGS)
    graphs: list[str] = []
    yield runtime, age, graphs
    async with age.acquire() as age_connection:
        for graph in graphs:
            if await projection_exists(age_connection, graph):
                await drop_projection(age_connection, graph)
    await age.close()
    await runtime.close()


@pytest.mark.asyncio
async def test_a_run_builds_records_and_the_graph_from_the_same_revision(pools, monkeypatch: pytest.MonkeyPatch):
    runtime, age, graphs = pools
    import app.datasource.asset_delivery as asset_delivery
    import app.workers.population_tasks as tasks

    files = {CUSTOMERS_ASSET: customers_xlsx(), CONTRACTS_ASSET: CONTRACTS_CSV}

    async def fetch(source: dict, _actor: str, **_kwargs) -> bytes:
        return files[source["assetId"]]

    monkeypatch.setattr(asset_delivery, "fetch_workspace_asset", fetch)
    monkeypatch.setenv("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED", "true")
    monkeypatch.setenv("SEMANTIC_RUNTIME_DATABASE_URL", RUNTIME_DSN)
    monkeypatch.setenv("SEMANTIC_AGEGRAPH_DATABASE_URL", AGE_DSN)

    app = FastAPI()
    app.include_router(population_router)
    app.include_router(job_router)
    app.state.job_service = JobService(PostgresJobRepository(runtime))
    app.state.population_pool = runtime
    app.state.age_pool = age
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://runtime") as client:
        # 1. The run request is admitted as a durable job.
        admitted = await client.post("/v1/semantic-model-population/runs", json=run_request(),
                                     headers={"Idempotency-Key": "e2e-run-1"})
        assert admitted.status_code == 202, admitted.text
        job_id = admitted.json()["jobId"]
        task_id = await runtime.fetchval("SELECT id FROM semantic_jobs.tasks WHERE job_id = $1", job_id)

        # 2. The real worker task reads both files, populates, saves and projects.
        await tasks._run_task(task_id, "e2e-worker")
        job = await runtime.fetchrow("SELECT state, result FROM semantic_jobs.jobs WHERE id = $1", job_id)
        assert job["state"] == "completed", job
        result = job["result"] if isinstance(job["result"], dict) else json.loads(job["result"])
        revision_id = result["dataRevisionId"]
        graphs.append(projection_graph_name(revision_id))
        assert result["servingDecision"] == "activate"
        assert result["boundEnvironment"] == "draft"

        # 3. Canonical state: 2 customers + 3 contracts, 3 links.
        assert await store.count_revision_rows(runtime, revision_id) == {
            "entities": 5, "assertions": result["assertionCount"], "relationships": 3}

        # 4. The draft binding serves this revision and its AGE graph.
        binding = await store.get_active_binding(runtime, MODEL_ID, "draft")
        assert binding["data_revision_id"] == revision_id
        graph = await read_projection_graph(age, binding["projection_ref"])
        assert len(graph["nodes"]) == 5
        assert len(graph["edges"]) == 3

        # 5. Records and Graph endpoints answer from the same revision.
        records = (await client.get(f"/v1/semantic-model-population/models/{MODEL_ID}/records",
                                    params={"limit": 50})).json()
        served = (await client.get(f"/v1/semantic-model-population/models/{MODEL_ID}/graph")).json()
    assert records["dataRevisionId"] == revision_id == served["dataRevisionId"]
    assert records["counts"]["entities"] == 5
    assert records["conceptCounts"] == {"c-customer": 2, "c-contract": 3}
    assert len(served["nodes"]) == 5 and len(served["edges"]) == 3

    # Links: Sony has two contracts, Carrefour one.
    labels = {node["id"]: node for node in served["nodes"]}
    by_customer: dict[str, set[str]] = {}
    for edge in served["edges"]:
        source, target = labels[edge["sourceId"]], labels[edge["targetId"]]
        by_customer.setdefault(source["properties"]["name"], set()).add(target["properties"]["title"])
    assert by_customer == {"Sony": {"Sony Master Agreement", "Sony Support Agreement"},
                           "Carrefour": {"Carrefour Supply Agreement"}}
    # Key fields show on the graph nodes, not only in the canonical identity.
    customers = [node for node in served["nodes"] if node["properties"]["concept_id"] == "c-customer"]
    assert sorted(str(node["properties"]["customer_id"]).upper() for node in customers) == ["C001", "C002"]
