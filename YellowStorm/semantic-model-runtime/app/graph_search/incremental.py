"""Incremental search index generations.

After a population run (a refresh of one concept included) most records are what they were in the
model's previous ready generation. Such a record keeps its card, passages and vectors: they are copied
inside the database, and only the records whose inputs changed go through ``build_document``, the vector
cache and the embedding model.

What "changed" means is read from the previous generation's own snapshot, never from the population
tables: a revision can be stored again in place under the same id, so the rows the previous generation was
built from may be gone. Every card is stored with ``source_digest`` (``graph_search_store.entity_digests``:
the record's fields, its workspaces and the names of its linked records), and a record is unchanged when
the digest computed now equals the stored one. A renamed neighbour changes the digest of the records that
show its name, so link-affected cards rebuild without a separate neighbour walk.

The build is full (every card rebuilt, as before) when there is no previous generation to carry from, when
the cards are written differently (``card_digest``: concept and field labels, field set and order, key
components), or when more than ``INCREMENTAL_MAX_CHANGED_RATIO`` of the records changed: a carry then saves
little. The path taken and the reason are kept on the generation.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from app.persistence import graph_search_store as search_store
from app.persistence import population_store

# Above this share of changed records a carry is not worth its extra steps: build in full.
INCREMENTAL_MAX_CHANGED_RATIO = 0.30
# The parts of a concept ``build_document`` reads (and the label of a linked record's concept).
CARD_CONCEPT_KEYS = ("key", "label", "aliases", "keyComponents", "fieldAliases", "allowedFields")

FULL_NO_PREVIOUS = "no_previous_generation"
FULL_NOT_COMPARABLE = "previous_not_comparable"
FULL_SPECIFICATION = "specification_changed"
FULL_TOO_MANY_CHANGES = "too_many_changes"
FULL_EMPTY = "empty_revision"


class BuildHalt(Exception):
    """The build must end now: ``cancelled`` (stopped on request) or ``lease_lost``."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass
class BuildPlan:
    mode: str
    reason: str | None = None
    previous_index_id: str | None = None
    changed: list[str] = field(default_factory=list)

    @property
    def incremental(self) -> bool:
        return self.mode == "incremental"


# ``checkpoint(stage, loaded=..., **counts)``: stop if asked to, renew the lease, record and report the
# progress. Raises ``BuildHalt`` when the build must end.
Checkpoint = Callable[..., Awaitable[None]]


def card_digest(concepts: dict[str, Any]) -> str:
    """Digest of how the specification writes cards (see ``CARD_CONCEPT_KEYS``): two builds with the
    same digest, fingerprint and record inputs write the same cards."""
    body = {concept_id: {key: (concept or {}).get(key) for key in CARD_CONCEPT_KEYS}
            for concept_id, concept in sorted(concepts.items())}
    return "sha256:" + hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


async def plan_build(pool: Any, *, generation: dict[str, Any], digest: str, expected: int, page_size: int,
                     checkpoint: Checkpoint) -> BuildPlan:
    """Choose the build path. Incremental compares every record of the revision with the previous
    generation's snapshot, a page at a time, and gives up as soon as too many changed."""
    if not expected:
        return BuildPlan("full", FULL_EMPTY)
    previous = await search_store.previous_ready_generation(
        pool, generation["model_id"], generation["embedding_fingerprint"], generation["index_id"])
    if previous is None:
        return BuildPlan("full", FULL_NO_PREVIOUS)
    if not previous.get("card_digest"):
        return BuildPlan("full", FULL_NOT_COMPARABLE)
    if previous["card_digest"] != digest:
        return BuildPlan("full", FULL_SPECIFICATION)
    revision_id = generation["data_revision_id"]
    allowed = int(expected * INCREMENTAL_MAX_CHANGED_RATIO)
    changed: list[str] = []
    compared, after = 0, ""
    while True:
        ids = await search_store.revision_entity_ids(pool, revision_id, after, page_size)
        if not ids:
            break
        after = ids[-1]
        now = await search_store.entity_digests(pool, revision_id, ids)
        before = await search_store.document_digests(pool, previous["index_id"], ids)
        changed += [entity_id for entity_id in ids
                    if before.get(entity_id) is None or before[entity_id] != now.get(entity_id)]
        if len(changed) > allowed:
            return BuildPlan("full", FULL_TOO_MANY_CHANGES)
        compared += len(ids)
        await checkpoint("comparing", loaded=compared)
        if len(ids) < page_size:
            break
    return BuildPlan("incremental", None, previous["index_id"], changed)


async def carry(pool: Any, *, generation: dict[str, Any], plan: BuildPlan,
                checkpoint: Checkpoint) -> int:
    """Copy the cards, passages and vectors of the unchanged records from the previous generation, a chunk
    of records at a time. Returns how many records were carried (the unchanged ones of the revision)."""
    changed = set(plan.changed)
    carried, after = 0, ""
    while True:
        ids = await search_store.revision_entity_ids(
            pool, generation["data_revision_id"], after, search_store.CARRY_CHUNK_ROWS)
        if not ids:
            break
        after = ids[-1]
        unchanged = [entity_id for entity_id in ids if entity_id not in changed]
        await search_store.carry_documents(pool, from_index=plan.previous_index_id or "",
                                           to_index=generation["index_id"], entity_ids=unchanged)
        carried += len(unchanged)
        await checkpoint("carrying", loaded=carried, carried=carried)
        if len(ids) < search_store.CARRY_CHUNK_ROWS:
            break
    return carried


async def rebuild(pool: Any, *, generation: dict[str, Any], plan: BuildPlan, carried: int, page_size: int,
                  write_page: Callable[[list[dict[str, Any]]], Awaitable[Any]],
                  checkpoint: Checkpoint) -> int:
    """Write the cards of the changed records (``write_page``: build, digest and store a page of them).
    Records a resumed attempt already wrote are not written again. Returns how many records were
    rebuilt."""
    rebuilt = 0
    for start in range(0, len(plan.changed), page_size):
        chunk = plan.changed[start:start + page_size]
        written = await search_store.existing_document_ids(pool, generation["index_id"], chunk)
        entities = await population_store.list_revision_entities_by_id(
            pool, generation["data_revision_id"], [entity_id for entity_id in chunk if entity_id not in written])
        if entities:
            await write_page(entities)
        rebuilt += len(chunk)
        await checkpoint("documents", loaded=carried + rebuilt, carried=carried, rebuilt=rebuilt)
    return rebuilt


__all__ = ["BuildHalt", "BuildPlan", "INCREMENTAL_MAX_CHANGED_RATIO", "card_digest", "carry", "plan_build",
           "rebuild"]
