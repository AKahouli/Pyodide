"""How records are written for search and how a request is read: lists and JSON values,
linked records' names, words split on signs, the adaptive similarity floor, and the names a
request gives to records of other concepts (anchors)."""

from __future__ import annotations

from app.graph_search.anchors import covers, names_of, request_words
from app.graph_search.documents import (LINKED_TEXT_CHARS, MAX_LINKED_NAMES, build_document, lexical_query,
                                        lexical_text)
from app.graph_search.embeddings import EmbeddingProfile
from app.graph_search.retrieval import similarity_floor, vectors_comparable
from app.graph_search.settings import SearchSettings

CONCEPT = {"key": "contract", "label": "Contract", "keyComponents": ["id"],
           "allowedFields": ["title", "tags", "parties", "terms"]}


def record(**attributes):  # type: ignore[no-untyped-def]
    return {"entityId": "e-1", "conceptId": "c", "label": "CT001", "identity": {"id": "CT001"},
            "attributes": attributes, "provenance": {}}


def test_lists_and_json_values_are_written_out() -> None:
    document = build_document(record(title="Master", tags=["urgent", "énergie"],
                                     parties='[{"name": "Sony", "role": "client"}, {"name": "Acme"}]',
                                     terms={"duration": 3, "renewal": {"notice": "6 months"}}), CONCEPT)
    text = document["searchText"]
    assert "Tags: urgent, énergie" in text
    assert "Parties: Name: Sony; Role: client, Name: Acme" in text
    assert "Terms: Duration: 3; Renewal: Notice: 6 months" in text
    # Not a JSON list after all: kept as written.
    assert "Tags: [draft" in build_document(record(tags="[draft"), CONCEPT)["searchText"]


def test_a_long_list_is_split_into_passages_like_a_long_text() -> None:
    clauses = [f"Clause {n}: the supplier delivers on time and in full." for n in range(40)]
    document = build_document(record(terms=clauses), CONCEPT)
    assert document["diagnostics"]["passageFields"]["terms"] >= 2
    assert "Clause 39" in document["passages"][-1]["text"]


def test_the_card_names_linked_records_bounded() -> None:
    links = [{"concept": "Customer", "name": "Sony"}, {"concept": "Customer", "name": "Sony"},
             *({"concept": "Invoice", "name": f"INV-{n}"} for n in range(MAX_LINKED_NAMES + 2)),
             {"concept": "Invoice", "more": 5}, {"concept": "Note", "name": "x" * 200}]
    document = build_document(record(title="Master"), CONCEPT, links=links)
    lines = document["searchText"].splitlines()
    assert "Linked Customer: Sony" in lines
    invoices = next(line for line in lines if line.startswith("Linked Invoice: "))
    assert invoices.count("INV-") == MAX_LINKED_NAMES and invoices.endswith("(+7)")
    note = next(line for line in lines if line.startswith("Linked Note: "))
    assert len(note) < 100 and note.endswith("…")
    assert sum(len(line) + 1 for line in lines if line.startswith("Linked ")) <= LINKED_TEXT_CHARS + 1
    # A record with only a name and keys, but links, is worth a vector.
    assert build_document(record(), CONCEPT, links=links[:1])["exactOnly"] is False
    assert build_document(record(), CONCEPT)["exactOnly"] is True


def test_words_are_split_on_every_sign_in_the_text_and_in_the_request() -> None:
    assert lexical_text("Contact: Jane.Doe@Sony.com, ref INV-2024-001 (été)") == \
        "contact jane doe sony com ref inv 2024 001 ete"
    assert lexical_query("jane.doe@sony.com contrats de l'INV-2024-001") == \
        "(jane <-> doe <-> sony <-> com) | contrats | (l <-> inv <-> 2024 <-> 001)"
    assert lexical_query("de la") == "de | la"
    assert lexical_query("Dupont et fils") == "dupont | fils"
    assert lexical_query("!!") is None
    assert lexical_query("a b c d", SearchSettings(stopWords=False, maxQueryTerms=2)) is None
    assert lexical_query("alpha beta gamma", SearchSettings(maxQueryTerms=2)) == "alpha | beta"


def test_the_similarity_floor_follows_the_request() -> None:
    settings = SearchSettings(minSimilarity=0.4)
    unrelated = [0.34 + n * 0.001 for n in range(40)]
    assert similarity_floor(unrelated, settings) == 0.4  # nothing stands out: the set floor
    related = [0.38] * 30 + [0.46, 0.5, 0.55, 0.59]
    assert round(similarity_floor(related, settings), 3) == round(0.38 + 0.3 * (0.59 - 0.38), 3)
    # Another model's scale: everything lower, the near ones still stand out and are kept.
    lower = [0.12] * 30 + [0.25, 0.3]
    assert 0.2 <= similarity_floor(lower, settings) < 0.25
    assert similarity_floor([0.1, 0.9], settings) == 0.4  # too few to judge
    assert similarity_floor(related, SearchSettings(minSimilarity=0.4, adaptiveSimilarity=False)) == 0.4


def test_vectors_compare_across_text_formats_of_one_vector_space() -> None:
    profile = EmbeddingProfile(base_url="http://e", api_key="", model="m", dimension=2560)
    other = EmbeddingProfile(base_url="http://e", api_key="", model="n", dimension=2560)
    assert profile.fingerprint != profile.vector_fingerprint and profile.vector_fingerprint != other.vector_fingerprint
    assert profile.cache_fingerprints[0] == profile.vector_fingerprint
    kept = {"embedding_fingerprint": "emb:older", "vector_fingerprint": profile.vector_fingerprint}
    assert vectors_comparable(kept, profile, profile.fingerprint)
    assert not vectors_comparable(kept, other, other.fingerprint)
    assert not vectors_comparable({"embedding_fingerprint": "emb:older", "vector_fingerprint": None},
                                  profile, profile.fingerprint)
    assert vectors_comparable({"embedding_fingerprint": profile.fingerprint}, profile, profile.fingerprint)


def test_a_request_names_a_record_by_its_whole_name() -> None:
    asked = [{"conceptId": "c", "key": "contract", "label": "Contrat", "aliases": ["Agreement"]}]
    words = request_words("Les contrats de Carrefour Market", asked)
    assert words == ["carrefour", "market"]
    assert covers(words, "Carrefour Market") == 2
    assert covers(words, "Carrefour") == 1
    assert covers(words, "Carefour") == 1  # one letter off in a long word
    assert covers(words, "Carrefour City") == 0  # a word of the name is not in the request
    assert covers(words, "Le Contrat") == 0  # only words naming what is asked for
    assert covers(words, " ".join(["carrefour"] * 9)) == 0  # a sentence, not a name
    assert request_words("agreements", asked) == []
    entity = {"label": "C002", "identity": {"customer_id": "C002"}}
    assert names_of(entity, {"name": "Carrefour", "nom_affiche": "Carrefour SA", "city": "Paris", "count": 3}) == \
        ["C002", "C002", "Carrefour", "Carrefour SA"]
