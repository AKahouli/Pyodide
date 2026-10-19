"""Deterministic tabular population: rows to entities, assertions, relationships.

Pure stdlib (Phase 5B steps 1-3 and 11, P5.7-P5.15). Rows arrive as prepared
string mappings; values outside eligibility never leak into any output.
Identities resolve by approved namespace plus the full composite key — never by
display-label similarity (P6.2). A missing key component is an explicit gap,
not a partial-key merge (T05). Similar names are candidates only where a
matching strategy is approved, and ambiguity never auto-merges (T06).
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from typing import Any

from .compiler import PopulationError, evaluate_filter

MAX_MATERIALIZED_ENTITIES = 5000
MAX_ASSERTIONS = 20000


def provenance_source_key(source: dict[str, Any]) -> str:
    """Stable identity of one source reference, excluding its row-level evidence."""
    return json.dumps({"assetRef": source.get("assetRef") or {},
                       "mappingVersion": source.get("mappingVersion")},
                      sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def merge_provenance_source(sources: list[dict[str, Any]], source: dict[str, Any]) -> None:
    """Keep one source reference while merging its filename and row-level evidence."""
    marker = provenance_source_key(source)
    existing = next((item for item in sources if provenance_source_key(item) == marker), None)
    if existing is None:
        existing = dict(source)
        existing["rowNumbers"] = list(source.get("rowNumbers") or [])
        sources.append(existing)
        return
    for key in ("documentId", "filename"):
        if source.get(key) and not existing.get(key):
            existing[key] = source[key]
    row_numbers = existing.setdefault("rowNumbers", [])
    for number in source.get("rowNumbers") or []:
        if number not in row_numbers:
            row_numbers.append(number)


def normalize_identity_value(value: Any) -> str | None:
    """Mirror ``normalizeIdentityValue``: trim + lowercase, empty stays empty."""
    if value is None:
        return None
    text = (value if isinstance(value, str) else str(value)).strip().lower()
    return text or None


def entity_key(namespace: str, key_values: dict[str, str]) -> str:
    canonical = json.dumps(key_values, sort_keys=True, separators=(",", ":"),
                           ensure_ascii=False)
    digest = hashlib.sha256(f"{namespace}|{canonical}".encode("utf-8")).hexdigest()
    return f"{namespace}:{digest[:32]}"


def match_value(value: Any, strategy: str) -> str | None:
    """Mirror ``normalizeRelationValue`` exactly: trim-only exact, lowercase
    case-insensitive, and diacritic/word-boundary normalized. Both sides of a
    match go through this function, so every approved strategy is symmetric."""
    if value is None:
        return None
    text = (value if isinstance(value, str) else str(value)).strip()
    if not text:
        return None
    if strategy == "exact":
        return text
    lowered = text.lower()
    if strategy == "case_insensitive":
        return lowered or None
    if strategy == "normalized":
        folded = unicodedata.normalize("NFKD", lowered)
        folded = "".join(char for char in folded if not unicodedata.combining(char))
        folded = re.sub(r"[^a-z0-9]+", " ", folded.replace("&", " and ")).strip()
        return re.sub(r"\s+", " ", folded) or None
    raise PopulationError("invalid_matching_strategy")


MAX_SAMPLE_FIELDS = 20
MAX_SAMPLE_TEXT = 200


def row_sample(row: dict[str, Any]) -> dict[str, Any]:
    """What a row held, bounded, so a person can see why it was left out."""
    sample: dict[str, Any] = {}
    for key, value in row.items():
        if key.startswith("_") or len(sample) >= MAX_SAMPLE_FIELDS:
            continue
        sample[key] = value[:MAX_SAMPLE_TEXT] if isinstance(value, str) else value
    return sample


def populate_concept_rows(compiled: dict[str, Any], rows: list[dict[str, Any]],
                          source_ref: dict[str, Any], observer: Any = None) -> dict[str, Any]:
    """Map prepared rows to entities and source assertions for one concept.

    ``source_ref`` carries ``assetRef``, ``mappingVersion``, optional ``filename`` and an optional
    ``labelField`` naming the attribute used as the human label; otherwise the
    first identity component labels the entity. A row may carry ``_ai_limited``, the fields the
    AI never read because of its row limit: an empty key field among them is no missing value
    (the run reports the limit once). ``observer`` (a ``ConceptHealth``) is told what happens to
    each row, for the model health report.
    """
    key_components: list[str] = compiled["keyComponents"]
    allowed = set(compiled["allowedFields"])
    label_field = source_ref.get("labelField")
    constant_fields = set(source_ref.get("constantFields", []))
    entities: dict[str, dict[str, Any]] = {}
    assertions: list[dict[str, Any]] = []
    gaps: list[dict[str, Any]] = []
    counts = {"scanned": 0, "excluded": 0, "queryable": 0, "materialized": 0, "gaps": 0}

    for row in rows:
        if not isinstance(row, dict):
            continue
        counts["scanned"] += 1
        row_number = row.get("_row")
        if not evaluate_filter(compiled.get("eligibility"), row):
            counts["excluded"] += 1
            continue
        if compiled["populationMode"] == "query_backed" or not evaluate_filter(
                compiled.get("materialization"), row):
            counts["queryable"] += 1
            if compiled["populationMode"] != "query_backed":
                continue
        identity: dict[str, str] = {}
        missing = False
        for component in key_components:
            normalized = normalize_identity_value(row.get(component))
            if normalized is None:
                missing = True
                if component in (row.get("_ai_limited") or ()):
                    if observer is not None:
                        observer.ai_limited_row(component)
                    break
                gaps.append({"kind": "missing_identity", "conceptId": compiled["conceptId"],
                             "rowNumber": row_number, "detail": f"identity component '{component}' is empty",
                             "field": component, "assetRef": source_ref.get("assetRef"),
                             "values": row_sample(row)})
                if observer is not None:
                    observer.missing_row(component, row, number=row_number)
                break
            identity[component] = normalized
        if missing:
            continue
        if observer is not None:
            observer.keyed_row(identity, row, number=row_number)
        key = entity_key(compiled["namespace"], identity)
        entity = entities.get(key)
        if entity is None:
            if len(entities) >= MAX_MATERIALIZED_ENTITIES:
                gaps.append({"kind": "materialization_cap", "conceptId": compiled["conceptId"],
                             "rowNumber": row_number, "detail": "bounded entity budget reached"})
                continue
            label_value = row.get(label_field) if isinstance(label_field, str) else None
            if label_value is None:
                label_value = row.get(key_components[0])
            source = {"assetRef": source_ref.get("assetRef"),
                      "mappingVersion": source_ref.get("mappingVersion"), "rowNumbers": []}
            if isinstance(source_ref.get("filename"), str) and source_ref["filename"]:
                source["filename"] = source_ref["filename"]
            entity = {"entityId": key, "conceptId": compiled["conceptId"],
                      "namespace": compiled["namespace"], "identity": dict(identity),
                      "label": str(label_value) if label_value is not None else key,
                      "attributes": {}, "materialized": True,
                      "provenance": {"sources": [source]}}
            entities[key] = entity
            counts["materialized"] += 1
        numbers = entity["provenance"]["sources"][0]["rowNumbers"]
        if row_number not in numbers:
            numbers.append(row_number)
        if compiled["populationMode"] == "query_backed":
            continue
        for field in compiled["allowedFields"]:
            if field in key_components or field not in row or row[field] is None:
                continue
            value = row[field] if isinstance(row[field], str) else str(row[field])
            current = entity["attributes"].get(field)
            if current is None:
                if len(assertions) >= MAX_ASSERTIONS:
                    gaps.append({"kind": "assertion_cap", "conceptId": compiled["conceptId"],
                                 "rowNumber": row_number,
                                 "detail": "bounded assertion budget reached"})
                    continue
                entity["attributes"][field] = value
                assertions.append({"entityId": key, "attribute": field, "value": value,
                                   "origin": "human" if field in constant_fields else "source",
                                   "evidence": {"assetRef": source_ref.get("assetRef"),
                                                "rowNumber": row_number, "column": field,
                                                "mappingVersion": source_ref.get("mappingVersion"),
                                                # A row expanded into items: which of its items.
                                                **({"item": row["_item"]} if row.get("_item") is not None else {})}})
            elif current != value:
                gaps.append({"kind": "conflicting_values", "conceptId": compiled["conceptId"],
                             "rowNumber": row_number, "field": field,
                             "detail": f"attribute '{field}' has competing source values"})
                if observer is not None:
                    observer.conflict(field, current, value, identity, number=row_number)

    counts["gaps"] = len(gaps)
    return {"entities": list(entities.values()), "assertions": assertions, "gaps": gaps,
            "counts": counts, "allowedFields": sorted(allowed)}


def merge_concept_results(results: list[dict[str, Any]]) -> dict[str, Any]:
    """Merge per-source concept outputs by stable entity id (P6.2, T11).

    First value wins per attribute; a competing source value becomes a
    visible ``conflicting_values`` gap instead of a silent overwrite.
    Provenance keeps one entry per contributing source.
    """
    entities: dict[str, dict[str, Any]] = {}
    assertions: list[dict[str, Any]] = []
    gaps: list[dict[str, Any]] = []
    counts = {"scanned": 0, "excluded": 0, "queryable": 0, "materialized": 0, "gaps": 0}
    for result in results:
        for key in counts:
            counts[key] += result.get("counts", {}).get(key, 0)
        gaps.extend(result.get("gaps", []))
        for entity in result.get("entities", []):
            current = entities.get(entity["entityId"])
            if current is None:
                entities[entity["entityId"]] = {
                    **entity, "attributes": dict(entity.get("attributes", {})),
                    "provenance": {"sources": [dict(s) for s in
                                               entity.get("provenance", {}).get("sources", [])]}}
                continue
            for field, value in entity.get("attributes", {}).items():
                if field not in current["attributes"]:
                    current["attributes"][field] = value
                elif current["attributes"][field] != value:
                    gaps.append({"kind": "conflicting_values",
                                 "conceptId": entity.get("conceptId"),
                                 "rowNumber": None,
                                 "detail": f"attribute '{field}' has competing source values"})
            for source in entity.get("provenance", {}).get("sources", []):
                merge_provenance_source(current["provenance"]["sources"], source)
        assertions.extend(result.get("assertions", []))
    counts["materialized"] = len(entities)
    counts["gaps"] = len(gaps)
    return {"entities": list(entities.values()), "assertions": assertions, "gaps": gaps,
            "counts": counts}


def _match_side(entity: dict[str, Any], field: str) -> tuple[Any, bool]:
    """The value an entity offers for matching, and whether it came from its (case-folded) identity."""
    value = entity["attributes"].get(field)
    if value is not None:
        return value, False
    return entity["identity"].get(field), True


def match_relationships(compiled: dict[str, Any], source_entities: list[dict[str, Any]],
                        target_entities: list[dict[str, Any]], reference_field: str,
                        target_field: str, budget: int | None = None) -> dict[str, Any]:
    """Establish relationships through an approved reference role (P5.9).

    ``budget`` bounds the links built: the matching stops once that many are made, so a key
    many records share never builds millions of links the caller would cut afterwards.

    The fields come from an approved relation rule in the population payload.
    Multiple matching targets are valid only for to-many cardinalities; an
    ambiguous to-one reference never auto-links (T06/T09).
    """
    strategy = compiled["matchingStrategy"]
    # Identity values are stored case-folded, so a side that falls back to the identity is
    # compared case-insensitively; two plain attribute values keep the strategy as is.
    exact_targets: dict[str, list[dict[str, Any]]] = {}
    folded_targets: dict[str, list[dict[str, Any]]] = {}
    identity_targets: dict[str, list[dict[str, Any]]] = {}
    for entity in target_entities:
        raw, from_identity = _match_side(entity, target_field)
        key = match_value(raw, strategy)
        if key is None:
            continue
        folded_targets.setdefault(key.lower(), []).append(entity)
        if from_identity:
            identity_targets.setdefault(key.lower(), []).append(entity)
        else:
            exact_targets.setdefault(key, []).append(entity)
    relationships: list[dict[str, Any]] = []
    gaps: list[dict[str, Any]] = []
    for source in source_entities:
        if budget is not None and len(relationships) >= budget:
            break
        raw, from_identity = _match_side(source, reference_field)
        reference = match_value(raw, strategy)
        if reference is None:
            # An empty reference means this record links to nothing (a message that answers
            # no other one); a value that is required is already reported as a missing value.
            continue
        if from_identity:
            candidates = folded_targets.get(reference.lower(), [])
        else:
            candidates = exact_targets.get(reference, []) + identity_targets.get(reference.lower(), [])
        if not candidates:
            # On the "one" side of a one-to-many link, finding nothing is normal: a message
            # without attachments, an attachment that states no fact.
            if compiled["cardinality"] == "one_to_many":
                continue
            gaps.append({"kind": "unresolved_reference", "relationId": compiled["relationId"],
                         "sourceEntityId": source["entityId"], "referenceField": reference_field,
                         "referenceValue": raw[:MAX_SAMPLE_TEXT] if isinstance(raw, str) else raw,
                         "targetField": target_field, "detail": "no approved target matches"})
        elif len(candidates) > 1 and compiled["cardinality"] not in ("one_to_many", "many_to_many"):
            gaps.append({"kind": "ambiguous_reference", "relationId": compiled["relationId"],
                         "sourceEntityId": source["entityId"],
                         "detail": f"{len(candidates)} targets share the normalized reference"})
        else:
            room = None if budget is None else budget - len(relationships)
            relationships.extend({"relationId": compiled["relationId"],
                                  "sourceEntityId": source["entityId"],
                                  "targetEntityId": candidate["entityId"],
                                  "matchingStrategy": strategy}
                                 for candidate in (candidates if room is None else candidates[:room]))
    return {"relationships": relationships, "gaps": gaps}
