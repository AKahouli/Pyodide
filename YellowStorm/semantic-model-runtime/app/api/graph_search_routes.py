"""Chat graph search (``/v1/graphs/search/fused``), the contract the chat agent calls.

Reads only the production-bound revision of a model, so chat always answers
from the published version.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.persistence import population_store
from app.persistence import search_store as store
from app.search.fused import (MAX_RESULTS, SearchError, graph_projection_ref,
                              matching_concepts, name_results, query_terms, rank_results,
                              retrieval_scope)

router = APIRouter(prefix="/v1/graphs", tags=["graph-search"])
CANDIDATE_LIMIT = 400


class FusedSearchBody(BaseModel):
    schema_name: str = Field(min_length=1, max_length=80)
    query: str = Field(min_length=1, max_length=4000)
    debug: bool = False
    include_supporting_data: bool = True


@router.post("/search/fused")
async def fused_search(body: FusedSearchBody, request: Request) -> dict[str, Any]:
    pool = getattr(request.app.state, "population_pool", None)
    if pool is None:
        raise HTTPException(status_code=503, detail="population_store_unavailable")
    try:
        projection_ref = graph_projection_ref(body.schema_name)
    except SearchError as exc:
        raise HTTPException(status_code=400, detail=exc.code) from exc
    binding = await store.find_published_binding(pool, projection_ref)
    if binding is None:
        raise HTTPException(status_code=404, detail="model_not_published")
    terms = query_terms(body.query)
    response: dict[str, Any] = {"schema_name": body.schema_name, "modelId": binding["model_id"],
                                "modelVersionId": binding["model_version_id"],
                                "dataRevisionId": binding["data_revision_id"], "results": []}
    if not terms:
        return response
    revision_id = binding["data_revision_id"]
    # A query naming a concept or one of its synonyms ("clients" for Customer)
    # also brings that concept's records forward.
    specification = await population_store.get_revision_specification(pool, revision_id)
    concepts = matching_concepts(specification, terms)
    entities = await store.search_revision_entities(
        pool, revision_id=revision_id, terms=terms, limit=CANDIDATE_LIMIT,
        concept_ids=sorted(concepts))
    relationships = await store.revision_relationships(
        pool, revision_id=revision_id, entity_ids=[e["id"] for e in entities]) \
        if body.include_supporting_data else []
    response["results"] = name_results(
        rank_results(entities, relationships, terms, MAX_RESULTS, concepts), specification)
    scope = retrieval_scope(response["results"])
    if scope:
        response["retrieval_scope"] = scope
    return response
