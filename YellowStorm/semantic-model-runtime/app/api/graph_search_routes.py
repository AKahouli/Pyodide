"""Graph search API: find records of a model's bound data, then follow their links.

Every request pins one binding (draft or production) and answers from that
single data revision, its AGE graph and the search index built for it. The
caller (NestJS) has already authorized the actor and passes the workspaces the
actor may read; a record read from any other workspace is never returned,
ranked or used as a bridge. Reads never build anything: a missing index is
requested (a durable job) and the answer says so.
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import Any, Literal

import asyncpg
from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.graph_search.embeddings import profile_from_env
from app.graph_search.indexer import IndexUnavailable, request_index, request_index_quietly
from app.graph_search.record_query import compile_query, overview, run_query
from app.graph_search.retrieval import find_seeds, resolve_concepts, resolve_relations
from app.graph_search.traversal import MAX_STEPS, expand
from app.persistence import graph_search_store as search_store
from app.persistence import population_store as store
from app.population.age_projection import is_live_projection_ref
from app.population.compiler import PopulationError, compile_specification

router = APIRouter(prefix="/v1/semantic-model-search", tags=["graph-search"])

Environment = Literal["draft", "production"]


class _Pinned(BaseModel):
    model_config = ConfigDict(extra="forbid")

    actor_user_id: str = Field(alias="actorUserId", min_length=1, max_length=200)
    model_id: str = Field(alias="modelId", min_length=1, max_length=200)
    environment: Environment = "production"
    allowed_workspace_ids: list[str] | None = Field(default=None, alias="allowedWorkspaceIds",
                                                    max_length=2000)
    expected_data_revision_id: str | None = Field(default=None, alias="expectedDataRevisionId",
                                                  max_length=200)


class SearchQuery(_Pinned):
    query: str = Field(min_length=1, max_length=500)
    concepts: list[str] | None = Field(default=None, max_length=10)
    limit: int = Field(default=10, ge=1, le=25)

    @field_validator("query")
    @classmethod
    def not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("query is blank")
        return value


class ExpandStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    relations: list[str] | None = Field(default=None, max_length=20)
    direction: Literal["outgoing", "incoming", "both"] = "both"
    concepts: list[str] | None = Field(default=None, max_length=10)


class ExpandQuery(_Pinned):
    seed_entity_ids: list[str] = Field(alias="seedEntityIds", min_length=1, max_length=25)
    steps: list[ExpandStep] = Field(min_length=1, max_length=MAX_STEPS)
    max_nodes: int = Field(default=50, alias="maxNodes", ge=1, le=100)


class RecordFilter(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    field: str = Field(max_length=300)
    op: str = Field(max_length=30)
    value: Any = None
    as_: str | None = Field(default=None, alias="as", max_length=20)


class GroupBy(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    field: str = Field(max_length=300)
    bucket: str | None = Field(default=None, max_length=20)
    as_: str | None = Field(default=None, alias="as", max_length=20)


class Aggregate(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    op: str = Field(max_length=30)
    field: str | None = Field(default=None, max_length=300)
    as_: str | None = Field(default=None, alias="as", max_length=20)


class OrderBy(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    field: str = Field(max_length=300)
    direction: str = Field(default="asc", max_length=10)
    as_: str | None = Field(default=None, alias="as", max_length=20)


class CatalogField(BaseModel):
    """A field definition from the model (NestJS): what a query may call it, and its type."""
    model_config = ConfigDict(extra="ignore")

    key: str = Field(min_length=1, max_length=200)
    label: str | None = Field(default=None, max_length=300)
    type: str | None = Field(default=None, max_length=20)
    aliases: list[str] | None = Field(default=None, max_length=50)


class CatalogConcept(BaseModel):
    model_config = ConfigDict(extra="ignore")

    key: str = Field(min_length=1, max_length=200)
    label: str | None = Field(default=None, max_length=300)
    aliases: list[str] | None = Field(default=None, max_length=50)
    fields: list[CatalogField] = Field(default_factory=list, max_length=1000)


class CatalogRelation(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    key: str = Field(min_length=1, max_length=200)
    label: str | None = Field(default=None, max_length=300)
    inverse_label: str | None = Field(default=None, alias="inverseLabel", max_length=300)


class Catalog(BaseModel):
    model_config = ConfigDict(extra="ignore")

    concepts: list[CatalogConcept] = Field(default_factory=list, max_length=500)
    relations: list[CatalogRelation] = Field(default_factory=list, max_length=1000)


class RecordsQuery(_Pinned):
    """Checked part by part by ``compile_query``; here only sizes are bounded."""
    concept: str = Field(min_length=1, max_length=300)
    filters: list[RecordFilter] = Field(default_factory=list, max_length=50)
    match: str = Field(default="all", max_length=10)
    group_by: list[GroupBy] = Field(default_factory=list, alias="groupBy", max_length=10)
    aggregates: list[Aggregate] = Field(default_factory=list, max_length=30)
    order_by: list[OrderBy] = Field(default_factory=list, alias="orderBy", max_length=10)
    fields: list[str] | None = Field(default=None, max_length=200)
    limit: int = 50
    offset: int = 0
    catalog: Catalog = Field(default_factory=Catalog)


class OverviewQuery(_Pinned):
    pass


class IndexCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    actor_user_id: str = Field(alias="actorUserId", min_length=1, max_length=200)
    model_id: str = Field(alias="modelId", min_length=1, max_length=200)
    environment: Environment = "draft"


def _pool(request: Request):  # type: ignore[no-untyped-def]
    pool = getattr(request.app.state, "population_pool", None)
    if pool is None:
        raise HTTPException(status_code=503, detail="population_store_unavailable")
    return pool


def _admit(request: Request):  # type: ignore[no-untyped-def]
    """Job admission when this runtime may write; None makes index requests read-only."""
    service = getattr(request.app.state, "job_service", None)
    if service is None or os.environ.get("SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED") != "true":
        return None
    return service.admit


async def _pin(pool, model_id: str, environment: str, expected: str | None) -> dict:  # type: ignore[no-untyped-def]
    binding = await store.get_active_binding(pool, model_id, environment)
    if binding is None:
        raise HTTPException(status_code=404, detail="model_not_published" if environment == "production"
                            else "active_binding_not_found")
    if expected is not None and expected != binding["data_revision_id"]:
        raise HTTPException(status_code=409, detail="active_binding_changed")
    if not is_live_projection_ref(binding["projection_ref"]):
        raise HTTPException(status_code=409, detail="revision_not_projected")
    return binding


async def _compiled(pool, revision_id: str) -> dict:  # type: ignore[no-untyped-def]
    specification = await store.get_revision_specification(pool, revision_id)
    if specification is None:
        raise HTTPException(status_code=409, detail="revision_specification_not_found")
    return compile_specification(specification)


def _pinned(binding: dict, environment: str) -> dict:
    return {"modelId": binding["model_id"], "environment": environment,
            "modelVersionId": binding["model_version_id"],
            "dataRevisionId": binding["data_revision_id"], "projectionRef": binding["projection_ref"]}


@router.post("/query", status_code=status.HTTP_200_OK)
async def search_records(command: SearchQuery, request: Request) -> dict[str, object]:
    pool = _pool(request)
    binding = await _pin(pool, command.model_id, command.environment, command.expected_data_revision_id)
    revision_id = binding["data_revision_id"]
    compiled = await _compiled(pool, revision_id)
    concepts, unknown = resolve_concepts(compiled, command.concepts)
    profile = profile_from_env()
    generation = (await search_store.get_generation(pool, revision_id, profile.fingerprint)
                  if profile is not None else None)
    if profile is not None and (generation is None or generation["state"] == "failed"):
        await request_index_quietly(pool, _admit(request), revision_id)
        generation = await search_store.get_generation(pool, revision_id, profile.fingerprint)
    index = search_store.public_generation(generation)
    if profile is None:
        index["state"] = "unavailable"
    base = {**_pinned(binding, command.environment), "index": index, "concepts": concepts,
            "unknownConcepts": unknown,
            "coverage": {"expectedCount": index.get("expectedCount"),
                         "indexedCount": index.get("indexedCount"),
                         "exactOnlyCount": index.get("exactOnlyCount"),
                         "passageCount": index.get("passageCount"),
                         "passageIndexedCount": index.get("passageIndexedCount"),
                         "passageTruncatedCount": index.get("passageTruncatedCount")}}
    if command.concepts and not concepts:
        # Every named concept is absent from the model: the data cannot hold the answer.
        return {**base, "modeUsed": "exact_only", "status": "not_represented", "seeds": [],
                "timings": {"embedMs": 0, "seedMs": 0}}
    found = await find_seeds(
        pool, revision_id=revision_id, compiled=compiled, query=command.query,
        concept_ids=[concept["conceptId"] for concept in concepts] or None, limit=command.limit,
        allowed_workspaces=command.allowed_workspace_ids, generation=generation, profile=profile)
    if found["seeds"]:
        outcome = "found"
    elif generation is None or generation["state"] != "ready":
        outcome = "index_not_ready"
    else:
        outcome = "no_match"
    return {**base, **found, "status": outcome}


@router.post("/expand", status_code=status.HTTP_200_OK)
async def expand_records(command: ExpandQuery, request: Request) -> dict[str, object]:
    pool = _pool(request)
    age_pool = getattr(request.app.state, "age_pool", None)
    if age_pool is None:
        raise HTTPException(status_code=503, detail="age_projection_unavailable")
    binding = await _pin(pool, command.model_id, command.environment, command.expected_data_revision_id)
    compiled = await _compiled(pool, binding["data_revision_id"])
    steps = []
    for index, step in enumerate(command.steps):
        if index > 0 and not step.relations:
            # Following every link twice reaches unrelated records through shared ones.
            raise HTTPException(status_code=422, detail="relations_required_for_second_step")
        relations, unknown = resolve_relations(compiled, step.relations or [])
        if unknown:
            raise HTTPException(status_code=422, detail="unknown_relation")
        concepts, unknown_concepts = resolve_concepts(compiled, step.concepts)
        if unknown_concepts:
            raise HTTPException(status_code=422, detail="unknown_concept")
        steps.append({"relations": relations or None, "direction": step.direction,
                      "conceptIds": [concept["conceptId"] for concept in concepts] or None})
    try:
        result = await expand(pool, age_pool, revision_id=binding["data_revision_id"],
                              projection_ref=binding["projection_ref"], compiled=compiled,
                              seed_ids=command.seed_entity_ids, steps=steps,
                              max_nodes=command.max_nodes,
                              allowed_workspaces=command.allowed_workspace_ids)
    except PopulationError as exc:
        raise HTTPException(status_code=409, detail=exc.code) from exc
    if not result["nodes"]:
        outcome = "no_match"
    elif result["truncated"]:
        outcome = "partial"
    else:
        outcome = "found"
    return {**_pinned(binding, command.environment), **result, "status": outcome}


@router.post("/records-query", status_code=status.HTTP_200_OK)
async def query_records(command: RecordsQuery, request: Request) -> dict[str, object]:
    """Filter, count, group and list the records of one concept (see ``record_query``).
    A request naming something the model does not hold is answered (200) with
    ``status`` invalid_query or not_represented and the errors, part by part."""
    pool = _pool(request)
    binding = await _pin(pool, command.model_id, command.environment, command.expected_data_revision_id)
    compiled = await _compiled(pool, binding["data_revision_id"])
    query = command.model_dump(by_alias=True, exclude_none=True,
                               include={"concept", "filters", "match", "group_by", "aggregates",
                                        "order_by", "fields", "limit", "offset"})
    plan, errors, applied = compile_query(
        compiled, command.catalog.model_dump(by_alias=True), query, model_id=command.model_id,
        revision_id=binding["data_revision_id"], allowed_workspaces=command.allowed_workspace_ids,
        now=datetime.now(timezone.utc))
    pinned = _pinned(binding, command.environment)
    if plan is None:
        outcome = "not_represented" if errors and errors[0]["reason"] == "unknown_concept" else "invalid_query"
        return {**pinned, "status": outcome, "errors": errors, "appliedQuery": applied}
    try:
        result = await run_query(pool, plan)
    except (asyncpg.QueryCanceledError, asyncio.TimeoutError) as exc:
        raise HTTPException(status_code=422, detail="query_too_slow") from exc
    return {**pinned, **result}


@router.post("/records-overview", status_code=status.HTTP_200_OK)
async def records_overview(command: OverviewQuery, request: Request) -> dict[str, object]:
    """Concepts of the pinned revision with their key fields, queryable fields and the
    number of records the actor may see; relations with their two concepts."""
    pool = _pool(request)
    binding = await _pin(pool, command.model_id, command.environment, command.expected_data_revision_id)
    compiled = await _compiled(pool, binding["data_revision_id"])
    counts = await overview(pool, model_id=command.model_id, revision_id=binding["data_revision_id"],
                            allowed_workspaces=command.allowed_workspace_ids)
    concepts = compiled["concepts"]
    return {
        **_pinned(binding, command.environment),
        "concepts": [{"conceptId": concept_id, "key": concept.get("key", ""), "label": concept.get("label", ""),
                      "keyFields": concept.get("keyComponents") or [],
                      "fields": concept.get("allowedFields") or [],
                      "recordCount": (counts.get(concept_id) or {}).get("visible", 0),
                      "hiddenRecords": ((counts.get(concept_id) or {}).get("stored", 0)
                                        - (counts.get(concept_id) or {}).get("visible", 0))}
                     for concept_id, concept in concepts.items()],
        "relations": [{"relationId": relation_id, "key": relation.get("key", ""),
                       "from": (concepts.get(relation["sourceConceptId"]) or {}).get("key", ""),
                       "to": (concepts.get(relation["targetConceptId"]) or {}).get("key", ""),
                       "cardinality": relation.get("cardinality")}
                      for relation_id, relation in compiled["relations"].items()],
    }


@router.post("/indexes", status_code=status.HTTP_202_ACCEPTED)
async def request_search_index(command: IndexCommand, request: Request) -> dict[str, object]:
    pool = _pool(request)
    admit = _admit(request)
    if admit is None:
        raise HTTPException(status_code=503, detail="runtime_writes_disabled")
    binding = await _pin(pool, command.model_id, command.environment, None)
    try:
        requested = await request_index(pool, admit, revision_id=binding["data_revision_id"])
    except IndexUnavailable as exc:
        raise HTTPException(status_code=409 if exc.code.startswith("revision_") else 503,
                            detail=exc.code) from exc
    return {"modelId": command.model_id, "environment": command.environment,
            "dataRevisionId": binding["data_revision_id"],
            "index": search_store.public_generation(requested["generation"]),
            "jobId": requested["jobId"]}


@router.get("/models/{model_id}/index", status_code=status.HTTP_200_OK)
async def read_search_index(model_id: str, request: Request,
                            environment: Environment = Query(default="draft")) -> dict[str, object]:
    pool = _pool(request)
    binding = await _pin(pool, model_id, environment, None)
    profile = profile_from_env()
    if profile is None:
        index = {**search_store.public_generation(None), "state": "unavailable"}
    else:
        index = search_store.public_generation(
            await search_store.get_generation(pool, binding["data_revision_id"], profile.fingerprint))
    return {"modelId": model_id, "environment": environment,
            "dataRevisionId": binding["data_revision_id"], "index": index}
