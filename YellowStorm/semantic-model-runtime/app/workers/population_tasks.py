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
from app.population.derived import (DerivationError, derive_concept, merge_derived, normalize_derivations,
                                    read_derived_fields)
from app.population.computed_fields import (apply_row_recipes, check_inputs, normalize_computed,
                                            normalize_row_recipes, recipe_columns, recipe_sources)
from app.population.cell_fields import (CellReader, cell_gaps, cell_text, extraction_columns,
                                        normalize_field_extractions, uses_ai as uses_cell_ai)
from app.population.document_rules import RuleError, normalize_ai_settings, normalize_rules
from app.population.run_limits import run_limits
from app.datasource.email_archive import resolve_column
from app.population.engine_version import reader_version
from app.population.serving_policy import blocking_gap_kinds, serving_decision
from app.population.tabular import (match_relationships, merge_concept_results,
                                    normalize_identity_value, populate_concept_rows)

from .celery_app import POPULATION_QUEUES, celery_app

logger = logging.getLogger(__name__)
ASSET_FETCH_WALL_SECONDS = 35
# Bump when the e-mail texts or attachment names written to the workspace change.
EMAIL_DERIVATION_VERSION = "email-derived-v1"
EMAIL_DERIVATION_CACHE_CONCEPT = "__email_derived_files__"
QUERY_ROW_LIMIT = 1000
# A workspace mapping expands to one source per document, so a run can read thousands of files.
MAX_SOURCES_PER_TASK = 5000
# How long each progress report keeps the lease alive: a long run stays owned while it reports.
PROGRESS_LEASE_SECONDS = 900
PROGRESS_RECENT = 8
# Bump when the way a sheet is read changes, so earlier readings are not reused.
TABULAR_READ_VERSION = "t1"
# A sheet this large is read again each run rather than kept: its reading would be a large row.
TABULAR_CACHE_MAX_RECORDS = 20000
MAX_TOTAL_ENTITIES = 10000
MAX_TOTAL_ASSERTIONS = 50000
MAX_TOTAL_RELATIONSHIPS = 20000
# Carries a manual row's display name; never a model attribute, so never asserted.
MANUAL_LABEL_FIELD = "__manual_label"
POPULATION_ENGINE_VERSION = "r1-mvp-8"


def population_execution_fingerprint(spec_hash: str, sources: list[dict],
                                     relation_bindings: list[dict],
                                     ai_extraction: dict | None = None,
                                     derivations: list[dict] | None = None) -> str:
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
        # Only present when a sheet field has a recipe, so other sources keep their fingerprint.
        **({"fieldRecipes": source["fieldRecipes"]} if source.get("fieldRecipes") else {}),
        # Only present when a sheet field is read out of a cell, so other sources keep their fingerprint.
        **({"fieldExtractions": source["fieldExtractions"]} if source.get("fieldExtractions") else {}),
    } for source in sources]
    # The AI agent's effective model is part of revision identity: changing it in
    # the agent library must produce a new revision instead of reusing persisted
    # rows. Always present (null when unused) so both sides hash the same body.
    fingerprinted = {"specHash": spec_hash, "sources": canonical_sources,
                     "relationBindings": relation_bindings,
                     "aiExtraction": ai_extraction,
                     "populationEngineVersion": POPULATION_ENGINE_VERSION}
    # Only present when a concept is made from another, so other models keep their fingerprint.
    if derivations:
        fingerprinted["derivations"] = derivations
    body = json.dumps(fingerprinted, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
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
        # What the saved result changed in the data in use, once it is known.
        self.changes: dict | None = None

    def snapshot(self) -> dict:
        snapshot = {"phase": self.phase, "total": self.total, "done": self.done, "reused": self.reused,
                    "records": self.records, "gaps": self.gaps, "current": self.current,
                    "recent": list(self.recent), "startedAt": self.started_at}
        if self.changes is not None:
            snapshot["changes"] = self.changes
        return snapshot

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


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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
                or len(sources) > min(MAX_SOURCES_PER_TASK, run_limits(payload)["maxRunSources"])):
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
                if any(item.get("mode") not in {"extract", "metadata", "constant", "computed"}
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
                if any(item.get("extractionStrategy") not in (None, "deterministic", "ai", "rules_then_ai")
                       or (item.get("extractionStrategy") is not None
                           and item.get("mode") != "extract") for item in active):
                    return {"ok": False, "errorCode": "invalid_document_mapping"}
                # The AI reading settings of a field: a definition (text) and an agent (an id).
                if any((item.get("semanticDefinition") is not None
                        and not isinstance(item["semanticDefinition"], str))
                       or (item.get("agentId") is not None and not isinstance(item["agentId"], str))
                       or ((item.get("semanticDefinition") is not None or item.get("agentId") is not None)
                           and item.get("mode") != "extract") for item in active):
                    return {"ok": False, "errorCode": "invalid_document_mapping"}
                # Rules are checked once here, so a bad pattern fails the run before any reading.
                try:
                    active = [{**item, "rules": normalize_rules(item["rules"])}
                              if item.get("rules") is not None else item for item in active]
                    if any(item.get("rules") is not None and item.get("mode") != "extract" for item in active):
                        raise RuleError("rules only apply to extracted fields")
                    active = [{**item, "computed": normalize_computed(item.get("computed"))}
                              if item.get("mode") == "computed" else item for item in active]
                    check_inputs(active)
                    normalize_ai_settings((entry.get("options") or {}).get("aiSettings"))
                except RuleError:
                    return {"ok": False, "errorCode": "invalid_document_mapping"}
                mapped_attributes = {item["targetAttribute"] for item in active}
                if len(mapped_attributes) != len(active):
                    return {"ok": False, "errorCode": "duplicate_document_mapping"}
                mapping = None
            else:
                mapping = entry.get("columnMapping") or entry.get("column_mapping")
                constants = entry.get("constantMapping") or entry.get("constant_mapping") or {}
                field_recipes = entry.get("fieldRecipes") or entry.get("field_recipes")
                field_extractions = entry.get("fieldExtractions") or entry.get("field_extractions")
                if (not isinstance(mapping, dict) or not isinstance(constants, dict)
                        or (not mapping and not constants and not field_extractions and not field_recipes)):
                    return {"ok": False, "errorCode": "invalid_column_mapping"}
                # A field read out of a cell's text with the document rules and/or AI.
                try:
                    extractions = normalize_field_extractions(field_extractions)
                    if uses_cell_ai(extractions):
                        normalize_ai_settings((entry.get("options") or {}).get("aiSettings"))
                except RuleError:
                    return {"ok": False, "errorCode": "invalid_column_mapping"}
                if (set(mapping.values()) & set(constants) or set(extractions) & set(mapping.values())
                        or set(extractions) & set(constants)):
                    return {"ok": False, "errorCode": "duplicate_column_mapping"}
                # A field's recipe (take it from, cut, keep, shape, clean-up), as a document's computed field:
                # on a column it shapes, or on its own (a field taken from a column or another field).
                recipe_fields = set(field_recipes) if isinstance(field_recipes, dict) else set()
                if recipe_fields & (set(constants) | set(extractions)):
                    return {"ok": False, "errorCode": "duplicate_column_mapping"}
                try:
                    recipes = normalize_row_recipes(
                        field_recipes, set(mapping.values()) | set(constants) | set(extractions) | recipe_fields)
                except RuleError:
                    return {"ok": False, "errorCode": "invalid_column_mapping"}
                mapped_attributes = set(mapping.values()) | set(constants) | set(extractions) | set(recipes)
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
                **({"fieldMappings": active, "receivedFieldMappings": field_mappings} if source_kind == "document"
                   else {"columnMapping": dict(mapping), "constantMapping": dict(constants),
                         **({"fieldRecipes": recipes, "receivedFieldRecipes": field_recipes} if recipes else {}),
                         **({"fieldExtractions": extractions, "receivedFieldExtractions": field_extractions}
                            if extractions else {})}),
                "labelField": entry.get("labelField") or entry.get("label_field"),
                "mappingVersion": entry.get("mappingVersion") or entry.get("mapping_version") or "v1",
            })
            mapped_fields.setdefault(entry.get("conceptId"), set()).update(mapped_attributes)
        try:
            derivations = normalize_derivations(payload.get("derivations"), compiled["concepts"])
        except DerivationError as exc:
            return {"ok": False, "errorCode": str(exc)}
        for derivation in derivations:
            mapped_fields.setdefault(derivation["conceptId"], set()).update(
                field["targetAttribute"] for field in derivation["fieldMappings"])
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
        # The core hashes the mappings it sent, before the rules are normalized here.
        received = [{**source, "fieldMappings": source["receivedFieldMappings"]}
                    if "receivedFieldMappings" in source else source for source in normalized]
        received = [{**source, "fieldRecipes": source["receivedFieldRecipes"]}
                    if "receivedFieldRecipes" in source else source for source in received]
        received = [{**source, "fieldExtractions": source["receivedFieldExtractions"]}
                    if "receivedFieldExtractions" in source else source for source in received]
        execution_fingerprint = population_execution_fingerprint(
            expected_hash, received, normalized_bindings, ai_extraction, derivations)
        for source in normalized:
            source.pop("receivedFieldMappings", None)
            source.pop("receivedFieldRecipes", None)
            source.pop("receivedFieldExtractions", None)
        supplied_fingerprint = (payload.get("populationExecutionFingerprint")
                                or payload.get("population_execution_fingerprint"))
        if supplied_fingerprint is not None and supplied_fingerprint != execution_fingerprint:
            return {"ok": False, "errorCode": "execution_fingerprint_mismatch"}
        return {"ok": True, "compiled": compiled, "sources": normalized,
                "relationBindings": normalized_bindings, "derivations": derivations,
                "purpose": payload.get("purpose"),
                "specHash": expected_hash, "executionFingerprint": execution_fingerprint}
    except Exception:
        return {"ok": False, "errorCode": "invalid_command"}


async def run_population_for_task(command_dump: dict, *, fetch=None, prepare=None,
                                  query=None, index_connection=None, metadata_fetch=None,
                                  manual_pool=None, progress: PopulationProgress | None = None,
                                  extraction_cache=None, upload_derived=None, derive=None) -> dict:
    """Fetch, prepare, query and populate every mapped source (bounded), reporting progress."""
    import asyncio
    import os
    import tempfile
    from pathlib import Path

    from app.datasource.asset_delivery import (AssetFetchError, asset_fetch_wall_seconds,
                                                fetch_workspace_asset)
    from app.datasource.discovery import is_email_archive
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
    limits = run_limits(command_dump.get("payload"))
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

    # An e-mail archive is downloaded once per run to disk; its three tables read the same file.
    archive_files: dict[tuple, Path] = {}
    archive_dir: dict = {"path": None}

    async def fetch_archive(source: dict) -> Path:
        key = (source.get("workspaceId"), source.get("assetId"), resolve_asset_ref(source)["assetVersionId"])
        if key not in archive_files:
            if archive_dir["path"] is None:
                archive_dir["path"] = Path(tempfile.mkdtemp(prefix="semantic-archive-",
                                                            dir=os.environ.get("SEMANTIC_TASK_TEMP_DIR")))
            target = archive_dir["path"] / f"{len(archive_files)}.bin"
            async with asyncio.timeout(asset_fetch_wall_seconds(source)):
                archive_files[key] = await (fetch or fetch_workspace_asset)(source, actor, target=target)
            await derive_archive(source, archive_files[key])
        return archive_files[key]

    async def derive_archive(source: dict, path: Path) -> None:
        """Store the e-mails' texts and readable attachments in the workspace, where they are indexed.

        Once per archive version and model: a later run finds it in the extraction cache. A failure
        here leaves the three tables readable, so it is logged instead of failing the run.
        """
        from app.datasource.asset_delivery import upload_derived_file
        from app.datasource.parser_sandbox import derive_files_subprocess

        cache_key = None
        if extraction_cache is not None:
            from app.persistence.extraction_cache import extraction_cache_key
            cache_key = extraction_cache_key({
                "engine": EMAIL_DERIVATION_VERSION, "workspaceId": source.get("workspaceId"),
                "assetId": source.get("assetId"), "assetVersionId": resolve_asset_ref(source)["assetVersionId"]})
            if await extraction_cache.get(cache_key) is not None:
                return
        phase = progress.phase
        await progress.enter("deriving")
        try:
            with tempfile.TemporaryDirectory(prefix="semantic-derived-",
                                             dir=os.environ.get("SEMANTIC_TASK_TEMP_DIR")) as directory:
                files = await asyncio.to_thread(derive or derive_files_subprocess, source, path, Path(directory))
                created = 0
                for number, entry in enumerate(files, start=1):
                    stored = Path(directory) / str(entry.get("stored", ""))
                    result = await (upload_derived or upload_derived_file)(source, actor, entry, stored)
                    created += bool(result.get("created"))
                    if number % 100 == 0:
                        await progress.send(force=True)
            if cache_key is not None:
                await extraction_cache.put(cache_key, concept_id=EMAIL_DERIVATION_CACHE_CONCEPT,
                                           asset_id=str(source.get("assetId") or ""),
                                           output={"files": len(files), "created": created})
            logger.info("email archive derived", extra={"assetId": source.get("assetId"),
                                                        "files": len(files), "created": created})
        except (ValueError, RuntimeError, AssetFetchError, TimeoutError) as exc:
            logger.warning("email archive derivation failed",
                           extra={"assetId": source.get("assetId"), "error": str(exc)})
        finally:
            progress.phase = phase
            await progress.send(force=True)

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
                # Only a retrieval cut can leave documents unread; a read cut inside one
                # document leaves some of its fields unresolved, not records missing.
                if any(gap.get("kind") == "budget_exhausted" and gap.get("scope") == "retrieval"
                       for gap in output["gaps"]):
                    complete_enumeration = False
                await progress.read(entry, records=len(output["entities"]), gaps=len(output["gaps"]),
                                    status=output["coverage"]["status"], reused=reused)
                continue
            try:
                if is_email_archive(source.get("mimeType")):
                    data = await fetch_archive(source)
                else:
                    async with asyncio.timeout(ASSET_FETCH_WALL_SECONDS):
                        data = await (fetch or fetch_workspace_asset)(source, actor)
            except AssetFetchError as exc:
                return {"ok": False, "errorCode": exc.code}
            try:
                asset_ref = resolve_asset_ref(source)
            except ValueError as exc:
                return {"ok": False, "errorCode": str(exc) or "invalid_source"}
            # A sheet whose bytes, mapping and concept are unchanged yields what it yielded last time.
            cache_key = None
            if extraction_cache is not None:
                from app.persistence.extraction_cache import extraction_cache_key
                if isinstance(data, Path):
                    content_digest = await asyncio.to_thread(_file_sha256, data)
                else:
                    content = data if isinstance(data, (bytes, bytearray)) else str(data).encode("utf-8")
                    content_digest = hashlib.sha256(content).hexdigest()
                cache_key = extraction_cache_key({
                    # A changed file reader reads the table again (reading a table is cheap).
                    "engine": TABULAR_READ_VERSION, "reader": reader_version(),
                    "modelId": str(command_dump.get("modelId") or ""),
                    "concept": compiled["concepts"][entry["conceptId"]], "conceptId": entry["conceptId"],
                    "columnMapping": entry["columnMapping"], "constantMapping": entry.get("constantMapping", {}),
                    "options": options, "mappingVersion": entry["mappingVersion"],
                    "labelField": entry.get("labelField"), "assetRef": asset_ref,
                    "content": content_digest,
                    # Only present with a recipe, so a sheet without one keeps its cached reading.
                    **({"fieldRecipes": entry["fieldRecipes"]} if entry.get("fieldRecipes") else {}),
                    **({"fieldExtractions": entry["fieldExtractions"], "aiExtraction": ai_extraction}
                       if entry.get("fieldExtractions") else {})})
                cached = await extraction_cache.get(cache_key)
                if cached is not None and isinstance(cached.get("outputs"), list):
                    for output in cached["outputs"]:
                        per_concept.setdefault(entry["conceptId"], []).append(output)
                    if not cached.get("completeEnumeration", True):
                        complete_enumeration = False
                    observation = cached.get("observation") or {}
                    if isinstance(observation.get("contentHash"), str) and observation["contentHash"]:
                        dataset_fingerprints.add(observation["contentHash"])
                    observations.append(observation)
                    await progress.read(entry, records=sum(len(output["entities"]) for output in cached["outputs"]),
                                        gaps=sum(len(output["gaps"]) for output in cached["outputs"]),
                                        status="read", reused=True)
                    continue
            temp_root = os.environ.get("SEMANTIC_TASK_TEMP_DIR")
            records = gaps = 0
            outputs: list[dict] = []
            sheet_complete = True
            try:
                with tempfile.TemporaryDirectory(prefix="semantic-populate-",
                                                 dir=temp_root) as directory:
                    artifact = Path(directory) / "dataset.parquet"
                    manifest = await asyncio.to_thread(
                        prepare or prepare_dataset_subprocess, source, options, data, artifact)
                    asset_ref["datasetRevisionId"] = manifest.get("datasetId")
                    # A column a newer reader renamed is read under its new name.
                    available = manifest.get("columns") if isinstance(manifest, dict) else None
                    mapping = ({resolve_column(column, available): attribute
                                for column, attribute in entry["columnMapping"].items()}
                               if isinstance(available, list) else entry["columnMapping"])
                    recipes = entry.get("fieldRecipes") or {}
                    joined_sources = {attribute: recipe_sources(spec) for attribute, spec in recipes.items()
                                      if spec["input"]["kind"] == "join"}
                    # A column a recipe reads that the sheet does not have is left out (its input is empty).
                    recipe_inputs = ({resolve_column(name, available) for name in recipe_columns(recipes)}
                                     & set(available) if isinstance(available, list) else recipe_columns(recipes))
                    extractions = entry.get("fieldExtractions") or {}
                    extraction_inputs = ({resolve_column(name, available) for name in extraction_columns(extractions)}
                                         & set(available) if isinstance(available, list)
                                         else extraction_columns(extractions))
                    columns = sorted(set(mapping) | recipe_inputs | extraction_inputs | {SHEET_ROW_KEY})
                    concept = compiled["concepts"][entry["conceptId"]]
                    # Fields read out of a cell's text, as a document's: rules on every row, AI on a bounded few.
                    cells = CellReader(extractions, {
                        "conceptId": entry["conceptId"], "conceptLabel": concept.get("label") or entry["conceptId"],
                        "source": source, "assetRef": asset_ref, "mappingVersion": entry["mappingVersion"],
                        "modelId": str(command_dump.get("modelId") or ""), "aiExtraction": ai_extraction,
                        "settings": normalize_ai_settings((options or {}).get("aiSettings"))},
                        cache=extraction_cache) if extractions else None
                    missing_cells: dict[str, int] = {}
                    read_rows = 0
                    offset = 0
                    while True:
                        page = await asyncio.to_thread(
                            query or query_parquet, artifact, columns=columns,
                            limit=QUERY_ROW_LIMIT, offset=offset)
                        constants = entry.get("constantMapping", {})
                        raws = page["rows"]
                        # The admin's per-source limit: the rest of the sheet is left unread.
                        capped = len(raws) > limits["maxRecordsPerSource"] - records
                        if capped:
                            raws = raws[:max(0, limits["maxRecordsPerSource"] - records)]
                            complete_enumeration = sheet_complete = False
                        rows = []
                        for raw in raws:
                            renamed: dict = {"_row": raw.get(SHEET_ROW_KEY), **constants}
                            for source_column, attribute in mapping.items():
                                if source_column in raw:
                                    renamed[attribute] = raw[source_column]
                            rows.append(renamed)
                        cell_evidence: dict = {}
                        if cells is not None:
                            outcomes = await cells.read_rows([
                                (raw.get(SHEET_ROW_KEY), {column: cell_text(raw.get(resolve_column(column, raw)))
                                                          for column in extraction_columns(extractions)})
                                for raw in raws])
                            for renamed, outcome in zip(rows, outcomes):
                                for attribute in extractions:
                                    renamed[attribute] = outcome["values"].get(attribute)
                                    if attribute not in outcome["values"]:
                                        missing_cells[attribute] = missing_cells.get(attribute, 0) + 1
                                cell_evidence[renamed["_row"]] = outcome["evidence"]
                            read_rows += len(raws)
                        # Shaped before the identity is read, so the key uses the shaped value.
                        if recipes:
                            for raw, renamed in zip(raws, rows):
                                apply_row_recipes(recipes, renamed, raw,
                                                  lambda name, raw=raw: resolve_column(name, raw))
                        output = populate_concept_rows(
                            concept, rows, {"assetRef": asset_ref,
                                           "mappingVersion": entry["mappingVersion"],
                                           "labelField": entry.get("labelField"),
                                           "constantFields": list(constants)})
                        # A value read out of a cell keeps where it was found: row, column and span.
                        for assertion in output["assertions"]:
                            found = cell_evidence.get(assertion["evidence"].get("rowNumber"), {}).get(assertion["attribute"])
                            if found is not None:
                                assertion["evidence"] = found
                            elif assertion["attribute"] in joined_sources:
                                # A recipe joining several columns or fields: every one it read.
                                assertion["evidence"]["recipeSources"] = joined_sources[assertion["attribute"]]
                        if cells is not None and (capped or page["returnedRows"] < QUERY_ROW_LIMIT):
                            output["gaps"].extend(cell_gaps(entry["conceptId"], asset_ref, extractions,
                                                            missing_cells, read_rows, cells.stats))
                            output["counts"]["gaps"] = len(output["gaps"])
                        per_concept.setdefault(entry["conceptId"], []).append(output)
                        outputs.append(output)
                        records += len(output["entities"])
                        gaps += len(output["gaps"])
                        offset += page["returnedRows"]
                        if capped or page["returnedRows"] < QUERY_ROW_LIMIT:
                            break
            except ValueError as exc:
                return {"ok": False, "errorCode": str(exc) or "parser_failed"}
            except AssetFetchError as exc:
                return {"ok": False, "errorCode": exc.code}
            fingerprint = manifest.get("contentHash") if isinstance(manifest, dict) else None
            if isinstance(fingerprint, str) and fingerprint:
                dataset_fingerprints.add(fingerprint)
            observation = {
                "assetRef": {key: asset_ref[key] for key in
                             ("workspaceId", "assetId", "assetVersionId") if key in asset_ref},
                "datasetId": manifest.get("datasetId"),
                "contentHash": manifest.get("contentHash"),
                "sizeBytes": manifest.get("sizeBytes"),
                "rowCount": manifest.get("rowCount")}
            observations.append(observation)
            # A failed call to the extraction agent is worth retrying next run.
            ai_failed = cells is not None and cells.stats["aiFailedRows"] > 0
            if cache_key is not None and records <= TABULAR_CACHE_MAX_RECORDS and not ai_failed:
                sheet = (options or {}).get("sheetName") or ""
                await extraction_cache.put(
                    cache_key, concept_id=entry["conceptId"],
                    asset_id=f"{asset_ref.get('assetId') or ''}#{sheet}",
                    output={"outputs": outputs, "observation": observation,
                            "completeEnumeration": sheet_complete})
            await progress.read(entry, records=records, gaps=gaps, status="read")
        return None

    try:
        failure = await read_sources()
    finally:
        if index_pool["owned"] is not None:
            await index_pool["owned"].close()
        if archive_dir["path"] is not None:
            import shutil
            shutil.rmtree(archive_dir["path"], ignore_errors=True)
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
    # Concepts made from another concept's records, once every source has been read.
    for derivation in validated["derivations"]:
        source = merged_by_concept.get(derivation["sourceConceptId"])
        if source is None:
            continue
        target = compiled["concepts"][derivation["conceptId"]]
        # Fields read out of a source field's text (rules, AI), taken by a recipe or fixed, with the
        # same readers as a sheet cell; a field copied as it is needs no reading.
        read = await read_derived_fields(derivation, source["entities"], {
            "conceptId": derivation["conceptId"], "conceptLabel": target.get("label") or derivation["conceptId"],
            "source": {"assetId": f"derived:{derivation['derivationId']}",
                       "originalName": compiled["concepts"][derivation["sourceConceptId"]].get("label")
                       or derivation["sourceConceptId"]},
            "assetRef": {}, "modelId": str(command_dump.get("modelId") or ""), "aiExtraction": ai_extraction},
            cache=extraction_cache)
        derived = derive_concept(target, derivation, source["entities"], source["assertions"], read["readings"])
        if read["gaps"]:
            derived["gaps"].extend(read["gaps"])
            derived["counts"]["gaps"] = len(derived["gaps"])
        merged_by_concept[derivation["conceptId"]] = merge_derived(
            merged_by_concept.get(derivation["conceptId"]), derived)
        for key in counts:
            counts[key] += derived["counts"].get(key, 0)
    # Bound the result before matching so relationships never reference dropped
    # entities and assertions never outlive their entity.
    kept: list[dict] = []
    for concept_id in sorted(merged_by_concept):
        ordered = sorted(merged_by_concept[concept_id]["entities"],
                         key=lambda item: item["entityId"])
        for entity in ordered:
            if len(kept) >= limits["maxRecordsPerRun"]:
                break
            kept.append(entity)
        if len(kept) >= limits["maxRecordsPerRun"]:
            break
    kept_ids = {entity["entityId"] for entity in kept}
    gaps: list[dict] = []
    assertions: list[dict] = []
    for merged in merged_by_concept.values():
        gaps.extend(merged["gaps"])
        for assertion in merged["assertions"]:
            if assertion["entityId"] in kept_ids and len(assertions) < limits["maxValuesPerRun"]:
                assertions.append(assertion)
    dropped_entities = (sum(len(merged["entities"]) for merged in merged_by_concept.values())
                        - len(kept))
    if dropped_entities > 0:
        gaps.append({"kind": "materialization_cap", "conceptId": None, "rowNumber": None,
                     "detail": f"bounded result capped at {limits['maxRecordsPerRun']} entities"})
    dropped_assertions = (sum(len(merged["assertions"]) for merged in merged_by_concept.values())
                          - len(assertions))
    if dropped_assertions > 0:
        gaps.append({"kind": "assertion_cap", "conceptId": None, "rowNumber": None,
                     "detail": f"bounded result capped at {limits['maxValuesPerRun']} assertions"})
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
    # Links grow with records: a run allowed more records may keep proportionally more links.
    max_relationships = max(MAX_TOTAL_RELATIONSHIPS, 2 * limits["maxRecordsPerRun"])
    if len(relationships) > max_relationships:
        relationships = sorted(relationships,
                               key=lambda item: (item.get("relationId", ""),
                                                 item.get("sourceEntityId", ""),
                                                 item.get("targetEntityId", "")))[:max_relationships]
        gaps.append({"kind": "relationship_cap", "conceptId": None, "rowNumber": None,
                     "detail": f"bounded result capped at {max_relationships} relationships"})
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


def _entity_assets(entity: dict) -> set[str]:
    sources = (entity.get("provenance") or {}).get("sources") or []
    return {str(asset) for source in sources
            if (asset := (source.get("assetRef") or {}).get("assetId"))}


def compare_revisions(before: list[dict], after: list[dict], current_assets: set[str]) -> dict:
    """What a new result changes in the data in use: records added, removed and changed, and
    the files that are no longer read with how many records came from them."""
    old = {entity["entityId"]: entity for entity in before}
    new = {entity["entityId"]: entity for entity in after}
    changed = sum(1 for entity_id, entity in new.items() if entity_id in old
                  and (entity.get("attributes") != old[entity_id].get("attributes")
                       or entity.get("label") != old[entity_id].get("label")))
    gone: dict[str, int] = {}
    for entity in before:
        for asset in _entity_assets(entity):
            # Typed records are not files: they come and go with the records themselves.
            if asset not in current_assets and not asset.startswith("manual:"):
                gone[asset] = gone.get(asset, 0) + 1
    return {"added": sum(1 for entity_id in new if entity_id not in old),
            "removed": sum(1 for entity_id in old if entity_id not in new),
            "changed": changed,
            "removedSources": [{"assetId": asset, "records": count} for asset, count in sorted(gone.items())]}


async def changes_from_data_in_use(pool, command_dump: dict, revision_id: str,  # type: ignore[no-untyped-def]
                                   sources: list[dict]) -> dict | None:
    """Compare a saved result with the draft data in use; None when there is nothing to compare with."""
    from app.persistence.population_store import get_active_binding, list_revision_entities

    model_id = str(command_dump.get("modelId") or command_dump.get("model_id") or "")
    current = await get_active_binding(pool, model_id, "draft") if model_id else None
    if current is None:
        return None
    previous_id = current["data_revision_id"]
    if previous_id == revision_id:
        return {"added": 0, "removed": 0, "changed": 0, "removedSources": []}
    current_assets = {str(asset) for entry in sources
                      if (asset := (entry.get("source") or {}).get("assetId"))}
    return compare_revisions(await list_revision_entities(pool, previous_id),
                             await list_revision_entities(pool, revision_id), current_assets)


def is_whole_model_build(command_dump: dict) -> bool:
    payload = command_dump.get("payload", {})
    return payload.get("purpose") == "build" and (payload.get("scope") or {}).get("kind") == "model"


async def has_draft_binding(pool, command_dump: dict) -> bool:  # type: ignore[no-untyped-def]
    """Whether the model already serves a draft graph that a partial result could replace."""
    from app.persistence.population_store import get_active_binding

    model_id = str(command_dump.get("modelId") or command_dump.get("model_id") or "")
    return bool(model_id) and await get_active_binding(pool, model_id, "draft") is not None


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
# A few examples of each gap, with where they come from, so a person can look at the rows themselves.
MAX_GAP_SAMPLES_PER_GROUP = 25
MAX_GAP_SAMPLES = 500


def _asset(gap: dict) -> dict:
    ref = gap.get("assetRef") or {}
    return {key: ref[key] for key in ("workspaceId", "assetId") if ref.get(key) is not None}


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
    fields: dict[tuple, set] = {}
    row_samples: list[dict] = []
    link_samples: list[dict] = []
    for gap in outcome.get("gaps", []):
        kind = gap.get("kind")
        if gap.get("relationId") is not None:
            key = (gap["relationId"], kind)
            links[key] = links.get(key, 0) + 1
            if links[key] <= MAX_GAP_SAMPLES_PER_GROUP and len(link_samples) < MAX_GAP_SAMPLES and gap.get("sourceEntityId"):
                link_samples.append({"relationId": gap["relationId"], "kind": kind,
                                     "sourceEntityId": gap["sourceEntityId"],
                                     **{name: gap[name] for name in ("referenceField", "referenceValue", "targetField")
                                        if name in gap}})
        else:
            key = (gap.get("conceptId"), kind)
            other[key] = other.get(key, 0) + 1
            if gap.get("field"):
                fields.setdefault(key, set()).add(gap["field"])
            if other[key] <= MAX_GAP_SAMPLES_PER_GROUP and len(row_samples) < MAX_GAP_SAMPLES:
                row_samples.append({"conceptId": gap.get("conceptId"), "kind": kind,
                                    **({"field": gap["field"]} if gap.get("field") else {}),
                                    **({"rowNumber": gap["rowNumber"]} if gap.get("rowNumber") is not None else {}),
                                    **({"asset": _asset(gap)} if _asset(gap) else {}),
                                    **({"values": gap["values"]} if gap.get("values") else {})})
    return {
        "missingValues": missing_values[:MAX_GAP_GROUPS],
        "unresolvedLinks": [{"relationId": r, "kind": k, "count": c}
                            for (r, k), c in sorted(links.items())][:MAX_GAP_GROUPS],
        "other": [{"conceptId": cid, "kind": k, "count": c,
                   **({"fields": sorted(fields[(cid, k)])} if (cid, k) in fields else {})}
                  for (cid, k), c in sorted(other.items(), key=lambda i: (str(i[0][0]), i[0][1]))
                  ][:MAX_GAP_GROUPS],
        "rowSamples": row_samples,
        "linkSamples": link_samples,
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
                                                  model_correction_sequence,
                                                  model_reset_generation, revision_id_for,
                                                  set_revision_validation, store_assertions,
                                                  store_entities, store_relationships)
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
                                  correction_sequence,
                                  await model_reset_generation(pool, model_id))
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
            # Measured against the data in use before this result can replace it.
            if is_whole_model_build(lease.payload):
                try:
                    changes = await changes_from_data_in_use(
                        pool, lease.payload, revision_id,
                        run_population_for_payload(lease.payload).get("sources", []))
                except Exception as exc:  # a missing comparison never fails a saved run
                    logger.warning("Population change summary failed",
                                   extra={"error_code": type(exc).__name__[:100]})
                    changes = None
                if changes is not None:
                    result["changes"] = changes
                    progress.changes = changes
                    try:
                        await progress.send(force=True)
                    except RunCancelled:
                        pass  # Already saved: a late stop request changes nothing.
            # A result missing data it should have is kept for diagnosis but does not
            # replace a graph already in use (see serving_policy).
            blocking = blocking_gap_kinds(outcome.get("gaps", []))
            decision = "activate"
            if blocking and is_whole_model_build(lease.payload):
                decision = serving_decision(blocking, await has_draft_binding(pool, lease.payload))
            result.update({"blockingGapKinds": blocking, "servingDecision": decision})
            if decision == "activate":
                finalized = await finalize_whole_model_build(pool, lease.payload, revision_id)
                if finalized is not None:
                    result.update({"projectionRef": finalized["projectionRef"],
                                   "boundEnvironment": finalized["environment"]})
                    # The new draft data gets its search index in its own job; a failure
                    # here never fails the build (reads request it again).
                    from app.graph_search.indexer import request_index_quietly
                    from app.jobs.service import JobService

                    await request_index_quietly(pool, JobService(repository).admit, revision_id)
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
