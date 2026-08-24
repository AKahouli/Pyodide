"""Shared helpers for the semantic-model mapping pipeline."""

from __future__ import annotations

import re
from typing import Any


_PLACEHOLDER_VALUES = {
    "null", "none", "nil", "n/a", "na", "unknown", "not found", "not_found",
    "missing", "empty", "-", "--", "aucun", "aucune", "inconnu", "inconnue",
}


def normalize_for_match(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).split()).casefold()


def is_meaningful_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        stripped = value.strip()
        return bool(stripped) and stripped.casefold() not in _PLACEHOLDER_VALUES
    if isinstance(value, (list, tuple, dict)):
        return len(value) > 0
    return True


def merge_node_pair(canonical: dict[str, Any], fragment: dict[str, Any]) -> dict[str, Any]:
    """Union of attributes — canonical wins on key collisions."""
    by_key = {attr["key"]: attr for attr in canonical.get("attributes", [])}
    for attr in fragment.get("attributes", []):
        key = attr.get("key")
        if not key or key in by_key:
            continue
        by_key[key] = attr
    return {
        **canonical,
        "attributes": list(by_key.values()),
        "evidenceReferences": list({
            *(canonical.get("evidenceReferences") or []),
            *(fragment.get("evidenceReferences") or []),
        }),
        "_sourceDocumentIds": list({
            *(canonical.get("_sourceDocumentIds") or []),
            *(fragment.get("_sourceDocumentIds") or []),
        }),
    }


def to_semantica_entity(node: dict[str, Any]) -> dict[str, Any]:
    """Convert a mapping-plan node to the shape Semantica's DuplicateDetector expects."""
    properties = {attr["key"]: attr["value"] for attr in node.get("attributes", [])}
    source_ids = node.get("_sourceDocumentIds") or []
    return {
        "id": node["id"],
        "name": normalize_for_match(node.get("label") or ""),
        "type": node.get("nodeTypeId", ""),
        "properties": properties,
        "_sourceDocumentId": source_ids[0] if source_ids else "",
    }


def strip_provenance(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{k: v for k, v in node.items() if not k.startswith("_")} for node in nodes]


def normalize_evidence(evidence: list[Any], normalize_text: Any) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in evidence:
        if not isinstance(item, dict):
            continue
        quote = str(item.get("quote", "")).strip()
        if not quote:
            continue
        normalized.append({**item, "quote": normalize_text(quote)})
    return normalized


def word_variants(label: str) -> list[str]:
    """Return the label plus its slug and individual words (≥4 chars) for fuzzy matching."""
    slug = re.sub(r"[.\-_]", " ", label)
    words = [w for w in slug.split() if len(w) >= 4]
    return [label, slug, *words]
