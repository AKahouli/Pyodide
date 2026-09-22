"""Deterministic, specification-bounded population from logical-index documents."""

from __future__ import annotations

import hashlib
import re
from typing import Any, Awaitable, Callable

from app.datasource.asset_delivery import AssetFetchError, fetch_workspace_asset_metadata
from app.datasource.discovery import resolve_asset_ref
from app.datasource.logical_index import (build_index_observation, detect_capabilities,
                                          resolve_document_candidates)
from app.datasource.logical_search import LogicalSearchError, combine_hits, search_exact, search_lexical
from app.datasource.section_reader import MAX_CLOSURE_SECTIONS, read_complete_section_set

from .tabular import populate_concept_rows

EXTRACTOR_VERSION = "label-value-v1"
MAX_FIELD_VALUE_CHARS = 500


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


async def populate_document(
    connection: Any, entry: dict[str, Any], concept: dict[str, Any], actor_user_id: str,
    *, metadata_fetch: Callable[[dict[str, Any], str], Awaitable[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    """Reauthorize, correlate, retrieve, and deterministically populate one mapped document."""
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

    values: dict[str, Any] = {}
    evidence_by_field: dict[str, dict[str, Any]] = {}
    extract_mappings = [m for m in entry["fieldMappings"] if m["mode"] == "extract"]
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
        for mapping in extract_mappings:
            candidates: list[tuple[str, dict[str, Any]]] = []
            for section in read["sections"]:
                for block in section["blocks"]:
                    value = _label_value(block.get("content"), mapping["sourceField"])
                    if value is not None and block.get("origin") != "generated_visual_description":
                        candidates.append((value, _evidence(
                            block, section, str(block.get("content") or ""), asset_ref,
                            entry["mappingVersion"])))
            unique = {value for value, _ in candidates}
            if len(unique) == 1:
                values[mapping["targetAttribute"]] = candidates[0][0]
                evidence_by_field[mapping["targetAttribute"]] = candidates[0][1]

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
    complete = bool(read is None or read["coverage"]["directBlocksComplete"])
    if read is not None and not complete:
        output["gaps"].append({"kind": "budget_exhausted", "conceptId": entry["conceptId"],
                               "rowNumber": None, "detail": "section evidence exceeded the read budget"})
    if search_truncated:
        output["gaps"].append({"kind": "budget_exhausted", "conceptId": entry["conceptId"],
                               "rowNumber": None, "detail": "candidate search exceeded the retrieval budget"})
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
    return output


def _gap(entry: dict[str, Any], status: str, detail: str, asset_ref: dict[str, Any]) -> dict[str, Any]:
    gap = {"kind": status, "conceptId": entry["conceptId"], "rowNumber": None, "detail": detail}
    return {"entities": [], "assertions": [], "gaps": [gap],
            "counts": {"scanned": 1, "excluded": 0, "queryable": 0, "materialized": 0, "gaps": 1},
            "coverage": {"assetRef": asset_ref, "status": status,
                         "fieldsAccepted": [], "fieldsUnresolved": [
                             m["targetAttribute"] for m in entry["fieldMappings"]]},
            "sourceObservation": {"assetRef": asset_ref, "indexResolution": status}}
