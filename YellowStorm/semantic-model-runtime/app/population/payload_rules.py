"""The rules a population payload must satisfy before any byte is read.

One rule set, two callers: ``run_population_for_payload`` (preview, build and refresh stop at the first
error) and the model check (:mod:`app.population.model_check`, which lists every problem so the model
can show them as it is edited). Pure functions, no I/O.

An issue is a plain dict::

    {"severity": "error" | "warning", "code": ..., "message": ..., "reason"?: ..., "conceptId"?: ...,
     "fieldId"?: ..., "relationId"?: ..., "mappingId"?: ..., "sourceId"?: ..., "params"?: {...}}

``code`` is the error code a run reports (``invalid_document_mapping``, ``unmapped_identity``...), so the
first error of an analysis is exactly what a run answers; ``reason`` refines it for the messages.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .cell_fields import normalize_field_extractions, uses_ai as uses_cell_ai
from .compiler import canonical_spec_hash, compile_specification, filter_fields, validate_specification
from .computed_fields import check_inputs, normalize_computed, normalize_row_recipes
from .derived import DerivationError, cyclic_derivation_ids, normalize_derivations
from .document_rules import RuleError, normalize_ai_settings, normalize_rules
from .expand import ExpandError, is_item_attribute, normalize_expand

SOURCE_KINDS = (None, "tabular", "excel_sheet", "csv", "document", "manual")
DOCUMENT_MODES = {"extract", "metadata", "constant", "computed"}
METADATA_FIELDS = {"document_name", "document_id", "workspace_id"}
STRATEGIES = (None, "deterministic", "ai", "rules_then_ai")
RELATION_SPEC_CODES = {"duplicate_relation_id", "unknown_relation_endpoint", "invalid_matching_strategy",
                       "invalid_cardinality"}


def make_issue(code: str, message: str, reason: str | None = None, *, severity: str = "error",
               concept_id: Any = None, field_id: Any = None, relation_id: Any = None,
               mapping_id: Any = None, source_id: Any = None, **params: Any) -> dict[str, Any]:
    issue: dict[str, Any] = {"severity": severity, "code": code, "message": message}
    for key, value in (("reason", reason), ("conceptId", concept_id), ("fieldId", field_id),
                       ("relationId", relation_id), ("mappingId", mapping_id), ("sourceId", source_id)):
        if isinstance(value, str) and value:
            issue[key] = value
    clean = {name: value if isinstance(value, (int, float)) and not isinstance(value, bool) else str(value)
             for name, value in params.items() if value is not None}
    if clean:
        issue["params"] = clean
    return issue


@dataclass
class PayloadAnalysis:
    issues: list[dict[str, Any]] = field(default_factory=list)
    # The raw ``validate_specification`` issues: a run answers ``invalid_specification`` with them.
    spec_issues: list[dict[str, Any]] = field(default_factory=list)
    compiled: dict[str, Any] | None = None
    sources: list[dict[str, Any]] = field(default_factory=list)
    bindings: list[dict[str, Any]] = field(default_factory=list)
    derivations: list[dict[str, Any]] = field(default_factory=list)

    @property
    def first_error(self) -> dict[str, Any] | None:
        return next((item for item in self.issues if item["severity"] == "error"), None)


def analyze_payload(payload: dict[str, Any], *, verify_hash: bool = False, expected_hash: str | None = None,
                    max_sources: int | None = None, allow_empty_sources: bool = False,
                    mapping_ids: list[str | None] | None = None) -> PayloadAnalysis:
    """Every rule a run checks on its payload, in the order a run checks them.

    With ``verify_hash`` (a run), the recomputed canonical hash must equal ``expected_hash``.
    ``max_sources`` bounds the source count (a check sends one source per mapping and leaves it out).
    ``mapping_ids`` names the mapping of each source, by position, for the issues.
    """
    analysis = PayloadAnalysis()
    spec = payload.get("specification")
    spec_issues = validate_specification(spec)
    if spec_issues:
        analysis.spec_issues = spec_issues
        for item in spec_issues:
            target = item.get("targetId")
            relation = item["code"] in RELATION_SPEC_CODES
            analysis.issues.append(make_issue(
                item["code"], item["message"], concept_id=None if relation else target,
                relation_id=target if relation else None))
        return analysis
    if verify_hash and canonical_spec_hash(spec) != expected_hash:
        analysis.issues.append(make_issue("spec_hash_mismatch", "The specification does not match its hash."))
        return analysis
    sources = payload.get("sources")
    # A concept refresh keeps every other concept from the data in use: its own concept may be made
    # from another one alone (no source of its own), and its links may reach concepts it does not read.
    concept_refresh = (payload.get("scope") or {}).get("kind") == "concept"
    if (not isinstance(sources, list) or (not sources and not concept_refresh and not allow_empty_sources)
            or (max_sources is not None and len(sources) > max_sources)):
        analysis.issues.append(make_issue("invalid_sources", "A run reads at least one source, and not too many."))
        return analysis
    compiled = compile_specification(spec)
    analysis.compiled = compiled
    mapped_fields: dict[str, set[str]] = {}
    for position, entry in enumerate(sources):
        mapping_id = mapping_ids[position] if mapping_ids and position < len(mapping_ids) else None
        found = _check_source(entry, compiled, mapping_id)
        analysis.issues.extend(found.issues)
        if found.normalized is not None:
            analysis.sources.append(found.normalized)
        # A refused source still counts as filling its fields, so a link is not blamed for it as well.
        if found.mapped:
            mapped_fields.setdefault(entry.get("conceptId"), set()).update(found.mapped)
    _check_derivations(payload, compiled, analysis, mapped_fields)
    _check_bindings(payload, compiled, analysis, mapped_fields, concept_refresh)
    return analysis


@dataclass
class _SourceCheck:
    issues: list[dict[str, Any]] = field(default_factory=list)
    normalized: dict[str, Any] | None = None
    mapped: set[str] = field(default_factory=set)


def _check_source(entry: Any, compiled: dict[str, Any], mapping_id: str | None) -> _SourceCheck:
    result = _SourceCheck()
    if not isinstance(entry, dict):
        result.issues.append(make_issue("invalid_sources", "A source is not readable.", mapping_id=mapping_id))
        return result
    concept_id = entry.get("conceptId")
    concept = compiled["concepts"].get(concept_id)

    def add(code: str, message: str, reason: str | None = None, field_id: Any = None, **params: Any) -> None:
        result.issues.append(make_issue(code, message, reason=reason, concept_id=concept_id, field_id=field_id,
                                        mapping_id=mapping_id, **params))

    if concept is None:
        add("unknown_concept", "This source feeds a concept that is not in the model.")
        return result
    source_kind = entry.get("sourceKind") or entry.get("source_kind")
    if source_kind not in SOURCE_KINDS:
        add("invalid_source_kind", "This kind of source cannot be read.", kind=source_kind)
        return result
    options = entry.get("options") or {}
    active: list[dict[str, Any]] = []
    field_mappings = None
    mapping: dict[str, Any] | None = None
    constants: dict[str, Any] = {}
    recipes: dict[str, Any] = {}
    extractions: dict[str, Any] = {}
    if source_kind == "document":
        field_mappings = entry.get("fieldMappings") or entry.get("field_mappings")
        mapped_attributes, active = _check_document_fields(field_mappings, concept, options, add)
    else:
        # An empty column mapping is a real one: fields may come only from fixed values, cell readings
        # or recipes. Absent (null) means the same.
        mapping = entry.get("columnMapping") if entry.get("columnMapping") is not None else entry.get("column_mapping")
        mapping = {} if mapping is None else mapping
        constants = entry.get("constantMapping") or entry.get("constant_mapping") or {}
        mapped_attributes, extractions, recipes = _check_sheet_fields(
            entry, mapping, constants, options, add)
    result.mapped = mapped_attributes
    ready = mapped_attributes is not None
    if mapped_attributes is not None:
        # Manual rows without a key value keep their own row key as identity.
        if source_kind != "manual":
            for component in concept["keyComponents"]:
                if component not in mapped_attributes:
                    add("unmapped_identity", f"The unique field {component} is not filled by this source.",
                        field_id=component, field=component)
        if mapping is not None and len(set(mapping.values())) != len(mapping):
            for name in {value for value in mapping.values() if list(mapping.values()).count(value) > 1}:
                add("duplicate_column_mapping", f"The field {name} is read from several columns.",
                    "duplicate_target", field_id=name, field=name)
        if "_row" in mapped_attributes:
            add("reserved_attribute_name", "A field cannot be called _row.", field_id="_row")
        # A filter on an unmapped attribute sees only None: eq never matches, so the source would
        # report a clean empty population.
        reported: set[str] = set()
        for filt in (concept.get("eligibility"), concept.get("materialization")):
            for name in filter_fields(filt):
                if name not in mapped_attributes and name not in reported:
                    reported.add(name)
                    add("unmapped_filter_field", f"The filter reads {name}, which this source does not fill.",
                        field_id=name, field=name)
    source = entry.get("source")
    if not isinstance(source, dict) or not source.get("assetId"):
        add("invalid_sources", "This source has no file.", "no_file")
    elif source_kind == "manual" and not isinstance(source.get("snapshotId"), str):
        add("invalid_sources", "These typed records have no snapshot.", "no_snapshot")
    if any(item["severity"] == "error" for item in result.issues) or not ready:
        return result
    result.normalized = {
        "conceptId": entry.get("conceptId"), "source": source,
        "sourceKind": source_kind or "tabular",
        "options": options if isinstance(options, dict) else {},
        **({"fieldMappings": active, "receivedFieldMappings": field_mappings} if source_kind == "document"
           else {"columnMapping": dict(mapping or {}), "constantMapping": dict(constants),
                 **({"fieldRecipes": recipes, "receivedFieldRecipes": entry.get("fieldRecipes") or entry.get("field_recipes")}
                    if recipes else {}),
                 **({"fieldExtractions": extractions,
                     "receivedFieldExtractions": entry.get("fieldExtractions") or entry.get("field_extractions")}
                    if extractions else {})}),
        "labelField": entry.get("labelField") or entry.get("label_field"),
        "mappingVersion": entry.get("mappingVersion") or entry.get("mapping_version") or "v1",
        **({"readLimits": entry["readLimits"]} if isinstance(entry.get("readLimits"), dict) else {}),
    }
    return result


def _check_document_fields(field_mappings: Any, concept: dict[str, Any], options: Any, add: Any):
    """The fields of a document source: their modes, targets, rules and AI settings."""
    if not isinstance(field_mappings, list) or not field_mappings:
        add("invalid_document_mapping", "This document source reads no field.", "no_fields")
        return None, []
    active = [item for item in field_mappings if isinstance(item, dict) and item.get("mode") != "ignore"]
    if len(active) != len(field_mappings):
        add("invalid_document_mapping", "This document source has a field that cannot be read.", "unusable_field")
    for item in active:
        name = item.get("targetAttribute")
        field_id = name if isinstance(name, str) else None
        mode = item.get("mode")
        if mode not in DOCUMENT_MODES:
            add("invalid_document_mapping", "A field is read in a way documents do not support.",
                "unsupported_mode", field_id, field=name, mode=mode)
        if name not in concept["allowedFields"]:
            add("invalid_document_mapping", f"The field {name} is not a field of the concept.",
                "unknown_field", field_id, field=name)
        if mode == "extract" and (not isinstance(item.get("sourceField"), str) or not item["sourceField"].strip()):
            add("invalid_document_mapping", f"The field {name} does not say what to look for.",
                "missing_source_field", field_id, field=name)
        if mode == "metadata" and item.get("sourceField") not in METADATA_FIELDS:
            add("invalid_document_mapping", f"The field {name} reads a file property that does not exist.",
                "unknown_metadata", field_id, field=name)
        strategy = item.get("extractionStrategy")
        if strategy not in STRATEGIES or (strategy is not None and mode != "extract"):
            add("invalid_document_mapping", f"The field {name} has a reading method that cannot be used.",
                "invalid_strategy", field_id, field=name)
        # The AI reading settings of a field: a definition (text) and an agent (an id).
        definition, agent = item.get("semanticDefinition"), item.get("agentId")
        if ((definition is not None and not isinstance(definition, str))
                or (agent is not None and not isinstance(agent, str))
                or ((definition is not None or agent is not None) and mode != "extract")):
            add("invalid_document_mapping", f"The AI settings of the field {name} cannot be used.",
                "invalid_ai_hint", field_id, field=name)
    # Rules are checked once here, so a bad pattern fails the run before any reading.
    normalized: list[dict[str, Any]] = []
    for item in active:
        name = item.get("targetAttribute")
        field_id = name if isinstance(name, str) else None
        try:
            current = item
            if item.get("rules") is not None:
                current = {**current, "rules": normalize_rules(item["rules"])}
                if item.get("mode") != "extract":
                    raise RuleError("rules only apply to extracted fields")
            if item.get("mode") == "computed":
                current = {**current, "computed": normalize_computed(item.get("computed"))}
            normalized.append(current)
        except RuleError as exc:
            add("invalid_document_mapping", f"The reading rules of the field {name} cannot be used.",
                "invalid_rules", field_id, field=name, detail=str(exc))
    if len(normalized) == len(active):
        active = normalized
        try:
            check_inputs(active)
        except RuleError as exc:
            add("invalid_document_mapping", "A computed field reads a field that is not read from the document.",
                "invalid_computed_input", None, detail=str(exc))
        try:
            normalize_ai_settings(options.get("aiSettings") if isinstance(options, dict) else None)
        except RuleError as exc:
            add("invalid_document_mapping", "The AI reading limits are out of range.", "ai_settings",
                None, detail=str(exc))
    targets = [item.get("targetAttribute") for item in active]
    for name in dict.fromkeys(item for item in targets if targets.count(item) > 1):
        add("duplicate_document_mapping", f"The field {name} is filled twice by this source.",
            "duplicate_target", name if isinstance(name, str) else None, field=name)
    return {item for item in targets if isinstance(item, str)}, active


def _check_sheet_fields(entry: dict[str, Any], mapping: Any, constants: Any, options: Any, add: Any):
    """The fields of a sheet source: columns, fixed values, cell readings and recipes."""
    field_recipes = entry.get("fieldRecipes") or entry.get("field_recipes")
    field_extractions = entry.get("fieldExtractions") or entry.get("field_extractions")
    if not isinstance(mapping, dict) or not isinstance(constants, dict):
        add("invalid_column_mapping", "This sheet source maps no field.", "invalid_shape")
        return None, {}, {}
    if not mapping and not constants and not field_extractions and not field_recipes:
        add("invalid_column_mapping", "This sheet source maps no field.", "no_fields")
        return None, {}, {}
    # A field read out of a cell's text with the document rules and/or AI.
    extractions: dict[str, Any] = {}
    try:
        extractions = normalize_field_extractions(field_extractions)
        if uses_cell_ai(extractions):
            normalize_ai_settings(options.get("aiSettings") if isinstance(options, dict) else None)
    except RuleError as exc:
        extractions = {}
        blamed = _blame(field_extractions, lambda name, item: normalize_field_extractions({name: item}))
        if blamed:
            for name, message in blamed:
                add("invalid_column_mapping", f"The cell reading of the field {name} cannot be used.",
                    "invalid_extraction", name if isinstance(name, str) else None, field=name, detail=message)
        else:
            add("invalid_column_mapping", "The cell readings or the AI reading limits cannot be used.",
                "invalid_extraction", None, detail=str(exc))
    mapped_values = list(mapping.values())
    clashes = (set(mapped_values) & set(constants)) | (set(extractions) & set(mapped_values)) \
        | (set(extractions) & set(constants))
    recipe_fields = set(field_recipes) if isinstance(field_recipes, dict) else set()
    clashes |= recipe_fields & (set(constants) | set(extractions))
    for name in sorted(clashes, key=str):
        add("duplicate_column_mapping", f"The field {name} is filled in several ways by this source.",
            "several_ways", name if isinstance(name, str) else None, field=name)
    # A field's recipe (take it from, cut, keep, shape, clean-up), as a document's computed field:
    # on a column it shapes, or on its own (a field taken from a column or another field).
    recipes: dict[str, Any] = {}
    mapped_for_recipes = set(mapped_values) | set(constants) | set(extractions) | recipe_fields
    try:
        recipes = normalize_row_recipes(field_recipes, mapped_for_recipes)
    except RuleError as exc:
        blamed = _blame(field_recipes, lambda name, item: normalize_row_recipes({name: item}, mapped_for_recipes))
        if blamed:
            for name, message in blamed:
                add("invalid_column_mapping", f"The recipe of the field {name} cannot be used.",
                    "invalid_recipe", name if isinstance(name, str) else None, field=name, detail=message)
        else:
            add("invalid_column_mapping", "These recipes cannot be used.", "invalid_recipe", None, detail=str(exc))
    # The fields named by readings and recipes count as mapped even when one is refused, so a refused
    # reading is reported once and not again as a missing unique field.
    mapped_attributes = (set(mapped_values) | set(constants) | recipe_fields
                         | (set(field_extractions) if isinstance(field_extractions, dict) else set()))
    # Several records per row: one column split into items (its columns are only known when read).
    sheet_expand = options.get("expand") if isinstance(options, dict) else None
    if sheet_expand is not None:
        try:
            if not isinstance(sheet_expand, dict) or "relationId" in sheet_expand:
                raise ExpandError("invalid_expand")
            normalize_expand(sheet_expand, {sheet_expand.get("field")} - {None, ""})
        except ExpandError:
            add("invalid_column_mapping", "The column split into several records cannot be used.", "invalid_expand")
    elif any(is_item_attribute(column) for column in mapping):
        # A field reading an item of a sheet that does not expand a column.
        add("invalid_column_mapping", "A field reads an item, but the sheet does not split a column into items.",
            "item_without_expand")
    return mapped_attributes, extractions, recipes


def _blame(raw: Any, probe: Any) -> list[tuple[Any, str]]:
    """The fields of a mapping that fail on their own, to tell which one a reader refuses."""
    if not isinstance(raw, dict):
        return []
    blamed: list[tuple[Any, str]] = []
    for name, item in raw.items():
        try:
            probe(name, item)
        except RuleError as exc:
            blamed.append((name, str(exc)))
    return blamed


def _check_derivations(payload: dict[str, Any], compiled: dict[str, Any], analysis: PayloadAnalysis,
                       mapped_fields: dict[str, set[str]]) -> None:
    raw = payload.get("derivations")

    def one(entries: Any, entry: Any) -> list[dict[str, Any]]:
        normalized = normalize_derivations(entries, compiled["concepts"])
        for derivation in normalized:
            # The relationship an expanding derivation links its records by joins its two concepts.
            relation_id = (derivation.get("expand") or {}).get("relationId")
            relation = compiled["relations"].get(relation_id) if relation_id else None
            if relation_id and (relation is None or {relation["sourceConceptId"], relation["targetConceptId"]}
                                != {derivation["conceptId"], derivation["sourceConceptId"]}):
                raise DerivationError("invalid_derivations", "expand_relation")
        return normalized

    def report(exc: DerivationError, entry: Any) -> None:
        known = entry if isinstance(entry, dict) else {}
        reason = exc.reason
        analysis.issues.append(make_issue(
            exc.code, "This concept cannot be filled from another concept as set up.", reason=reason,
            concept_id=known.get("conceptId"), field_id=exc.field, source_id=known.get("derivationId"),
            detail=exc.detail, source_concept=known.get("sourceConceptId"), field=exc.field))

    if not isinstance(raw, list):
        try:
            analysis.derivations = one(raw, raw)
        except DerivationError as exc:
            report(exc, raw)
        return
    failed = False
    for entry in raw:
        try:
            one([entry], entry)
        except DerivationError as exc:
            failed = True
            report(exc, entry)
    if failed:
        return
    try:
        analysis.derivations = one(raw, raw)
    except DerivationError as exc:
        # Only the whole list can fail now: otherwise-valid derivations form a cycle.
        cyclic_ids = cyclic_derivation_ids(raw) if exc.code == "cyclic_derivation" else set()
        cyclic = [entry for entry in raw if entry.get("derivationId") in cyclic_ids]
        if cyclic:
            for entry in cyclic:
                report(exc, entry)
        else:
            report(exc, None)
        return
    for derivation in analysis.derivations:
        mapped_fields.setdefault(derivation["conceptId"], set()).update(
            item["targetAttribute"] for item in derivation["fieldMappings"])


def _check_bindings(payload: dict[str, Any], compiled: dict[str, Any], analysis: PayloadAnalysis,
                    mapped_fields: dict[str, set[str]], concept_refresh: bool) -> None:
    bindings = payload.get("relationBindings") or payload.get("relation_bindings") or []
    if not isinstance(bindings, list):
        analysis.issues.append(make_issue("invalid_relation_bindings", "The link rules cannot be read.", "shape"))
        return

    def mapped(concept_id: str, name: str) -> bool:
        # A kept concept's fields were checked when its data was made; the back plans every link.
        if concept_refresh and concept_id not in mapped_fields:
            return name in compiled["concepts"][concept_id]["allowedFields"]
        return name in mapped_fields.get(concept_id, set())

    for binding in bindings:
        if not isinstance(binding, dict):
            analysis.issues.append(make_issue("invalid_relation_bindings", "A link rule cannot be read.", "shape"))
            continue
        relation = compiled["relations"].get(binding.get("relationId"))
        if relation is None:
            analysis.issues.append(make_issue("unknown_relation", "A link rule names a link that is not in the model.",
                                              relation_id=binding.get("relationId")))
            continue
        reference = binding.get("referenceField") or binding.get("reference_field")
        target = binding.get("targetField") or binding.get("target_field")
        target_identity = compiled["concepts"][relation["targetConceptId"]]["keyComponents"]
        if target is None and len(target_identity) == 1:
            target = target_identity[0]
        for side, concept_id, name in (("reference", relation["sourceConceptId"], reference),
                                       ("target", relation["targetConceptId"], target)):
            if not isinstance(name, str) or not mapped(concept_id, name):
                analysis.issues.append(make_issue(
                    "invalid_relation_bindings", "A link matches records on a field that no source fills.",
                    f"{side}_unmapped", concept_id=concept_id, field_id=name,
                    relation_id=relation["relationId"], field=name))
        if (isinstance(reference, str) and isinstance(target, str)
                and mapped(relation["sourceConceptId"], reference) and mapped(relation["targetConceptId"], target)):
            analysis.bindings.append({"relationId": relation["relationId"],
                                      "referenceField": reference, "targetField": target})
