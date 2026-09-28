"""Deterministic, specification-bounded population from logical-index documents."""

from __future__ import annotations

import hashlib
import re
from typing import Any, Awaitable, Callable

from app.datasource.asset_delivery import AssetFetchError, fetch_workspace_asset_metadata
from app.datasource.attribute_extraction import AttributeExtractionError, extract_attributes
from app.datasource.discovery import resolve_asset_ref
from app.datasource.logical_index import (build_index_observation, detect_capabilities,
                                          resolve_document_candidates)
from app.datasource.logical_search import LogicalSearchError, combine_hits, search_exact, search_lexical
from app.datasource.section_reader import (MAX_CLOSURE_SECTIONS, SectionReadError,
                                           get_outline, read_complete_section_set)

from .tabular import populate_concept_rows

# Bump when the way a document is read changes, so cached results are not reused.
DOCUMENT_EXTRACTION_VERSION = "document-v1"

EXTRACTOR_VERSION = "label-value-v4"
MAX_FIELD_VALUE_CHARS = 500
RECORD_ROW_MIN_LABELS = 2


def _metadata_value(source: dict[str, Any], field: str) -> Any:
    return {"document_name": source.get("originalName"),
            "document_id": source.get("assetId"),
            "workspace_id": source.get("workspaceId")}.get(field)


def _label_value(text: Any, label: str) -> str | None:
    if not isinstance(text, str):
        return None
    match = re.search(
        rf"(?:^|[\r\n])\s*{re.escape(label)}\s*[:\-]\s*([^\r\n]{{1,{MAX_FIELD_VALUE_CHARS}}})",
        text, flags=re.IGNORECASE)
    return match.group(1).strip() if match else None


def _label_spans(text: Any, labels: list[str]) -> list[tuple[int, int, str]]:
    """Non-overlapping whole-word label occurrences, longest label first.

    Scanning longest-first stops a shorter mapped label from matching inside a
    longer one, so ``id`` is never counted within ``customer id``.
    """
    if not isinstance(text, str) or not labels:
        return []
    ordered = sorted(set(labels), key=len, reverse=True)
    pattern = re.compile(
        "|".join(rf"(?<![A-Za-z0-9_]){re.escape(label)}(?![A-Za-z0-9_])" for label in ordered),
        re.IGNORECASE)
    spans: list[tuple[int, int, str]] = []
    for match in pattern.finditer(text):
        if spans and match.start() < spans[-1][1]:
            continue
        matched = match.group(0)
        spans.append((match.start(), match.end(),
                      next(label for label in ordered if label.lower() == matched.lower())))
    return spans


def _record_row_value(text: str, label: str, labels: list[str],
                      spans: list[tuple[int, int, str]]) -> str | None:
    r"""Single token following a whole-word label inside a flattened record row.

    Extracted PDF tables arrive as one line of ``Label value`` pairs, so the
    separator is whitespace and later labels are not at line start. Exactly one
    bounded token is accepted, so a value cannot swallow the neighbouring pairs,
    and a label followed straight away by another mapped label is treated as a
    missing value rather than as a value named after the next label.
    """
    target = next(((start, end) for start, end, name in spans if name == label), None)
    if target is None:
        return None
    if any(start > target[1] and not text[target[1]:start].strip() for start, _, _ in spans):
        return None
    remainder = text[target[1]:]
    value = re.match(rf"(?:\s*[:\-]\s+|\s+)(\S{{1,{MAX_FIELD_VALUE_CHARS}}})", remainder)
    return value.group(1) if value else None


def _has_explicit_label_separator(text: str, labels: list[str]) -> bool:
    """A mapped label followed by ``:`` or ``-`` uses the explicit form."""
    return any(
        re.search(rf"(?<![A-Za-z0-9_]){re.escape(label)}(?![A-Za-z0-9_])\s*[:\-]", text,
                  flags=re.IGNORECASE)
        for label in labels)


def _is_record_row(text: Any, labels: list[str]) -> bool:
    """A record row is a punctuation-free line that opens with a mapped label.

    Blocks using explicit separators keep the line-anchored semantics, which
    preserves multi-word values; only flattened ``Label value`` rows that start
    at a label are read as records, so prose that merely mentions two labels is
    not mistaken for one.

    The two-label minimum is what separates a row from a sentence. A consequence
    is that a document mapping with a single extracted field cannot use this
    path; such a field needs an explicit ``Label:``/``Label -`` form, or AI
    extraction.
    """
    if not isinstance(text, str) or "." in text:
        return False
    if _has_explicit_label_separator(text, labels):
        return False
    spans = _label_spans(text, labels)
    if not spans or text[:spans[0][0]].strip():
        return False
    return len({name for _, _, name in spans}) >= RECORD_ROW_MIN_LABELS


def _record_row_blocks(sections: list[dict[str, Any]], labels: list[str],
                       ) -> list[tuple[dict[str, Any], dict[str, Any], list[tuple[int, int, str]]]]:
    rows = []
    for section in sections:
        for block in section["blocks"]:
            if block.get("origin") == "generated_visual_description":
                continue
            text = block.get("content")
            if _is_record_row(text, labels):
                rows.append((block, section, _label_spans(text, labels)))
    return rows


def _record_row_candidates(
        rows: list[tuple[dict[str, Any], dict[str, Any], list[tuple[int, int, str]]]],
        label: str, labels: list[str]) -> list[tuple[str, dict[str, Any], dict[str, Any]]]:
    candidates = []
    for block, section, spans in rows:
        value = _record_row_value(block.get("content"), label, labels, spans)
        if value is not None:
            candidates.append((value, block, section))
    return candidates


def _line_anchored_candidates(sections: list[dict[str, Any]], label: str,
                              ) -> list[tuple[str, dict[str, Any], dict[str, Any]]]:
    candidates = []
    for section in sections:
        for block in section["blocks"]:
            value = _label_value(block.get("content"), label)
            if value is not None and block.get("origin") != "generated_visual_description":
                candidates.append((value, block, section))
    return candidates


def _evidence(block: dict[str, Any], section: dict[str, Any], raw_text: str,
              asset_ref: dict[str, Any], mapping_version: str) -> dict[str, Any]:
    return {
        "assetRef": asset_ref,
        "sectionPk": section["sectionPk"], "sectionKey": section.get("sectionKey"),
        "blockPk": block["blockPk"], "blockKey": block.get("blockKey"),
        "pageNumber": block.get("pageNumber"), "origin": block.get("origin", "native_text"),
        "rawEvidenceHash": "sha256:" + hashlib.sha256(raw_text.encode()).hexdigest(),
        "extractorVersion": EXTRACTOR_VERSION, "mappingVersion": mapping_version,
    }


async def _ai_evidence(connection: Any, document_pk: Any) -> tuple[list[dict[str, Any]],
                                                                  dict[str, tuple[dict[str, Any], dict[str, Any]]]]:
    """Whole-document evidence for AI extraction, independent of label search.

    Label search would bias the model towards the fields the deterministic
    extractor already finds, so the outline is read instead, bounded by the same
    closure limits. Only blocks that really exist can ground a value.
    """
    outline = await get_outline(connection, document_pk=document_pk)
    section_pks = [section["sectionPk"] for section in outline["sections"]][:MAX_CLOSURE_SECTIONS]
    if not section_pks:
        return [], {}
    read = await read_complete_section_set(
        connection, document_pk=document_pk, section_pks=section_pks, include_descendants=True)
    payload: list[dict[str, Any]] = []
    by_reference: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
    for section in read["sections"]:
        for block in section["blocks"]:
            content = block.get("content")
            if not isinstance(content, str) or not content.strip():
                continue
            reference = f"section:{section['sectionPk']}/block:{block['blockPk']}"
            payload.append({"sectionPk": section["sectionPk"], "blockPk": block["blockPk"],
                            "content": content})
            by_reference[reference] = (block, section)
    return payload, by_reference


def _normalize_for_grounding(value: Any) -> str:
    return " ".join(str(value).split()).casefold()


def _value_in_block(value: Any, content: Any) -> bool:
    """True when the value appears in the cited block, ignoring case/spacing."""
    if value is None or not isinstance(content, str):
        return False
    if isinstance(value, (list, tuple, dict)):
        return False
    normalized = _normalize_for_grounding(value).strip('"\'')
    return bool(normalized) and normalized in _normalize_for_grounding(content)


async def _apply_ai_extraction(
    connection: Any, entry: dict[str, Any], asset_ref: dict[str, Any], document_pk: Any,
    ai_mappings: list[dict[str, Any]], model_id: str, ai_extraction: dict[str, Any] | None,
    values: dict[str, Any], evidence_by_field: dict[str, dict[str, Any]],
) -> str | None:
    """Resolve AI-mapped fields; return a failure code or None when it ran."""
    try:
        sections, by_reference = await _ai_evidence(connection, document_pk)
    except SectionReadError as exc:
        return exc.code
    if not sections:
        return "no_evidence"
    attributes = [{"key": mapping["targetAttribute"],
                   "label": mapping.get("sourceField") or mapping["targetAttribute"]}
                  for mapping in ai_mappings]
    try:
        result = await extract_attributes(
            model_id=model_id, concept_id=entry["conceptId"],
            concept_label=entry.get("conceptLabel") or entry["conceptId"],
            document_id=str(entry["source"].get("assetId") or ""),
            file_name=str(entry["source"].get("originalName") or ""),
            attributes=attributes, sections=sections, ai_extraction=ai_extraction)
    except AttributeExtractionError as exc:
        return exc.code
    extractor_version = str(result.get("extractorVersion") or "ai-attribute-v1")
    for item in result.get("values") or []:
        key = item.get("key") if isinstance(item, dict) else None
        if not key or key in values:
            continue
        grounded = [reference for reference in (item.get("evidenceReferences") or [])
                    if reference in by_reference]
        if not grounded:
            continue
        block, section = by_reference[grounded[0]]
        # A real reference is not proof of a real value: the value must occur in
        # the block it cites, otherwise the model invented it.
        if not _value_in_block(item.get("value"), block.get("content")):
            continue
        values[key] = item.get("value")
        evidence = _evidence(block, section, str(block.get("content") or ""), asset_ref,
                             entry["mappingVersion"])
        evidence["origin"] = "ai"
        evidence["extractorVersion"] = extractor_version
        if result.get("model"):
            evidence["model"] = result["model"]
        evidence_by_field[key] = evidence
    return None


async def populate_document(
    connection: Any, entry: dict[str, Any], concept: dict[str, Any], actor_user_id: str,
    *, metadata_fetch: Callable[[dict[str, Any], str], Awaitable[dict[str, Any]]] | None = None,
    model_id: str = "", ai_extraction: dict[str, Any] | None = None,
    cache: Any | None = None,
) -> dict[str, Any]:
    """Reauthorize, correlate, retrieve, and deterministically populate one mapped document.

    With a ``cache``, a document whose content, mapping, concept and extractor are unchanged
    reuses its previous result (marked ``reused``). Access and index correlation are still
    checked every time; only reading and extraction are skipped.
    """
    source = entry["source"]
    asset_ref = resolve_asset_ref(source)
    try:
        current = await (metadata_fetch or fetch_workspace_asset_metadata)(source, actor_user_id)
    except AssetFetchError as exc:
        return _gap(entry, "source_unavailable", exc.code, asset_ref)
    asset_ref = resolve_asset_ref(current)
    capabilities = await detect_capabilities(connection)
    if (not capabilities["capabilities"].get("structure")
            or current.get("indexingStatus") not in {"ready", "completed"}):
        observation = build_index_observation(
            asset_ref=asset_ref, document_pk=None,
            capabilities=capabilities["capabilities"], fingerprint=current.get("contentHash"))
        result = _gap(entry, "index_unavailable", "logical index is not ready", asset_ref)
        result["indexObservation"] = observation
        return result
    resolution = await resolve_document_candidates(
        connection, workspace_id=current["workspaceId"], file_name=current["originalName"],
        uploader_user_id=current.get("uploaderUserId"))
    candidate = resolution["candidates"][0] if resolution["resolution"] == "resolved" else None
    observation = build_index_observation(
        asset_ref=asset_ref, document_pk=candidate["documentPk"] if candidate else None,
        capabilities=capabilities["capabilities"], fingerprint=current.get("contentHash"))
    if resolution["resolution"] != "resolved":
        status = "index_ambiguous" if resolution["resolution"] == "ambiguous" else "index_unavailable"
        result = _gap(entry, status, f"logical index correlation is {resolution['resolution']}", asset_ref)
        result["indexObservation"] = observation
        return result

    cache_key = None
    if cache is not None:
        from app.persistence.extraction_cache import extraction_cache_key
        cache_key = extraction_cache_key({
            "engine": DOCUMENT_EXTRACTION_VERSION, "modelId": model_id, "concept": concept,
            "conceptId": entry["conceptId"], "fieldMappings": entry["fieldMappings"],
            "mappingVersion": entry["mappingVersion"], "labelField": entry.get("labelField"),
            "assetRef": asset_ref, "contentHash": current.get("contentHash"),
            "documentPk": candidate["documentPk"], "aiExtraction": ai_extraction})
        cached = await cache.get(cache_key)
        if cached is not None:
            cached["indexObservation"] = observation
            cached["reused"] = True
            return cached

    values: dict[str, Any] = {}
    evidence_by_field: dict[str, dict[str, Any]] = {}
    extract_mappings = [m for m in entry["fieldMappings"] if m["mode"] == "extract"
                        and m.get("extractionStrategy") != "ai"]
    ai_mappings = [m for m in entry["fieldMappings"] if m["mode"] == "extract"
                   and m.get("extractionStrategy") == "ai"]
    for mapping in entry["fieldMappings"]:
        if mapping["mode"] == "metadata":
            values[mapping["targetAttribute"]] = _metadata_value(current, mapping["sourceField"])
            evidence_by_field[mapping["targetAttribute"]] = {
                "assetRef": asset_ref, "origin": "metadata", "extractorVersion": "metadata-v1",
                "mappingVersion": entry["mappingVersion"]}
        elif mapping["mode"] == "constant":
            values[mapping["targetAttribute"]] = mapping.get("constantValue")
            evidence_by_field[mapping["targetAttribute"]] = {
                "assetRef": asset_ref, "origin": "human", "extractorVersion": "constant-v1",
                "mappingVersion": entry["mappingVersion"]}

    hits: list[dict[str, Any]] = []
    search_truncated = False
    document_pk = candidate["documentPk"]
    for mapping in extract_mappings:
        label = mapping["sourceField"]
        exact = await search_exact(connection, document_pk=document_pk, value=label)
        search_truncated = search_truncated or exact["truncated"]
        lexical_hits: list[dict[str, Any]] = []
        if capabilities["capabilities"].get("lexical"):
            try:
                lexical = await search_lexical(
                    connection, document_pk=document_pk, query=label,
                    capabilities=capabilities["capabilities"])
                lexical_hits = lexical["hits"]
                search_truncated = search_truncated or lexical["truncated"]
            except LogicalSearchError:
                lexical_hits = []
        hits = combine_hits(hits, exact["hits"], lexical_hits)
    if len(hits) > MAX_CLOSURE_SECTIONS:
        hits = hits[:MAX_CLOSURE_SECTIONS]
        search_truncated = True

    read = None
    if hits:
        read = await read_complete_section_set(
            connection, document_pk=document_pk,
            section_pks=[hit["sectionPk"] for hit in hits], include_descendants=True)
        extract_labels = [m["sourceField"] for m in extract_mappings]
        record_rows = _record_row_blocks(read["sections"], extract_labels)
        for mapping in extract_mappings:
            label = mapping["sourceField"]
            candidates = _line_anchored_candidates(read["sections"], label)
            candidates += _record_row_candidates(record_rows, label, extract_labels)
            unique = {value for value, _, _ in candidates}
            if len(unique) == 1:
                value, block, section = candidates[0]
                values[mapping["targetAttribute"]] = value
                evidence_by_field[mapping["targetAttribute"]] = _evidence(
                    block, section, str(block.get("content") or ""), asset_ref,
                    entry["mappingVersion"])

    # AI extraction must finish before the row is turned into entities, otherwise
    # the resolved values would never reach the assertions.
    ai_failure: str | None = None
    if ai_mappings:
        ai_failure = await _apply_ai_extraction(
            connection, entry, asset_ref, document_pk, ai_mappings, model_id, ai_extraction,
            values, evidence_by_field)

    row = {**values, "_row": None}
    output = populate_concept_rows(
        concept, [row], {"assetRef": asset_ref, "mappingVersion": entry["mappingVersion"],
                         "labelField": entry.get("labelField")})
    for assertion in output["assertions"]:
        assertion["evidence"] = evidence_by_field[assertion["attribute"]]
        assertion["origin"] = "human" if assertion["evidence"]["origin"] == "human" else "source"
    missing_fields = [m["targetAttribute"] for m in extract_mappings
                      if m["targetAttribute"] not in values]
    for field in missing_fields:
        output["gaps"].append({"kind": "unresolved_document_field", "conceptId": entry["conceptId"],
                               "rowNumber": None, "detail": f"field '{field}' was not resolved"})
    for mapping in ai_mappings:
        if mapping["targetAttribute"] in values:
            continue
        # Never silently fall back to deterministic values when AI was requested.
        if ai_failure is not None:
            output["gaps"].append({"kind": "ai_extraction_unavailable", "conceptId": entry["conceptId"],
                                   "rowNumber": None,
                                   "detail": f"AI extraction failed for '{mapping['targetAttribute']}': {ai_failure}"})
        else:
            output["gaps"].append({"kind": "ai_extraction_unresolved", "conceptId": entry["conceptId"],
                                   "rowNumber": None,
                                   "detail": f"field '{mapping['targetAttribute']}' was not grounded by the extraction agent"})
    complete = bool(read is None or read["coverage"]["directBlocksComplete"])
    if read is not None and not complete:
        output["gaps"].append({"kind": "budget_exhausted", "conceptId": entry["conceptId"],
                               "rowNumber": None, "scope": "read", "detail": "section evidence exceeded the read budget"})
    if search_truncated:
        output["gaps"].append({"kind": "budget_exhausted", "conceptId": entry["conceptId"],
                               "rowNumber": None, "scope": "retrieval", "detail": "candidate search exceeded the retrieval budget"})
        complete = False
    output["counts"]["gaps"] = len(output["gaps"])
    if any(gap["kind"] == "missing_identity" for gap in output["gaps"]):
        status = "unresolved_identity"
    elif not complete:
        status = "budget_exhausted"
    elif output["gaps"]:
        status = "processed_with_gaps"
    else:
        status = "processed_complete"
    output.update({"coverage": {"assetRef": asset_ref, "status": status,
                                "fieldsAccepted": sorted(values), "fieldsUnresolved": missing_fields},
                   "sourceObservation": {"assetRef": asset_ref, "contentHash": current.get("contentHash"),
                                         "sizeBytes": current.get("sizeBytes"),
                                         "indexResolution": resolution["resolution"]},
                   "indexObservation": observation})
    # A failed call to the extraction agent is worth retrying next run; anything else is what this
    # document yields until it, its mapping or the extractor changes.
    if cache_key is not None and not any(gap["kind"] == "ai_extraction_unavailable" for gap in output["gaps"]):
        await cache.put(cache_key, concept_id=entry["conceptId"],
                        asset_id=str(asset_ref.get("assetId") or ""), output=output)
    return output


def _gap(entry: dict[str, Any], status: str, detail: str, asset_ref: dict[str, Any]) -> dict[str, Any]:
    gap = {"kind": status, "conceptId": entry["conceptId"], "rowNumber": None, "detail": detail}
    return {"entities": [], "assertions": [], "gaps": [gap],
            "counts": {"scanned": 1, "excluded": 0, "queryable": 0, "materialized": 0, "gaps": 1},
            "coverage": {"assetRef": asset_ref, "status": status,
                         "fieldsAccepted": [], "fieldsUnresolved": [
                             m["targetAttribute"] for m in entry["fieldMappings"]]},
            "sourceObservation": {"assetRef": asset_ref, "indexResolution": status}}
