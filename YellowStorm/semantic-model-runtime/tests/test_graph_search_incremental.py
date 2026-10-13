"""Incremental search index generations: the choice of the build path, and what a build reports."""

from __future__ import annotations

from typing import Any

import pytest

from app.graph_search import incremental
from app.persistence import graph_search_store as search_store

GENERATION = {"index_id": "new", "model_id": "m", "data_revision_id": "dr-2", "embedding_fingerprint": "fp"}
CONCEPTS = {"c-1": {"key": "mail", "label": "Mail", "aliases": ["email"], "keyComponents": ["id"],
                    "fieldAliases": {"subject": ["title"]}, "allowedFields": ["id", "subject", "body"],
                    "populationMode": "materialized", "eligibility": None}}


def test_the_card_digest_follows_what_cards_are_written_with_and_nothing_else() -> None:
    digest = incremental.card_digest(CONCEPTS)
    assert incremental.card_digest({"c-1": {**CONCEPTS["c-1"], "eligibility": {"x": 1}, "populationMode": "lazy"}}) == digest
    for change in ({"label": "E-mail"}, {"aliases": []}, {"keyComponents": ["id", "n"]},
                   {"fieldAliases": {}}, {"allowedFields": ["id", "body", "subject"]}, {"key": "message"}):
        assert incremental.card_digest({"c-1": {**CONCEPTS["c-1"], **change}}) != digest, change
    assert incremental.card_digest({**CONCEPTS, "c-2": {"key": "x"}}) != digest


class _Store:
    """The previous generation's snapshot and the new revision's digests, in memory."""

    def __init__(self, before: dict[str, str | None], now: dict[str, str], previous: dict[str, Any] | None) -> None:
        self.before, self.now, self.previous = before, now, previous
        self.pages_read = 0
        self.carried: list[list[str]] = []

    async def previous_ready_generation(self, pool: Any, model_id: str, fingerprint: str, index_id: str) -> Any:
        assert (model_id, fingerprint, index_id) == ("m", "fp", "new")
        return self.previous

    async def revision_entity_ids(self, pool: Any, revision_id: str, after: str, limit: int) -> list[str]:
        self.pages_read += 1
        return [entity for entity in sorted(self.now) if entity > after][:limit]

    async def entity_digests(self, pool: Any, revision_id: str, ids: list[str]) -> dict[str, str]:
        return {entity: self.now[entity] for entity in ids}

    async def document_digests(self, pool: Any, index_id: str, ids: list[str]) -> dict[str, str | None]:
        assert index_id == "old"
        return {entity: self.before[entity] for entity in ids if entity in self.before}

    async def carry_documents(self, pool: Any, *, from_index: str, to_index: str, entity_ids: list[str]) -> tuple[int, int]:
        assert (from_index, to_index) == ("old", "new")
        self.carried.append(entity_ids)
        return len(entity_ids), 0


async def _checkpoint(stage: str, **counts: Any) -> None:
    return None


def _install(monkeypatch: pytest.MonkeyPatch, store: _Store) -> None:
    for name in ("previous_ready_generation", "revision_entity_ids", "entity_digests", "document_digests",
                 "carry_documents"):
        monkeypatch.setattr(search_store, name, getattr(store, name))


def _previous(**fields: Any) -> dict[str, Any]:
    return {"index_id": "old", "card_digest": "sha256:same", **fields}


@pytest.mark.asyncio
@pytest.mark.parametrize("previous, expected_reason", [
    (None, incremental.FULL_NO_PREVIOUS),
    ({"index_id": "old", "card_digest": None}, incremental.FULL_NOT_COMPARABLE),
    ({"index_id": "old", "card_digest": "sha256:other"}, incremental.FULL_SPECIFICATION)])
async def test_a_build_without_a_comparable_previous_generation_is_full(
        monkeypatch: pytest.MonkeyPatch, previous: Any, expected_reason: str) -> None:
    store = _Store({}, {"a": "1"}, previous)
    _install(monkeypatch, store)
    plan = await incremental.plan_build(object(), generation=GENERATION, digest="sha256:same", expected=1,
                                        page_size=10, checkpoint=_checkpoint)
    assert (plan.mode, plan.reason) == ("full", expected_reason)
    assert store.pages_read == 0  # no record is compared when the cards are written differently


@pytest.mark.asyncio
async def test_an_empty_revision_is_built_in_full(monkeypatch: pytest.MonkeyPatch) -> None:
    _install(monkeypatch, _Store({}, {}, _previous()))
    plan = await incremental.plan_build(object(), generation=GENERATION, digest="sha256:same", expected=0,
                                        page_size=10, checkpoint=_checkpoint)
    assert (plan.mode, plan.reason) == ("full", incremental.FULL_EMPTY)


@pytest.mark.asyncio
async def test_the_changed_set_is_what_is_new_different_or_stored_without_a_digest(monkeypatch: pytest.MonkeyPatch) -> None:
    now = {f"e{n:02d}": f"d{n}" for n in range(40)}
    before = {**now, "e03": "stale", "e07": None, "gone": "x"}
    del before["e11"]  # e11 is new; "gone" was removed
    store = _Store(before, now, _previous())
    _install(monkeypatch, store)
    stages: list[tuple[str, int]] = []

    async def checkpoint(stage: str, *, loaded: int, **counts: Any) -> None:
        stages.append((stage, loaded))

    plan = await incremental.plan_build(object(), generation=GENERATION, digest="sha256:same", expected=40,
                                        page_size=15, checkpoint=checkpoint)
    assert (plan.mode, plan.reason, plan.previous_index_id) == ("incremental", None, "old")
    assert plan.changed == ["e03", "e07", "e11"]
    assert stages == [("comparing", 15), ("comparing", 30), ("comparing", 40)]


@pytest.mark.asyncio
async def test_more_than_thirty_percent_changed_ends_the_comparison_at_once(monkeypatch: pytest.MonkeyPatch) -> None:
    now = {f"e{n:03d}": f"new{n}" for n in range(100)}
    store = _Store({entity: "old" for entity in now}, now, _previous())  # everything differs
    _install(monkeypatch, store)
    plan = await incremental.plan_build(object(), generation=GENERATION, digest="sha256:same", expected=100,
                                        page_size=20, checkpoint=_checkpoint)
    assert (plan.mode, plan.reason) == ("full", incremental.FULL_TOO_MANY_CHANGES)
    assert store.pages_read == 2  # 20 changed is under the 30 allowed, 40 is over: the other pages are not read


@pytest.mark.asyncio
async def test_exactly_thirty_percent_is_still_incremental(monkeypatch: pytest.MonkeyPatch) -> None:
    now = {f"e{n:03d}": f"d{n}" for n in range(100)}
    before = {entity: ("old" if n < 30 else digest) for n, (entity, digest) in enumerate(now.items())}
    _install(monkeypatch, _Store(before, now, _previous()))
    plan = await incremental.plan_build(object(), generation=GENERATION, digest="sha256:same", expected=100,
                                        page_size=50, checkpoint=_checkpoint)
    assert plan.mode == "incremental" and len(plan.changed) == 30


@pytest.mark.asyncio
async def test_carrying_copies_every_record_but_the_changed_ones_chunk_by_chunk(monkeypatch: pytest.MonkeyPatch) -> None:
    now = {f"e{n:02d}": "d" for n in range(25)}
    store = _Store({}, now, _previous())
    _install(monkeypatch, store)
    monkeypatch.setattr(search_store, "CARRY_CHUNK_ROWS", 10)
    seen: list[tuple[str, int]] = []

    async def checkpoint(stage: str, *, loaded: int, **counts: Any) -> None:
        seen.append((stage, counts["carried"]))

    plan = incremental.BuildPlan("incremental", None, "old", ["e03", "e24"])
    carried = await incremental.carry(object(), generation=GENERATION, plan=plan, checkpoint=checkpoint)
    assert carried == 23
    assert [len(chunk) for chunk in store.carried] == [9, 10, 4]
    assert all("e03" not in chunk and "e24" not in chunk for chunk in store.carried)
    assert seen == [("carrying", 9), ("carrying", 19), ("carrying", 23)]


@pytest.mark.asyncio
async def test_a_halt_requested_at_a_checkpoint_stops_the_carry_after_the_chunk_in_hand(monkeypatch: pytest.MonkeyPatch) -> None:
    store = _Store({}, {f"e{n:02d}": "d" for n in range(30)}, _previous())
    _install(monkeypatch, store)
    monkeypatch.setattr(search_store, "CARRY_CHUNK_ROWS", 10)

    async def checkpoint(stage: str, *, loaded: int, **counts: Any) -> None:
        if loaded >= 20:
            raise incremental.BuildHalt("cancelled")

    plan = incremental.BuildPlan("incremental", None, "old", [])
    with pytest.raises(incremental.BuildHalt) as halted:
        await incremental.carry(object(), generation=GENERATION, plan=plan, checkpoint=checkpoint)
    assert halted.value.reason == "cancelled" and len(store.carried) == 2
