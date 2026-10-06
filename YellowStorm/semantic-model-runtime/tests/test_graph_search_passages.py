"""Passages of long fields: how a long text is cut, what is indexed, and how a passage
hit ranks its record next to the record cards (no database: the store is faked)."""

from __future__ import annotations

import re

import pytest

import app.graph_search.retrieval as retrieval
from app.graph_search.documents import (MAX_PASSAGES_PER_FIELD, MAX_PASSAGES_PER_RECORD, MAX_VALUE_CHARS,
                                        PASSAGE_MAX_CHARS, PASSAGE_OVERLAP_CHARS, build_document,
                                        split_passages)
from app.graph_search.retrieval import excerpt, find_seeds

SENTENCES = ["The supplier confirmed the delivery of the replacement servers.",
             "Invoices are payable within thirty days of receipt.",
             "Our team will schedule the migration over the weekend.",
             "Please send the signed purchase order before Friday.",
             "The warranty covers parts and labour for three years."]


def prose(paragraphs: int) -> str:
    return "\n\n".join(" ".join(SENTENCES[(p + s) % 5] for s in range(4)) for p in range(paragraphs))


def collapse(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def test_a_long_text_is_cut_on_boundaries_with_bounded_overlap_and_nothing_lost() -> None:
    value = "  " + prose(30) + "\n"
    spans, truncated = split_passages(value)
    assert not truncated and len(spans) > 3
    covered = set()
    for index, (start, end) in enumerate(spans):
        assert end - start <= PASSAGE_MAX_CHARS
        assert not value[start].isspace() and not value[end - 1].isspace()
        assert value[start].isupper()  # a passage starts a sentence
        if index < len(spans) - 1:
            assert value[end - 1] == "."  # and ends one: paragraph or sentence boundary
            following = spans[index + 1][0]
            assert 0 < end - following <= PASSAGE_OVERLAP_CHARS
        covered.update(range(start, end))
    assert all(index in covered for index, char in enumerate(value) if not char.isspace())
    assert spans == split_passages(value)[0]  # deterministic


def test_a_text_without_boundaries_and_the_caps() -> None:
    spans, truncated = split_passages("x" * 3000)
    assert spans == [(0, 1200), (1200, 2400), (2400, 3000)] and not truncated
    assert split_passages("   ") == ([], False)
    spans, truncated = split_passages(prose(60), limit=3)
    assert len(spans) == 3 and truncated


CONCEPT = {"conceptId": "c-mail", "key": "email", "label": "E-mail", "keyComponents": ["message_id"],
           "allowedFields": ["message_id", "subject", "body", "notes"], "fieldAliases": {"body": ["Corps"]}}


def mail(body: str, **attributes) -> dict:  # type: ignore[no-untyped-def]
    return {"entityId": "mail:1", "conceptId": "c-mail", "label": "Re: servers", "identity": {"message_id": "m1"},
            "attributes": {"subject": "Re: servers", "body": body, **attributes},
            "provenance": {"sources": [{"assetRef": {"workspaceId": "ws1", "assetId": "a1"}}]}}


def test_the_card_stays_bounded_and_the_long_field_becomes_passages() -> None:
    body = prose(12)
    short = build_document(mail("A short body."), CONCEPT)
    document = build_document(mail(body), CONCEPT)
    assert short["passages"] == [] and "diagnostics" in short
    # The card is what it was: the body cut at MAX_VALUE_CHARS.
    assert "Body (Corps): " + collapse(body)[:MAX_VALUE_CHARS].rstrip() + "…" in document["searchText"]
    passages = document["passages"]
    assert len(passages) > 2 and document["diagnostics"]["passageFields"] == {"body": len(passages)}
    assert [p["ordinal"] for p in passages] == list(range(len(passages)))
    for passage in passages:
        assert passage["fieldKey"] == "body" and passage["fieldLabel"] == "Body"
        assert passage["text"] == collapse(body[passage["start"]:passage["end"]])
        assert passage["searchText"] == "Type: E-mail\nName: Re: servers\nField: Body (Corps)\n" + passage["text"]
        assert passage["lexicalText"] == passage["text"].lower()
        assert passage["contentHash"].startswith("sha256:")
    assert build_document(mail(body), CONCEPT) == document
    # Another record with the same body has the same passage texts: vectors are reused.
    other = build_document({**mail(body), "entityId": "mail:2"}, CONCEPT)
    assert [p["contentHash"] for p in other["passages"]] == [p["contentHash"] for p in passages]


def test_fields_left_off_the_card_get_passages_and_the_record_cap_is_reported() -> None:
    crowded = build_document(mail("x " * 140, notes="Remember the rack keys.",
                                  subject="s" * 299), {**CONCEPT, "allowedFields": [
        "message_id", "subject", "body", "notes"] + [f"f{i}" for i in range(12)]} | {"fieldAliases": {}})
    assert crowded["passages"] == []  # nothing too long, nothing omitted
    many = {f"f{i}": "w" * 250 for i in range(12)}
    omitted = build_document({**mail("body"), "attributes": {"subject": "s", "body": "b", **many}},
                             {**CONCEPT, "allowedFields": ["message_id", "subject", "body", *many]})
    assert omitted["diagnostics"]["omittedFields"]
    assert {p["fieldKey"] for p in omitted["passages"]} == set(omitted["diagnostics"]["omittedFields"])
    huge = build_document(mail(prose(400), notes=prose(400)), CONCEPT)
    assert len(huge["passages"]) == MAX_PASSAGES_PER_FIELD * 2 <= MAX_PASSAGES_PER_RECORD
    assert huge["diagnostics"]["truncatedPassageFields"] == ["body", "notes"]
    capped = build_document({**mail(prose(400)), "attributes": {
        "subject": "s", "body": prose(400), "notes": prose(400), "extra": prose(400)}},
        {**CONCEPT, "allowedFields": ["message_id", "subject", "body", "notes", "extra"]})
    assert len(capped["passages"]) == MAX_PASSAGES_PER_RECORD
    assert capped["diagnostics"]["truncatedPassageFields"] == ["body", "notes", "extra"]


def test_excerpt_centres_on_the_rarest_query_words() -> None:
    text = collapse(prose(3)) + " Le contrat prévoit une pénalité de retard. " + collapse(prose(3))
    cut = excerpt(text, ["de", "penalite", "retard"])
    assert "pénalité de retard" in cut and len(cut) <= 402
    assert cut.startswith("…") and cut.endswith("…")
    assert excerpt(text, ["absent"]).startswith(text[:50])
    assert excerpt("short text", ["x"]) == "short text"


# Fusion: the store is replaced by fixed candidate lists ------------------------------------

def entity(entity_id: str, workspace: str = "ws1") -> dict:
    return {"entityId": entity_id, "conceptId": "c-mail", "label": entity_id, "identity": {},
            "provenance": {"sources": [{"assetRef": {"workspaceId": workspace, "assetId": "a"}}]}}


class FakeStore:
    def __init__(self, **lists) -> None:  # type: ignore[no-untyped-def]
        self.lists = {"exact": [], "lexical": [], "vector": [], "passage_lexical": [], "passage_vector": [],
                      **lists}
        self.rows = {name: entity(name) for name in ("short", "mail", "other", "hidden", "exact")}
        self.rows["hidden"] = entity("hidden", "ws-secret")
        self.PASSAGES_PER_RECORD = 2

    async def exact_entity_ids(self, *_args, **_kwargs):  # type: ignore[no-untyped-def]
        return self.lists["exact"]

    async def lexical_candidates(self, *_args):  # type: ignore[no-untyped-def]
        return self.lists["lexical"]

    async def vector_candidates(self, *_args):  # type: ignore[no-untyped-def]
        return self.lists["vector"]

    async def lexical_passage_candidates(self, *_args):  # type: ignore[no-untyped-def]
        return self.lists["passage_lexical"]

    async def vector_passage_candidates(self, *_args):  # type: ignore[no-untyped-def]
        return self.lists["passage_vector"]

    async def entity_rows(self, _pool, _revision, ids):  # type: ignore[no-untyped-def]
        return {entity_id: self.rows[entity_id] for entity_id in ids if entity_id in self.rows}

    async def document_texts(self, _pool, _index, ids):  # type: ignore[no-untyped-def]
        return {entity_id: f"Type: E-mail\nName: {entity_id}" for entity_id in ids}

    async def passage_texts(self, _pool, _index, keys):  # type: ignore[no-untyped-def]
        return {key: {"fieldKey": "body", "fieldLabel": "Body", "start": key[1] * 850,
                      "end": key[1] * 850 + 1000, "text": f"passage {key[1]} of {key[0]}: the rack keys are at the desk"}
                for key in keys}


async def _embed(_profile, texts, *, query=False):  # type: ignore[no-untyped-def]
    return [[1.0] for _ in texts]


class Profile:
    fingerprint = "fp"


GENERATION = {"index_id": "i1", "state": "ready", "embedding_fingerprint": "fp"}


async def seeds(monkeypatch: pytest.MonkeyPatch, store: FakeStore, allowed=None) -> list[dict]:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(retrieval, "search_store", store)
    monkeypatch.setattr(retrieval, "vector_literal", lambda vector: "[1]")
    monkeypatch.setenv("SEMANTIC_SEARCH_MIN_SIMILARITY", "0.4")
    found = await find_seeds(None, revision_id="r", compiled={"concepts": {}}, query="where are the rack keys",
                             concept_ids=None, limit=10, allowed_workspaces=allowed, generation=GENERATION,
                             profile=Profile(), embedder=_embed)  # type: ignore[arg-type]
    assert found["modeUsed"] == "hybrid"
    return found["seeds"]


def hit(entity_id: str, score: float, *ordinals: int, key: str = "similarity") -> dict:
    return {"entityId": entity_id, key: score, "passages": [{"ordinal": o, key: score} for o in ordinals]}


@pytest.mark.asyncio
async def test_a_record_found_only_by_a_deep_passage_ranks_and_carries_it(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    store = FakeStore(vector=[{"entityId": "other", "similarity": 0.45}],
                      passage_lexical=[hit("mail", 0.3, 4, key="score")],
                      passage_vector=[hit("mail", 0.62, 4, 5)])
    found = await seeds(monkeypatch, store)
    assert [seed["entityId"] for seed in found] == ["mail", "other"]
    mail_seed = found[0]
    assert mail_seed["matchClass"] == "hybrid" and mail_seed["matchedIn"] == "passage"
    assert mail_seed["diagnostics"] | {"fusedScore": 0} == {
        "lexicalRank": 1, "lexicalFrom": "passage", "vectorRank": 1, "similarity": 0.62, "vectorFrom": "passage",
        "fusedScore": 0}
    assert [p["start"] for p in mail_seed["passages"]] == [4 * 850, 5 * 850]  # best passage first
    assert mail_seed["passages"][0] == {"fieldKey": "body", "field": "Body", "start": 3400, "end": 4400,
                                        "text": "passage 4 of mail: the rack keys are at the desk"}
    assert found[1]["matchedIn"] == "record" and "passages" not in found[1]


@pytest.mark.asyncio
async def test_a_passage_competes_with_cards_on_the_same_scale(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    # "short" matches best on its card; "mail" has passages too, but weaker than "short"'s card:
    # being in more lists gives "mail" nothing.
    store = FakeStore(lexical=[{"entityId": "short", "score": 1.0}, {"entityId": "mail", "score": 0.5}],
                      vector=[{"entityId": "short", "similarity": 0.7}, {"entityId": "mail", "similarity": 0.6}],
                      passage_lexical=[hit("mail", 0.4, 1, key="score")], passage_vector=[hit("mail", 0.65, 1)])
    found = await seeds(monkeypatch, store)
    assert [seed["entityId"] for seed in found] == ["short", "mail"]
    assert found[1]["diagnostics"]["vectorFrom"] == "passage"  # a tie of card and passage: "record"
    assert found[1]["matchedIn"] == "record"
    assert found[1]["diagnostics"]["lexicalFrom"] == "record"
    # A passage closer to the request than any card puts its record first.
    store.lists["passage_vector"] = [hit("mail", 0.8, 1)]
    store.lists["passage_lexical"] = [hit("mail", 1.5, 1, key="score")]
    found = await seeds(monkeypatch, store)
    assert [seed["entityId"] for seed in found] == ["mail", "short"]
    assert found[0]["passages"][0]["start"] == 850


@pytest.mark.asyncio
async def test_floor_exact_first_and_visibility_apply_to_passages(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    store = FakeStore(exact=["exact"], passage_vector=[hit("other", 0.3, 0), hit("hidden", 0.9, 0), hit("mail", 0.5, 2)],
                      passage_lexical=[hit("other", 0.1, 3, key="score")])
    found = await seeds(monkeypatch, store, allowed=["ws1"])
    # Below the floor but sharing words: kept (and ranked by both). Hidden workspace: never returned.
    assert [seed["entityId"] for seed in found] == ["exact", "other", "mail"]
    assert found[0]["matchClass"] == "exact" and "matchedIn" not in found[0]
    store.lists["passage_lexical"] = []
    found = await seeds(monkeypatch, store, allowed=["ws1"])
    assert [seed["entityId"] for seed in found] == ["exact", "mail"]  # vector-only below the floor: dropped
