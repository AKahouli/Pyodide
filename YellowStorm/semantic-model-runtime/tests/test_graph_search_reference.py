"""A written reference in the request (a dossier number such as AV-2026-0135) names its record:
records carrying it come first, those saying most of the rest of the request first among them
(no database: the store is faked)."""

from __future__ import annotations

import pytest

import app.graph_search.retrieval as retrieval
from app.graph_search.documents import reference_phrases
from app.graph_search.retrieval import find_seeds

OPENING = "[av-2026-0135] outillage specialise indisponible - actif sim-0135 - lot 10 | etape 01 - position et preuves"
REPLY_02 = "[av-2026-0135] outillage specialise indisponible - actif sim-0135 - lot 10 | re: etape 02 - position et preuves"
REPLY_FOLLOWUP = "[av-2026-0135] outillage specialise indisponible - actif sim-0135 - lot 10 | re: suivi 02 - registre"
OTHER_DOSSIER = "[av-2026-0012] panne reapparue apres reparation - actif sim-0012 - lot 01 | re: etape 07 - position et preuves"
LONGER_NUMBER = "[av-2026-01350] autre dossier | etape 01 - position et preuves"


def test_a_written_reference_is_a_multi_part_token_with_a_digit_or_an_at_sign() -> None:
    assert reference_phrases("AV-2026-0135 Etape 01 Position et preuves") == ["av-2026-0135"]
    assert reference_phrases("mails de [AV-2026-0135], puis INV-2024-001.") == ["av-2026-0135", "inv-2024-001"]
    assert reference_phrases("alice.martin@acme.com") == ["alice.martin@acme.com"]
    # Plain words, a lone number and a hyphenated word are not references.
    assert reference_phrases("Etape 01 en retard") == []
    assert reference_phrases("rendez-vous 2026") == []


def entity(entity_id: str, label: str) -> dict:
    return {"entityId": entity_id, "conceptId": "c-mail", "label": label, "identity": {},
            "provenance": {"sources": [{"assetRef": {"workspaceId": "ws1", "assetId": "a"}}]}}


class Store:
    def __init__(self, referenced: list[dict], lexical: list[dict], vector: list[dict]) -> None:
        self.referenced, self.lexical, self.vector = referenced, lexical, vector
        self.reference_calls: list[tuple] = []
        self.tsqueries: list[str | None] = []
        labels = {item["entityId"]: item["labelKey"] for item in referenced}
        labels.update(other=OTHER_DOSSIER)
        self.rows = {entity_id: entity(entity_id, label) for entity_id, label in labels.items()}

    async def exact_entity_ids(self, *_args, **_kwargs):  # type: ignore[no-untyped-def]
        return []

    async def reference_candidates(self, _pool, index_id, phrases, concept_ids, allowed, limit):  # type: ignore[no-untyped-def]
        self.reference_calls.append((index_id, phrases, concept_ids, allowed, limit))
        return self.referenced

    async def lexical_candidates(self, _pool, _index, tsquery, *_args):  # type: ignore[no-untyped-def]
        self.tsqueries.append(tsquery)
        return self.lexical

    async def vector_candidates(self, *_args):  # type: ignore[no-untyped-def]
        return self.vector

    async def lexical_passage_candidates(self, *_args):  # type: ignore[no-untyped-def]
        return []

    async def vector_passage_candidates(self, *_args):  # type: ignore[no-untyped-def]
        return []

    async def entity_rows(self, _pool, _revision, ids):  # type: ignore[no-untyped-def]
        return {entity_id: self.rows[entity_id] for entity_id in ids if entity_id in self.rows}

    async def document_texts(self, _pool, _index, ids):  # type: ignore[no-untyped-def]
        return {entity_id: f"Name: {entity_id}" for entity_id in ids}

    async def passage_texts(self, _pool, _index, _keys):  # type: ignore[no-untyped-def]
        return {}


async def _embed(_profile, texts, *, query=False):  # type: ignore[no-untyped-def]
    return [[1.0] for _ in texts]


class Profile:
    fingerprint = "fp"


GENERATION = {"index_id": "i1", "state": "ready", "embedding_fingerprint": "fp"}


async def search(monkeypatch: pytest.MonkeyPatch, store: Store, query: str, allowed=None) -> list[dict]:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(retrieval, "search_store", store)
    monkeypatch.setattr(retrieval, "vector_literal", lambda vector: "[1]")
    found = await find_seeds(None, revision_id="r", compiled={"concepts": {}}, query=query, concept_ids=None,
                             limit=10, allowed_workspaces=allowed, generation=GENERATION, profile=Profile(),
                             embedder=_embed)  # type: ignore[arg-type]
    return found["seeds"]


def referenced() -> list[dict]:
    return [{"entityId": "reply-followup", "labelKey": REPLY_FOLLOWUP},
            {"entityId": "reply-02", "labelKey": REPLY_02},
            {"entityId": "opening", "labelKey": OPENING},
            {"entityId": "longer", "labelKey": LONGER_NUMBER}]


@pytest.mark.asyncio
async def test_the_record_carrying_the_reference_and_the_most_words_comes_first(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    # By words and meaning alone, a reply of another dossier that says "etape ... position et preuves" leads.
    store = Store(referenced(),
                  lexical=[{"entityId": "other", "score": 2.0}, {"entityId": "reply-02", "score": 1.0}],
                  vector=[{"entityId": "other", "similarity": 0.9}, {"entityId": "reply-02", "similarity": 0.8}])
    found = await search(monkeypatch, store, "AV-2026-0135 Etape 01 Position et preuves", allowed=["ws1"])
    assert [seed["entityId"] for seed in found] == ["opening", "reply-02", "reply-followup", "other"]
    # "longer" holds av-2026-01350, not the reference: dropped from the leading group, not returned as a match.
    assert "longer" not in [seed["entityId"] for seed in found[:3]]
    assert found[0]["diagnostics"]["referenceWords"] == 4  # etape, 01, position, preuves
    assert found[1]["diagnostics"]["referenceWords"] == 3  # no "01"
    assert found[2]["diagnostics"]["referenceWords"] == 0
    assert "referenceWords" not in found[3]["diagnostics"]
    assert found[0]["matchClass"] == "lexical"  # a word match, not an exact name
    index_id, phrases, concept_ids, allowed, _limit = store.reference_calls[0]
    assert (index_id, phrases, concept_ids, allowed) == ("i1", ["av-2026-0135"], None, ["ws1"])
    # The common words of the request do not widen the word search: only the dossier is read.
    assert store.tsqueries == ["(av <-> 2026 <-> 0135)"]


@pytest.mark.asyncio
async def test_a_reference_no_record_carries_keeps_the_ordinary_word_search(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    store = Store([], lexical=[{"entityId": "other", "score": 2.0}], vector=[{"entityId": "other", "similarity": 0.9}])
    found = await search(monkeypatch, store, "AV-2026-9999 Etape 01 Position et preuves")
    assert [seed["entityId"] for seed in found] == ["other"]
    assert store.tsqueries == ["(av <-> 2026 <-> 9999) | etape | 01 | position | preuves"]


@pytest.mark.asyncio
async def test_a_request_without_a_reference_is_ranked_as_before(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    store = Store(referenced(), lexical=[{"entityId": "other", "score": 2.0}],
                  vector=[{"entityId": "other", "similarity": 0.9}])
    found = await search(monkeypatch, store, "etape 01 position et preuves")
    assert [seed["entityId"] for seed in found] == ["other"]
    assert store.reference_calls == []  # no extra read
