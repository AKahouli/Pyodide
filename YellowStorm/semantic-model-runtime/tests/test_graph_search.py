from __future__ import annotations

import json

import httpx
import pytest

from app.graph_search.documents import build_document, fold, query_terms
from app.graph_search.embeddings import (STORAGE_DIMENSION, EmbeddingError, EmbeddingProfile, embed,
                                         vector_literal)
from app.graph_search.retrieval import describe_entity, is_visible, resolve_concepts, resolve_relations
from app.graph_search.traversal import graph_of, step_query
from app.population.age_projection import relation_label
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
    assert long["diagnostics"] == {"shortenedFields": ["title"], "passageFields": {"title": 1}}
    assert len(long["searchText"]) < 500
    assert document["passages"] == []


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


def test_record_provenance_exposes_document_handles_and_deduplicates_sources() -> None:
    source = {"assetRef": {"workspaceId": "ws1", "assetId": "doc1", "assetVersionId": "v1"},
              "filename": "agreement.pdf", "mappingVersion": "m1", "rowNumbers": [2]}
    described = describe_entity({**ENTITY, "provenance": {"sources": [source, {**source, "rowNumbers": [3]}]}},
                                COMPILED)

    assert described["provenance"] == [{
        "assetId": "doc1", "documentId": "doc1", "workspaceId": "ws1", "filename": "agreement.pdf",
        "assetVersionId": "v1", "mappingVersion": "m1", "rowNumbers": [2, 3],
    }]


def test_step_queries_are_fixed_shapes_with_escaped_values() -> None:
    sql = step_query("pop_dr_abc", "incoming", 11, frontier=["c:1", "o'k"], relations=["r-1"])
    assert "MATCH (t)-[r]->(s)" in sql  # no label: an Entity graph filters the relation property
    assert r"WHERE s.record_id IN ['c:1', 'o\'k'] AND r.relation_id IN ['r-1'] RETURN" in sql
    assert "RETURN s.record_id, r.relation_id, t.record_id, t.concept_id, t.workspace_ids LIMIT 11" in sql
    typed = step_query("pop_dr_abc", "outgoing", 11, frontier=["c:1"], relations=["r-1"],
                       edge_label=relation_label("r-1"))
    assert f"MATCH (s)-[r:{relation_label('r-1')}]->(t) WHERE s.record_id IN ['c:1'] RETURN" in typed
    assert "relation_id IN" not in typed
    for graph, direction, limit, frontier in (("pop_x'; drop", "outgoing", 5, ["a"]), ("pop_ok", "sideways", 5, ["a"]),
                                              ("pop_ok", "outgoing", 0, ["a"]), ("pop_ok", "outgoing", 5, []),
                                              ("pop_ok", "outgoing", 5, ["a$agesearch$ x"])):
        with pytest.raises(PopulationError):
            step_query(graph, direction, limit, frontier=frontier)
    with pytest.raises(PopulationError):
        step_query("pop_ok", "outgoing", 5, frontier=["a"], edge_label="Entity]->(x) DETACH DELETE (x")
    assert graph_of("age:v1:pop_dr_abc") == graph_of("age:v2:pop_dr_abc") == "pop_dr_abc"
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
    assert [body["dimensions"] for body in seen] == [3072, 3072]
    assert seen[1]["input"][0].startswith("Instruct: ") and seen[1]["input"][0].endswith("Query: q")
    assert vector_literal([0.5, 0.25]) == "[0.5,0.25]"


@pytest.mark.asyncio
@pytest.mark.parametrize("response, code, retryable", [
    (httpx.Response(503), "embedding_http_503", True),
    (httpx.Response(429), "embedding_http_429", True),
    (httpx.Response(400), "embedding_http_400", False),
    (httpx.Response(200, json={"data": [{"index": 0, "embedding": [1.0, 2.0]}]}),
     "embedding_dimension_mismatch", False),
    (httpx.Response(200, json={"data": [{"index": 0, "embedding": [0.01] * 2560}]}),
     "embedding_dimension_mismatch", False),
    (httpx.Response(200, json={"data": [{"index": 0, "embedding": [0.01] * 4096}]}),
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


def test_3072_profile_never_reuses_2560_vectors() -> None:
    from dataclasses import replace

    current = replace(PROFILE, dimension=3072)
    old = replace(PROFILE, dimension=2560)
    assert current.fingerprint != old.fingerprint
    assert not set(current.cache_fingerprints) & set(old.cache_fingerprints)


def test_storage_default_is_3072() -> None:
    import os
    import subprocess
    import sys

    env = {key: value for key, value in os.environ.items() if key != "SEMANTIC_EMBEDDING_DIMENSION"}
    subprocess.run([sys.executable, "-c", "from app.graph_search.embeddings import STORAGE_DIMENSION; "
                    "assert STORAGE_DIMENSION == 3072"], env=env, check=True)


@pytest.mark.parametrize("dimension", ["2560", "4096", "garbage", ""])
def test_conflicting_environment_cannot_change_fixed_storage_or_admit_a_profile(monkeypatch, dimension) -> None:
    from app.graph_search import embeddings

    monkeypatch.setenv("SEMANTIC_EMBEDDING_DIMENSION", dimension)
    monkeypatch.setenv("SEMANTIC_EMBEDDING_BASE_URL", "http://litellm")
    monkeypatch.setenv("SEMANTIC_EMBEDDING_MODEL", "m")
    assert embeddings.STORAGE_DIMENSION == 3072
    with pytest.raises(EmbeddingError, match="embedding_dimension_unsupported"):
        embeddings.profile_from_env()


def test_matching_environment_uses_fixed_storage_profile(monkeypatch) -> None:
    from app.graph_search import embeddings

    monkeypatch.setenv("SEMANTIC_EMBEDDING_DIMENSION", "3072")
    monkeypatch.setenv("SEMANTIC_EMBEDDING_BASE_URL", "http://litellm")
    monkeypatch.setenv("SEMANTIC_EMBEDDING_MODEL", "m")
    assert embeddings.profile_from_env().dimension == 3072


@pytest.mark.asyncio
async def test_conflicting_dimension_is_rejected_before_build_admission(monkeypatch) -> None:
    from app.graph_search import indexer

    monkeypatch.setenv("SEMANTIC_EMBEDDING_DIMENSION", "4096")

    async def admit(**kwargs):
        raise AssertionError("a conflicting dimension must not admit work")

    with pytest.raises(EmbeddingError, match="embedding_dimension_unsupported"):
        await indexer.request_index(None, admit, revision_id="r")
