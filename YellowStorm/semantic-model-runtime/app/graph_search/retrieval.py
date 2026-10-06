"""Seed retrieval: the records of one pinned revision that best match a request.

Order of trust: an exact id, name or key value first (no model needed), then
the fusion of word matches and vector neighbours by rank (reciprocal rank
fusion; raw scores are not comparable). A vector-only candidate below the
similarity floor is dropped, so an unrelated request returns no match instead
of the least distant record.

Words and vectors are matched against each record's card and against the
passages of its long fields; a passage hit stands for its record (see
``_Fusion``), and the record comes back with its best matching passages.

A request limited to some concepts may name a record of another one ("contrats
de Carrefour"): the records asked for that are linked to it are found through it
(``anchors``), as a third ranking fused with the other two, weighing more.
"""

from __future__ import annotations

import re
import time
import unicodedata
from typing import Any, Awaitable, Callable

from app.persistence import graph_search_store as search_store
from app.population.tabular import normalize_identity_value

from . import anchors as anchor_search
from .documents import fold, lexical_query, query_terms
from .embeddings import EmbeddingError, EmbeddingProfile, embed, vector_literal
from .settings import SearchSettings
from .typed_values import near_match

# Defaults of SearchSettings (an administrator can change them per deployment).
CANDIDATES_PER_METHOD = 50
RRF_K = 60
SNIPPET_CHARS = 400
MAX_ROW_NUMBERS = 5
# A record found through a record the request names counts this much more than a word or
# meaning match of the same rank: more than both together, since the request asked for it by its
# link (a record only matching the words never comes before it).
LINKED_WEIGHT = 3.0
# Adaptive floor (SearchSettings.adaptive_similarity): at least this many nearest records to judge
# from, a gap of at least this much between the nearest and their median, the floor at this share
# of that gap above the median, never below the lowest.
ADAPTIVE_MIN_CANDIDATES = 10
ADAPTIVE_MIN_SPREAD = 0.08
ADAPTIVE_SHARE = 0.3
ADAPTIVE_LOWEST = 0.2


def min_similarity() -> float:
    """Floor for vector-only matches when no setting says otherwise (see SearchSettings)."""
    return SearchSettings().min_similarity


def similarity_floor(similarities: list[float], settings: SearchSettings) -> float:
    """The similarity a record found only by meaning must reach for this request. The median
    of the nearest records is what an unrelated record scores here; the floor is set above it,
    a share of the way to the nearest. When nothing stands out from the median, the
    configured floor applies."""
    if not settings.adaptive_similarity or len(similarities) < ADAPTIVE_MIN_CANDIDATES:
        return settings.min_similarity
    ordered = sorted(similarities)
    median, best = ordered[len(ordered) // 2], ordered[-1]
    if best - median < ADAPTIVE_MIN_SPREAD:
        return settings.min_similarity
    return max(ADAPTIVE_LOWEST, median + ADAPTIVE_SHARE * (best - median))


def resolve_concepts(compiled: dict[str, Any], names: list[str] | None
                     ) -> tuple[list[dict[str, Any]], list[str]]:
    """Concepts named by id, key, label or alias, or nearly (``near_match``); unknown names
    are returned apart."""
    if not names:
        return [], []
    found: dict[str, dict[str, Any]] = {}
    unknown: list[str] = []
    named: dict[str, dict[str, Any]] = {}
    for concept in compiled["concepts"].values():
        for item in [concept["conceptId"], concept.get("key"), concept.get("label"), *(concept.get("aliases") or [])]:
            if fold(item):
                named.setdefault(fold(item), concept)
    for name in names:
        match = named.get(fold(name)) or near_match(name, named)
        if match is None:
            unknown.append(name)
        else:
            found[match["conceptId"]] = match
    return [{"conceptId": c["conceptId"], "key": c.get("key", ""), "label": c.get("label", "")}
            for c in found.values()], unknown


def resolve_relations(compiled: dict[str, Any], names: list[str], catalog: dict[str, Any] | None = None
                      ) -> tuple[list[str], list[str]]:
    """Relations named by id or key, or by the label or inverse label the model gives them
    (``catalog``), or nearly (``near_match``); unknown names are returned apart."""
    labels = {item.get("key"): item for item in (catalog or {}).get("relations") or [] if item.get("key")}
    named: dict[str, str] = {}
    for relation in compiled["relations"].values():
        entry = labels.get(relation.get("key")) or {}
        for item in (relation["relationId"], relation.get("key"), entry.get("label"), entry.get("inverseLabel")):
            if fold(item):
                named.setdefault(fold(item), relation["relationId"])
    found: list[str] = []
    unknown: list[str] = []
    for name in names:
        match = named.get(fold(name)) or near_match(name, named)
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
        self.offers: dict[str, dict[str, dict[str, Any]]] = {"lexical": {}, "vector": {}, "linked": {}}
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
                  if slot["score"] >= floor or entity_id in lexical or entity_id in self.offers["linked"]}
        linked = self.offers["linked"]
        # Records equally near the same anchor share a rank: their words and meaning order them.
        linked_ranks = {score: place for place, score in
                        enumerate(sorted({slot["score"] for slot in linked.values()}, reverse=True), start=1)}
        for method, slots in (("lexical", lexical), ("vector", vector), ("linked", linked)):
            ordered = sorted(slots, key=lambda entity_id: (-slots[entity_id]["score"], entity_id))
            for rank, entity_id in enumerate(ordered, start=1):
                slot = slots[entity_id]
                entry = self.entries.setdefault(entity_id, {"score": 0.0, "parts": {}, "diagnostics": {},
                                                            "passages": {}})
                if method == "linked":
                    rank = linked_ranks[slot["score"]]
                    contribution = LINKED_WEIGHT / (self.rrf_k + rank)
                else:
                    contribution = 1 / (self.rrf_k + rank)
                entry["score"] += contribution
                entry["parts"][method] = (contribution, slot["where"])
                if method == "lexical":
                    entry["diagnostics"].update({"lexicalRank": rank, "lexicalFrom": slot["where"]})
                elif method == "linked":
                    entry["diagnostics"]["linkedRank"] = rank
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
        """Where the record's best matches were: its card, a passage of a long field, or only its
        link to a record the request names."""
        parts = self.entries[entity_id]["parts"].values()
        passage = sum(contribution for contribution, where in parts if where == "passage")
        record = sum(contribution for contribution, where in parts if where == "record")
        if not passage and not record:
            return "link"
        return "passage" if passage > record else "record"

    def best_passages(self, entity_id: str) -> list[int]:
        scored = (self.entries.get(entity_id) or {}).get("passages", {})
        return [ordinal for ordinal, _ in sorted(scored.items(), key=lambda pair: (-pair[1], pair[0]))
                ][:self.passages_per_record]


def vectors_comparable(generation: dict[str, Any], profile: EmbeddingProfile | None, wanted: str | None) -> bool:
    """The request vector can be compared with the generation's: same fingerprint, or the same
    vector space under another search text format (a generation kept while a new one is built)."""
    if profile is None:
        return False
    if wanted == generation["embedding_fingerprint"]:
        return True
    space = getattr(profile, "vector_fingerprint", None)
    return space is not None and generation.get("vector_fingerprint") == space


def _relation_steps(path: list[tuple[str, str]], compiled: dict[str, Any]) -> list[dict[str, str]]:
    return [{"relation": (compiled["relations"].get(relation_id) or {}).get("key") or relation_id,
             "direction": direction} for relation_id, direction in path]


async def find_seeds(pool: Any, *, revision_id: str, compiled: dict[str, Any], query: str,
                     concept_ids: list[str] | None, limit: int,
                     allowed_workspaces: list[str] | None, generation: dict[str, Any] | None,
                     profile: EmbeddingProfile | None,
                     embedder: Callable[..., Awaitable[list[list[float]]]] | None = None,
                     settings: SearchSettings | None = None,
                     index_fingerprint: str | None = None) -> dict[str, Any]:
    """``index_fingerprint``: the fingerprint the generation must carry for the query vector to
    be comparable (the profile's, plus its index settings); the profile's when None. A
    generation in the same vector space under another text format is compared too."""
    embedder = embedder or embed
    settings = settings or SearchSettings()
    started = time.perf_counter()
    timings = {"embedMs": 0, "seedMs": 0}
    exact_ids = await search_store.exact_entity_ids(
        pool, revision_id, query.strip(), normalize_identity_value(query), concept_ids)
    fusion = _Fusion(settings.rrf_k, settings.passages_per_record)
    mode = "exact_only"
    terms = query_terms(query, settings)
    tsquery = lexical_query(query, settings)
    # Passages still rank their records when none are shown.
    per_record = max(1, settings.passages_per_record)
    ready = generation is not None and generation["state"] == "ready"
    floor = settings.min_similarity
    if ready:
        index_id = generation["index_id"]
        lexical = await search_store.lexical_candidates(
            pool, index_id, tsquery, fold(query), concept_ids, allowed_workspaces, settings.lexical_candidates)
        passage_lexical = await search_store.lexical_passage_candidates(
            pool, index_id, tsquery, concept_ids, allowed_workspaces, settings.lexical_candidates,
            per_record)
        vector: list[dict[str, Any]] = []
        passage_vector: list[dict[str, Any]] = []
        mode = "lexical_only"
        wanted = index_fingerprint or (profile.fingerprint if profile is not None else None)
        if vectors_comparable(generation, profile, wanted):
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
        floor = similarity_floor([slot["score"] for slot in fusion.offers["vector"].values()], settings)
    # Records asked for, found through a record of another concept that the request names.
    anchors: list[dict[str, Any]] = []
    followed: dict[str, Any] = {"reached": {}, "truncated": False}
    if concept_ids:
        asked = [compiled["concepts"][concept_id] for concept_id in concept_ids if concept_id in compiled["concepts"]]
        others = [concept_id for concept_id in compiled["concepts"] if concept_id not in set(concept_ids)]
        other_exact = await search_store.exact_entity_ids(
            pool, revision_id, query.strip(), normalize_identity_value(query), others) if others else []
        anchors = await anchor_search.find_anchors(
            pool, revision_id=revision_id, compiled=compiled, query=query, asked=asked, tsquery=tsquery,
            index_id=generation["index_id"] if ready else None, exact_ids=other_exact,
            allowed_workspaces=allowed_workspaces)
        if anchors:
            followed = await anchor_search.follow(
                pool, revision_id=revision_id, anchor_ids=[anchor["entityId"] for anchor in anchors],
                asked_ids=set(concept_ids), allowed_workspaces=allowed_workspaces)
            order = {anchor["entityId"]: place for place, anchor in enumerate(anchors)}
            for entity_id, reach in followed["reached"].items():
                # Nearer the first anchor ranks first; equals share a rank (see _Fusion.fuse).
                fusion.offer("linked", entity_id, -(order[reach["anchorId"]] * 100 + reach["links"]), "link")
    fusion.fuse(floor)
    ranked = fusion.ranked()
    ordered = list(exact_ids) + [entity_id for entity_id in ranked if entity_id not in exact_ids]
    rows = await search_store.entity_rows(pool, revision_id, ordered[: limit * 4])
    texts = await search_store.document_texts(pool, generation["index_id"], list(rows)) if ready else {}
    seeds = []
    has_more = False
    anchor_names = {anchor["entityId"]: anchor for anchor in anchors}
    for entity_id in ordered:
        if len(seeds) >= limit:
            # A visible match left out, or one not even read: the list is not the whole answer.
            entity = rows.get(entity_id)
            if entity is None or is_visible(entity, allowed_workspaces):
                has_more = True
                break
            continue
        entity = rows.get(entity_id)
        if entity is None or not is_visible(entity, allowed_workspaces):
            continue
        entry = fusion.entries.get(entity_id)
        methods = set(entry["parts"]) if entry else set()
        if entity_id in exact_ids:
            match_class = "exact"
        elif {"lexical", "vector"} <= methods:
            match_class = "hybrid"
        elif "lexical" in methods or "vector" in methods:
            match_class = "lexical" if "lexical" in methods else "vector"
        else:
            match_class = "linked"
        seed = {**describe_entity(entity, compiled),
                "snippet": (texts.get(entity_id) or "")[:settings.snippet_chars],
                "matchClass": match_class, "rank": len(seeds) + 1,
                "diagnostics": dict(entry["diagnostics"]) if entry else {}}
        if entry is not None:
            seed["diagnostics"]["fusedScore"] = round(entry["score"], 6)
            seed["matchedIn"] = "record" if entity_id in exact_ids else fusion.matched_in(entity_id)
            seed["passageOrdinals"] = fusion.best_passages(entity_id)
        reach = followed["reached"].get(entity_id)
        if reach is not None:
            anchor = anchor_names[reach["anchorId"]]
            seed["via"] = {"entityId": anchor["entityId"], "label": anchor["label"],
                           "conceptLabel": (compiled["concepts"].get(anchor["conceptId"]) or {}).get("label", ""),
                           "links": reach["links"], "path": _relation_steps(reach["path"], compiled)}
        seeds.append(seed)
    wanted = [(seed["entityId"], ordinal) for seed in seeds for ordinal in seed.pop("passageOrdinals", [])]
    passages = await search_store.passage_texts(pool, generation["index_id"], wanted) if wanted else {}
    for seed in seeds:
        found = [passages[key] for key in wanted if key[0] == seed["entityId"] and key in passages]
        if found:
            seed["passages"] = [{"fieldKey": passage["fieldKey"], "field": passage["fieldLabel"],
                                 "start": passage["start"], "end": passage["end"],
                                 "text": excerpt(passage["text"], terms, settings.excerpt_chars)} for passage in found]
    timings["seedMs"] = round((time.perf_counter() - started) * 1000)
    reached_per_anchor: dict[str, int] = {}
    for reach in followed["reached"].values():
        reached_per_anchor[reach["anchorId"]] = reached_per_anchor.get(reach["anchorId"], 0) + 1
    result: dict[str, Any] = {"seeds": seeds, "modeUsed": mode, "timings": timings, "hasMore": has_more,
                              "similarityFloor": round(floor, 4)}
    if anchors:
        result["anchors"] = [{
            "entityId": anchor["entityId"], "label": anchor["label"],
            "conceptLabel": (compiled["concepts"].get(anchor["conceptId"]) or {}).get("label", ""),
            "linkedCount": reached_per_anchor.get(anchor["entityId"], 0)} for anchor in anchors]
        result["linksTruncated"] = followed["truncated"]
    return result
