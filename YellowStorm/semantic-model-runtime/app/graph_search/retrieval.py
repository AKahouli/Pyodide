"""Seed retrieval: the records of one pinned revision that best match a request.

Order of trust: an exact id, name or key value first (no model needed), then
the fusion of word matches and vector neighbours by rank (reciprocal rank
fusion; raw scores are not comparable). A vector-only candidate below the
similarity floor is dropped, so an unrelated request returns no match instead
of the least distant record.
"""

from __future__ import annotations

import os
import time
from typing import Any, Awaitable, Callable

from app.persistence import graph_search_store as search_store
from app.population.tabular import normalize_identity_value

from .documents import fold, query_terms
from .embeddings import EmbeddingError, EmbeddingProfile, embed, vector_literal

CANDIDATES_PER_METHOD = 50
RRF_K = 60
SNIPPET_CHARS = 400
MAX_ROW_NUMBERS = 5


def min_similarity() -> float:
    """Floor for vector-only matches. 0.4 from first live qwen3 probes: unrelated records
    scored 0.34-0.37 against a key, related ones 0.46-0.59; calibrate on gold queries (plan G5)."""
    try:
        return float(os.environ.get("SEMANTIC_SEARCH_MIN_SIMILARITY", "0.4"))
    except ValueError:
        return 0.4


def resolve_concepts(compiled: dict[str, Any], names: list[str] | None
                     ) -> tuple[list[dict[str, Any]], list[str]]:
    """Concepts named by id, key, label or alias; unknown names are returned apart."""
    if not names:
        return [], []
    found: dict[str, dict[str, Any]] = {}
    unknown: list[str] = []
    for name in names:
        key = fold(name)
        match = next((concept for concept in compiled["concepts"].values()
                      if key in {fold(concept["conceptId"]), fold(concept.get("key")),
                                 fold(concept.get("label"))}
                      or key in {fold(alias) for alias in concept.get("aliases") or []}), None)
        if match is None:
            unknown.append(name)
        else:
            found[match["conceptId"]] = match
    return [{"conceptId": c["conceptId"], "key": c.get("key", ""), "label": c.get("label", "")}
            for c in found.values()], unknown


def resolve_relations(compiled: dict[str, Any], names: list[str]) -> tuple[list[str], list[str]]:
    found: list[str] = []
    unknown: list[str] = []
    for name in names:
        key = fold(name)
        match = next((relation["relationId"] for relation in compiled["relations"].values()
                      if key in {fold(relation["relationId"]), fold(relation.get("key"))}), None)
        if match is None:
            unknown.append(name)
        elif match not in found:
            found.append(match)
    return found, unknown


def is_visible(entity: dict[str, Any], allowed_workspaces: list[str] | None) -> bool:
    """A record is shown only when every workspace it was read from is readable."""
    if allowed_workspaces is None:
        return True
    allowed = set(allowed_workspaces)
    sources = (entity.get("provenance") or {}).get("sources") or []
    return all(((source or {}).get("assetRef") or {}).get("workspaceId") in allowed
               for source in sources
               if ((source or {}).get("assetRef") or {}).get("workspaceId"))


def describe_entity(entity: dict[str, Any], compiled: dict[str, Any]) -> dict[str, Any]:
    concept = compiled["concepts"].get(entity["conceptId"]) or {}
    provenance = []
    for source in (entity.get("provenance") or {}).get("sources") or []:
        asset = (source or {}).get("assetRef") or {}
        if not asset.get("assetId"):
            continue
        item: dict[str, Any] = {"assetId": asset["assetId"]}
        if asset.get("workspaceId"):
            item["workspaceId"] = asset["workspaceId"]
        rows = source.get("rowNumbers")
        if isinstance(rows, list) and rows:
            item["rowNumbers"] = rows[:MAX_ROW_NUMBERS]
        provenance.append(item)
    return {"entityId": entity["entityId"], "conceptId": entity["conceptId"],
            "conceptLabel": concept.get("label", ""), "label": entity.get("label", ""),
            "keyFields": entity.get("identity") or {}, "provenance": provenance}


async def find_seeds(pool: Any, *, revision_id: str, compiled: dict[str, Any], query: str,
                     concept_ids: list[str] | None, limit: int,
                     allowed_workspaces: list[str] | None, generation: dict[str, Any] | None,
                     profile: EmbeddingProfile | None,
                     embedder: Callable[..., Awaitable[list[list[float]]]] | None = None) -> dict[str, Any]:
    embedder = embedder or embed
    started = time.perf_counter()
    timings = {"embedMs": 0, "seedMs": 0}
    exact_ids = await search_store.exact_entity_ids(
        pool, revision_id, query.strip(), normalize_identity_value(query), concept_ids)
    ranked: dict[str, dict[str, Any]] = {}
    mode = "exact_only"
    if generation is not None and generation["state"] == "ready":
        index_id = generation["index_id"]
        lexical = await search_store.lexical_candidates(
            pool, index_id, query_terms(query), fold(query), concept_ids, allowed_workspaces,
            CANDIDATES_PER_METHOD)
        vector: list[dict[str, Any]] = []
        mode = "lexical_only"
        if profile is not None and profile.fingerprint == generation["embedding_fingerprint"]:
            embed_started = time.perf_counter()
            try:
                query_vector = (await embedder(profile, [query], query=True))[0]
                vector = await search_store.vector_candidates(
                    pool, index_id, vector_literal(query_vector), concept_ids, allowed_workspaces,
                    CANDIDATES_PER_METHOD)
                mode = "hybrid"
            except EmbeddingError:
                vector = []
            timings["embedMs"] = round((time.perf_counter() - embed_started) * 1000)
        floor = min_similarity()
        lexical_ids = {item["entityId"] for item in lexical}
        for rank, item in enumerate(lexical, start=1):
            entry = ranked.setdefault(item["entityId"], {"score": 0.0, "diagnostics": {}})
            entry["score"] += 1 / (RRF_K + rank)
            entry["diagnostics"]["lexicalRank"] = rank
        for rank, item in enumerate(vector, start=1):
            if item["similarity"] < floor and item["entityId"] not in lexical_ids:
                continue
            entry = ranked.setdefault(item["entityId"], {"score": 0.0, "diagnostics": {}})
            entry["score"] += 1 / (RRF_K + rank)
            entry["diagnostics"]["vectorRank"] = rank
            entry["diagnostics"]["similarity"] = round(item["similarity"], 4)
    ordered = [entity_id for entity_id in exact_ids]
    ordered += [entity_id for entity_id, _ in sorted(ranked.items(), key=lambda pair: (-pair[1]["score"], pair[0]))
                if entity_id not in exact_ids]
    rows = await search_store.entity_rows(pool, revision_id, ordered[: limit * 4])
    texts = (await search_store.document_texts(pool, generation["index_id"], list(rows))
             if generation is not None and generation["state"] == "ready" else {})
    seeds = []
    for entity_id in ordered:
        entity = rows.get(entity_id)
        if entity is None or not is_visible(entity, allowed_workspaces):
            continue
        diagnostics = (ranked.get(entity_id) or {}).get("diagnostics", {})
        if entity_id in exact_ids:
            match_class = "exact"
        elif "lexicalRank" in diagnostics and "vectorRank" in diagnostics:
            match_class = "hybrid"
        else:
            match_class = "lexical" if "lexicalRank" in diagnostics else "vector"
        seeds.append({**describe_entity(entity, compiled),
                      "snippet": (texts.get(entity_id) or "")[:SNIPPET_CHARS],
                      "matchClass": match_class, "rank": len(seeds) + 1, "diagnostics": diagnostics})
        if len(seeds) >= limit:
            break
    timings["seedMs"] = round((time.perf_counter() - started) * 1000)
    return {"seeds": seeds, "modeUsed": mode, "timings": timings}
