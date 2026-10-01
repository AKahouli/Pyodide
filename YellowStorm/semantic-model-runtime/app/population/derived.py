"""Records of one concept made from the values another concept's records carry.

A contract names its customer by id and name; the customers themselves are listed nowhere. A
derivation maps some fields of the source concept (Contract) to fields of the target concept
(Organization) and makes one target record per distinct key value. When records that share a key
disagree on another field, the derivation's conflict rule picks the value kept.

Derived records use the target concept's own entity ids, so they merge with records a direct
source gives the same concept: a direct value always wins, a derived one only fills a gap. Every
derived value keeps the evidence of the source value it was taken from (the file, page and quote),
so a person can still open the document it came from.
"""

from __future__ import annotations

from typing import Any

from .document_rules import to_iso_date
from .tabular import MAX_ASSERTIONS, MAX_MATERIALIZED_ENTITIES, entity_key, normalize_identity_value

CONFLICT_RULES = ("most_frequent", "latest", "longest", "leave_empty")
MAX_DERIVATIONS = 50
# How many source records a derived record names; the count is always exact.
MAX_DERIVED_FROM_IDS = 50


class DerivationError(ValueError):
    """A derivation that cannot run as described; the message is an error code."""


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = (value if isinstance(value, str) else str(value)).strip()
    return text or None


def normalize_derivations(entries: Any, concepts: dict[str, dict]) -> list[dict]:
    """Checks every derivation and returns it in the one shape both sides hash.

    Raises :class:`DerivationError` with an error code. A concept filled by a derivation cannot
    itself be the source of another one, so derivations never chain or loop.
    """
    if entries is None:
        return []
    if not isinstance(entries, list) or len(entries) > MAX_DERIVATIONS:
        raise DerivationError("invalid_derivations")
    normalized: list[dict] = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise DerivationError("invalid_derivations")
        derivation_id = entry.get("derivationId")
        target = concepts.get(entry.get("conceptId"))
        source = concepts.get(entry.get("sourceConceptId"))
        if not isinstance(derivation_id, str) or not derivation_id or target is None or source is None:
            raise DerivationError("invalid_derivations")
        if target["conceptId"] == source["conceptId"]:
            raise DerivationError("invalid_derivations")
        fields = entry.get("fieldMappings")
        if not isinstance(fields, list) or not fields:
            raise DerivationError("invalid_derivations")
        mapped: list[dict] = []
        for field in fields:
            if not isinstance(field, dict):
                raise DerivationError("invalid_derivations")
            source_attribute, target_attribute = field.get("sourceAttribute"), field.get("targetAttribute")
            if (source_attribute not in source["allowedFields"]
                    or target_attribute not in target["allowedFields"]):
                raise DerivationError("invalid_derivations")
            mapped.append({"sourceAttribute": source_attribute, "targetAttribute": target_attribute})
        targets = [field["targetAttribute"] for field in mapped]
        if len(set(targets)) != len(targets):
            raise DerivationError("invalid_derivations")
        if any(component not in targets for component in target["keyComponents"]):
            raise DerivationError("unmapped_identity")
        rule = entry.get("conflictRule") or "most_frequent"
        order_by = entry.get("orderBy")
        if rule not in CONFLICT_RULES:
            raise DerivationError("invalid_derivations")
        if rule == "latest" and order_by not in source["allowedFields"]:
            raise DerivationError("invalid_derivations")
        if rule != "latest":
            order_by = None
        label_field = entry.get("labelField")
        if label_field is not None and label_field not in targets:
            raise DerivationError("invalid_derivations")
        mapping_version = entry.get("mappingVersion")
        normalized.append({
            "derivationId": derivation_id, "conceptId": target["conceptId"],
            "sourceConceptId": source["conceptId"], "fieldMappings": mapped,
            "conflictRule": rule, "orderBy": order_by, "labelField": label_field,
            "mappingVersion": mapping_version if isinstance(mapping_version, str) and mapping_version else "v1",
        })
    targets = {derivation["conceptId"] for derivation in normalized}
    if any(derivation["sourceConceptId"] in targets for derivation in normalized):
        raise DerivationError("chained_derivation")
    return normalized


def _source_value(entity: dict, attribute: str) -> Any:
    """What a source record holds for a field; a key field is only kept in its (lowercased) identity."""
    value = (entity.get("attributes") or {}).get(attribute)
    if value is None:
        value = (entity.get("identity") or {}).get(attribute)
    return value


def _order_key(value: Any) -> tuple[int, str]:
    """Sorts values given for the "most recent" rule; records without one come last."""
    text = _text(value)
    if text is None:
        return (1, "")
    return (0, to_iso_date(text) or text)


def _choose(candidates: list[tuple[str, dict]], rule: str) -> str | None:
    """The value kept among those the records of one key give, in source-record order."""
    counts: dict[str, int] = {}
    for value, _entity in candidates:
        counts[value] = counts.get(value, 0) + 1
    if len(counts) == 1:
        return candidates[0][0]
    if rule == "leave_empty":
        return None
    if rule == "latest":
        # Candidates arrive most recent first.
        return candidates[0][0]
    if rule == "longest":
        return max(counts, key=lambda value: (len(value), counts[value], -_first_index(candidates, value)))
    return max(counts, key=lambda value: (counts[value], -_first_index(candidates, value)))


def _first_index(candidates: list[tuple[str, dict]], value: str) -> int:
    return next(index for index, (candidate, _entity) in enumerate(candidates) if candidate == value)


def derive_concept(target: dict, derivation: dict, source_entities: list[dict],
                   source_assertions: list[dict]) -> dict:
    """One target record per distinct key found in the source records, shaped like a source's output."""
    fields = derivation["fieldMappings"]
    by_target = {field["targetAttribute"]: field["sourceAttribute"] for field in fields}
    key_components: list[str] = target["keyComponents"]
    rule = derivation["conflictRule"]
    evidence_of = {(assertion["entityId"], assertion["attribute"]): assertion for assertion in source_assertions}
    ordered = sorted(source_entities, key=lambda entity: entity["entityId"])
    if rule == "latest":
        # Most recent first, records without a date last; equal dates keep the entity-id order.
        keyed = [(_order_key(_source_value(entity, derivation["orderBy"])), entity) for entity in ordered]
        dated = sorted((item for item in keyed if item[0][0] == 0), key=lambda item: item[0][1], reverse=True)
        ordered = [entity for _key, entity in dated] + [entity for key, entity in keyed if key[0] == 1]
    groups: dict[str, dict[str, Any]] = {}
    gaps: list[dict] = []
    counts = {"scanned": 0, "excluded": 0, "queryable": 0, "materialized": 0, "gaps": 0}
    for entity in ordered:
        counts["scanned"] += 1
        identity: dict[str, str] = {}
        for component in key_components:
            normalized = normalize_identity_value(_source_value(entity, by_target[component]))
            if normalized is None:
                break
            identity[component] = normalized
        if len(identity) != len(key_components):
            missing = next(component for component in key_components if component not in identity)
            gaps.append({"kind": "missing_identity", "conceptId": target["conceptId"], "rowNumber": None,
                         "detail": f"{entity.get('label') or entity['entityId']} has no value for '{by_target[missing]}'",
                         "field": missing, "derivationId": derivation["derivationId"],
                         "values": {"record": entity.get("label") or entity["entityId"]}})
            continue
        key = entity_key(target["namespace"], identity)
        group = groups.get(key)
        if group is None:
            if len(groups) >= MAX_MATERIALIZED_ENTITIES:
                gaps.append({"kind": "materialization_cap", "conceptId": target["conceptId"],
                             "rowNumber": None, "detail": "bounded entity budget reached"})
                continue
            group = groups[key] = {"identity": identity, "members": []}
        group["members"].append(entity)

    entities: list[dict] = []
    assertions: list[dict] = []
    for key, group in groups.items():
        members: list[dict] = group["members"]
        attributes: dict[str, str] = {}
        for target_attribute, source_attribute in by_target.items():
            if target_attribute in key_components:
                continue
            candidates = [(text, member) for member in members
                          if (text := _text(_source_value(member, source_attribute))) is not None]
            if not candidates:
                continue
            value = _choose(candidates, rule)
            distinct = len({candidate for candidate, _member in candidates})
            if value is None:
                gaps.append({"kind": "conflicting_values", "conceptId": target["conceptId"], "rowNumber": None,
                             "detail": f"attribute '{target_attribute}' has {distinct} different values",
                             "field": target_attribute, "derivationId": derivation["derivationId"]})
                continue
            if len(assertions) >= MAX_ASSERTIONS:
                gaps.append({"kind": "assertion_cap", "conceptId": target["conceptId"], "rowNumber": None,
                             "detail": "bounded assertion budget reached"})
                continue
            member = next(member for candidate, member in candidates if candidate == value)
            source_assertion = evidence_of.get((member["entityId"], source_attribute))
            evidence = dict(source_assertion["evidence"]) if source_assertion else {
                "assetRef": ((member.get("provenance") or {}).get("sources") or [{}])[0].get("assetRef")}
            evidence["mappingVersion"] = derivation["mappingVersion"]
            evidence["derivedFrom"] = {
                "derivationId": derivation["derivationId"], "conceptId": derivation["sourceConceptId"],
                "entityId": member["entityId"], "label": member.get("label"), "attribute": source_attribute,
                "rule": rule, "distinctValues": distinct, "records": len(candidates)}
            attributes[target_attribute] = value
            assertions.append({"entityId": key, "attribute": target_attribute, "value": value,
                               "origin": "human" if source_assertion and source_assertion.get("origin") == "human" else "source",
                               "evidence": evidence})
        label_field = derivation.get("labelField")
        first_key_value = _text(_source_value(members[0], by_target[key_components[0]]))
        label = attributes.get(label_field) if label_field else None
        sources: list[dict] = []
        seen: set[tuple[Any, Any]] = set()
        for member in members:
            for source in (member.get("provenance") or {}).get("sources", []):
                marker = ((source.get("assetRef") or {}).get("assetVersionId"), source.get("mappingVersion"))
                if marker not in seen:
                    seen.add(marker)
                    sources.append({**source, "rowNumbers": list(source.get("rowNumbers", []))})
        member_ids = sorted(member["entityId"] for member in members)
        entities.append({
            "entityId": key, "conceptId": target["conceptId"], "namespace": target["namespace"],
            "identity": dict(group["identity"]), "label": label or first_key_value or key,
            "attributes": attributes, "materialized": True,
            "provenance": {"sources": sources, "derivedFrom": {
                "derivationId": derivation["derivationId"], "conceptId": derivation["sourceConceptId"],
                "count": len(members), "entityIds": member_ids[:MAX_DERIVED_FROM_IDS]}},
        })
        counts["materialized"] += 1
    counts["gaps"] = len(gaps)
    return {"entities": entities, "assertions": assertions, "gaps": gaps, "counts": counts}


def merge_derived(direct: dict | None, derived: dict) -> dict:
    """Adds derived records to what direct sources gave the same concept.

    A record both give keeps every direct value; the derived one only fills fields the direct
    sources left empty, so the two never disagree. The derived record's sources are added to its
    provenance.
    """
    base = direct or {"entities": [], "assertions": [], "gaps": [], "counts": {}}
    entities = {entity["entityId"]: entity for entity in base["entities"]}
    assertions = list(base["assertions"])
    added_fields: dict[str, set[str]] = {}
    for entity in derived["entities"]:
        current = entities.get(entity["entityId"])
        if current is None:
            entities[entity["entityId"]] = entity
            added_fields[entity["entityId"]] = set(entity["attributes"])
            continue
        current = entities[entity["entityId"]] = {
            **current, "attributes": dict(current["attributes"]),
            "provenance": {**current.get("provenance", {}),
                           "sources": list((current.get("provenance") or {}).get("sources", []))}}
        filled = {field for field in entity["attributes"] if field not in current["attributes"]}
        for field in filled:
            current["attributes"][field] = entity["attributes"][field]
        added_fields[entity["entityId"]] = filled
        seen = {((source.get("assetRef") or {}).get("assetVersionId"), source.get("mappingVersion"))
                for source in current["provenance"]["sources"]}
        for source in entity["provenance"]["sources"]:
            marker = ((source.get("assetRef") or {}).get("assetVersionId"), source.get("mappingVersion"))
            if marker not in seen:
                seen.add(marker)
                current["provenance"]["sources"].append(source)
        current["provenance"]["derivedFrom"] = entity["provenance"]["derivedFrom"]
    assertions.extend(assertion for assertion in derived["assertions"]
                      if assertion["attribute"] in added_fields.get(assertion["entityId"], set()))
    counts = dict(base.get("counts") or {})
    for key, value in derived["counts"].items():
        counts[key] = counts.get(key, 0) + value
    counts["materialized"] = len(entities)
    gaps = list(base["gaps"]) + list(derived["gaps"])
    counts["gaps"] = len(gaps)
    return {"entities": list(entities.values()), "assertions": assertions, "gaps": gaps, "counts": counts}
