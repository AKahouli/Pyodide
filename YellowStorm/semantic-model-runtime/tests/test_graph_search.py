from __future__ import annotations

import json

import httpx
import pytest

from app.graph_search.documents import build_document, fold, query_terms
from app.graph_search.embeddings import (STORAGE_DIMENSION, EmbeddingError, EmbeddingProfile, embed,
                                         vector_literal)
from app.graph_search.retrieval import is_visible, resolve_concepts, resolve_relations
from app.graph_search.traversal import graph_of, step_query
from app.population.compiler import PopulationError

CONCEPT = {"conceptId": "c-contract", "key": "contract", "label": "Contract",
           "aliases": ["Agreement"], "keyComponents": ["contract_id"],
           "allowedFields": ["contract_id", "title", "service_category", "notes"],
           "fieldAliases": {"service_category": ["Domain"]}}
ENTITY = {"entityId": "contracts:abc", "conceptId": "c-contract", "label": "Enterprise Desk",
          "identity": {"contract_id": "ct001"},
          "attributes": {"title": "Enterprise Service Desk", "service_category": "Managed IT", "notes": ""},
          "provenance": {"sources": [{"assetRef": {"workspaceId": "ws1", "assetId": "a1"}},
                                     {"assetRef": {"assetId": "manual:m1"}}]}}
COMPILED = {"concepts": {"c-contract": CONCEPT,
                         "c-customer": {"conceptId": "c-customer", "key": "customer", "label": "Customer",
                                        "aliases": ["Client"]}},
            "relations": {"r-1": {"relationId": "r-1", "key": "has_contract"}}}


def test_search_text_is_deterministic_readable_and_bounded() -> None:
    document = build_document(ENTITY, CONCEPT)
    assert document["searchText"] == ("Type: Contract (Agreement)\nName: Enterprise Desk\n"
                                      "Contract id: ct001\nTitle: Enterprise Service Desk\n"
                                      "Service category (Domain): Managed IT")
    assert build_document(ENTITY, CONCEPT) == document
    assert document["sourceWorkspaces"] == ["ws1"]
    assert document["exactOnly"] is False
    edited = build_document({**ENTITY, "attributes": {**ENTITY["attributes"], "title": "Other"}}, CONCEPT)
    assert edited["contentHash"] != document["contentHash"]
    # Another record's attributes or provenance never change this record's text.
    moved = build_document({**ENTITY, "provenance": {}}, CONCEPT)
    assert moved["contentHash"] == document["contentHash"]
    long = build_document({**ENTITY, "attributes": {"title": "x" * 900}}, CONCEPT)
    assert long["diagnostics"] == {"shortenedFields": ["title"]}
    assert len(long["searchText"]) < 500


def test_a_record_with_only_keys_is_exact_only() -> None:
    document = build_document({**ENTITY, "attributes": {}}, CONCEPT)
    assert document["exactOnly"] is True


def test_folding_and_query_terms() -> None:
    assert fold("  Société   GÉNÉRALE ") == "societe generale"
    assert query_terms("Contrat d'assistance IT, IT!") == ["contrat", "assistance", "it"]


def test_concepts_and_relations_resolve_by_id_key_label_or_alias() -> None:
    found, unknown = resolve_concepts(COMPILED, ["client", "c-contract", "Penalty"])
    assert [c["conceptId"] for c in found] == ["c-customer", "c-contract"]
    assert unknown == ["Penalty"]
    assert resolve_relations(COMPILED, ["HAS_CONTRACT", "r-1", "owns"]) == (["r-1"], ["owns"])


def test_visibility_requires_every_source_workspace() -> None:
    assert is_visible(ENTITY, None)
    assert is_visible(ENTITY, ["ws1"])  # the manual source has no workspace
    assert not is_visible(ENTITY, ["ws2"])
    assert is_visible({"provenance": {}}, [])


def test_step_queries_are_fixed_shapes_with_bound_values() -> None:
    sql = step_query("pop_dr_abc", "incoming", True, 11)
    assert "MATCH (t:Entity)-[r:RELATED_TO]->(s:Entity)" in sql
    assert "s.record_id IN $frontier AND r.relation_id IN $relations" in sql
    assert sql.endswith("$1) AS (source_id ag_catalog.agtype, relation_id ag_catalog.agtype, "
                        "target_id ag_catalog.agtype)")
    assert "$relations" not in step_query("pop_dr_abc", "outgoing", False, 11)
    for graph, direction, limit in (("pop_x'; drop", "outgoing", 5), ("pop_ok", "sideways", 5),
                                    ("pop_ok", "outgoing", 0)):
        with pytest.raises(PopulationError):
            step_query(graph, direction, False, limit)
    assert graph_of("age:v1:pop_dr_abc") == "pop_dr_abc"
    with pytest.raises(PopulationError):
        graph_of("legacy:pop_dr_abc")


PROFILE = EmbeddingProfile(base_url="http://litellm", api_key="k", model="qwen3-embedding",
                           dimension=STORAGE_DIMENSION)


def _client(handler) -> httpx.AsyncClient:  # type: ignore[no-untyped-def]
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_embeddings_are_ordered_unit_vectors_and_queries_carry_the_instruction() -> None:
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(body)
        data = [{"index": i, "embedding": [float(i + 1)] + [0.0] * (STORAGE_DIMENSION - 1)}
                for i in range(len(body["input"]))]
        return httpx.Response(200, json={"data": list(reversed(data))})

    async with _client(handler) as client:
        vectors = await embed(PROFILE, ["a", "b"], client=client)
        await embed(PROFILE, ["q"], query=True, client=client)
    assert [vector[0] for vector in vectors] == [1.0, 1.0]
    assert seen[0]["input"] == ["a", "b"] and seen[0]["model"] == "qwen3-embedding"
    assert seen[1]["input"][0].startswith("Instruct: ") and seen[1]["input"][0].endswith("Query: q")
    assert vector_literal([0.5, 0.25]) == "[0.5,0.25]"


@pytest.mark.asyncio
@pytest.mark.parametrize("response, code, retryable", [
    (httpx.Response(503), "embedding_http_503", True),
    (httpx.Response(429), "embedding_http_429", True),
    (httpx.Response(400), "embedding_http_400", False),
    (httpx.Response(200, json={"data": [{"index": 0, "embedding": [1.0, 2.0]}]}),
     "embedding_dimension_mismatch", False),
    (httpx.Response(200, json={"data": [{"index": 0, "embedding": [0.0] * STORAGE_DIMENSION}]}),
     "embedding_zero_vector", False),
    (httpx.Response(200, json={"data": []}), "embedding_count_mismatch", False),
])
async def test_bad_embedding_responses_fail_explicitly(response, code, retryable) -> None:  # type: ignore[no-untyped-def]
    async with _client(lambda _request: response) as client:
        with pytest.raises(EmbeddingError) as raised:
            await embed(PROFILE, ["a"], client=client)
    assert (raised.value.code, raised.value.retryable) == (code, retryable)


def test_the_fingerprint_names_the_vector_space() -> None:
    same = EmbeddingProfile(base_url="http://elsewhere", api_key="other", model="qwen3-embedding",
                            dimension=STORAGE_DIMENSION)
    other = EmbeddingProfile(base_url="http://litellm", api_key="k", model="another-model",
                             dimension=STORAGE_DIMENSION)
    assert PROFILE.fingerprint == same.fingerprint != other.fingerprint
