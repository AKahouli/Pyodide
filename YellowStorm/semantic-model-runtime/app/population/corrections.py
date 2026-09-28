"""Apply recorded human corrections on top of a computed population.

Corrections are durable rows in ``semantic_population.corrections``; every
rebuild replays the ones still in force (not undone) in sequence order so a
fix survives new source data. Pure and deterministic: the same computed
outcome and corrections always yield the same corrected outcome.

Supported actions:
- ``edit_entity``: ``targetIdentity.entityId`` + ``payload.attribute``/``value``
  (or ``payload.attributes``) — a human assertion overriding the source value.
- ``remove_entity``: the record, its values and its links are hidden.
- ``add_relationship``: ``targetIdentity`` ``relationId``/``sourceEntityId``/
  ``targetEntityId`` — a link added by a person.
- ``remove_relationship``: that link is hidden.
- ``revert``: ``payload.sequence`` — undoes an earlier correction.
"""

from __future__ import annotations

import copy
from typing import Any


def corrections_in_force(corrections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Corrections not undone by a later ``revert``, in sequence order."""
    ordered = sorted(corrections, key=lambda c: int(c.get("sequence") or 0))
    reverted = {int((c.get("payload") or {}).get("sequence") or 0)
                for c in ordered if c.get("action") == "revert"}
    return [c for c in ordered
            if c.get("action") != "revert" and int(c.get("sequence") or 0) not in reverted]


def _edits_of(payload: dict[str, Any]) -> dict[str, Any]:
    if isinstance(payload.get("attributes"), dict):
        return dict(payload["attributes"])
    if isinstance(payload.get("attribute"), str) and payload["attribute"]:
        return {payload["attribute"]: payload.get("value")}
    return {}


def _link_key(value: dict[str, Any]) -> tuple[str, str, str]:
    return (str(value.get("relationId") or ""), str(value.get("sourceEntityId") or ""),
            str(value.get("targetEntityId") or ""))


def apply_corrections(outcome: dict[str, Any],
                      corrections: list[dict[str, Any]]) -> dict[str, Any]:
    """Return a copy of ``outcome`` with the corrections in force applied."""
    active = corrections_in_force(corrections)
    if not active:
        return outcome
    result = dict(outcome)
    entities = {e["entityId"]: copy.deepcopy(e) for e in outcome.get("entities", [])}
    order = [e["entityId"] for e in outcome.get("entities", [])]
    assertions = {(a["entityId"], a["attribute"]): copy.deepcopy(a)
                  for a in outcome.get("assertions", [])}
    links = {_link_key(r): copy.deepcopy(r) for r in outcome.get("relationships", [])}
    removed_entities: set[str] = set()
    removed_links: set[tuple[str, str, str]] = set()
    applied = 0
    for correction in active:
        target = correction.get("targetIdentity") or correction.get("target_identity") or {}
        payload = correction.get("payload") or {}
        action = correction.get("action")
        human = {"correctionSequence": int(correction.get("sequence") or 0),
                 "actorUserId": correction.get("actorUserId") or correction.get("actor_user_id"),
                 "reason": correction.get("reason") or ""}
        if action == "edit_entity":
            entity = entities.get(str(target.get("entityId") or ""))
            if entity is None:
                continue
            for attribute, value in _edits_of(payload).items():
                previous = assertions.get((entity["entityId"], attribute))
                original = (previous or {}).get("evidence", {}).get("correction", {}).get(
                    "originalValue", (previous or {}).get("value",
                                                          (entity.get("attributes") or {}).get(attribute)))
                entity.setdefault("attributes", {})[attribute] = value
                assertions[(entity["entityId"], attribute)] = {
                    "entityId": entity["entityId"], "attribute": attribute, "value": value,
                    "origin": "human",
                    "evidence": {**((previous or {}).get("evidence") or {}),
                                 "correction": {**human, "originalValue": original}},
                }
            applied += 1
        elif action == "remove_entity":
            entity_id = str(target.get("entityId") or "")
            if entity_id in entities:
                removed_entities.add(entity_id)
                applied += 1
        elif action == "add_relationship":
            key = _link_key(target)
            if not all(key) or key[1] not in entities or key[2] not in entities:
                continue
            removed_links.discard(key)
            links[key] = {"relationId": key[0], "sourceEntityId": key[1],
                          "targetEntityId": key[2], "matchingStrategy": "human"}
            applied += 1
        elif action == "remove_relationship":
            key = _link_key(target)
            if key in links:
                removed_links.add(key)
                applied += 1
    result["entities"] = [entities[i] for i in order if i not in removed_entities]
    result["assertions"] = [a for (entity_id, _), a in assertions.items()
                            if entity_id not in removed_entities]
    result["relationships"] = [
        r for key, r in links.items()
        if key not in removed_links and key[1] not in removed_entities
        and key[2] not in removed_entities]
    result["appliedCorrections"] = applied
    return result
