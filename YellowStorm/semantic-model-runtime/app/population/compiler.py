"""Deterministic population compiler (Phase 5A, P5.1-P5.3 tabular subset).

Pure stdlib. Compiles a canonical ``ModelSpecification`` into per-concept
field groups, identity rules, matching plans and filter ASTs. Document
extraction recipes (P5.4-P5.6) and LLM fallback (P5.16-P5.22) are out of scope:
this slice compiles the deterministic tabular path only. Mirrors the reference
validation in ``ModelSpecificationService`` (P1.2/P1.4/P1.5).
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

POPULATION_MODES = {"materialized", "filtered_materialized", "query_backed"}
FILTER_OPS = {"eq", "neq", "in", "not_in", "is_null", "is_not_null"}
MATCHING_STRATEGIES = {"exact", "case_insensitive", "normalized"}
SPEC_HASH_RE = re.compile(r"^sha256:[0-9a-f]{64}$")


class PopulationError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _is_nonblank(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def validate_specification(spec: Any) -> list[dict[str, Any]]:
    """Reference/type validation before any population job is accepted (P1.5)."""
    issues: list[dict[str, Any]] = []
    if not isinstance(spec, dict):
        return [{"code": "invalid_specification", "message": "Specification must be an object."}]
    concepts = spec.get("concepts")
    if not isinstance(concepts, list):
        return [{"code": "invalid_specification", "message": "Specification concepts must be a list."}]

    concept_ids: set[str] = set()
    concept_keys: set[str] = set()
    fields_by_concept: dict[str, set[str]] = {}
    for entry in concepts:
        if not isinstance(entry, dict):
            issues.append({"code": "invalid_specification", "message": "Concept must be an object."})
            continue
        concept_id = entry.get("conceptId")
        if concept_id in concept_ids:
            issues.append({"code": "duplicate_concept_id", "targetId": concept_id,
                           "message": "Concept ids must be unique; rename preserves id."})
        concept_ids.add(concept_id)
        key = entry.get("key")
        lowered = key.strip().lower() if isinstance(key, str) else ""
        if lowered in concept_keys:
            issues.append({"code": "duplicate_concept_key", "targetId": concept_id,
                           "message": "Concept keys must be unique."})
        concept_keys.add(lowered)
        identity = entry.get("identity") if isinstance(entry.get("identity"), dict) else {}
        parts = identity.get("keyComponents")
        if (not _is_nonblank(identity.get("namespace")) or not isinstance(parts, list)
                or not parts or any(not _is_nonblank(p) for p in parts)):
            issues.append({"code": "empty_identity_key", "targetId": concept_id,
                           "message": "Identity needs a namespace and a non-blank key component."})
        allowed = entry.get("allowedFields")
        if not isinstance(allowed, list) or not allowed or any(not _is_nonblank(f) for f in allowed):
            issues.append({"code": "empty_allowed_fields", "targetId": concept_id,
                           "message": "Allowed fields must list at least one field."})
        fields_by_concept[concept_id] = set(allowed) if isinstance(allowed, list) else set()
        if entry.get("populationMode") not in POPULATION_MODES:
            issues.append({"code": "invalid_population_mode", "targetId": concept_id,
                           "message": "Population mode must be materialized, filtered_materialized or query_backed."})
        if entry.get("materialization") and not entry.get("eligibility"):
            issues.append({"code": "materialization_without_eligibility", "targetId": concept_id,
                           "message": "Materialization filter requires an eligibility filter."})
        _check_filter(entry.get("eligibility"), fields_by_concept[concept_id], concept_id, issues)
        _check_filter(entry.get("materialization"), fields_by_concept[concept_id], concept_id, issues)

    relation_ids: set[str] = set()
    relations = spec.get("relations")
    if not isinstance(relations, list):
        issues.append({"code": "invalid_specification", "message": "Specification relations must be a list."})
    else:
        for entry in relations:
            if not isinstance(entry, dict):
                issues.append({"code": "invalid_specification",
                               "message": "Relation must be an object."})
                continue
            relation_id = entry.get("relationId")
            if relation_id in relation_ids:
                issues.append({"code": "duplicate_relation_id", "targetId": relation_id,
                               "message": "Relation ids must be unique."})
            relation_ids.add(relation_id)
            if (entry.get("sourceConceptId") not in concept_ids
                    or entry.get("targetConceptId") not in concept_ids):
                issues.append({"code": "unknown_relation_endpoint", "targetId": relation_id,
                               "message": "Relation endpoints must reference known concepts."})
            if entry.get("matchingStrategy") not in MATCHING_STRATEGIES:
                issues.append({"code": "invalid_matching_strategy", "targetId": relation_id,
                               "message": "Matching strategy must be exact, case_insensitive or normalized."})

    if not isinstance(spec.get("sourceScope"), list) or not spec.get("sourceScope"):
        issues.append({"code": "empty_source_scope", "message": "Source scope must not be empty."})
    return issues


def _check_filter(node: Any, allowed: set[str], target_id: Any,
                  issues: list[dict[str, Any]]) -> None:
    if not node:
        return
    if not isinstance(node, dict):
        issues.append({"code": "invalid_filter", "targetId": target_id,
                       "message": "Filter node must be an object."})
        return
    if "field" in node:
        if node.get("field") not in allowed:
            issues.append({"code": "unknown_filter_field", "targetId": target_id,
                           "message": f"Filter field '{node.get('field')}' is not in allowed fields."})
        if node.get("op") not in FILTER_OPS:
            issues.append({"code": "invalid_filter_op", "targetId": target_id,
                           "message": "Filter op is not a supported typed operator."})
        return
    for child in node.get("all", []) or []:
        _check_filter(child, allowed, target_id, issues)
    for child in node.get("any", []) or []:
        _check_filter(child, allowed, target_id, issues)
    if node.get("not") is not None:
        _check_filter(node.get("not"), allowed, target_id, issues)


def _text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def evaluate_filter(node: Any, row: dict[str, Any]) -> bool:
    """Typed filter AST over a prepared row. Empty/absent groups pass (P5.3)."""
    if not node:
        return True
    if not isinstance(node, dict) or not isinstance(row, dict):
        raise PopulationError("invalid_filter")
    if "field" in node:
        actual = _text(row.get(node.get("field")))
        op = node.get("op")
        if op in ("eq", "neq", "in", "not_in") and actual is None:
            return False
        if op == "eq":
            return actual == _text(node.get("value"))
        if op == "neq":
            return actual != _text(node.get("value"))
        if op == "in":
            expected = node.get("value")
            return isinstance(expected, list) and actual in [_text(v) for v in expected]
        if op == "not_in":
            expected = node.get("value")
            return isinstance(expected, list) and actual not in [_text(v) for v in expected]
        if op == "is_null":
            return actual is None or actual == ""
        if op == "is_not_null":
            return actual is not None and actual != ""
        raise PopulationError("invalid_filter_op")
    for child in node.get("all", []) or []:
        if not evaluate_filter(child, row):
            return False
    any_children = node.get("any", []) or []
    if any_children and not any(evaluate_filter(child, row) for child in any_children):
        return False
    if node.get("not") is not None and evaluate_filter(node.get("not"), row):
        return False
    return True


def filter_fields(node: Any) -> list[str]:
    """Every leaf field name referenced by a filter AST."""
    if not isinstance(node, dict):
        return []
    if "field" in node:
        field = node.get("field")
        return [field] if isinstance(field, str) else []
    fields: list[str] = []
    for child in (node.get("all", []) or []) + (node.get("any", []) or []):
        fields.extend(filter_fields(child))
    if node.get("not") is not None:
        fields.extend(filter_fields(node.get("not")))
    return fields


def compile_specification(spec: dict[str, Any]) -> dict[str, Any]:
    """Compile a validated specification into executable per-concept plans."""
    concepts: dict[str, Any] = {}
    for entry in spec.get("concepts", []):
        concepts[entry["conceptId"]] = {
            "conceptId": entry["conceptId"], "key": entry["key"], "label": entry.get("label", ""),
            "namespace": entry["identity"]["namespace"].strip(),
            "keyComponents": [p.strip() for p in entry["identity"]["keyComponents"]],
            "populationMode": entry["populationMode"],
            "eligibility": entry.get("eligibility"),
            "materialization": entry.get("materialization"),
            "allowedFields": list(entry["allowedFields"]),
        }
    relations: dict[str, Any] = {}
    for entry in spec.get("relations", []):
        relations[entry["relationId"]] = {
            "relationId": entry["relationId"], "key": entry.get("key", ""),
            "sourceConceptId": entry["sourceConceptId"],
            "targetConceptId": entry["targetConceptId"],
            "cardinality": entry.get("cardinality"),
            "matchingStrategy": entry["matchingStrategy"],
        }
    return {"specHash": spec.get("specHash"), "concepts": concepts, "relations": relations,
            "sourceScope": list(spec.get("sourceScope", []))}


def canonical_spec_hash(spec: dict[str, Any]) -> str:
    """Recompute the P1.5 canonical hash. Byte-compatible port of the
    TypeScript ``ModelSpecificationService`` for ASCII specs; object keys sort
    by code point (JS sorts UTF-16 units, identical for ASCII)."""
    canonical = {
        **spec,
        "concepts": sorted(
            ({**c, "allowedFields": sorted(c.get("allowedFields", []))}
             for c in spec.get("concepts", [])),
            key=lambda c: c.get("conceptId", "")),
        "relations": sorted(spec.get("relations", []), key=lambda r: r.get("relationId", "")),
        "sourceScope": sorted(spec.get("sourceScope", []),
                              key=lambda s: f"{s.get('workspaceId')}:{s.get('assetId')}"),
    }
    canonical.pop("specHash", None)
    return "sha256:" + hashlib.sha256(_stable_stringify(canonical).encode("utf-8")).hexdigest()


def _stable_stringify(value: Any) -> str:
    if value is None or not isinstance(value, (dict, list)):
        return json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(_stable_stringify(item) for item in value) + "]"
    parts = [json.dumps(k, ensure_ascii=False) + ":" + _stable_stringify(value[k])
             for k in sorted(value.keys())]
    return "{" + ",".join(parts) + "}"
