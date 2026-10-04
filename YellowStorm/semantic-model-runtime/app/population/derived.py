"""Records of one concept made from the values another concept's records carry.

A contract names its customer by id and name; the customers themselves are listed nowhere. A
derivation maps some fields of the source concept (Contract) to fields of the target concept
(Organization) and makes one target record per distinct key value. When records that share a key
disagree on another field, the derivation's conflict rule picks the value kept.

Derived records use the target concept's own entity ids, so they merge with records a direct
source gives the same concept: a direct value always wins, a derived one only fills a gap. Every
derived value keeps the evidence of the source value it was taken from (the file, page and quote),
so a person can still open the document it came from.

A field is copied from a field of the source record by default. It can instead be read out of that
field's text with the document rules and/or AI (``mode: extract``, the same readers a sheet cell
uses: the text is a one-section document), taken from a field by a recipe (``mode: computed``, the
same recipe a sheet field uses; a ``column`` input names a field of the source record), or fixed
(``mode: constant``). Such a value keeps the source value's evidence and adds which part of the
source field it was read from (``derivedFrom.attribute``, ``span``, ``method``); a recipe joining several
source fields lists them all in ``derivedFrom.attributes``.

A derivation can also *expand* one source field into several items (``expand``, see :mod:`.expand`): the
recipients a message lists, as text or a JSON array. Each item is read as a record of its own, its fields
reading ``@item`` (or ``@item.<path>`` of an object item); evidence still names the source record and field.
"""

from __future__ import annotations

from typing import Any

from .document_rules import RuleError, normalize_ai_settings, to_iso_date
from .expand import ExpandError, expand_entities, is_item_attribute, normalize_expand
from .tabular import MAX_ASSERTIONS, MAX_MATERIALIZED_ENTITIES, entity_key, normalize_identity_value

CONFLICT_RULES = ("most_frequent", "latest", "longest", "leave_empty")
MAX_DERIVATIONS = 50
# How many source records a derived record names; the count is always exact.
MAX_DERIVED_FROM_IDS = 50


FIELD_MODES = ("direct", "extract", "computed", "constant")
# What a derived field mapping may carry, kept as received so both sides hash the same body.
_FIELD_KEYS = ("sourceAttribute", "targetAttribute", "mode", "label", "extractionStrategy", "rules",
               "semanticDefinition", "agentId", "description", "valueType", "allowedValues", "computed",
               "constantValue")


class DerivationError(ValueError):
    """A derivation that cannot run as described; the message is an error code."""


def _mode(field: dict) -> str:
    return field.get("mode") or "direct"


def field_plan(derivation: dict) -> dict[str, Any]:
    """How a derivation's fields that are not copied as they are get their value, in the shapes the
    sheet readers use: cell extractions (the source field is the "column"), row recipes and constants.

    Raises ``RuleError`` for settings the readers refuse.
    """
    from .cell_fields import normalize_field_extractions
    from .computed_fields import normalize_row_recipes

    fields = derivation["fieldMappings"]
    extractions = normalize_field_extractions({
        field["targetAttribute"]: {"column": field.get("sourceAttribute"),
                                   **{key: field[key] for key in _FIELD_KEYS
                                      if key not in ("sourceAttribute", "targetAttribute", "mode", "computed",
                                                     "constantValue") and field.get(key) is not None}}
        for field in fields if _mode(field) == "extract"} or None)
    mapped = {field["targetAttribute"] for field in fields if _mode(field) != "constant"}
    recipes = normalize_row_recipes({field["targetAttribute"]: field.get("computed")
                                     for field in fields if _mode(field) == "computed"} or None, mapped)
    constants = {field["targetAttribute"]: field.get("constantValue")
                 for field in fields if _mode(field) == "constant"}
    return {"extractions": extractions, "recipes": recipes, "constants": constants}


def _normalize_field(field: Any, source: dict, target: dict, items: bool = False) -> dict:
    if not isinstance(field, dict):
        raise DerivationError("invalid_derivations")

    def readable(name: Any) -> bool:
        # A field of the source record, or (when the derivation expands a field) of the item.
        return name in source["allowedFields"] or (items and is_item_attribute(name))
    mode = _mode(field)
    target_attribute = field.get("targetAttribute")
    if mode not in FIELD_MODES or target_attribute not in target["allowedFields"]:
        raise DerivationError("invalid_derivations")
    if mode in ("direct", "extract") and not readable(field.get("sourceAttribute")):
        raise DerivationError("invalid_derivations")
    if mode == "direct" and "mode" not in field:
        # A field copied as it is: the shape every derivation had before the field modes.
        return {"sourceAttribute": field["sourceAttribute"], "targetAttribute": target_attribute}
    if mode == "constant" and not isinstance(field.get("constantValue"), (str, int, float, bool)):
        raise DerivationError("invalid_derivations")
    if mode == "computed":
        computed = field.get("computed")
        source_input = (computed.get("input") or {}) if isinstance(computed, dict) else {}
        # A joined input reads each of its parts; a fixed text part reads nothing.
        parts = source_input.get("parts") if source_input.get("kind") == "join" else [source_input]
        if not isinstance(parts, list):
            raise DerivationError("invalid_derivations")
        for part in parts:
            kind = part.get("kind") if isinstance(part, dict) else None
            # A "column" of a source record is one of its fields.
            if (kind not in ("column", "field", "text") or (kind == "text" and part is source_input)
                    or (kind == "column" and not readable(part.get("name")))):
                raise DerivationError("invalid_derivations")
    return {key: field[key] for key in _FIELD_KEYS if key in field}


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
        try:
            expand = normalize_expand(entry.get("expand"), source["allowedFields"])
        except ExpandError as exc:
            raise DerivationError("invalid_derivations") from exc
        mapped = [_normalize_field(field, source, target, items=expand is not None) for field in fields]
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
        derivation = {
            "derivationId": derivation_id, "conceptId": target["conceptId"],
            "sourceConceptId": source["conceptId"], "fieldMappings": mapped,
            "conflictRule": rule, "orderBy": order_by, "labelField": label_field,
            "mappingVersion": mapping_version if isinstance(mapping_version, str) and mapping_version else "v1",
        }
        if expand is not None:
            derivation["expand"] = expand
        # How much of a field's text the AI reads; only sent when a field is read by AI.
        ai_settings = entry.get("aiSettings")
        if ai_settings is not None:
            if not isinstance(ai_settings, dict):
                raise DerivationError("invalid_derivations")
            derivation["aiSettings"] = ai_settings
        try:
            field_plan(derivation)
            normalize_ai_settings(ai_settings)
        except RuleError as exc:
            raise DerivationError("invalid_derivations") from exc
        normalized.append(derivation)
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


def derivation_items(derivation: dict, source_entities: list[dict]) -> tuple[list[dict], list[dict]]:
    """The records a derivation reads: the source records, or one item record per item of the field it
    expands, with the gaps of the expansion (a record listing more items than are read)."""
    items, gaps = expand_entities(source_entities, derivation.get("expand"))
    for gap in gaps:
        gap.update({"conceptId": derivation["conceptId"], "derivationId": derivation["derivationId"]})
    return items, gaps


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


_READ_KEYS = ("span", "quote", "extractorVersion", "rawEvidenceHash", "model", "requestedAgentId")
_METHODS = {"extract": "rules", "computed": "recipe", "constant": "constant"}


def _recipe_attributes(field: dict, by_field: dict[str, dict]) -> list[str]:
    """The source fields a recipe reads, in order and once each: its column, or the source field of the
    field it is taken from, for every part of a joined input."""
    source = (field.get("computed") or {}).get("input") or {}
    parts = (source.get("parts") or []) if source.get("kind") == "join" else [source]
    names: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        if part.get("kind") == "column":
            name = part.get("name")
        else:
            other = by_field.get(part.get("name")) if part.get("kind") == "field" else None
            name = other.get("sourceAttribute") if other else None
        if isinstance(name, str) and name not in names:
            names.append(name)
    return names


def _recipe_attribute(field: dict, by_field: dict[str, dict]) -> str | None:
    """The (first) source field a recipe reads, for the evidence of the value it gives."""
    names = _recipe_attributes(field, by_field)
    return names[0] if names else None


async def read_derived_fields(derivation: dict, source_entities: list[dict], context: dict[str, Any], *,
                              cache: Any = None, extract: Any = None, ai_records: int | None = None) -> dict:
    """The fields of a derivation that are not copied as they are, read on every source record with the
    sheet readers: a source field's text read by the document rules and/or AI (``CellReader``: AI once
    per record for all its AI fields, at most ``ai_records`` records per run, unchanged texts reuse
    their answer from ``cache``), then recipes (``apply_row_recipes``), then fixed values.

    ``context`` is the ``CellReader`` context (``conceptId``, ``conceptLabel``, ``source``, ``modelId``,
    ``aiExtraction``). Returns ``readings`` (per source record id: ``values`` and ``evidence`` by field),
    ``gaps`` and the AI ``stats``. Nothing is read when every field is copied as it is.
    """
    from .cell_fields import CellReader, cell_gaps, cell_text, extraction_columns
    from .computed_fields import apply_row_recipes, recipe_columns

    plan = field_plan(derivation)
    if not (plan["extractions"] or plan["recipes"] or plan["constants"]):
        return {"readings": {}, "gaps": [], "stats": {}}
    by_field = {field["targetAttribute"]: field for field in derivation["fieldMappings"]}
    ordered = sorted(source_entities, key=lambda entity: entity["entityId"])
    outcomes: list[dict | None] = [None] * len(ordered)
    reader = None
    if plan["extractions"]:
        reader = CellReader(plan["extractions"], {
            **context, "unit": "record", "mappingVersion": derivation["mappingVersion"],
            "settings": normalize_ai_settings(derivation.get("aiSettings"))},
            cache=cache, ai_rows=ai_records, extract=extract)
        columns = extraction_columns(plan["extractions"])
        outcomes = list(await reader.read_rows([
            (entity["entityId"], {column: cell_text(_source_value(entity, column)) for column in columns})
            for entity in ordered]))
    readings: dict[str, dict] = {}
    missing: dict[str, int] = {}
    for entity, outcome in zip(ordered, outcomes):
        values: dict[str, Any] = {field: _source_value(entity, item["sourceAttribute"])
                                  for field, item in by_field.items() if _mode(item) == "direct"}
        evidence: dict[str, dict] = {}
        if outcome is not None:
            for attribute in plan["extractions"]:
                values[attribute] = outcome["values"].get(attribute)
                found = outcome["evidence"].get(attribute)
                if found is None:
                    missing[attribute] = missing.get(attribute, 0) + 1
                    continue
                evidence[attribute] = {"method": "ai" if found.get("origin") == "ai" else "rules",
                                       "attribute": found.get("column"),
                                       **{key: found[key] for key in _READ_KEYS if found.get(key) is not None}}
        values.update(plan["constants"])
        raw = {column: _source_value(entity, column) for column in recipe_columns(plan["recipes"])}
        for attribute, recipe in apply_row_recipes(plan["recipes"], values, raw).items():
            if recipe["reason"] == "found":
                names = _recipe_attributes(by_field[attribute], by_field)
                # A joined input names every source field it read; ``attribute`` stays the first one.
                evidence[attribute] = {"method": "recipe", "attribute": names[0] if names else None,
                                       **({"attributes": names} if len(names) > 1 else {})}
        readings[entity["entityId"]] = {
            "values": {field: values.get(field) for field, item in by_field.items() if _mode(item) != "direct"},
            "evidence": evidence}
    gaps = cell_gaps(derivation["conceptId"], None, plan["extractions"], missing, len(ordered),
                     reader.stats, unit="records") if reader is not None else []
    for gap in gaps:
        gap["derivationId"] = derivation["derivationId"]
    return {"readings": readings, "gaps": gaps, "stats": reader.stats if reader is not None else {}}


def derive_concept(target: dict, derivation: dict, source_entities: list[dict],
                   source_assertions: list[dict], readings: dict[str, dict] | None = None) -> dict:
    """One target record per distinct key found in the source records, shaped like a source's output.

    ``readings`` (from :func:`read_derived_fields`) holds, per source record, the values and evidence
    of the fields that are not copied as they are; a copied field reads the source record itself.
    """
    fields = derivation["fieldMappings"]
    by_field = {field["targetAttribute"]: field for field in fields}
    # The source field each field reads, for its evidence and the reports; none for a fixed value.
    by_target = {field["targetAttribute"]: field.get("sourceAttribute") or _recipe_attribute(field, by_field)
                 for field in fields}
    readings = readings or {}

    def value_of(entity: dict, attribute: str) -> Any:
        field = by_field[attribute]
        if _mode(field) == "direct":
            return _source_value(entity, field["sourceAttribute"])
        return ((readings.get(entity["entityId"]) or {}).get("values") or {}).get(attribute)
    key_components: list[str] = target["keyComponents"]
    rule = derivation["conflictRule"]
    evidence_of = {(assertion["entityId"], assertion["attribute"]): assertion for assertion in source_assertions}
    expanded = (derivation.get("expand") or {}).get("field")

    def source_of(member: dict) -> str:
        """The source record an item record was made from (the record itself when nothing is expanded)."""
        return member.get("parentEntityId") or member["entityId"]
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
            normalized = normalize_identity_value(value_of(entity, component))
            if normalized is None:
                break
            identity[component] = normalized
        if len(identity) != len(key_components):
            missing = next(component for component in key_components if component not in identity)
            gaps.append({"kind": "missing_identity", "conceptId": target["conceptId"], "rowNumber": None,
                         "detail": f"{entity.get('label') or entity['entityId']} has no value for '{by_target[missing] or missing}'",
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
                          if (text := _text(value_of(member, target_attribute))) is not None]
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
            read = ((readings.get(member["entityId"]) or {}).get("evidence") or {}).get(target_attribute) or {}
            source_attribute = read.get("attribute", source_attribute)
            # An item's value is evidenced by the source field the item was expanded from.
            evidence_attribute = expanded if is_item_attribute(source_attribute) else source_attribute
            source_assertion = evidence_of.get((source_of(member), evidence_attribute)) if evidence_attribute else None
            evidence = dict(source_assertion["evidence"]) if source_assertion else {
                "assetRef": ((member.get("provenance") or {}).get("sources") or [{}])[0].get("assetRef")}
            evidence["mappingVersion"] = derivation["mappingVersion"]
            evidence["derivedFrom"] = {
                "derivationId": derivation["derivationId"], "conceptId": derivation["sourceConceptId"],
                "entityId": source_of(member), "label": member.get("label"), "attribute": source_attribute,
                "rule": rule, "distinctValues": distinct, "records": len({source_of(item) for _value, item in candidates})}
            if member.get("itemIndex") is not None:
                evidence["derivedFrom"].update({"item": member["itemIndex"], "expandedFrom": expanded})
            if _mode(by_field[target_attribute]) != "direct":
                # Read out of the source field's text, by a recipe, or fixed: how, and where in the text.
                evidence["derivedFrom"].update({key: read[key] for key in _READ_KEYS if read.get(key) is not None})
                evidence["derivedFrom"]["method"] = read.get("method") or _METHODS[_mode(by_field[target_attribute])]
                if read.get("attributes"):
                    evidence["derivedFrom"]["attributes"] = list(read["attributes"])
                if read.get("method") == "ai":
                    evidence["origin"] = "ai"
            attributes[target_attribute] = value
            assertions.append({"entityId": key, "attribute": target_attribute, "value": value,
                               "origin": "human" if source_assertion and source_assertion.get("origin") == "human" else "source",
                               "evidence": evidence})
        label_field = derivation.get("labelField")
        first_key_value = _text(value_of(members[0], key_components[0]))
        label = attributes.get(label_field) if label_field else None
        sources: list[dict] = []
        seen: set[tuple[Any, Any]] = set()
        for member in members:
            for source in (member.get("provenance") or {}).get("sources", []):
                marker = ((source.get("assetRef") or {}).get("assetVersionId"), source.get("mappingVersion"))
                if marker not in seen:
                    seen.add(marker)
                    sources.append({**source, "rowNumbers": list(source.get("rowNumbers", []))})
        member_ids = sorted({source_of(member) for member in members})
        entities.append({
            "entityId": key, "conceptId": target["conceptId"], "namespace": target["namespace"],
            "identity": dict(group["identity"]), "label": label or first_key_value or key,
            "attributes": attributes, "materialized": True,
            "provenance": {"sources": sources, "derivedFrom": {
                "derivationId": derivation["derivationId"], "conceptId": derivation["sourceConceptId"],
                "count": len(member_ids), "entityIds": member_ids[:MAX_DERIVED_FROM_IDS]}},
        })
        counts["materialized"] += 1
    counts["gaps"] = len(gaps)
    # An expanding derivation links each source record to the records its items made.
    links = sorted({(source_of(member), key) for key, group in groups.items() for member in group["members"]
                    if member.get("parentEntityId")}) if (derivation.get("expand") or {}).get("relationId") else []
    return {"entities": entities, "assertions": assertions, "gaps": gaps, "counts": counts,
            "links": [{"sourceEntityId": parent, "targetEntityId": key} for parent, key in links]}


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
