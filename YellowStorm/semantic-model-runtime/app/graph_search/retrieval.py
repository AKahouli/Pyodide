"""Seed retrieval: the records of one pinned revision that best match a request.

Order of trust: an exact id, name or key value first (no model needed), then
the fusion of word matches and vector neighbours by rank (reciprocal rank
fusion; raw scores are not comparable). A vector-only candidate below the
similarity floor is dropped, so an unrelated request returns no match instead
of the least distant record.

Words and vectors are matched against each record's card and against the
passages of its long fields; a passage hit stands for its record (see
``_Fusion``), and the record comes back with its best matching passages.
"""

from __future__ import annotations

import re
import time
import unicodedata
from typing import Any, Awaitable, Callable

from app.persistence import graph_search_store as search_store
from app.population.tabular import normalize_identity_value

from .documents import fold, query_terms
from .embeddings import EmbeddingError, EmbeddingProfile, embed, vector_literal
from .settings import SearchSettings

# Defaults of SearchSettings (an administrator can change them per deployment).
CANDIDATES_PER_METHOD = 50
RRF_K = 60
SNIPPET_CHARS = 400
MAX_ROW_NUMBERS = 5


def min_similarity() -> float:
    """Floor for vector-only matches when no setting says otherwise (see SearchSettings)."""
    return SearchSettings().min_similarity


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


def _fold_map(text: str) -> tuple[str, list[int]]:
    """``fold`` character by character (no space collapsing), with the index in ``text`` of
    each folded character, so a word found in the folded text is located in ``text``."""
    folded: list[str] = []
    origin: list[int] = []
    for index, char in enumerate(text):
        for part in unicodedata.normalize("NFKD", char.lower()):
            if not unicodedata.combining(part):
                folded.append(part)
                origin.append(index)
    return "".join(folded), origin


def excerpt(text: str, terms: list[str], size: int = SNIPPET_CHARS) -> str:
    """About ``size`` characters of ``text`` around the query words it holds (longer
    words count more, so "de" or "la" never choose the place); its start without any."""
    if len(text) <= size:
        return text
    folded, origin = _fold_map(text)
    hits: list[tuple[int, str]] = []
    for term in terms:
        hits += [(origin[match.start()], term)
                 for match in re.finditer(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", folded)]
    start = 0
    if hits:
        def weight(begin: int) -> int:
            return sum(len(term) for term in {term for position, term in hits if begin <= position < begin + size})
        start = max(sorted({max(0, position - size // 4) for position, _ in hits}),
                    key=lambda begin: (weight(begin), -begin))
    start = min(start, max(0, len(text) - size))
    if start > 0:
        space = text.find(" ", start)
        start = space + 1 if 0 <= space < start + 40 else start
    end = min(len(text), start + size)
    if end < len(text):
        space = text.rfind(" ", start, end)
        end = space if space > start + size // 2 else end
    return ("…" if start > 0 else "") + text[start:end].strip() + ("…" if end < len(text) else "")


class _Fusion:
    """Reciprocal rank fusion of words and meaning, over record cards and passages.

    Within one method a passage stands for its record: the record's score there is the
    best of its card's and its passages' (cosine similarities, or word ranks, on one
    scale), so a long text is one more way to be found, not extra votes, and a record
    whose card matches as well as another's passage ranks as well. Records are then
    ranked per method and the two ranks fused (k=60), as before passages existed."""

    def __init__(self, rrf_k: int = RRF_K, passages_per_record: int = 2) -> None:
        self.offers: dict[str, dict[str, dict[str, Any]]] = {"lexical": {}, "vector": {}}
        self.entries: dict[str, dict[str, Any]] = {}
        self.rrf_k = rrf_k
        self.passages_per_record = passages_per_record

    def offer(self, method: str, entity_id: str, score: float, where: str,
              passages: list[dict[str, Any]] | None = None, key: str = "score") -> None:
        slot = self.offers[method].setdefault(entity_id, {"score": float("-inf"), "where": where, "passages": {}})
        if score > slot["score"]:
            slot["score"], slot["where"] = score, where
        for passage in passages or []:
            slot["passages"][passage["ordinal"]] = max(slot["passages"].get(passage["ordinal"], float("-inf")),
                                                       passage[key])

    def fuse(self, floor: float) -> None:
        lexical = self.offers["lexical"]
        # A record near the request only by meaning, and not near enough, is not a match.
        vector = {entity_id: slot for entity_id, slot in self.offers["vector"].items()
                  if slot["score"] >= floor or entity_id in lexical}
        for method, slots in (("lexical", lexical), ("vector", vector)):
            ordered = sorted(slots, key=lambda entity_id: (-slots[entity_id]["score"], entity_id))
            for rank, entity_id in enumerate(ordered, start=1):
                slot = slots[entity_id]
                entry = self.entries.setdefault(entity_id, {"score": 0.0, "parts": {}, "diagnostics": {},
                                                            "passages": {}})
                contribution = 1 / (self.rrf_k + rank)
                entry["score"] += contribution
                entry["parts"][method] = (contribution, slot["where"])
                if method == "lexical":
                    entry["diagnostics"].update({"lexicalRank": rank, "lexicalFrom": slot["where"]})
                else:
                    entry["diagnostics"].update({"vectorRank": rank, "similarity": round(slot["score"], 4),
                                                 "vectorFrom": slot["where"]})
                best_first = sorted(slot["passages"].items(), key=lambda pair: (-pair[1], pair[0]))
                for place, (ordinal, _) in enumerate(best_first):
                    # A record's best passage of a method weighs its rank there; the next, half.
                    entry["passages"][ordinal] = entry["passages"].get(ordinal, 0.0) + contribution / (1 + place)

    def ranked(self) -> list[str]:
        return sorted(self.entries, key=lambda entity_id: (-self.entries[entity_id]["score"], entity_id))

    def matched_in(self, entity_id: str) -> str:
        """Where the record's best matches were: its card, or a passage of a long field."""
        parts = self.entries[entity_id]["parts"].values()
        passage = sum(contribution for contribution, where in parts if where == "passage")
        record = sum(contribution for contribution, where in parts if where == "record")
        return "passage" if passage > record else "record"

    def best_passages(self, entity_id: str) -> list[int]:
        scored = (self.entries.get(entity_id) or {}).get("passages", {})
        return [ordinal for ordinal, _ in sorted(scored.items(), key=lambda pair: (-pair[1], pair[0]))
                ][:self.passages_per_record]


async def find_seeds(pool: Any, *, revision_id: str, compiled: dict[str, Any], query: str,
                     concept_ids: list[str] | None, limit: int,
                     allowed_workspaces: list[str] | None, generation: dict[str, Any] | None,
                     profile: EmbeddingProfile | None,
                     embedder: Callable[..., Awaitable[list[list[float]]]] | None = None,
                     settings: SearchSettings | None = None,
                     index_fingerprint: str | None = None) -> dict[str, Any]:
    """``index_fingerprint``: the fingerprint the generation must carry for the query vector to
    be comparable (the profile's, plus its index settings); the profile's when None."""
    embedder = embedder or embed
    settings = settings or SearchSettings()
    started = time.perf_counter()
    timings = {"embedMs": 0, "seedMs": 0}
    exact_ids = await search_store.exact_entity_ids(
        pool, revision_id, query.strip(), normalize_identity_value(query), concept_ids)
    fusion = _Fusion(settings.rrf_k, settings.passages_per_record)
    mode = "exact_only"
    terms = query_terms(query, settings)
    # Passages still rank their records when none are shown.
    per_record = max(1, settings.passages_per_record)
    ready = generation is not None and generation["state"] == "ready"
    if ready:
        index_id = generation["index_id"]
        lexical = await search_store.lexical_candidates(
            pool, index_id, terms, fold(query), concept_ids, allowed_workspaces, settings.lexical_candidates)
        passage_lexical = await search_store.lexical_passage_candidates(
            pool, index_id, terms, concept_ids, allowed_workspaces, settings.lexical_candidates,
            per_record)
        vector: list[dict[str, Any]] = []
        passage_vector: list[dict[str, Any]] = []
        mode = "lexical_only"
        wanted = index_fingerprint or (profile.fingerprint if profile is not None else None)
        if profile is not None and wanted == generation["embedding_fingerprint"]:
            embed_started = time.perf_counter()
            try:
                query_vector = vector_literal((await embedder(profile, [query], query=True))[0])
                vector = await search_store.vector_candidates(
                    pool, index_id, query_vector, concept_ids, allowed_workspaces, settings.vector_candidates)
                passage_vector = await search_store.vector_passage_candidates(
                    pool, index_id, query_vector, concept_ids, allowed_workspaces, settings.vector_candidates,
                    per_record)
                mode = "hybrid"
            except EmbeddingError:
                vector, passage_vector = [], []
            timings["embedMs"] = round((time.perf_counter() - embed_started) * 1000)
        for item in lexical:
            fusion.offer("lexical", item["entityId"], item["score"], "record")
        for item in passage_lexical:
            fusion.offer("lexical", item["entityId"], item["score"], "passage", item["passages"])
        for item in vector:
            fusion.offer("vector", item["entityId"], item["similarity"], "record")
        for item in passage_vector:
            fusion.offer("vector", item["entityId"], item["similarity"], "passage", item["passages"],
                         key="similarity")
        fusion.fuse(settings.min_similarity)
    ranked = fusion.ranked()
    ordered = list(exact_ids) + [entity_id for entity_id in ranked if entity_id not in exact_ids]
    rows = await search_store.entity_rows(pool, revision_id, ordered[: limit * 4])
    texts = await search_store.document_texts(pool, generation["index_id"], list(rows)) if ready else {}
    seeds = []
    for entity_id in ordered:
        entity = rows.get(entity_id)
        if entity is None or not is_visible(entity, allowed_workspaces):
            continue
        entry = fusion.entries.get(entity_id)
        methods = set(entry["parts"]) if entry else set()
        if entity_id in exact_ids:
            match_class = "exact"
        elif methods == {"lexical", "vector"}:
            match_class = "hybrid"
        else:
            match_class = "lexical" if "lexical" in methods else "vector"
        seed = {**describe_entity(entity, compiled),
                "snippet": (texts.get(entity_id) or "")[:settings.snippet_chars],
                "matchClass": match_class, "rank": len(seeds) + 1,
                "diagnostics": dict(entry["diagnostics"]) if entry else {}}
        if entry is not None:
            seed["diagnostics"]["fusedScore"] = round(entry["score"], 6)
            seed["matchedIn"] = "record" if entity_id in exact_ids else fusion.matched_in(entity_id)
            seed["passageOrdinals"] = fusion.best_passages(entity_id)
        seeds.append(seed)
        if len(seeds) >= limit:
            break
    wanted = [(seed["entityId"], ordinal) for seed in seeds for ordinal in seed.pop("passageOrdinals", [])]
    passages = await search_store.passage_texts(pool, generation["index_id"], wanted) if wanted else {}
    for seed in seeds:
        found = [passages[key] for key in wanted if key[0] == seed["entityId"] and key in passages]
        if found:
            seed["passages"] = [{"fieldKey": passage["fieldKey"], "field": passage["fieldLabel"],
                                 "start": passage["start"], "end": passage["end"],
                                 "text": excerpt(passage["text"], terms, settings.excerpt_chars)} for passage in found]
    timings["seedMs"] = round((time.perf_counter() - started) * 1000)
    return {"seeds": seeds, "modeUsed": mode, "timings": timings}
