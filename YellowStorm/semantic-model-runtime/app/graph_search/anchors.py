"""Search through another record: find the record a request names, then follow its links.

"Contrats de Carrefour" asks for contracts, but its words name a customer. When a request is
limited to some concepts (the records asked for), the records of the *other* concepts whose whole
name is written in the request, apart from the words naming the concepts asked for, are its
anchors ("Carrefour"). The records asked for that are linked to an anchor, through the fewest
stored links (at most ``MAX_LINKS``, read either way, every record on the way readable by the
actor), are then found through it, nearest first. A linked record matching the request's words
too ranks above one that is only linked.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

from app.persistence import graph_search_store as search_store

from .documents import STOP_WORDS, fold, words

MAX_ANCHORS = 3
# A record whose name has more words is a sentence (a fact, a subject line), not a name.
MAX_ANCHOR_WORDS = 8
# Anchor candidates read from the word index, per request.
ANCHOR_CANDIDATES = 25
MAX_LINKS = 3
# Links read per step of the walk out of the anchors; more and the walk is cut (``truncated``).
MAX_ROWS_PER_STEP = 5000
# Fields that hold what a record is called (folded field keys).
_NAME_FIELD = re.compile(r"(^|_)(name|nom|names|title|titre|label|libelle|raison_sociale|company|societe)(_|$)"
                         r"|^nom|name$")


def _stem(word: str) -> str:
    return re.sub(r"(?<=...)(es|s|x)$", "", word)


def _same_word(written: str, named: str) -> bool:
    """A word of a name is written in a request: as is, singular or plural, or with one letter
    off when it is long enough to tell."""
    if written == named or _stem(written) == _stem(named):
        return True
    return len(named) >= 5 and len(written) >= 5 and SequenceMatcher(None, written, named).ratio() >= 0.85


def name_words(name: Any) -> list[str]:
    """The words that make a name: no one-letter word, no common word."""
    return [word for word in words(name) if len(word) > 1 and word not in STOP_WORDS]


def concept_words(concepts: list[dict[str, Any]]) -> set[str]:
    """Words naming the concepts asked for (label, key, aliases): they ask, they do not name."""
    found: set[str] = set()
    for concept in concepts:
        for name in [concept.get("label"), concept.get("key"), *(concept.get("aliases") or [])]:
            found.update(name_words(re.sub(r"[_\-]+", " ", str(name or ""))))
    return found


def covers(request: list[str], name: Any) -> int:
    """How many words of the request a name is made of: 0 unless every word of the name is
    written in the request (and the name has at most ``MAX_ANCHOR_WORDS`` words)."""
    named = name_words(name)
    if not named or len(named) > MAX_ANCHOR_WORDS:
        return 0
    used: set[int] = set()
    for word in named:
        place = next((index for index, written in enumerate(request)
                      if index not in used and _same_word(written, word)), None)
        if place is None:
            return 0
        used.add(place)
    return len(used)


def names_of(entity: dict[str, Any], values: dict[str, Any]) -> list[Any]:
    """What a record is called: its name, its key values, and its fields that hold a name (a
    record named by its key, C001, often keeps its name in a field)."""
    names = [entity.get("label"), *(entity.get("identity") or {}).values()]
    names += [value for field, value in values.items()
              if isinstance(value, str) and _NAME_FIELD.search(fold(field))]
    return names


def request_words(query: str, asked: list[dict[str, Any]]) -> list[str]:
    """The words of a request that may name an anchor: those that do not name the concepts asked for."""
    naming = concept_words(asked)
    return [word for word in name_words(query)
            if not any(_same_word(word, concept_word) for concept_word in naming)]


async def find_anchors(pool: Any, *, revision_id: str, compiled: dict[str, Any], query: str,
                       asked: list[dict[str, Any]], tsquery: str | None, index_id: str | None,
                       exact_ids: list[str], allowed_workspaces: list[str] | None) -> list[dict[str, Any]]:
    """The records of other concepts than those asked for that the request names, best first:
    ``{entityId, conceptId, label, covered}``."""
    words_left = request_words(query, asked)
    if not words_left:
        return []
    asked_ids = {concept["conceptId"] for concept in asked}
    others = [concept_id for concept_id in compiled["concepts"] if concept_id not in asked_ids]
    if not others:
        return []
    candidates = list(exact_ids)
    if index_id is not None:
        # Names are words of the request: the word index finds them, and their spelling is checked below.
        # Concept by concept, so many records of one (a name repeated on every participation) never
        # crowd out the one record of another that bears it.
        named = " | ".join(words_left)
        for concept_id in others:
            for row in await search_store.lexical_candidates(
                    pool, index_id, named, fold(" ".join(words_left)), [concept_id], allowed_workspaces,
                    ANCHOR_CANDIDATES):
                if row["entityId"] not in candidates:
                    candidates.append(row["entityId"])
    rows = await search_store.entity_rows(pool, revision_id, candidates)
    values = await search_store.entity_attributes(pool, revision_id, candidates)
    from .retrieval import is_visible  # retrieval imports this module

    anchors = []
    for place, entity_id in enumerate(candidates):
        entity = rows.get(entity_id)
        if entity is None or entity["conceptId"] in asked_ids or not is_visible(entity, allowed_workspaces):
            continue
        scored = [(covers(words_left, name), str(name)) for name in names_of(entity, values.get(entity_id) or {})]
        covered, name = max(scored, key=lambda pair: pair[0], default=(0, ""))
        if covered:
            # Named as the request names it ("Sony"), not by its key when that is its label.
            anchors.append({"entityId": entity_id, "conceptId": entity["conceptId"],
                            "label": name, "covered": covered, "place": place})
    # The name covering most of the request first (a full name beats a first name), then word rank.
    anchors.sort(key=lambda anchor: (-anchor["covered"], anchor["place"]))
    best = [anchor for anchor in anchors if anchor["covered"] == anchors[0]["covered"]] if anchors else []
    # One concept: the one where the name is rarest. A person is one correspondent but names each of
    # their participations; walking from the one record reaches everything the others do.
    per_concept: dict[str, list[dict[str, Any]]] = {}
    for anchor in best:
        per_concept.setdefault(anchor["conceptId"], []).append(anchor)
    chosen = min(per_concept.values(), key=lambda group: (len(group), group[0]["place"]), default=[])
    return [{key: value for key, value in anchor.items() if key != "place"} for anchor in chosen][:MAX_ANCHORS]


async def follow(pool: Any, *, revision_id: str, anchor_ids: list[str], asked_ids: set[str],
                 allowed_workspaces: list[str] | None, max_links: int = MAX_LINKS) -> dict[str, Any]:
    """The records of the concepts asked for nearest the anchors along stored links: the walk
    stops at the first number of links that reaches any. Records asked for end a path (a walk
    never goes on through one). Returns ``{"reached": {entityId: {"anchorId", "links", "path"}},
    "truncated": bool}``; ``path`` lists ``(relationId, direction)`` from the anchor."""
    parents: dict[str, tuple[str, str, str] | None] = {anchor_id: None for anchor_id in anchor_ids}
    origin = {anchor_id: anchor_id for anchor_id in anchor_ids}
    reached: dict[str, int] = {}
    frontier = list(anchor_ids)
    truncated = False
    for links in range(1, max_links + 1):
        rows = await search_store.neighbours(pool, revision_id, frontier, allowed_workspaces, MAX_ROWS_PER_STEP + 1)
        if len(rows) > MAX_ROWS_PER_STEP:
            truncated, rows = True, rows[:MAX_ROWS_PER_STEP]
        following: list[str] = []
        for row in rows:
            other = row["to"]
            if other in parents:
                continue
            parents[other] = (row["from"], row["relationId"], row["direction"])
            origin[other] = origin[row["from"]]
            if row["conceptId"] in asked_ids:
                reached[other] = links
            else:
                following.append(other)
        if reached or not following:
            break
        frontier = following

    def path(entity_id: str) -> list[tuple[str, str]]:
        steps = []
        while (parent := parents.get(entity_id)) is not None:
            steps.append((parent[1], parent[2]))
            entity_id = parent[0]
        return steps[::-1]

    return {"reached": {entity_id: {"anchorId": origin[entity_id], "links": links, "path": path(entity_id)}
                        for entity_id, links in reached.items()},
            "truncated": truncated}
