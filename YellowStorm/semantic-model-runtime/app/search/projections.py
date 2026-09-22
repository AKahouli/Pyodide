"""Entity search projections from accepted revisions (P7.3, P7.10-P7.11).

Pure stdlib. Precomputes per-strategy match keys over the normalized identity
space so candidate resolution never scans AGE and never invents matches:
candidates are returned for an explicit decision, never auto-resolved (P7.3).
The joined identity order follows the entity's own component order, identical
to relation matching, so projection keys and relationship keys agree.
"""

from __future__ import annotations

from typing import Any

from app.population.tabular import match_value, normalize_identity_value

STRATEGIES = ("exact", "case_insensitive", "normalized")


def build_entity_projections(entities: list[dict[str, Any]], *, model_id: str,
                             revision_id: str) -> list[dict[str, Any]]:
    projections = []
    for entity in entities:
        if not isinstance(entity, dict) or not entity.get("entityId"):
            continue
        # Keys live in the normalized identity space, exactly like relation
        # matching: components normalize first so raw and stored identities
        # produce identical keys for every strategy.
        normalized = [normalize_identity_value(value)
                      for value in (entity.get("identity") or {}).values()]
        if any(component is None for component in normalized):
            continue
        joined = "|".join(normalized)
        keys = {}
        for strategy in STRATEGIES:
            key = match_value(joined, strategy)
            if key is not None:
                keys[strategy] = key
        projections.append({
            "entityId": entity["entityId"], "modelId": model_id,
            "dataRevisionId": revision_id, "conceptId": entity.get("conceptId", ""),
            "displayLabel": entity.get("label", ""),
            "identity": dict(entity.get("identity") or {}), "searchKeys": keys})
    return projections


def match_candidates(projections: list[dict[str, Any]], query: Any,
                     strategy: str) -> dict[str, Any]:
    """Resolve a query to candidate projections without auto-resolving (P7.3).

    Identity similarity must not silently resolve real ambiguity: zero, one,
    or many candidates are all explicit outcomes for the caller to decide.
    """
    if strategy not in STRATEGIES:
        from app.population.compiler import PopulationError
        raise PopulationError("invalid_matching_strategy")
    key = match_value(normalize_identity_value(query), strategy)
    if key is None:
        return {"strategy": strategy, "candidates": [], "ambiguous": False}
    candidates = [p for p in projections if p.get("searchKeys", {}).get(strategy) == key]
    return {"strategy": strategy, "candidates": candidates, "ambiguous": len(candidates) > 1}
