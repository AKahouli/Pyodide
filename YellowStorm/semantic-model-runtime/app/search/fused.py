"""Chat graph search over the published data revision.

The chat agent posts ``{"schema_name": "pop_<revision>", "query": ...}``. Only
the revision bound to production for its model is searchable, so drafts and
superseded revisions never reach a conversation. Matching is lexical over
entity labels and accepted attribute values; each hit carries its direct
relationships so the agent can answer "which X belongs to Y" questions.
"""

from __future__ import annotations

import re
from typing import Any

from app.population.age_projection import LIVE_PROJECTION_PREFIX

_TERM_RE = re.compile(r"[\w][\w\-./]*", re.UNICODE)
_GRAPH_RE = re.compile(r"^pop_[a-z0-9_]{1,64}$")
MAX_TERMS = 12
MIN_TERM_LENGTH = 2
MAX_RESULTS = 25


class SearchError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def graph_projection_ref(schema_name: Any) -> str:
    name = str(schema_name or "").strip()
    if not _GRAPH_RE.match(name):
        raise SearchError("invalid_schema_name")
    return LIVE_PROJECTION_PREFIX + name


def query_terms(query: Any) -> list[str]:
    """Distinct lower-case terms, longest first, so specific words rank first."""
    seen: dict[str, None] = {}
    for match in _TERM_RE.findall(str(query or "").lower()):
        term = match.strip("-./")
        if len(term) >= MIN_TERM_LENGTH:
            seen.setdefault(term, None)
    return sorted(seen, key=len, reverse=True)[:MAX_TERMS]


def _text(value: Any) -> str:
    return "" if value is None else str(value).lower()


def score_entity(entity: dict[str, Any], terms: list[str]) -> float:
    label = _text(entity.get("label"))
    values = [_text(v) for k, v in (entity.get("attributes") or {}).items()
              if not str(k).startswith("_")]
    score = 0.0
    for term in terms:
        if term == label:
            score += 5
        elif term in label:
            score += 3
        if any(term == value for value in values):
            score += 2
        elif any(term in value for value in values):
            score += 1
    return score


def _business_attributes(attributes: Any) -> dict[str, Any]:
    return {k: v for k, v in (attributes or {}).items() if not str(k).startswith("_")}


def _source_names(provenance: Any) -> list[str]:
    names = []
    for source in (provenance or {}).get("sources", []) if isinstance(provenance, dict) else []:
        name = source.get("sourceName") or source.get("fileName") if isinstance(source, dict) else None
        if name and name not in names:
            names.append(str(name))
    return names


def rank_results(entities: list[dict[str, Any]], relationships: list[dict[str, Any]],
                 terms: list[str], limit: int = MAX_RESULTS) -> list[dict[str, Any]]:
    scored = [(score_entity(e, terms), e) for e in entities]
    scored = [(s, e) for s, e in scored if s > 0]
    scored.sort(key=lambda pair: (-pair[0], _text(pair[1].get("label"))))
    by_entity: dict[str, list[dict[str, Any]]] = {}
    for rel in relationships:
        by_entity.setdefault(rel["source_entity_id"], []).append({
            "relation": rel["relation_id"], "direction": "outgoing",
            "entityId": rel["target_entity_id"], "concept": rel.get("target_concept_id"),
            "label": rel.get("target_label", "")})
        by_entity.setdefault(rel["target_entity_id"], []).append({
            "relation": rel["relation_id"], "direction": "incoming",
            "entityId": rel["source_entity_id"], "concept": rel.get("source_concept_id"),
            "label": rel.get("source_label", "")})
    return [{
        "entityId": e["id"], "concept": e["concept_id"], "label": e.get("label", ""),
        "score": score, "attributes": _business_attributes(e.get("attributes")),
        "sources": _source_names(e.get("provenance")),
        "relationships": by_entity.get(e["id"], []),
    } for score, e in scored[:limit]]


def retrieval_scope(results: list[dict[str, Any]]) -> dict[str, list[str]] | None:
    names: list[str] = []
    for result in results:
        for name in result["sources"]:
            if name not in names:
                names.append(name)
    return {"file_names": names} if names else None
