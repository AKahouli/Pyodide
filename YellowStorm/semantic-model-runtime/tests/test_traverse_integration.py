"""Walks over the stored links on a real Postgres: fields and groups of records several
links away, walks with conditions at each step and repeated steps, visibility at every
step (a hidden record never links two others), and the shortest chains between two
records over the AGE graph.

A mailbox: a Message has participants (Participation), each designating a Correspondent;
a Message states Facts; a Correspondent reports to another.

Needs SEMANTIC_RUNTIME_TEST_DATABASE_URL (its runtime schemas are dropped and rebuilt);
the connect test also needs SEMANTIC_AGEGRAPH_TEST_DATABASE_URL (only its graph is
created and dropped).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

import asyncpg
import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI

import app.api.graph_search_routes as routes
from app.graph_search.traversal import init_age_connection
from app.persistence.partitions import ensure_revision_partitions
from app.population.age_projection import drop_projection, projection_exists, projection_graph, reproject_revision

DSN = os.environ.get("SEMANTIC_RUNTIME_TEST_DATABASE_URL")
AGE_DSN = os.environ.get("SEMANTIC_AGEGRAPH_TEST_DATABASE_URL")
AGE_SETTINGS = {"search_path": 'ag_catalog, "$user", public'}
pytestmark = pytest.mark.skipif(not DSN, reason="SEMANTIC_RUNTIME_TEST_DATABASE_URL not set")
ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((ROOT / "migrations").glob("*.sql"))
SCHEMAS = ("semantic_jobs", "semantic_datasource", "semantic_runtime", "semantic_population",
           "semantic_graph_search", "semantic_model")

MODEL, VERSION, REVISION = "model-walk", "version-1", "dr_walk01"
SPEC_HASH = "sha256:" + "d" * 64
NOW = datetime(2026, 10, 6, 12, 0, tzinfo=timezone.utc)


def concept(concept_id: str, key: str, label: str, fields: list[str]) -> dict:
    return {"conceptId": concept_id, "key": key, "label": label, "populationMode": "materialized",
            "identity": {"namespace": key, "keyComponents": ["code"]}, "allowedFields": ["code", *fields]}


def relation(relation_id: str, key: str, source: str, target: str) -> dict:
    return {"relationId": relation_id, "key": key, "sourceConceptId": source, "targetConceptId": target,
            "cardinality": "many_to_many", "matchingStrategy": "exact"}


SPEC = {
    "modelId": MODEL, "modelVersionId": VERSION, "homeWorkspaceId": "ws1", "sourceScope": [],
    "concepts": [concept("c-msg", "message", "Message", ["subject"]),
                 concept("c-part", "participation", "Participation", ["role"]),
                 concept("c-corr", "correspondent", "Correspondant", ["domain"]),
                 concept("c-fact", "fact", "Fait", ["text"])],
    "relations": [relation("r-part", "has_participant", "c-msg", "c-part"),
                  relation("r-des", "designates", "c-part", "c-corr"),
                  relation("r-states", "states", "c-msg", "c-fact"),
                  relation("r-reports", "reports_to", "c-corr", "c-corr")],
}
CATALOG = {
    "concepts": [
        {"key": "message", "label": "Message", "fields": [{"key": "subject", "label": "Sujet", "type": "text"}]},
        {"key": "participation", "label": "Participation", "fields": [{"key": "role", "label": "Rôle", "type": "text"}]},
        {"key": "correspondent", "label": "Correspondant",
         "fields": [{"key": "domain", "label": "Domaine", "type": "text"}]},
        {"key": "fact", "label": "Fait", "fields": [{"key": "text", "label": "Texte", "type": "text"}]},
    ],
    "relations": [{"key": "has_participant", "label": "a pour participant", "inverseLabel": "participe à"},
                  {"key": "designates", "label": "désigne", "inverseLabel": "désigné par"},
                  {"key": "states", "label": "énonce", "inverseLabel": "énoncé par"},
                  {"key": "reports_to", "label": "rend compte à", "inverseLabel": "encadre"}],
}
# id, concept, label, attributes, workspace
RECORDS = [
    ("msg:1", "c-msg", "Contrat Acme", {"subject": "Contrat Acme"}, "ws1"),
    ("msg:2", "c-msg", "Relance", {"subject": "Relance"}, "ws1"),
    ("msg:3", "c-msg", "Pénalités", {"subject": "Pénalités"}, "ws1"),
    ("part:1", "c-part", "M1 Alice", {"role": "from"}, "ws1"),
    ("part:2", "c-part", "M1 Bob", {"role": "to"}, "ws1"),
    ("part:3", "c-part", "M2 Bob", {"role": "from"}, "ws1"),
    ("part:4", "c-part", "M3 Carol", {"role": "from"}, "ws2"),  # hidden from ws1 readers
    ("part:5", "c-part", "M3 Alice", {"role": "to"}, "ws1"),
    ("corr:alice", "c-corr", "Alice", {"domain": "acme.com"}, "ws1"),
    ("corr:bob", "c-corr", "Bob", {"domain": "other.org"}, "ws1"),
    ("corr:carol", "c-corr", "Carol", {"domain": "acme.com"}, "ws1"),
    ("corr:dan", "c-corr", "Dan", {"domain": "other.org"}, "ws1"),
    ("fact:1", "c-fact", "F1", {"text": "Une clause de pénalité s'applique"}, "ws1"),
    ("fact:2", "c-fact", "F2", {"text": "Livraison le 3 mars"}, "ws1"),
    ("fact:3", "c-fact", "F3", {"text": "Les pénalités courent"}, "ws1"),
    ("fact:4", "c-fact", "F4", {"text": "Pénalité de retard"}, "ws1"),
]
LINKS = [
    ("r-part", "msg:1", "part:1"), ("r-part", "msg:1", "part:2"), ("r-part", "msg:2", "part:3"),
    ("r-part", "msg:3", "part:4"), ("r-part", "msg:3", "part:5"),
    ("r-des", "part:1", "corr:alice"), ("r-des", "part:2", "corr:bob"), ("r-des", "part:3", "corr:bob"),
    ("r-des", "part:4", "corr:carol"), ("r-des", "part:5", "corr:alice"),
    ("r-states", "msg:1", "fact:1"), ("r-states", "msg:1", "fact:2"), ("r-states", "msg:2", "fact:3"),
    ("r-states", "msg:3", "fact:4"),
    ("r-reports", "corr:dan", "corr:bob"), ("r-reports", "corr:bob", "corr:alice"),
]
# Correspondant -> Participation -> Message -> Fait
TO_FACTS = [{"relation": "désigne"}, {"relation": "a pour participant"}, {"relation": "énonce"}]


@pytest_asyncio.fixture
async def pool():
    assert DSN
    connection = await asyncpg.connect(DSN)
    try:
        for schema in SCHEMAS:
            await connection.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        for migration in MIGRATIONS:
            await connection.execute(migration.read_text(encoding="utf-8"))
        await connection.execute(
            "INSERT INTO semantic_runtime.specifications (home_workspace_id, model_id, model_version_id, spec_hash, "
            "specification) VALUES ('ws1', $1, $2, $3, $4::jsonb)", MODEL, VERSION, SPEC_HASH, json.dumps(SPEC))
        await connection.execute(
            "INSERT INTO semantic_population.data_revisions (id, model_id, model_version_id, spec_hash, projection_ref) "
            "VALUES ($1, $2, $3, $4, $5)", REVISION, MODEL, VERSION, SPEC_HASH, f"age:v1:pop_{REVISION}")
        await ensure_revision_partitions(connection, REVISION)
        await connection.execute(
            "INSERT INTO semantic_runtime.active_bindings (model_id, environment, model_version_id, "
            "data_revision_id, projection_ref) VALUES ($1, 'production', $2, $3, $4)",
            MODEL, VERSION, REVISION, f"age:v1:pop_{REVISION}")
        await connection.executemany(
            "INSERT INTO semantic_population.entities (id, model_id, data_revision_id, concept_id, namespace, "
            "identity_key, label, attributes, provenance) VALUES ($1, $2, $3, $4, 'ns', $5, $6, $7::jsonb, $8::jsonb)",
            [(entity_id, MODEL, REVISION, concept_id, json.dumps({"code": entity_id}), label, json.dumps(values),
              json.dumps({"sources": [{"assetRef": {"assetId": "a-1", "workspaceId": workspace}}]}))
             for entity_id, concept_id, label, values, workspace in RECORDS])
        await connection.executemany(
            "INSERT INTO semantic_population.relationships (model_id, data_revision_id, relation_id, "
            "source_entity_id, target_entity_id) VALUES ($1, $2, $3, $4, $5)",
            [(MODEL, REVISION, *link) for link in LINKS])
    finally:
        await connection.close()
    value = await asyncpg.create_pool(DSN, min_size=1, max_size=4)
    yield value
    await value.close()


PINNED = {"actorUserId": "u-1", "modelId": MODEL, "environment": "production", "allowedWorkspaceIds": ["ws1"],
          "catalog": CATALOG}


async def post(pool, path: str, body: dict, age=None) -> dict:  # type: ignore[no-untyped-def]
    app = FastAPI()
    app.include_router(routes.router)
    app.state.population_pool = pool
    app.state.age_pool = age
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://runtime") as client:
        response = await client.post(f"/v1/semantic-model-search/{path}", json={**PINNED, **body})
    assert response.status_code == 200, response.text
    return response.json()


def names(result: dict) -> list[str]:
    return sorted(record["name"] for record in result["records"])


@pytest.mark.asyncio
async def test_a_walk_counts_the_facts_per_correspondent(pool) -> None:  # type: ignore[no-untyped-def]
    result = await post(pool, "traverse", {"start": {"concept": "Correspondant"}, "steps": TO_FACTS,
                                           "groupBy": [{"field": "name", "step": 0}]})
    assert result["status"] == "ok", result
    assert result["concept"]["label"] == "Fait"
    # Alice: M1 (F1, F2) and M3 (F4); Bob: M1 and M2 (F3). Carol's participation is hidden: no bridge.
    groups = {bucket["start.name"]: bucket["count"] for bucket in result["buckets"]}
    assert groups == {"Alice": 3, "Bob": 3}
    assert {bucket["entityIds"]["start.name"] for bucket in result["buckets"]} == {"corr:alice", "corr:bob"}
    assert result["groupsOverlap"] is True and result["total"] == 4
    assert [step["concept"] for step in result["appliedQuery"]["path"]["steps"]] == ["Participation", "Message", "Fait"]


@pytest.mark.asyncio
async def test_conditions_at_each_step_and_on_the_records_reached(pool) -> None:  # type: ignore[no-untyped-def]
    steps = [{"relation": "désigne", "filters": [{"field": "Rôle", "op": "eq", "value": "from"}]},
             {"relation": "a pour participant"},
             {"relation": "énonce", "filters": [{"field": "Texte", "op": "contains", "value": "penalite"}]}]
    result = await post(pool, "traverse", {"start": {"concept": "Correspondant", "filters": [
        {"field": "Domaine", "op": "eq", "value": "ACME.com"}]}, "steps": steps})
    # Alice sent M1 only (she received M3): its penalty fact. Carol sent M3 through a hidden participation.
    assert names(result) == ["F1"] and result["total"] == 1
    everyone = await post(pool, "traverse", {"start": {"concept": "Correspondant", "filters": [
        {"field": "Domaine", "op": "eq", "value": "acme.com"}]}, "steps": steps, "allowedWorkspaceIds": None})
    assert names(everyone) == ["F1", "F4"]
    started = await post(pool, "traverse", {"start": {"concept": "Correspondant", "recordIds": ["corr:bob"]},
                                            "steps": TO_FACTS, "limit": 0})
    assert started["total"] == 3 and started["records"] == []


@pytest.mark.asyncio
async def test_a_repeated_step_follows_a_chain_of_one_concept(pool) -> None:  # type: ignore[no-untyped-def]
    up = await post(pool, "traverse", {"start": {"concept": "Correspondant", "recordIds": ["corr:dan"]},
                                       "steps": [{"relation": "rend compte à", "minHops": 1, "maxHops": 3}]})
    assert names(up) == ["Alice", "Bob"]
    down = await post(pool, "traverse", {"start": {"concept": "Correspondant", "recordIds": ["corr:alice"]},
                                         "steps": [{"relation": "encadre", "maxHops": 2}]})
    assert names(down) == ["Bob", "Dan"]
    once = await post(pool, "traverse", {"start": {"concept": "Correspondant", "recordIds": ["corr:alice"]},
                                         "steps": [{"relation": "reports_to", "direction": "incoming"}]})
    assert names(once) == ["Bob"]
    bad = await post(pool, "traverse", {"start": {"concept": "Message"},
                                        "steps": [{"relation": "énonce", "maxHops": 2}]})
    assert bad["status"] == "invalid_query" and bad["errors"][0]["part"] == "steps[0].hops"


@pytest.mark.asyncio
async def test_fields_and_groups_several_links_away_in_query_records(pool) -> None:  # type: ignore[no-untyped-def]
    acme = await post(pool, "records-query", {"concept": "Fait", "filters": [
        {"field": "énonce.a pour participant.désigne.Domaine", "op": "eq", "value": "acme.com"}]})
    assert names(acme) == ["F1", "F2", "F4"]
    assert acme["appliedQuery"]["filters"][0]["relationLabel"] == "énonce > a pour participant > désigne"
    per_subject = await post(pool, "records-query", {"concept": "Fait", "groupBy": [{"field": "énonce.Sujet"}]})
    assert {bucket["states.subject"]: bucket["count"] for bucket in per_subject["buckets"]} == {
        "Contrat Acme": 2, "Relance": 1, "Pénalités": 1}
    linked = await post(pool, "records-query", {"concept": "Fait", "linkedTo": [
        {"relation": "énonce.a pour participant", "recordIds": ["part:3"]}]})
    assert names(linked) == ["F3"]
    nobody = await post(pool, "records-query", {"concept": "Correspondant", "filters": [
        {"field": "désigné par.participe à", "op": "is_empty"}]})
    assert names(nobody) == ["Carol", "Dan"]  # Carol's only participation is hidden


@pytest.mark.asyncio
async def test_an_empty_walk_says_why(pool) -> None:  # type: ignore[no-untyped-def]
    result = await post(pool, "traverse", {"start": {"concept": "Correspondant", "filters": [
        {"field": "Domaine", "op": "eq", "value": "acme.cmo"}]}, "steps": TO_FACTS})
    assert result["total"] == 0
    diagnostics = result["diagnostics"]
    assert diagnostics["startRecords"] == 0
    assert diagnostics["start"]["checks"][0]["didYouMean"] == ["acme.com"]
    wrong = await post(pool, "traverse", {"start": {"concept": "Correspondant"},
                                          "steps": [{"relation": "énonce"}]})
    assert wrong["status"] == "invalid_query" and wrong["errors"][0]["part"] == "steps[0].relation"
    assert "désigné par" in wrong["errors"][0]["available"]


@pytest.mark.asyncio
@pytest.mark.skipif(not AGE_DSN, reason="SEMANTIC_AGEGRAPH_TEST_DATABASE_URL not set")
async def test_the_shortest_chains_between_two_records(pool) -> None:  # type: ignore[no-untyped-def]
    age = await asyncpg.create_pool(AGE_DSN, min_size=1, max_size=2, server_settings=AGE_SETTINGS,
                                    init=init_age_connection)
    graph = None
    try:
        built = await reproject_revision(pool, age, REVISION, force=True)
        graph = projection_graph(built["projectionRef"])
        result = await post(pool, "connect", {"fromEntityId": "corr:alice", "toEntityId": "corr:bob"}, age)
        assert result["status"] == "connected" and result["links"] == 1  # Bob reports to Alice
        assert result["paths"][0]["steps"][0]["direction"] == "incoming"
        via_mail = await post(pool, "connect", {"fromEntityId": "corr:alice", "toEntityId": "fact:3",
                                                "relations": ["désigne", "a pour participant", "énonce"]}, age)
        # Alice -> part:1 -> msg:1 -> part:2 -> Bob -> part:3 -> msg:2 -> F3 is 7 links: more than 4.
        assert via_mail["status"] == "not_connected" and via_mail["searchedLinks"] == 4
        far = await post(pool, "connect", {"fromEntityId": "corr:alice", "toEntityId": "fact:3", "maxLinks": 6,
                                           "relations": ["désigne", "a pour participant", "énonce", "reports_to"]}, age)
        assert far["status"] == "connected" and far["links"] == 4  # through Bob, who reports to Alice
        assert far["paths"][0]["records"] == ["corr:alice", "corr:bob", "part:3", "msg:2", "fact:3"]
        # Carol is reached only through a hidden participation: no chain for a ws1 reader.
        hidden = await post(pool, "connect", {"fromEntityId": "corr:carol", "toEntityId": "msg:3",
                                              "relations": ["désigne", "a pour participant"]}, age)
        assert hidden["status"] == "not_connected" and hidden["truncated"] is False
        seen = await post(pool, "connect", {"fromEntityId": "corr:carol", "toEntityId": "msg:3",
                                            "allowedWorkspaceIds": None}, age)
        assert seen["status"] == "connected" and seen["links"] == 2
        assert [step["relationKey"] for step in seen["paths"][0]["steps"]] == ["designates", "has_participant"]
    finally:
        if graph:
            async with age.acquire() as connection:
                if await projection_exists(connection, graph):
                    await drop_projection(connection, graph)
        await age.close()
