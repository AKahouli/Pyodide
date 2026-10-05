"""Graph search settings: stop words, bounds, what changes the index fingerprint, per-field
passage overrides, and settings carried through indexing and retrieval."""

from __future__ import annotations

import pytest

from app.graph_search import indexer, retrieval
from app.graph_search.documents import build_document, query_terms, split_passages
from app.graph_search.retrieval import find_seeds
from app.graph_search.settings import (FieldIndexSettings, IndexSettings, PassagePlan, SearchSettings,
                                       ValidationError, index_fingerprint)

PROFILE_FP = "emb:0123456789abcdef0123456789abcdef"


# Stop words --------------------------------------------------------------------------------

def test_common_words_are_left_out_of_word_matching() -> None:
    assert query_terms("Contrat de maintenance pour la société Dupont et fils") == [
        "contrat", "maintenance", "societe", "dupont", "fils"]
    assert query_terms("the keys of the rack in the server room") == ["keys", "rack", "server", "room"]
    # Accents fold before the check: "où", "à", "été" are stop words too.
    assert query_terms("où été envoyé le devis à Lyon") == ["envoye", "devis", "lyon"]


def test_a_query_made_only_of_common_words_keeps_them() -> None:
    assert query_terms("de la") == ["de", "la"]
    assert query_terms("The Who") == ["the", "who"]


def test_stop_words_can_be_turned_off_or_extended() -> None:
    assert query_terms("contrat de service", SearchSettings(stopWords=False)) == ["contrat", "de", "service"]
    extended = SearchSettings(extraStopWords=["Société", "merci"])
    assert query_terms("Merci pour le contrat de la société Dupont", extended) == ["contrat", "dupont"]
    assert query_terms("a b c d e f g h", SearchSettings(stopWords=False, maxQueryTerms=3)) == []
    assert query_terms("alpha beta gamma delta", SearchSettings(maxQueryTerms=2)) == ["alpha", "beta"]


# Bounds -----------------------------------------------------------------------------------

@pytest.mark.parametrize("payload", [
    {"passageMinChars": 1000},                         # min >= target
    {"passageMaxChars": 900},                          # max <= target
    {"passageOverlapChars": 700},                      # overlap >= min
    {"cardValueChars": 300, "longFieldChars": 400},    # threshold above the card cap
    {"cardValueChars": 1500, "cardTextChars": 1000},   # card total below one value
    {"maxPassagesPerField": 60},                       # per record below per field
    {"passageTargetChars": 50},                        # below the range
    {"unknown": 1},
    {"fields": {"email": {"corps": {"passageMinChars": 1100}}}},  # merged override inconsistent
])
def test_index_settings_reject_inconsistent_values(payload) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(ValidationError):
        IndexSettings.model_validate(payload)


@pytest.mark.parametrize("payload", [
    {"defaultLimit": 30, "maxLimit": 25}, {"minSimilarity": 1.5}, {"rrfK": 0},
    {"extraStopWords": ["x" * 41]}, {"maxQueryTerms": 65},
])
def test_search_settings_reject_out_of_range_values(payload) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(ValidationError):
        SearchSettings.model_validate(payload)


def test_defaults_are_the_former_constants_and_env_remains_the_fallback(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    index = IndexSettings()
    assert (index.card_value_chars, index.card_text_chars, index.threshold, index.passage_target_chars,
            index.passage_min_chars, index.passage_max_chars, index.passage_overlap_chars,
            index.max_passages_per_field, index.max_passages_per_record) == (300, 2000, 300, 1000, 700, 1200,
                                                                             150, 20, 50)
    monkeypatch.setenv("SEMANTIC_SEARCH_MIN_SIMILARITY", "0.35")
    search = SearchSettings()
    assert search.min_similarity == 0.35
    assert SearchSettings(minSimilarity=0.5).min_similarity == 0.5
    assert (search.lexical_candidates, search.vector_candidates, search.rrf_k, search.default_limit,
            search.max_limit, search.passages_per_record, search.excerpt_chars, search.snippet_chars,
            search.max_query_terms) == (50, 50, 60, 10, 25, 2, 400, 400, 16)
    assert search.limit(None) == 10 and search.limit(80) == 25 and search.limit(3) == 3


# Fingerprint ------------------------------------------------------------------------------

def test_default_index_settings_keep_the_profile_fingerprint() -> None:
    assert index_fingerprint(PROFILE_FP, None) == PROFILE_FP
    assert index_fingerprint(PROFILE_FP, IndexSettings()) == PROFILE_FP
    # Spelled-out defaults and empty overrides are the defaults.
    spelled = IndexSettings(cardValueChars=300, longFieldChars=300,
                            fields={"email": {"corps": FieldIndexSettings()}})
    assert index_fingerprint(PROFILE_FP, spelled) == PROFILE_FP


def test_index_settings_and_field_overrides_change_the_fingerprint() -> None:
    target = index_fingerprint(PROFILE_FP, IndexSettings(passageTargetChars=900))
    header = index_fingerprint(PROFILE_FP, IndexSettings(passageHeader=False))
    field = index_fingerprint(PROFILE_FP, IndexSettings(fields={"email": {"corps": {"passageOverlapChars": 100}}}))
    other_field = index_fingerprint(PROFILE_FP, IndexSettings(fields={"email": {"sujet": {"passageOverlapChars": 100}}}))
    assert len({PROFILE_FP, target, header, field, other_field}) == 5
    assert target.startswith(PROFILE_FP + ":ix:") and len(target) <= 100
    # Stable: the same settings name the same generation, however they were spelled.
    assert target == index_fingerprint(PROFILE_FP, IndexSettings.model_validate(
        IndexSettings(passageTargetChars=900).canonical()))


def test_search_settings_never_reach_the_fingerprint() -> None:
    """Search settings live apart from index settings: a request with other search settings
    pins the same generation."""
    from app.api.graph_search_routes import RequestSettings
    one = RequestSettings.model_validate({"index": {"passageTargetChars": 900}, "search": {"rrfK": 10}})
    two = RequestSettings.model_validate({"index": {"passageTargetChars": 900},
                                          "search": {"rrfK": 90, "stopWords": False, "minSimilarity": 0.2}})
    assert index_fingerprint(PROFILE_FP, one.index) == index_fingerprint(PROFILE_FP, two.index)


# Per-field overrides ----------------------------------------------------------------------

def prose(sentences: int) -> str:
    return " ".join(f"Sentence {n} talks about the rack and the network switch of room {n}." for n in range(sentences))


CONCEPT = {"conceptId": "c-mail", "key": "email", "label": "E-mail", "keyComponents": [],
           "allowedFields": ["sujet", "corps", "resume"]}


def mail(**attributes: str) -> dict:
    return {"entityId": "m1", "conceptId": "c-mail", "label": "Rack keys", "identity": {},
            "attributes": attributes, "provenance": {}}


def test_a_field_override_cuts_its_field_with_its_own_sizes() -> None:
    body = prose(60)
    settings = IndexSettings(fields={"email": {"corps": {"passageTargetChars": 500, "passageMinChars": 400,
                                                         "passageMaxChars": 600, "passageOverlapChars": 80}}})
    default = build_document(mail(corps=body, resume=body), CONCEPT)
    custom = build_document(mail(corps=body, resume=body), CONCEPT, settings)
    custom_body = [p for p in custom["passages"] if p["fieldKey"] == "corps"]
    custom_resume = [p for p in custom["passages"] if p["fieldKey"] == "resume"]
    default_resume = [p for p in default["passages"] if p["fieldKey"] == "resume"]
    assert all(p["end"] - p["start"] <= 600 for p in custom_body)
    assert len(custom_body) > len([p for p in default["passages"] if p["fieldKey"] == "corps"])
    # The other field keeps the global sizes.
    assert [(p["start"], p["end"]) for p in custom_resume] == [(p["start"], p["end"]) for p in default_resume]
    # The whole body is still covered.
    assert custom_body[-1]["end"] == len(body)


def test_a_field_can_be_left_out_of_passages_or_searched_from_a_lower_threshold() -> None:
    body = prose(30)
    off = build_document(mail(corps=body), CONCEPT, IndexSettings(fields={"email": {"corps": {"passages": False}}}))
    assert off["passages"] == [] and "corps" in off["diagnostics"]["shortenedFields"]
    short = "A short summary that fits the card but is searched as a passage anyway, two hundred characters."
    assert build_document(mail(resume=short), CONCEPT)["passages"] == []
    lowered = build_document(mail(resume=short), CONCEPT,
                             IndexSettings(fields={"email": {"resume": {"longFieldChars": 50}}}))
    assert [p["fieldKey"] for p in lowered["passages"]] == ["resume"]
    globally = build_document(mail(resume=short), CONCEPT, IndexSettings(longFieldChars=50))
    assert [p["fieldKey"] for p in globally["passages"]] == ["resume"]


def test_card_caps_and_passage_header_follow_the_settings() -> None:
    body = prose(10)
    document = build_document(mail(corps=body), CONCEPT, IndexSettings(cardValueChars=150, passageHeader=False))
    assert "Corps: " + body[:150].rstrip() + "…" in document["searchText"]
    assert document["passages"][0]["searchText"] == document["passages"][0]["text"]
    with_header = build_document(mail(corps=body), CONCEPT)
    assert with_header["passages"][0]["searchText"].startswith("Type: E-mail\nName: Rack keys\nField: Corps\n")


def test_passage_caps_per_field_and_record_follow_the_settings() -> None:
    huge = prose(400)
    capped = build_document(mail(corps=huge, resume=huge), CONCEPT,
                            IndexSettings(maxPassagesPerField=3, maxPassagesPerRecord=5))
    assert [p["fieldKey"] for p in capped["passages"]] == ["corps"] * 3 + ["resume"] * 2
    assert capped["diagnostics"]["truncatedPassageFields"] == ["corps", "resume"]
    spans, cut_short = split_passages(huge, plan=PassagePlan(max_per_field=2))
    assert len(spans) == 2 and cut_short


# Settings carried through retrieval and indexing --------------------------------------------

class Store:
    def __init__(self) -> None:
        self.calls: list[tuple] = []

    async def exact_entity_ids(self, *_args, **_kwargs):  # type: ignore[no-untyped-def]
        return []

    async def lexical_candidates(self, *args):  # type: ignore[no-untyped-def]
        self.calls.append(("lexical", args[2], args[-1]))
        return [{"entityId": "a", "score": 0.5}, {"entityId": "b", "score": 0.4}]

    async def vector_candidates(self, *args):  # type: ignore[no-untyped-def]
        self.calls.append(("vector", args[-1]))
        return [{"entityId": "b", "similarity": 0.45}, {"entityId": "c", "similarity": 0.42}]

    async def lexical_passage_candidates(self, *args):  # type: ignore[no-untyped-def]
        self.calls.append(("passage_lexical", args[-2], args[-1]))
        return [{"entityId": "a", "score": 0.6, "passages": [{"ordinal": 0, "score": 0.6}, {"ordinal": 1, "score": 0.5}]}]

    async def vector_passage_candidates(self, *args):  # type: ignore[no-untyped-def]
        self.calls.append(("passage_vector", args[-2], args[-1]))
        return []

    async def entity_rows(self, _pool, _revision, ids):  # type: ignore[no-untyped-def]
        return {entity_id: {"entityId": entity_id, "conceptId": "c", "label": entity_id, "identity": {},
                            "provenance": {}} for entity_id in ids}

    async def document_texts(self, _pool, _index, ids):  # type: ignore[no-untyped-def]
        return {entity_id: "Type: Thing\nName: " + entity_id + " " + "x" * 500 for entity_id in ids}

    async def passage_texts(self, _pool, _index, keys):  # type: ignore[no-untyped-def]
        return {key: {"fieldKey": "body", "fieldLabel": "Body", "start": 0, "end": 900,
                      "text": "words " * 150 + "rack keys " + "words " * 50} for key in keys}


async def _embed(_profile, texts, *, query=False):  # type: ignore[no-untyped-def]
    return [[1.0] for _ in texts]


class Profile:
    fingerprint = PROFILE_FP


@pytest.mark.asyncio
async def test_search_settings_apply_to_one_request(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    store = Store()
    monkeypatch.setattr(retrieval, "search_store", store)
    monkeypatch.setattr(retrieval, "vector_literal", lambda vector: "[1]")
    settings = SearchSettings(lexicalCandidates=7, vectorCandidates=9, minSimilarity=0.44, passagesPerRecord=1,
                              snippetChars=120, excerptChars=150)
    fingerprint = PROFILE_FP + ":ix:abc"
    found = await find_seeds(None, revision_id="r", compiled={"concepts": {}}, query="the rack keys",
                             concept_ids=None, limit=10, allowed_workspaces=None,
                             generation={"index_id": "i", "state": "ready", "embedding_fingerprint": fingerprint},
                             profile=Profile(), embedder=_embed, settings=settings,  # type: ignore[arg-type]
                             index_fingerprint=fingerprint)
    assert found["modeUsed"] == "hybrid"
    assert ("lexical", ["rack", "keys"], 7) in store.calls and ("vector", 9) in store.calls
    assert ("passage_lexical", 7, 1) in store.calls
    # c is near only by meaning and below 0.44: dropped; b, found both ways, first.
    assert [seed["entityId"] for seed in found["seeds"]] == ["b", "a"]
    assert all(len(seed["snippet"]) == 120 for seed in found["seeds"])
    passages = found["seeds"][1]["passages"]
    assert len(passages) == 1 and len(passages[0]["text"]) <= 152 and "rack keys" in passages[0]["text"]
    # A generation built with other index settings is not compared with the query vector.
    other = await find_seeds(None, revision_id="r", compiled={"concepts": {}}, query="the rack keys",
                             concept_ids=None, limit=10, allowed_workspaces=None,
                             generation={"index_id": "i", "state": "ready", "embedding_fingerprint": PROFILE_FP},
                             profile=Profile(), embedder=_embed, settings=settings,  # type: ignore[arg-type]
                             index_fingerprint=fingerprint)
    assert other["modeUsed"] == "lexical_only"


class IndexStore:
    def __init__(self, latest: dict | None = None) -> None:
        self.generations: dict[str, dict] = {}
        self.latest = latest

    async def get_generation(self, _pool, revision_id, fingerprint):  # type: ignore[no-untyped-def]
        return self.generations.get(fingerprint)

    async def latest_index_settings(self, _pool, _model_id, _fingerprint):  # type: ignore[no-untyped-def]
        return self.latest

    async def create_generation(self, _pool, **row):  # type: ignore[no-untyped-def]
        generation = {"index_id": f"g{len(self.generations)}", "state": "ready", "job_id": None, "attempt": 1,
                      "model_id": row["model_id"], "embedding_fingerprint": row["fingerprint"],
                      "index_settings": row["index_settings"]}
        self.generations[row["fingerprint"]] = generation
        return generation


class Population:
    async def get_data_revision(self, _pool, revision_id):  # type: ignore[no-untyped-def]
        return {"model_id": "m1", "validation_state": "valid", "projection_ref": "age:x", "spec_hash": "h"}


@pytest.mark.asyncio
async def test_an_index_request_records_its_settings_and_a_later_one_reuses_them(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from app.graph_search import embeddings
    store = IndexStore()
    monkeypatch.setattr(indexer, "search_store", store)
    monkeypatch.setattr(indexer, "population_store", Population())
    monkeypatch.setattr(indexer, "is_live_projection_ref", lambda ref: True)
    monkeypatch.setattr(indexer, "profile_from_env", lambda: embeddings.EmbeddingProfile(
        base_url="http://x", api_key="", model="m", dimension=2560))

    async def admit(**_kwargs):  # type: ignore[no-untyped-def]
        raise AssertionError("a ready generation needs no job")

    profile_fp = indexer.profile_from_env().fingerprint
    default = await indexer.request_index(None, admit, revision_id="r1")
    assert default["fingerprint"] == profile_fp and default["generation"]["index_settings"] is None
    custom_settings = IndexSettings(passageTargetChars=800, fields={"email": {"corps": {"passages": False}}})
    custom = await indexer.request_index(None, admit, revision_id="r1", settings=custom_settings)
    assert custom["fingerprint"] != profile_fp
    assert custom["generation"]["index_settings"] == custom_settings.canonical()
    # A request without settings (after a population run) takes the model's latest ones.
    store.latest = custom["generation"]["index_settings"]
    again = await indexer.request_index(None, admit, revision_id="r1")
    assert again["fingerprint"] == custom["fingerprint"]
    assert indexer.stored_settings({"passageMinChars": "bad"}) == IndexSettings()
