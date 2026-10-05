"""The search text of one record, built the same way every time.

A record's text names its concept, its label, its key values and its allowed
fields, in the specification's order, under readable field names with their
business synonyms. Values are bounded; nothing else (ids, provenance, other
records) is included, so a neighbour's change never changes this text.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from typing import Any

SERIALIZER_VERSION = "gs-doc-v1"
FIELD_POLICY_VERSION = "allowed-fields-v1"
MAX_VALUE_CHARS = 300
MAX_TEXT_CHARS = 2000
MAX_QUERY_TERMS = 16


def fold(value: Any) -> str:
    """Lowercase, accent-free, single-spaced: how keys, labels and queries compare."""
    text = value if isinstance(value, str) else ("" if value is None else str(value))
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", text).strip()


def query_terms(query: str) -> list[str]:
    """Distinct words of a query, safe to join into a tsquery."""
    terms: list[str] = []
    for term in re.findall(r"[a-z0-9]+", fold(query)):
        if len(term) > 1 and term not in terms:
            terms.append(term)
    return terms[:MAX_QUERY_TERMS]


def humanize(name: str) -> str:
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", name)
    spaced = re.sub(r"[_\-.]+", " ", spaced).strip()
    return spaced[:1].upper() + spaced[1:] if spaced else name


def _text(value: Any) -> str | None:
    if value is None or isinstance(value, (dict, list)):
        return None
    text = re.sub(r"\s+", " ", value if isinstance(value, str) else str(value)).strip()
    return text or None


def source_workspaces(provenance: dict[str, Any] | None) -> list[str]:
    """Workspaces the record was read from; manual and corrected records have none."""
    workspaces = set()
    for source in (provenance or {}).get("sources") or []:
        workspace = ((source or {}).get("assetRef") or {}).get("workspaceId")
        if isinstance(workspace, str) and workspace:
            workspaces.add(workspace)
    return sorted(workspaces)


def build_document(entity: dict[str, Any], concept: dict[str, Any] | None) -> dict[str, Any]:
    """Search document of one stored record (``list_revision_entities`` shape)."""
    concept = concept or {}
    label = _text(entity.get("label")) or ""
    identity = entity.get("identity") or {}
    attributes = entity.get("attributes") or {}
    key_components = list(concept.get("keyComponents") or [])
    field_aliases = concept.get("fieldAliases") or {}
    type_line = _text(concept.get("label")) or str(entity.get("conceptId") or "")
    aliases = [alias for alias in (_text(a) for a in concept.get("aliases") or []) if alias]
    if aliases:
        type_line += f" ({', '.join(aliases)})"
    lines = [f"Type: {type_line}"]
    if label:
        lines.append(f"Name: {label}")
    shortened: list[str] = []
    for component in key_components:
        value = _text(identity.get(component))
        if value and value != fold(label):
            lines.append(f"{humanize(component)}: {value[:MAX_VALUE_CHARS]}")
    described = 0
    fields = [field for field in (concept.get("allowedFields") or list(attributes))
              if field not in key_components]
    omitted: list[str] = []
    for field in fields:
        value = _text(attributes.get(field))
        if value is None:
            continue
        if len(value) > MAX_VALUE_CHARS:
            value = value[:MAX_VALUE_CHARS].rstrip() + "…"
            shortened.append(field)
        name = humanize(field)
        synonyms = [s for s in (_text(a) for a in field_aliases.get(field) or []) if s]
        if synonyms:
            name += f" ({', '.join(synonyms)})"
        line = f"{name}: {value}"
        if sum(len(item) + 1 for item in lines) + len(line) > MAX_TEXT_CHARS:
            omitted.append(field)
            continue
        lines.append(line)
        described += 1
    search_text = "\n".join(lines)
    diagnostics: dict[str, Any] = {}
    if shortened:
        diagnostics["shortenedFields"] = shortened
    if omitted:
        diagnostics["omittedFields"] = omitted
    return {
        "entityId": entity["entityId"],
        "conceptId": str(entity.get("conceptId") or ""),
        "label": label,
        "labelKey": fold(label),
        "sourceWorkspaces": source_workspaces(entity.get("provenance")),
        "searchText": search_text,
        # Folded so accents never decide a word match; 'simple' keeps every word.
        "lexicalText": fold(search_text),
        "contentHash": "sha256:" + hashlib.sha256(search_text.encode("utf-8")).hexdigest(),
        # Only a name and keys: findable by key or words, not worth a vector.
        "exactOnly": described == 0,
        "diagnostics": diagnostics,
    }
