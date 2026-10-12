"""Side-effect-free consistency check of a model's population plan.

The back end sends what a build would send (specification, one source per mapping, link rules,
derived sources) and gets every problem a preview or build would stop on, not just the first one.
It runs the same rules as a run (:mod:`app.population.payload_rules`) after the same shape validation
the admission applies (:mod:`app.jobs.models`); nothing is read, stored or sent anywhere.
"""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from app.jobs.models import Derivation, PopulationSource, RelationBinding

from .compiler import canonical_spec_hash
from .payload_rules import analyze_payload, make_issue

MAX_ISSUES = 500
MAX_CHECKED_SOURCES = 5000


def _first_message(exc: ValidationError) -> str:
    error = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(part) for part in error.get("loc", ()))
    return f"{where}: {error.get('msg', 'invalid')}"[:300]


def _shape_issue(code: str, exc: ValidationError, **target: Any) -> dict[str, Any]:
    return make_issue(code, "This part of the model cannot be read as set up.", "shape",
                      detail=_first_message(exc), **target)


def check_model(request: dict[str, Any]) -> dict[str, Any]:
    """``{"issues": [...], "errorCount": n, "warningCount": n}`` for a plan, without side effects.

    ``request`` carries ``specification``, ``sources`` (each may name its ``mappingId``),
    ``relationBindings``, ``derivations`` and the admin ``limits``.
    """
    issues: list[dict[str, Any]] = []
    sources: list[dict[str, Any]] = []
    mapping_ids: list[str | None] = []
    raw_sources = request.get("sources")
    for raw in (raw_sources if isinstance(raw_sources, list) else [])[:MAX_CHECKED_SOURCES]:
        entry = dict(raw) if isinstance(raw, dict) else {}
        mapping_id = entry.pop("mappingId", None)
        mapping_id = mapping_id if isinstance(mapping_id, str) else None
        try:
            sources.append(PopulationSource.model_validate(entry).model_dump(by_alias=True, mode="json"))
            mapping_ids.append(mapping_id)
        except ValidationError as exc:
            code = "invalid_document_mapping" if entry.get("sourceKind") == "document" else "invalid_column_mapping"
            issues.append(_shape_issue(code, exc, concept_id=entry.get("conceptId"), mapping_id=mapping_id))
    derivations: list[dict[str, Any]] = []
    for raw in request.get("derivations") if isinstance(request.get("derivations"), list) else []:
        try:
            derivations.append(Derivation.model_validate(raw).model_dump(by_alias=True, mode="json"))
        except ValidationError as exc:
            known = raw if isinstance(raw, dict) else {}
            issues.append(_shape_issue("invalid_derivations", exc, concept_id=known.get("conceptId"),
                                       source_id=known.get("derivationId")))
    bindings: list[dict[str, Any]] = []
    for raw in request.get("relationBindings") if isinstance(request.get("relationBindings"), list) else []:
        try:
            bindings.append(RelationBinding.model_validate(raw).model_dump(by_alias=True, mode="json"))
        except ValidationError as exc:
            known = raw if isinstance(raw, dict) else {}
            issues.append(_shape_issue("invalid_relation_bindings", exc, relation_id=known.get("relationId")))
    spec = request.get("specification")
    payload: dict[str, Any] = {
        "specification": spec, "scope": {"kind": "model"}, "purpose": "build",
        "sources": sources, "derivations": derivations, "relationBindings": bindings,
        "limits": request.get("limits") if isinstance(request.get("limits"), dict) else None,
    }
    try:
        payload["specHash"] = canonical_spec_hash(spec) if isinstance(spec, dict) else None
        # A model with no source yet is for the back to report: here it is only checked for what it holds.
        analysis = analyze_payload(payload, allow_empty_sources=True, mapping_ids=mapping_ids)
        issues.extend(analysis.issues)
    except Exception as exc:
        # A run answers invalid_command for a payload it cannot read at all; so does the check.
        issues.append(make_issue("invalid_command", "The model could not be read.", detail=type(exc).__name__))
    unique: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in issues:
        key = repr(sorted(item.items(), key=lambda pair: pair[0]))
        if key not in seen:
            seen.add(key)
            unique.append(item)
    unique = unique[:MAX_ISSUES]
    return {"issues": unique,
            "errorCount": sum(1 for item in unique if item["severity"] == "error"),
            "warningCount": sum(1 for item in unique if item["severity"] == "warning")}
