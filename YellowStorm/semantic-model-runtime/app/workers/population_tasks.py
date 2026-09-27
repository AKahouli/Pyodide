"""Population worker entry point (Phase 5).

Claims the durable ``semantic_jobs`` lease, runs the pure deterministic domain
in :mod:`app.population.compiler` / :mod:`app.population.tabular` over
prepared Parquet queried through the Phase 3 pipeline, then completes with
fencing. Only task references cross RabbitMQ; canonical inputs stay in
PostgreSQL. No LLM, no formula execution, no raw SQL: rows come from bounded
``query_parquet`` calls and every failure maps to an ``errorCode``.
"""

from __future__ import annotations

import logging
import hashlib
import json

from app.jobs.recovery import max_attempts_from_env, retry_seconds_from_env
from app.population.compiler import (canonical_spec_hash, compile_specification,
                                     filter_fields, validate_specification)
from app.population.tabular import (match_relationships, merge_concept_results,
                                    normalize_identity_value, populate_concept_rows)

from .celery_app import POPULATION_QUEUES, celery_app

logger = logging.getLogger(__name__)
ASSET_FETCH_WALL_SECONDS = 35
QUERY_ROW_LIMIT = 1000
# A workspace mapping expands to one source per document, so a run can read thousands of files.
MAX_SOURCES_PER_TASK = 5000
# How long each progress report keeps the lease alive: a long run stays owned while it reports.
PROGRESS_LEASE_SECONDS = 900
PROGRESS_RECENT = 8
MAX_TOTAL_ENTITIES = 10000
MAX_TOTAL_ASSERTIONS = 50000
MAX_TOTAL_RELATIONSHIPS = 20000
# Carries a manual row's display name; never a model attribute, so never asserted.
MANUAL_LABEL_FIELD = "__manual_label"
POPULATION_ENGINE_VERSION = "r1-mvp-5"


def population_execution_fingerprint(spec_hash: str, sources: list[dict],
                                     relation_bindings: list[dict],
                                     ai_extraction: dict | None = None) -> str:
    canonical_sources = [{
        "conceptId": source["conceptId"],
        "sourceKind": source["sourceKind"],
        "source": source["source"],
        "mappingVersion": source["mappingVersion"],
        "columnMapping": source.get("columnMapping"),
        # The core omits an empty constant mapping; normalization fills in {}. Both mean none.
        "constantMapping": source.get("constantMapping") or None,
        "fieldMappings": source.get("fieldMappings"),
        "options": source.get("options", {}),
        "labelField": source.get("labelField"),
    } for source in sources]
    # The AI agent's effective model is part of revision identity: changing it in
    # the agent library must produce a new revision instead of reusing persisted
    # rows. Always present (null when unused) so both sides hash the same body.
    body = json.dumps({"specHash": spec_hash, "sources": canonical_sources,
                       "relationBindings": relation_bindings,
                       "aiExtraction": ai_extraction,
                       "populationEngineVersion": POPULATION_ENGINE_VERSION},
                      sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return "sha256:" + hashlib.sha256(body.encode("utf-8")).hexdigest()


def population_lease_seconds(source_count: int, parser_timeout: int) -> int:
    """Cover fetch, prepare, query and completion for every mapped source."""
    units = max(1, min(source_count, MAX_SOURCES_PER_TASK))
    return min(1800, max(300, units * (parser_timeout + 60)))


class PopulationProgress:
    """What a run has done so far, reported (at most about once a second) to whoever watches the job."""

    def __init__(self, report=None, *, min_interval: float = 1.0):  # type: ignore[no-untyped-def]
        import time
        from datetime import datetime, timezone

        self._report = report
        self._min_interval = min_interval
        self._last_sent = float("-inf")
        self._clock = time.monotonic
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.phase = "starting"
        self.total = 0
        self.done = 0
        self.reused = 0
        self.records = 0
        self.gaps = 0
        self.current: dict | None = None
        self.recent: list[dict] = []

    def snapshot(self) -> dict:
        return {"phase": self.phase, "total": self.total, "done": self.done, "reused": self.reused,
                "records": self.records, "gaps": self.gaps, "current": self.current,
                "recent": list(self.recent), "startedAt": self.started_at}

    async def send(self, *, force: bool = False) -> None:
        if self._report is None:
            return
        now = self._clock()
        if not force and now - self._last_sent < self._min_interval:
            return
        self._last_sent = now
        await self._report(self.snapshot())

    async def begin(self, total: int) -> None:
        self.phase, self.total = "reading", total
        await self.send(force=True)

    async def reading(self, entry: dict) -> None:
        self.current = {"name": source_display_name(entry), "conceptId": entry.get("conceptId"),
                        "kind": entry.get("sourceKind")}
        await self.send()

    async def read(self, entry: dict, *, records: int, gaps: int, status: str,
                   reused: bool = False) -> None:
        self.done += 1
        self.current = None
        self.reused += 1 if reused else 0
        self.records += records
        self.gaps += gaps
        self.recent = [{"name": source_display_name(entry), "conceptId": entry.get("conceptId"),
                        "status": status, "records": records, "reused": reused},
                       *self.recent][:PROGRESS_RECENT]
        await self.send(force=self.done == self.total)

    async def enter(self, phase: str) -> None:
        self.phase, self.current = phase, None
        await self.send(force=True)


class RunCancelled(Exception):
    """The run was asked to stop; it ends without saving what it read."""


def source_display_name(entry: dict) -> str:
    if entry.get("sourceKind") == "manual":
        return "Typed records"
    source = entry.get("source") or {}
    name = source.get("originalName") or source.get("assetId") or "source"
    sheet = (entry.get("options") or {}).get("sheetName")
    return f"{name} · {sheet}" if sheet else str(name)


def attempts_exhausted(attempt_count: int, max_attempts: int) -> bool:
    return attempt_count > max_attempts


def run_population_for_payload(command_dump: dict) -> dict:
    """Pure validate+compile entry point (no DB, no I/O). Never raises.

    The canonical top-level ``workspaceId`` is the authenticated home and is
    required, mirroring discovery: an inner scope may never substitute for it.
    The supplied ``specHash`` must equal the recomputed canonical hash (P1.5);
    every identity component must be mapped or the job is rejected
    before any byte is fetched.
    """
    try:
        if not isinstance(command_dump, dict):
            return {"ok": False, "errorCode": "invalid_command"}
        actor = command_dump.get("actorUserId") or command_dump.get("actor_user_id")
        model_id = command_dump.get("modelId") or command_dump.get("model_id")
        home_ws = command_dump.get("workspaceId") or command_dump.get("workspace_id")
        if not isinstance(home_ws, str) or not home_ws:
            return {"ok": False, "errorCode": "workspace_required"}
        if not isinstance(actor, str) or not actor:
            return {"ok": False, "errorCode": "invalid_command"}
        if not isinstance(model_id, str) or not model_id:
            return {"ok": False, "errorCode": "invalid_command"}
        payload = command_dump.get("payload")
        if not isinstance(payload, dict):
            return {"ok": False, "errorCode": "invalid_command"}
        if payload.get("purpose") not in ("preview", "build", "refresh"):
            return {"ok": False, "errorCode": "invalid_purpose"}
        spec = payload.get("specification")
        issues = validate_specification(spec)
        if issues:
            return {"ok": False, "errorCode": "invalid_specification",
                    "issues": issues[:10]}
        expected_hash = payload.get("specHash") or payload.get("spec_hash")
        if canonical_spec_hash(spec) != expected_hash:
            return {"ok": False, "errorCode": "spec_hash_mismatch"}
        sources = payload.get("sources")
        if (not isinstance(sources, list) or not sources
                or len(sources) > MAX_SOURCES_PER_TASK):
            return {"ok": False, "errorCode": "invalid_sources"}
        compiled = compile_specification(spec)
        normalized: list[dict] = []
        mapped_fields: dict[str, set[str]] = {}
        for entry in sources:
            if not isinstance(entry, dict):
                return {"ok": False, "errorCode": "invalid_sources"}
            concept = compiled["concepts"].get(entry.get("conceptId"))
            if concept is None:
                return {"ok": False, "errorCode": "unknown_concept"}
            source_kind = entry.get("sourceKind") or entry.get("source_kind")
            if source_kind not in (None, "tabular", "excel_sheet", "csv", "document", "manual"):
                return {"ok": False, "errorCode": "invalid_source_kind"}
            if source_kind == "document":
                field_mappings = entry.get("fieldMappings") or entry.get("field_mappings")
                if not isinstance(field_mappings, list) or not field_mappings:
                    return {"ok": False, "errorCode": "invalid_document_mapping"}
                active = [item for item in field_mappings if isinstance(item, dict)
                          and item.get("mode") != "ignore"]
                if len(active) != len(field_mappings):
                    return {"ok": False, "errorCode": "invalid_document_mapping"}
                if any(item.get("mode") not in {"extract", "metadata", "constant"}
                       or item.get("targetAttribute") not in concept["allowedFields"] for item in active):
                    return {"ok": False, "errorCode": "invalid_document_mapping"}
                if any(item.get("mode") == "extract"
                       and (not isinstance(item.get("sourceField"), str)
                            or not item["sourceField"].strip()) for item in active):
                    return {"ok": False, "errorCode": "invalid_document_mapping"}
                metadata_fields = {"document_name", "document_id", "workspace_id"}
                if any(item.get("mode") == "metadata"
                       and item.get("sourceField") not in metadata_fields for item in active):
                    return {"ok": False, "errorCode": "invalid_document_mapping"}
                if any(item.get("extractionStrategy") not in (None, "deterministic", "ai")
                       or (item.get("extractionStrategy") is not None
                           and item.get("mode") != "extract") for item in active):
                    return {"ok": False, "errorCode": "invalid_document_mapping"}
                mapped_attributes = {item["targetAttribute"] for item in active}
                if len(mapped_attributes) != len(active):
                    return {"ok": False, "errorCode": "duplicate_document_mapping"}
                mapping = None
            else:
                mapping = entry.get("columnMapping") or entry.get("column_mapping")
                constants = entry.get("constantMapping") or entry.get("constant_mapping") or {}
                if (not isinstance(mapping, dict) or not isinstance(constants, dict)
                        or (not mapping and not constants)):
                    return {"ok": False, "errorCode": "invalid_column_mapping"}
                if set(mapping.values()) & set(constants):
                    return {"ok": False, "errorCode": "duplicate_column_mapping"}
                mapped_attributes = set(mapping.values()) | set(constants)
            unmapped = [c for c in concept["keyComponents"] if c not in mapped_attributes]
            # Manual rows without a key value keep their own row key as identity.
            if unmapped and source_kind != "manual":
                return {"ok": False, "errorCode": "unmapped_identity"}
            if mapping is not None and len(set(mapping.values())) != len(mapping):
                return {"ok": False, "errorCode": "duplicate_column_mapping"}
            if "_row" in mapped_attributes:
                return {"ok": False, "errorCode": "reserved_attribute_name"}
            # A filter on an unmapped attribute sees only None: eq never
            # matches, so the source would report a clean empty population.
            for filt in (concept.get("eligibility"), concept.get("materialization")):
                for field in filter_fields(filt):
                    if field not in mapped_attributes:
                        return {"ok": False, "errorCode": "unmapped_filter_field"}
            source = entry.get("source")
            if not isinstance(source, dict) or not source.get("assetId"):
                return {"ok": False, "errorCode": "invalid_sources"}
            if source_kind == "manual" and not isinstance(source.get("snapshotId"), str):
                return {"ok": False, "errorCode": "invalid_sources"}
            options = entry.get("options") or {}
            normalized.append({
                "conceptId": entry.get("conceptId"), "source": source,
                "sourceKind": source_kind or "tabular",
                "options": options if isinstance(options, dict) else {},
                **({"fieldMappings": active} if source_kind == "document"
                   else {"columnMapping": dict(mapping), "constantMapping": dict(constants)}),
                "labelField": entry.get("labelField") or entry.get("label_field"),
                "mappingVersion": entry.get("mappingVersion") or entry.get("mapping_version") or "v1",
            })
            mapped_fields.setdefault(entry.get("conceptId"), set()).update(mapped_attributes)
        bindings = payload.get("relationBindings") or payload.get("relation_bindings") or []
        if not isinstance(bindings, list):
            return {"ok": False, "errorCode": "invalid_relation_bindings"}
        normalized_bindings = []
        for binding in bindings:
            if not isinstance(binding, dict):
                return {"ok": False, "errorCode": "invalid_relation_bindings"}
            relation = compiled["relations"].get(binding.get("relationId"))
            if relation is None:
                return {"ok": False, "errorCode": "unknown_relation"}
            reference = binding.get("referenceField") or binding.get("reference_field")
            target = binding.get("targetField") or binding.get("target_field")
            target_concept = compiled["concepts"][relation["targetConceptId"]]
            target_identity = target_concept["keyComponents"]
            if target is None and len(target_identity) == 1:
                target = target_identity[0]
            if (not isinstance(reference, str)
                    or reference not in mapped_fields.get(relation["sourceConceptId"], set())
                    or not isinstance(target, str)
                    or target not in mapped_fields.get(relation["targetConceptId"], set())):
                return {"ok": False, "errorCode": "invalid_relation_bindings"}
            normalized_bindings.append({"relationId": relation["relationId"],
                                        "referenceField": reference, "targetField": target})
        ai_extraction = payload.get("aiExtraction") or payload.get("ai_extraction")
        if ai_extraction is not None and not isinstance(ai_extraction, dict):
            return {"ok": False, "errorCode": "invalid_command"}
        execution_fingerprint = population_execution_fingerprint(
            expected_hash, normalized, normalized_bindings, ai_extraction)
        supplied_fingerprint = (payload.get("populationExecutionFingerprint")
                                or payload.get("population_execution_fingerprint"))
        if supplied_fingerprint is not None and supplied_fingerprint != execution_fingerprint:
            return {"ok": False, "errorCode": "execution_fingerprint_mismatch"}
        return {"ok": True, "compiled": compiled, "sources": normalized,
                "relationBindings": normalized_bindings, "purpose": payload.get("purpose"),
                "specHash": expected_hash, "executionFingerprint": execution_fingerprint}
    except Exception:
        return {"ok": False, "errorCode": "invalid_command"}


async def run_population_for_task(command_dump: dict, *, fetch=None, prepare=None,
                                  query=None, index_connection=None, metadata_fetch=None,
                                  manual_pool=None, progress: PopulationProgress | None = None,
                                  extraction_cache=None) -> dict:
    """Fetch, prepare, query and populate every mapped source (bounded), reporting progress."""
    import asyncio
    import os
    import tempfile
    from pathlib import Path

    from app.datasource.asset_delivery import AssetFetchError, fetch_workspace_asset
    from app.datasource.dataset_query import query_parquet
    from app.datasource.discovery import resolve_asset_ref
    from app.datasource.parsers import SHEET_ROW_KEY
    from app.datasource.parser_sandbox import prepare_dataset_subprocess

    validated = run_population_for_payload(command_dump)
    if not validated.get("ok"):
        return validated
    actor = command_dump.get("actorUserId") or command_dump.get("actor_user_id")
    ai_extraction = (command_dump.get("payload") or {}).get("aiExtraction")
    compiled = validated["compiled"]
    per_concept: dict[str, list[dict]] = {}
    dataset_fingerprints: set[str] = set()
    observations: list[dict] = []
    document_coverage: list[dict] = []
    index_observations: list[dict] = []
    complete_enumeration = True
    manual_links: list[tuple[str, dict]] = []
    progress = progress or PopulationProgress()
    await progress.begin(len(validated["sources"]))
    # One index connection for the whole run, opened on the first document: a workspace can hold
    # thousands of them.
    index_pool: dict = {"connection": index_connection, "owned": None}

    async def document_connection():  # type: ignore[no-untyped-def]
        if index_pool["connection"] is None:
            from app.datasource.logical_index import create_index_pool
            index_pool["owned"] = index_pool["connection"] = await create_index_pool()
        return index_pool["connection"]

    async def read_sources() -> dict | None:
        """Read every source in turn; an error result stops the run."""
        nonlocal complete_enumeration
        for entry in validated["sources"]:
            source, options = entry["source"], entry["options"]
            await progress.reading(entry)
            if entry["sourceKind"] == "manual":
                outcome = await _populate_manual_source(manual_pool, entry,
                                                        compiled["concepts"][entry["conceptId"]])
                if not outcome.get("ok"):
                    return outcome
                per_concept.setdefault(entry["conceptId"], []).append(outcome["output"])
                observations.append(outcome["observation"])
                dataset_fingerprints.add(source["snapshotId"])
                manual_links.extend((source["snapshotId"], link) for link in outcome["links"])
                await progress.read(entry, records=len(outcome["output"]["entities"]),
                                    gaps=len(outcome["output"]["gaps"]), status="read")
                continue
            if entry["sourceKind"] == "document":
                from app.population.document import populate_document

                output = await populate_document(
                    await document_connection(), entry, compiled["concepts"][entry["conceptId"]], actor,
                    metadata_fetch=metadata_fetch,
                    model_id=str(command_dump.get("modelId") or ""),
                    ai_extraction=ai_extraction, cache=extraction_cache)
                reused = bool(output.pop("reused", False))
                per_concept.setdefault(entry["conceptId"], []).append(output)
                document_coverage.append(output["coverage"])
                observations.append(output["sourceObservation"])
                if output.get("indexObservation"):
                    index_observations.append(output["indexObservation"])
                fingerprint = output["sourceObservation"]["assetRef"].get("assetVersionId")
                if isinstance(fingerprint, str) and fingerprint:
                    dataset_fingerprints.add(fingerprint)
                if output["coverage"]["status"] == "budget_exhausted":
                    complete_enumeration = False
                await progress.read(entry, records=len(output["entities"]), gaps=len(output["gaps"]),
                                    status=output["coverage"]["status"], reused=reused)
                continue
            try:
                async with asyncio.timeout(ASSET_FETCH_WALL_SECONDS):
                    data = await (fetch or fetch_workspace_asset)(source, actor)
            except AssetFetchError as exc:
                return {"ok": False, "errorCode": exc.code}
            try:
                asset_ref = resolve_asset_ref(source)
            except ValueError as exc:
                return {"ok": False, "errorCode": str(exc) or "invalid_source"}
            temp_root = os.environ.get("SEMANTIC_TASK_TEMP_DIR")
            records = gaps = 0
            try:
                with tempfile.TemporaryDirectory(prefix="semantic-populate-",
                                                 dir=temp_root) as directory:
                    artifact = Path(directory) / "dataset.parquet"
                    manifest = await asyncio.to_thread(
                        prepare or prepare_dataset_subprocess, source, options, data, artifact)
                    asset_ref["datasetRevisionId"] = manifest.get("datasetId")
                    columns = sorted(set(entry["columnMapping"]) | {SHEET_ROW_KEY})
                    offset = 0
                    while True:
                        page = await asyncio.to_thread(
                            query or query_parquet, artifact, columns=columns,
                            limit=QUERY_ROW_LIMIT, offset=offset)
                        mapping = entry["columnMapping"]
                        constants = entry.get("constantMapping", {})
                        rows = []
                        for raw in page["rows"]:
                            renamed: dict = {"_row": raw.get(SHEET_ROW_KEY), **constants}
                            for source_column, attribute in mapping.items():
                                if source_column in raw:
                                    renamed[attribute] = raw[source_column]
                            rows.append(renamed)
                        concept = compiled["concepts"][entry["conceptId"]]
                        output = populate_concept_rows(
                            concept, rows, {"assetRef": asset_ref,
                                           "mappingVersion": entry["mappingVersion"],
                                           "labelField": entry.get("labelField"),
                                           "constantFields": list(constants)})
                        per_concept.setdefault(entry["conceptId"], []).append(output)
                        records += len(output["entities"])
                        gaps += len(output["gaps"])
                        offset += page["returnedRows"]
                        if page["returnedRows"] < QUERY_ROW_LIMIT:
                            break
                        if offset >= MAX_TOTAL_ASSERTIONS:
                            complete_enumeration = False
                            break
            except ValueError as exc:
                return {"ok": False, "errorCode": str(exc) or "parser_failed"}
            except AssetFetchError as exc:
                return {"ok": False, "errorCode": exc.code}
            fingerprint = manifest.get("contentHash") if isinstance(manifest, dict) else None
            if isinstance(fingerprint, str) and fingerprint:
                dataset_fingerprints.add(fingerprint)
            observations.append({
                "assetRef": {key: asset_ref[key] for key in
                             ("workspaceId", "assetId", "assetVersionId") if key in asset_ref},
                "datasetId": manifest.get("datasetId"),
                "contentHash": manifest.get("contentHash"),
                "sizeBytes": manifest.get("sizeBytes"),
                "rowCount": manifest.get("rowCount")})
            await progress.read(entry, records=records, gaps=gaps, status="read")
        return None

    try:
        failure = await read_sources()
    finally:
        if index_pool["owned"] is not None:
            await index_pool["owned"].close()
    if failure is not None:
        return failure
    await progress.enter("linking")

    counts = {"scanned": 0, "excluded": 0, "queryable": 0, "materialized": 0, "gaps": 0}
    merged_by_concept: dict[str, dict] = {}
    for concept_id, outputs in per_concept.items():
        merged = merge_concept_results(outputs)
        merged_by_concept[concept_id] = merged
        for key in counts:
            counts[key] += merged["counts"].get(key, 0)
    # Bound the result before matching so relationships never reference dropped
    # entities and assertions never outlive their entity.
    kept: list[dict] = []
    for concept_id in sorted(merged_by_concept):
        ordered = sorted(merged_by_concept[concept_id]["entities"],
                         key=lambda item: item["entityId"])
        for entity in ordered:
            if len(kept) >= MAX_TOTAL_ENTITIES:
                break
            kept.append(entity)
        if len(kept) >= MAX_TOTAL_ENTITIES:
            break
    kept_ids = {entity["entityId"] for entity in kept}
    gaps: list[dict] = []
    assertions: list[dict] = []
    for merged in merged_by_concept.values():
        gaps.extend(merged["gaps"])
        for assertion in merged["assertions"]:
            if assertion["entityId"] in kept_ids and len(assertions) < MAX_TOTAL_ASSERTIONS:
                assertions.append(assertion)
    dropped_entities = (sum(len(merged["entities"]) for merged in merged_by_concept.values())
                        - len(kept))
    if dropped_entities > 0:
        gaps.append({"kind": "materialization_cap", "conceptId": None, "rowNumber": None,
                     "detail": f"bounded result capped at {MAX_TOTAL_ENTITIES} entities"})
    dropped_assertions = (sum(len(merged["assertions"]) for merged in merged_by_concept.values())
                          - len(assertions))
    if dropped_assertions > 0:
        gaps.append({"kind": "assertion_cap", "conceptId": None, "rowNumber": None,
                     "detail": f"bounded result capped at {MAX_TOTAL_ASSERTIONS} assertions"})
    trimmed = {concept_id: [entity for entity in merged["entities"]
                            if entity["entityId"] in kept_ids]
               for concept_id, merged in merged_by_concept.items()}
    relationships: list[dict] = []
    for binding in validated["relationBindings"]:
        relation = compiled["relations"][binding.get("relationId")]
        reference = binding["referenceField"]
        target = binding["targetField"]
        matched = match_relationships(
            relation,
            trimmed.get(relation["sourceConceptId"], []),
            trimmed.get(relation["targetConceptId"], []),
            reference, target)
        relationships.extend(matched["relationships"])
        gaps.extend(matched["gaps"])
    relationships.extend(manual_relationships(kept, manual_links, compiled["relations"]))
    if len(relationships) > MAX_TOTAL_RELATIONSHIPS:
        relationships = sorted(relationships,
                               key=lambda item: (item.get("relationId", ""),
                                                 item.get("sourceEntityId", ""),
                                                 item.get("targetEntityId", "")))[:MAX_TOTAL_RELATIONSHIPS]
        gaps.append({"kind": "relationship_cap", "conceptId": None, "rowNumber": None,
                     "detail": f"bounded result capped at {MAX_TOTAL_RELATIONSHIPS} relationships"})
    if not complete_enumeration:
        gaps.append({"kind": "enumeration_capped", "conceptId": None, "rowNumber": None,
                     "detail": f"per-source enumeration capped at {QUERY_ROW_LIMIT} rows"})
    counts["materialized"] = len(kept)
    counts["gaps"] = len(gaps)
    return {"ok": True, "specHash": validated["specHash"],
            "executionFingerprint": validated["executionFingerprint"],
            "purpose": validated["purpose"],
            "completeEnumeration": complete_enumeration, "entities": kept,
            "assertions": assertions, "relationships": relationships, "gaps": gaps,
            "counts": counts, "datasetFingerprints": sorted(dataset_fingerprints),
             "sourceObservations": observations,
             "documentCoverage": document_coverage, "indexObservations": index_observations,
             "jobState": "completed_with_gaps" if gaps else "completed"}


async def _populate_manual_source(pool, entry: dict, concept: dict) -> dict:  # type: ignore[no-untyped-def]
    """Rows people entered by hand, read from a committed immutable snapshot."""
    from app.persistence import manual_store

    snapshot_id = entry["source"]["snapshotId"]
    if pool is None or not await manual_store.is_committed(pool, snapshot_id):
        return {"ok": False, "errorCode": "manual_snapshot_unavailable"}
    stored = await manual_store.read_snapshot_rows(pool, snapshot_id, entry["conceptId"])
    mapping, constants = entry["columnMapping"], entry.get("constantMapping", {})
    rows = []
    for item in stored:
        values = item["values"]
        label = item["label"] or next((str(v) for v in values.values() if v not in (None, "")), None)
        row: dict = {"_row": item["rowKey"], MANUAL_LABEL_FIELD: label, **constants}
        for column, attribute in mapping.items():
            if column in values:
                row[attribute] = values[column]
        for component in concept["keyComponents"]:
            if normalize_identity_value(row.get(component)) is None:
                row[component] = item["rowKey"]
        rows.append(row)
    asset_ref = {"assetId": entry["source"]["assetId"], "assetVersionId": snapshot_id}
    output = populate_concept_rows(concept, rows, {
        "assetRef": asset_ref, "mappingVersion": entry["mappingVersion"],
        "labelField": MANUAL_LABEL_FIELD, "constantFields": list(constants)})
    links = await manual_store.read_snapshot_links(pool, snapshot_id)
    return {"ok": True, "output": output, "links": links,
            "observation": {"assetRef": asset_ref, "rowCount": len(stored)}}


def manual_relationships(entities: list[dict], links: list[tuple[str, dict]],
                         relations: dict) -> list[dict]:
    """Explicit links between manual rows, resolved to the entities those rows produced."""
    if not links:
        return []
    by_row: dict[tuple[str, str], str] = {}
    for entity in entities:
        for source in entity.get("provenance", {}).get("sources", []):
            snapshot = (source.get("assetRef") or {}).get("assetVersionId")
            for row_key in source.get("rowNumbers", []):
                by_row.setdefault((str(snapshot), str(row_key)), entity["entityId"])
    seen: set[tuple[str, str, str]] = set()
    relationships = []
    for snapshot, link in links:
        relation = relations.get(link["relationId"])
        source_id = by_row.get((snapshot, link["sourceRowKey"]))
        target_id = by_row.get((snapshot, link["targetRowKey"]))
        if relation is None or source_id is None or target_id is None:
            continue
        key = (relation["relationId"], source_id, target_id)
        if key not in seen:
            seen.add(key)
            relationships.append({"relationId": relation["relationId"], "sourceEntityId": source_id,
                                  "targetEntityId": target_id, "matchingStrategy": "manual"})
    return relationships


def preview_job_result(outcome: dict) -> dict:
    """Preview/Test result: bounded computed output, no revision, no storage."""
    return {key: value for key, value in outcome.items() if key not in {"ok", "jobState"}}


def summarize_job_result(revision_id: str, outcome: dict, persisted: dict) -> dict:
    """Bounded job summary built from storage counts, never submitted rows."""
    return {
        "dataRevisionId": revision_id, "specHash": outcome.get("specHash"),
        "purpose": outcome.get("purpose"),
        "completeEnumeration": outcome.get("completeEnumeration"),
        "counts": outcome.get("counts"),
        "gapKinds": sorted({gap.get("kind") for gap in outcome.get("gaps", [])}),
        "entityCount": persisted["entities"],
        "assertionCount": persisted["assertions"],
        "relationshipCount": persisted["relationships"],
    }


def is_whole_model_build(command_dump: dict) -> bool:
    payload = command_dump.get("payload", {})
    return payload.get("purpose") == "build" and (payload.get("scope") or {}).get("kind") == "model"


async def finalize_whole_model_build(pool, command_dump: dict,  # type: ignore[no-untyped-def]
                                     revision_id: str) -> dict | None:
    if not is_whole_model_build(command_dump):
        return None
    import asyncpg
    import os

    from app.population.age_projection import finalize_draft_revision

    database_url = os.environ.get("SEMANTIC_AGEGRAPH_DATABASE_URL")
    if not database_url:
        raise RuntimeError("age_projection_unavailable")
    age_pool = await asyncpg.create_pool(
        database_url, min_size=1, max_size=1, command_timeout=30,
        server_settings={"application_name": "semantic-model-population-worker-age",
                         "search_path": 'ag_catalog, "$user", public',
                         "statement_timeout": "30s", "lock_timeout": "5s",
                         "idle_in_transaction_session_timeout": "30s"})
    try:
        return await finalize_draft_revision(pool, age_pool, revision_id)
    finally:
        await age_pool.close()


MAX_GAP_GROUPS = 200


def summarize_gaps(outcome: dict, specification: dict) -> dict:
    """Readable gaps of a population: missing values per concept attribute,
    links that could not be resolved, and the other gap kinds grouped by
    concept. Bounded so a large population keeps a small coverage row."""
    entities = outcome.get("entities", [])
    missing_values = []
    for concept in specification.get("concepts", []):
        concept_id = concept.get("conceptId")
        members = [e for e in entities if e.get("conceptId") == concept_id]
        if not members:
            continue
        keys = set((concept.get("identity") or {}).get("keyComponents") or [])
        for attribute in sorted(concept.get("allowedFields", [])):
            if attribute in keys:
                continue
            missing = sum(1 for e in members
                          if (e.get("attributes") or {}).get(attribute) in (None, ""))
            if missing:
                missing_values.append({"conceptId": concept_id, "attribute": attribute,
                                       "missing": missing, "total": len(members)})
    links: dict[tuple, int] = {}
    other: dict[tuple, int] = {}
    for gap in outcome.get("gaps", []):
        kind = gap.get("kind")
        if gap.get("relationId") is not None:
            key = (gap["relationId"], kind)
            links[key] = links.get(key, 0) + 1
        else:
            key = (gap.get("conceptId"), kind)
            other[key] = other.get(key, 0) + 1
    return {
        "missingValues": missing_values[:MAX_GAP_GROUPS],
        "unresolvedLinks": [{"relationId": r, "kind": k, "count": c}
                            for (r, k), c in sorted(links.items())][:MAX_GAP_GROUPS],
        "other": [{"conceptId": cid, "kind": k, "count": c}
                  for (cid, k), c in sorted(other.items(), key=lambda i: (str(i[0][0]), i[0][1]))
                  ][:MAX_GAP_GROUPS],
    }


async def persist_population_revision(pool, command_dump: dict, outcome: dict) -> str:
    """Persist a computed population as an inert data revision (P6A, P6.16).

    Idempotent (ON CONFLICT DO NOTHING): a retried task re-stores the same
    revision without duplicates. The revision is inert until an explicit
    activation swaps the serving binding, so a stored-but-uncompleted task
    leaves serving state untouched.
    """
    from app.persistence.population_store import (create_data_revision, list_model_corrections,
                                                  mirror_specification,
                                                  model_correction_sequence, revision_id_for,
                                                  set_revision_validation, store_assertions,
                                                  store_entities, store_relationships)
    from app.persistence.search_store import store_entity_projections
    from app.search.projections import build_entity_projections
    from app.population.corrections import apply_corrections

    payload = command_dump.get("payload", {})
    specification = payload.get("specification", {})
    model_id = command_dump.get("modelId") or command_dump.get("model_id", "")
    model_version_id = payload.get("modelVersionId") or payload.get("model_version_id", "")
    home_ws = command_dump.get("workspaceId") or command_dump.get("workspace_id", "")
    correction_sequence = await model_correction_sequence(pool, model_id)
    if correction_sequence:
        # Human fixes survive rebuilds: replay every correction still in force
        # on top of the computed rows. The revision records the watermark it
        # applied so activation can refuse a revision built before a newer fix.
        outcome = apply_corrections(outcome, await list_model_corrections(pool, model_id))
    execution_fingerprint = outcome["executionFingerprint"]
    revision_id = revision_id_for(model_version_id, execution_fingerprint,
                                  outcome.get("datasetFingerprints", []),
                                  correction_sequence)
    await mirror_specification(pool, home_workspace_id=home_ws, model_id=model_id,
                               model_version_id=model_version_id,
                               spec_hash=outcome["specHash"], specification=specification)
    coverage = {"counts": outcome.get("counts", {}),
                 "completeEnumeration": outcome.get("completeEnumeration", False),
                 "gapKinds": sorted({gap.get("kind") for gap in outcome.get("gaps", [])}),
                 "documents": outcome.get("documentCoverage", []),
                 "gaps": summarize_gaps(outcome, specification)}
    await create_data_revision(pool, revision_id=revision_id, model_id=model_id,
                                model_version_id=model_version_id,
                                spec_hash=outcome["specHash"],
                                execution_fingerprint=execution_fingerprint,
                               source_observations=outcome.get("sourceObservations", []),
                               correction_sequence=correction_sequence,
                               coverage=coverage)
    await store_entities(pool, model_id=model_id, revision_id=revision_id,
                         entities=outcome.get("entities", []))
    await store_assertions(pool, model_id=model_id, revision_id=revision_id,
                           assertions=outcome.get("assertions", []))
    await store_relationships(pool, model_id=model_id, revision_id=revision_id,
                               relationships=outcome.get("relationships", []))
    from app.persistence.index_observations import record_index_observation
    for observation in outcome.get("indexObservations", []):
        await record_index_observation(pool, observation)
    await store_entity_projections(
        pool, build_entity_projections(outcome.get("entities", []),
                                       model_id=model_id, revision_id=revision_id))
    await set_revision_validation(pool, revision_id, "valid")
    return revision_id


async def _run_task(task_id: int, lease_owner: str) -> dict:
    import asyncpg

    from app.jobs.models import StaleLease
    from app.persistence.postgres_jobs import PostgresJobRepository
    from app.datasource.parser_sandbox import parser_timeout_seconds

    from .celery_app import POPULATION_QUEUES as _QUEUES
    import os

    max_attempts = max_attempts_from_env(os.environ.get("SEMANTIC_TASK_MAX_ATTEMPTS"))
    retry_seconds = retry_seconds_from_env(os.environ.get("SEMANTIC_TASK_RETRY_SECONDS"))
    pool = await asyncpg.create_pool(
        os.environ["SEMANTIC_RUNTIME_DATABASE_URL"], min_size=1, max_size=2,
        command_timeout=10,
        server_settings={"application_name": "semantic-model-population-worker",
                         "statement_timeout": "10s", "lock_timeout": "2s",
                         "idle_in_transaction_session_timeout": "10s"},
    )
    lease = None
    try:
        repository = PostgresJobRepository(pool)
        lease = await repository.claim_task(
            task_id=task_id, queue_name=_QUEUES[1], lease_owner=lease_owner,
            lease_seconds=population_lease_seconds(MAX_SOURCES_PER_TASK,
                                                   parser_timeout_seconds()))
        if lease is None:
            return {"ok": False, "errorCode": "lease_unavailable"}
        if attempts_exhausted(lease.attempt_count, max_attempts):
            try:
                await repository.complete_task(task_id=task_id, lease_owner=lease_owner,
                                               lease_epoch=lease.lease_epoch, job_state="failed",
                                               result=None, error_code="attempts_exhausted")
            except StaleLease:
                return {"ok": False, "errorCode": "stale_lease"}
            return {"ok": False, "errorCode": "attempts_exhausted"}
        from app.persistence.extraction_cache import DocumentExtractionCache

        async def report(snapshot: dict) -> None:
            # Each report also renews the lease, so a run over thousands of files stays owned.
            if not await repository.checkpoint(task_id=task_id, lease_owner=lease_owner,
                                               lease_epoch=lease.lease_epoch, progress=snapshot,
                                               lease_seconds=PROGRESS_LEASE_SECONDS):
                raise StaleLease("population lease lost while reporting progress")
            # Someone asked to stop: end here, before anything read is saved.
            if await repository.cancel_requested(lease.job_id):
                raise RunCancelled()

        progress = PopulationProgress(report)
        model_id = str(lease.payload.get("modelId") or lease.payload.get("model_id") or "")
        try:
            outcome = await run_population_for_task(
                lease.payload, manual_pool=pool, progress=progress,
                extraction_cache=DocumentExtractionCache(pool, model_id) if model_id else None)
            if outcome.get("ok") and outcome.get("purpose") != "preview":
                # The last chance to stop: after this the new data is saved.
                await progress.enter("saving")
            if await repository.cancel_requested(lease.job_id):
                raise RunCancelled()
        except RunCancelled:
            try:
                await repository.cancel_task(task_id=task_id, lease_owner=lease_owner,
                                             lease_epoch=lease.lease_epoch)
            except StaleLease:
                return {"ok": False, "errorCode": "stale_lease"}
            return {"ok": False, "errorCode": "cancelled", "jobState": "cancelled"}
        if not outcome.get("ok"):
            try:
                await repository.complete_task(task_id=task_id, lease_owner=lease_owner,
                                               lease_epoch=lease.lease_epoch, job_state="failed",
                                               result=None, error_code=outcome["errorCode"])
            except StaleLease:
                return {"ok": False, "errorCode": "stale_lease"}
            return outcome
        # Preview/Test runs never mutate stored state: the bounded computed
        # output travels in the job result and no revision is created.
        if outcome.get("purpose") == "preview":
            result = preview_job_result(outcome)
        else:
            # Durably persist before acknowledging: the job result carries only
            # a bounded summary while canonical rows live in semantic_population.
            # Counts are re-read from storage so ON CONFLICT skips never inflate
            # the summary.
            from app.persistence.population_store import count_revision_rows

            revision_id = await persist_population_revision(pool, lease.payload, outcome)
            persisted = await count_revision_rows(pool, revision_id)
            result = summarize_job_result(revision_id, outcome, persisted)
            finalized = await finalize_whole_model_build(pool, lease.payload, revision_id)
            if finalized is not None:
                result.update({"projectionRef": finalized["projectionRef"],
                               "boundEnvironment": finalized["environment"]})
        try:
            await repository.complete_task(task_id=task_id, lease_owner=lease_owner,
                                           lease_epoch=lease.lease_epoch,
                                           job_state=outcome["jobState"], result=result)
        except StaleLease:
            return {"ok": False, "errorCode": "stale_lease"}
        return {"ok": True, **result, "jobState": outcome["jobState"]}
    except Exception as exc:
        if lease is not None:
            try:
                await PostgresJobRepository(pool).requeue_task(
                    task_id=task_id, lease_owner=lease_owner, lease_epoch=lease.lease_epoch,
                    error_code=type(exc).__name__, retry_seconds=retry_seconds)
            except Exception as requeue_exc:
                logger.warning("Semantic population requeue failed; lease recovery will retry",
                               extra={"error_code": type(requeue_exc).__name__[:100]})
        raise
    finally:
        await pool.close()


@celery_app.task(bind=True, name="semantic-model-population.run", queue=POPULATION_QUEUES[1])
def populate_model(self, task_id: int) -> dict:  # type: ignore[no-untyped-def]
    import asyncio
    import os
    import uuid

    if isinstance(task_id, bool) or not isinstance(task_id, int):
        return {"ok": False, "errorCode": "invalid_task_reference"}
    max_attempts = max_attempts_from_env(os.environ.get("SEMANTIC_TASK_MAX_ATTEMPTS"))
    retry_seconds = retry_seconds_from_env(os.environ.get("SEMANTIC_TASK_RETRY_SECONDS"))
    try:
        return asyncio.run(_run_task(task_id, f"population-worker:{uuid.uuid4().hex}"))
    except Exception as exc:
        logger.warning("Semantic population task failed, scheduling bounded retry",
                       extra={"error_code": type(exc).__name__[:100]})
        raise self.retry(exc=exc, countdown=retry_seconds, max_retries=max_attempts)
