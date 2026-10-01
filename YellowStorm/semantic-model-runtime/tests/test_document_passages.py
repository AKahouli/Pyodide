from __future__ import annotations

import pytest

from app.population.document import _read_rules
from app.population.document_labels import labels_in_document, recurring_labels
from app.population.document_rules import RuleError, clean, heading_matches, heading_text, normalize_rules, trim


def block(pk: int, page: int, content: str, kind: str = "text/text") -> dict:
    return {"blockPk": pk, "pageNumber": page, "content": content, "blockType": kind, "origin": "native_text"}


def section(pk: int, title: str, *blocks: dict) -> dict:
    return {"sectionPk": pk, "title": title, "blocks": list(blocks)}


DOCUMENT = [
    section(1, "Sommaire", block(1, 2, "1. INFORMATIONS GENERALES ..... 3 1.1. DEFINITION ..... 3")),
    section(2, "1. INFORMATIONS GENERALES", block(2, 3, "Version : 1.0 Date de création : 19/06/2017")),
    section(3, "1.1. DEFINITION", block(3, 3, "Un prêt est un contrat."), block(4, 3, "Il porte intérêt.")),
    section(4, "1.1.1. Variantes", block(5, 4, "Taux fixe ou variable.")),
    section(5, "1.2. DONNEES DE MARCHE", block(6, 4, "Courbes de taux."), block(7, 5, "Note : à revoir")),
]


def read(**raw):  # type: ignore[no-untyped-def]
    rules = normalize_rules(raw)
    return _read_rules({"targetAttribute": "x", "sourceField": "x", "rules": rules}, [], DOCUMENT, [])


def test_after_a_heading_reads_its_section_and_subsections_not_the_table_of_contents() -> None:
    outcome = read(labels=["Définition"], location="after_label")
    assert outcome["reason"] == "found"
    assert outcome["value"] == "Un prêt est un contrat.\n\nIl porte intérêt.\n\nTaux fixe ou variable."
    assert (outcome["block"]["pageNumber"], outcome["block"]["lastPageNumber"]) == (3, 4)


def test_after_a_label_stops_at_a_boundary_label() -> None:
    outcome = read(labels=["Définition"], location="after_label", boundaryLabels=["Données de marché"])
    assert outcome["value"].endswith("Taux fixe ou variable.")
    inline = read(labels=["Version"], location="after_label", boundaryLabels=["Date de création"])
    assert inline["value"] == "1.0"


def test_before_a_label_reads_back_to_the_start_of_its_section() -> None:
    assert read(labels=["Note"], location="before_label")["value"] == "Courbes de taux."
    # Before a heading: the section just before it.
    assert read(labels=["Données de marché"], location="before_label")["value"] == "Taux fixe ou variable."


def test_pages_read_every_block_of_the_pages() -> None:
    outcome = read(location="pages", pages={"from": 4, "to": 5})
    assert outcome["value"] == "Taux fixe ou variable.\n\nCourbes de taux.\n\nNote : à revoir"
    assert read(location="pages", pages={"from": 9})["reason"] == "no_page"


@pytest.mark.parametrize("raw", [
    {"location": "pages"},
    {"location": "pages", "pages": {"from": 0}},
    {"location": "pages", "pages": {"from": 3, "to": 2}},
    {"location": "pages", "pages": {"from": 1, "to": 80}},
    {"location": "after_label", "boundaryLabels": "x"},
])
def test_unusable_passage_rules_are_refused(raw) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(RuleError):
        normalize_rules(raw)


def test_passages_keep_more_than_a_short_value() -> None:
    long = "mot " * 1000
    assert len(clean(long, normalize_rules({"location": "after_label"})) or "") > 500
    assert len(clean(long, normalize_rules({"location": "same_line"})) or "") == 500


def test_trim_removes_spaces_bullets_and_separators_at_both_ends_only() -> None:
    assert trim("  : Collecte - la valeur (CA).  ") == "Collecte - la valeur (CA)."
    assert clean("  - 12/06/2017 ;", normalize_rules({"transform": "trim"})) == "12/06/2017"


def test_headings_match_without_numbering_case_or_accents() -> None:
    assert heading_text("1.2.1. Pertinence") == "Pertinence"
    assert heading_text("Version") == "Version"
    assert heading_matches("1.1. DEFINITION", ["Définition"])
    assert not heading_matches("1.1. DEFINITIONS ANNEXES", ["Définition"])


def test_labels_recurring_across_documents_are_ranked_by_document_count() -> None:
    other = [section(9, "1.1. Définition", block(9, 1, "Autre."))]
    labels = recurring_labels([labels_in_document(DOCUMENT), labels_in_document(other)])
    assert labels[0]["label"] == "DEFINITION" and labels[0]["documents"] == 2 and labels[0]["kind"] == "heading"
    found = {(item["kind"], item["label"]) for item in labels}
    assert ("label", "Version") in found and ("label", "Date de création") in found
    assert ("heading", "Sommaire") not in found


def test_before_a_label_starts_after_a_boundary_label_in_the_same_block() -> None:
    assert read(labels=["Date de création"], location="before_label", boundaryLabels=["Version"])["value"] == "1.0"
