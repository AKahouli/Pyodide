"""Labels and headings that recur across a source's documents, offered as ready-made rule labels.

A person picks "Définition" from a list that says it is a heading in 15 of 15 documents instead
of guessing how the documents name the value. Only what the index already holds is read.
"""

from __future__ import annotations

import re
from typing import Any

from .document_rules import fold, heading_text

MAX_DOCUMENTS = 10
MAX_SUGGESTIONS = 60
MAX_LABEL_WORDS = 6
MAX_EXAMPLE_CHARS = 160

# "Version : 1.0 Date de création : 19/06/2017": a short label, a colon, then a value. A label starts
# a line, or starts with a capital after a space (so a sentence's last words are not taken for one).
_LABEL = re.compile(r"(?:(?:^|(?<=\n))([^\W\d_][^:\n.;]{0,58}?)|(?<=\s)([^\W\d_a-zà-ÿ][^:\n.;]{0,58}?))\s*:\s*(?=\S)")
_SKIPPED_HEADINGS = {"document", "sommaire", "table des matieres", "contents", "table of contents"}


def _clean_label(text: str) -> str | None:
    label = " ".join(text.split()).strip(" -–—*•")
    words = label.split()
    if not label or len(words) > MAX_LABEL_WORDS or len(label) < 2:
        return None
    if sum(char.isalpha() for char in label) < 2:
        return None
    return label


def labels_in_document(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Each heading and ``Label:`` of one document once, with the page and text that follow it."""
    found: dict[tuple[str, str], dict[str, Any]] = {}
    for section in sections:
        title = str(section.get("title") or "").strip()
        # Image descriptions are written by the indexer, not by the document's author.
        blocks = [block for block in section.get("blocks") or []
                  if isinstance(block.get("content"), str) and block.get("origin") != "generated_visual_description"
                  and not str(block.get("blockType") or "").startswith("image/image")]
        if title:
            label = _clean_label(heading_text(title))
            if label and fold(label) not in _SKIPPED_HEADINGS:
                first = blocks[0] if blocks else {}
                found.setdefault(("heading", fold(label)), {
                    "label": label, "kind": "heading", "page": first.get("pageNumber"),
                    "example": " ".join(str(first.get("content") or "").split())[:MAX_EXAMPLE_CHARS]})
        for block in blocks:
            if "table" in str(block.get("blockType") or ""):
                continue
            content = block["content"]
            for match in _LABEL.finditer(content):
                label = _clean_label(match.group(1) or match.group(2))
                if not label:
                    continue
                rest = content[match.end():].split("\n", 1)[0]
                found.setdefault(("label", fold(label)), {
                    "label": label, "kind": "label", "page": block.get("pageNumber"),
                    "example": " ".join(rest.split())[:MAX_EXAMPLE_CHARS]})
    return list(found.values())


def recurring_labels(per_document: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """Labels ranked by how many documents hold them, then by where they first appear."""
    merged: dict[tuple[str, str], dict[str, Any]] = {}
    order = 0
    for labels in per_document:
        for item in labels:
            key = (item["kind"], fold(item["label"]))
            if key not in merged:
                merged[key] = {**item, "documents": 0, "order": order}
                order += 1
            merged[key]["documents"] += 1
    ranked = sorted(merged.values(), key=lambda item: (-item["documents"], item["order"]))
    return [{key: value for key, value in item.items() if key != "order"} for item in ranked[:MAX_SUGGESTIONS]]
