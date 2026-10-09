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
import uuid
from functools import partial

from celery.signals import worker_ready

from app.jobs.recovery import max_attempts_from_env, retry_seconds_from_env
from app.population.payload_rules import analyze_payload
from app.population.derived import derivation_items, derive_concept, merge_derived, read_derived_fields
from app.population.computed_fields import apply_row_recipes, recipe_columns, recipe_sources
from app.population.cell_fields import CellReader, cell_gaps, cell_text, extraction_columns
from app.population.document_rules import answer_options, normalize_ai_settings
from app.population.run_limits import (ai_pacing, identity_limits, index_build_limits, run_limits,
                                        source_limits, source_record_cap)
from app.datasource.email_archive import resolve_column
from app.population.engine_version import reader_version
from app.population.expand import expand_rows, is_item_attribute, normalize_expand
from app.population.serving_policy import blocking_gap_kinds, serving_decision
from app.population.tabular import (MAX_ASSERTIONS, MAX_MATERIALIZED_ENTITIES, match_relationships, merge_concept_results,
                                    normalize_identity_value, populate_concept_rows)

from .celery_app import POPULATION_QUEUES, celery_app

logger = logging.getLogger(__name__)
ASSET_FETCH_WALL_SECONDS = 35
# Files of an e-mail archive sent for indexing at once, and per batch awaited together.
DERIVED_UPLOAD_CONCURRENCY = 8
DERIVED_UPLOAD_BATCH = 500
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
MAX_TOTAL_ENTITIES = 10000
MAX_TOTAL_ASSERTIONS = 50000
MAX_TOTAL_RELATIONSHIPS = 20000
# Carries a manual row's display name; never a model attribute, so never asserted.
MANUAL_LABEL_FIELD = "__manual_label"
POPULATION_ENGINE_VERSION = "r1-mvp-8"


def population_execution_fingerprint(spec_hash: str, sources: list[dict],
                                     relation_bindings: list[dict],
                                     ai_extraction: dict | None = None,
                                     derivations: list[dict] | None = None,
                                     limits: dict | None = None) -> str:
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
        # Only present when a mapping sets its own reading limits.
        **({"readLimits": source["readLimits"]} if source.get("readLimits") else {}),
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
    # Only the limits an admin set travel with the run (the core hashes the same object), so
    # other runs keep their fingerprint. The save limits are left out: they only decide how it is written.
    if identity_limits(limits):
        fingerprinted["limits"] = identity_limits(limits)
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
        # How far the current step is (rows of a sheet, files sent for indexing…); ``total`` is
        # None when unknown (an archive being opened).
        self.step: dict | None = None
        # AI calls of the whole run: planned, answered, reused from an earlier run, skipped over
        # the cap, failed.
        self.ai = {"planned": 0, "answered": 0, "reused": 0, "skipped": 0, "failed": 0}
        # False once the new data is being saved: a stop request is then not acted on (the run
        # finishes), so a report must not raise it into the middle of a save.
        self.cancellable = True

    def snapshot(self) -> dict:
        snapshot = {"phase": self.phase, "total": self.total, "done": self.done, "reused": self.reused,
                    "records": self.records, "gaps": self.gaps, "current": self.current,
                    "recent": list(self.recent), "startedAt": self.started_at}
        if not self.cancellable:
            # Past the last chance to stop: a stop request changes nothing, so the UI does not offer it.
            snapshot["cancellable"] = False
        if self.changes is not None:
            snapshot["changes"] = self.changes
        if self.step is not None:
            snapshot["step"] = dict(self.step)
        if any(self.ai.values()):
            snapshot["ai"] = dict(self.ai)
        return snapshot

    async def advance(self, unit: str, done: int, total: int | None = None) -> None:
        """How far the current step is: ``done`` of ``total`` ``unit`` (rows, files, …)."""
        self.step = {"unit": unit, "done": done, "total": total}
        await self.send()

    async def count_ai(self, key: str, amount: int = 1) -> None:
        self.ai[key] = self.ai.get(key, 0) + amount
        await self.send()

    async def send(self, *, force: bool = False) -> None:
        if self._report is None:
            return
        now = self._clock()
        if not force and now - self._last_sent < self._min_interval:
            return
        self._last_sent = now
        try:
            await self._report(self.snapshot())
        except RunCancelled:
            if self.cancellable:
                raise

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
        self.step = None
        self.reused += 1 if reused else 0
        self.records += records
        self.gaps += gaps
        self.recent = [{"name": source_display_name(entry), "conceptId": entry.get("conceptId"),
                        "status": status, "records": records, "reused": reused},
                       *self.recent][:PROGRESS_RECENT]
        await self.send(force=self.done == self.total)

    async def enter(self, phase: str) -> None:
        self.phase, self.current, self.step = phase, None, None
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
        expected_hash = payload.get("specHash") or payload.get("spec_hash")
        # The rules live in app.population.payload_rules, shared with the model check.
        analysis = analyze_payload(
            payload, verify_hash=True, expected_hash=expected_hash,
            max_sources=min(MAX_SOURCES_PER_TASK, run_limits(payload)["maxRunSources"]))
        if analysis.spec_issues:
            return {"ok": False, "errorCode": "invalid_specification",
                    "issues": analysis.spec_issues[:10]}
        error = analysis.first_error
        if error is not None:
            return {"ok": False, "errorCode": error["code"]}
        compiled, normalized = analysis.compiled, analysis.sources
        derivations, normalized_bindings = analysis.derivations, analysis.bindings
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
            expected_hash, received, normalized_bindings, ai_extraction, derivations,
            payload.get("limits") if isinstance(payload.get("limits"), dict) else None)
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
                                  extraction_cache=None, upload_derived=None, derive=None,
                                  carried: dict | None = None) -> dict:
    """Fetch, prepare, query and populate every mapped source (bounded), reporting progress.

    ``carried`` is the data in use when the run refreshes one concept: every record, value and link the
    run does not make again is kept from it (see ``carry_over``)."""
    import asyncio
    import os
    import shutil
    import tempfile
    from typing import Any
    from pathlib import Path

    from app.datasource.asset_delivery import (AssetFetchError, asset_fetch_wall_seconds,
                                                fetch_workspace_asset, fetch_workspace_asset_metadata)
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
                archive_mb = source_limits(limits, source)["maxArchiveMb"]
                archive_files[key] = await (fetch or partial(fetch_workspace_asset, archive_mb=archive_mb))(
                    source, actor, target=target)
            # Copying the e-mails into the workspace only feeds its search; the model reads the
            # archive itself, so it is done only when the data source asks for it.
            if source.get("indexInWorkspace") is True:
                await derive_archive(source, archive_files[key])
        return archive_files[key]

    def derivation_cache_key(source: dict) -> str | None:
        """What marks an archive version as already copied into the workspace, for this model."""
        if extraction_cache is None:
            return None
        from app.persistence.extraction_cache import extraction_cache_key
        return extraction_cache_key({
            "engine": EMAIL_DERIVATION_VERSION, "workspaceId": source.get("workspaceId"),
            "assetId": source.get("assetId"), "assetVersionId": resolve_asset_ref(source)["assetVersionId"],
            # Tables cut at the old e-mail or size limit are derived again once it changes.
            "limits": {key: value for key, value in source_limits(limits, source).items()
                       if key in ("maxArchiveEmails", "maxArchiveMb")}})

    async def derive_archive(source: dict, path: Path) -> None:
        """Store the e-mails' texts and readable attachments in the workspace, where they are indexed.

        Once per archive version and model: a later run finds it in the extraction cache. A failure
        here leaves the three tables readable, so it is logged instead of failing the run.
        """
        from app.datasource.asset_delivery import upload_derived_file
        from app.datasource.parser_sandbox import derive_files_subprocess

        cache_key = derivation_cache_key(source)
        if cache_key is not None and await extraction_cache.get(cache_key) is not None:
            return
        phase = progress.phase
        await progress.enter("deriving")
        try:
            with tempfile.TemporaryDirectory(prefix="semantic-derived-",
                                             dir=os.environ.get("SEMANTIC_TASK_TEMP_DIR")) as directory:
                await progress.advance("opening", 0, None)
                files = await asyncio.to_thread(derive or partial(derive_files_subprocess, limits=source_limits(limits, source)),
                                                source, path, Path(directory))
                created = sent = failed = 0
                await progress.advance("files", 0, len(files))
                # Several at once: a large mailbox gives tens of thousands of files. One that fails
                # does not stop the others; the archive is derived again next run.
                gate = asyncio.Semaphore(DERIVED_UPLOAD_CONCURRENCY)

                async def send_one(entry: dict) -> None:
                    nonlocal created, sent, failed
                    async with gate:
                        stored = Path(directory) / str(entry.get("stored", ""))
                        try:
                            result = await (upload_derived or upload_derived_file)(source, actor, entry, stored)
                            created += bool(result.get("created"))
                        except (ValueError, RuntimeError, AssetFetchError, TimeoutError, OSError) as exc:
                            failed += 1
                            logger.warning("derived file not sent", extra={"assetId": source.get("assetId"),
                                                                           "error": str(exc)[:200]})
                        sent += 1
                        await progress.advance("files", sent, len(files))

                for start in range(0, len(files), DERIVED_UPLOAD_BATCH):
                    await asyncio.gather(*(send_one(entry) for entry in files[start:start + DERIVED_UPLOAD_BATCH]))
                if failed:
                    raise RuntimeError(f"derived_files_failed:{failed}")
            if cache_key is not None:
                await extraction_cache.put(cache_key, concept_id=EMAIL_DERIVATION_CACHE_CONCEPT,
                                           asset_id=str(source.get("assetId") or ""),
                                           output={"files": len(files), "created": created})
            # "created" is a reserved LogRecord attribute; INFO logs are no longer
            # filtered out now that the unified-logging bridge captures them.
            logger.info("email archive derived", extra={"assetId": source.get("assetId"),
                                                        "files": len(files), "files_created": created})
        except (ValueError, RuntimeError, AssetFetchError, TimeoutError) as exc:
            logger.warning("email archive derivation failed",
                           extra={"assetId": source.get("assetId"), "error": str(exc)})
        finally:
            progress.phase = phase
            await progress.send(force=True)

    email_tables: dict[str, dict] = {}

    async def prepare_table(source: dict, options: dict | None, data: Any, artifact: Path) -> dict:
        """The prepared dataset of one source. An e-mail archive's three tables come from one read
        of the archive, shared by every mapping of it in this run."""
        if prepare is None and is_email_archive(source.get("mimeType")) and isinstance(data, Path):
            from app.datasource.datasets import dataset_id
            from app.datasource.email_archive import selected_sheet
            from app.datasource.parser_sandbox import prepare_email_tables_subprocess

            key = str(data)
            if key not in email_tables:
                email_tables[key] = await asyncio.to_thread(
                    prepare_email_tables_subprocess, source, data, data.parent / f"{data.stem}-tables",
                    limits=source_limits(limits, source))
            table = email_tables[key][selected_sheet(options)]
            await asyncio.to_thread(shutil.copyfile, table["path"], artifact)
            return {**{name: table[name] for name in ("rowCount", "columns", "sizeBytes", "contentHash")},
                    "datasetId": dataset_id(source, options)}
        result = await asyncio.to_thread(
            prepare or partial(prepare_dataset_subprocess, limits=limits), source, options, data, artifact)
        # The parser answers with the preview and the prepared dataset beside it.
        return result["dataset"] if isinstance(result, dict) and isinstance(result.get("dataset"), dict) else result

    def tabular_cache_key(entry: dict, options: dict | None, asset_ref: dict, content_digest: str | None) -> str:
        """Over everything that decides a sheet's reading: the file (its version, else its bytes),
        the mapping and the concept."""
        from app.persistence.extraction_cache import extraction_cache_key
        return extraction_cache_key({
            # A changed file reader reads the table again (reading a table is cheap).
            "engine": TABULAR_READ_VERSION, "reader": reader_version(),
            "modelId": str(command_dump.get("modelId") or ""),
            "concept": compiled["concepts"][entry["conceptId"]], "conceptId": entry["conceptId"],
            "columnMapping": entry["columnMapping"], "constantMapping": entry.get("constantMapping", {}),
            "options": answer_options(options), "mappingVersion": entry["mappingVersion"],
            "labelField": entry.get("labelField"), "assetRef": asset_ref,
            # None when the version identifies the file, so that key is found before fetching it.
            "content": content_digest,
            # A reading cut at the old limit must not be reused once the limit changes.
            "recordCap": source_record_cap(limits, entry),
            # Only present with a recipe, so a sheet without one keeps its cached reading.
            **({"fieldRecipes": entry["fieldRecipes"]} if entry.get("fieldRecipes") else {}),
            **({"fieldExtractions": entry["fieldExtractions"], "aiExtraction": ai_extraction}
               if entry.get("fieldExtractions") else {})})

    async def derivation_done(source: dict) -> bool:
        """False while an archive still has to be copied into the workspace, which needs its bytes."""
        if source.get("indexInWorkspace") is not True or not is_email_archive(source.get("mimeType")):
            return True
        key = derivation_cache_key(source)
        return key is not None and await extraction_cache.get(key) is not None

    async def reuse_reading(entry: dict, cached: dict) -> bool:
        """Take a sheet's earlier reading as this run's; False when it is not usable."""
        nonlocal complete_enumeration
        if not isinstance(cached.get("outputs"), list):
            return False
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
        return True

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
                asset_ref = resolve_asset_ref(source)
            except ValueError as exc:
                return {"ok": False, "errorCode": str(exc) or "invalid_source"}
            # A sheet whose file, mapping and concept are unchanged yields what it yielded last time.
            cache_key = None
            cached = None
            if extraction_cache is not None and asset_ref["assetVersionId"].startswith(("sha256:", "md5:")):
                # The version is the file's content fingerprint, so an unchanged sheet is found
                # without downloading it; the back end is still asked to confirm the version and access.
                cache_key = tabular_cache_key(entry, options, asset_ref, None)
                cached = await extraction_cache.get(cache_key)
                if cached is not None and await derivation_done(source):
                    try:
                        async with asyncio.timeout(ASSET_FETCH_WALL_SECONDS):
                            await (metadata_fetch or fetch_workspace_asset_metadata)(source, actor)
                    except AssetFetchError as exc:
                        return {"ok": False, "errorCode": exc.code}
                    if await reuse_reading(entry, cached):
                        continue
            try:
                if is_email_archive(source.get("mimeType")):
                    data = await fetch_archive(source)
                else:
                    async with asyncio.timeout(ASSET_FETCH_WALL_SECONDS):
                        data = await (fetch or fetch_workspace_asset)(source, actor)
            except AssetFetchError as exc:
                return {"ok": False, "errorCode": exc.code}
            if extraction_cache is not None and cache_key is None:
                # No version to trust: the fetched bytes name the file.
                if isinstance(data, Path):
                    content_digest = await asyncio.to_thread(_file_sha256, data)
                else:
                    content = data if isinstance(data, (bytes, bytearray)) else str(data).encode("utf-8")
                    content_digest = hashlib.sha256(content).hexdigest()
                cache_key = tabular_cache_key(entry, options, asset_ref, content_digest)
                cached = await extraction_cache.get(cache_key)
            # Fetched anyway (the archive was not yet copied into the workspace): the reading still stands.
            if cached is not None and await reuse_reading(entry, cached):
                continue
            temp_root = os.environ.get("SEMANTIC_TASK_TEMP_DIR")
            records = gaps = 0
            outputs: list[dict] = []
            sheet_complete = True
            try:
                with tempfile.TemporaryDirectory(prefix="semantic-populate-",
                                                 dir=temp_root) as directory:
                    artifact = Path(directory) / "dataset.parquet"
                    await progress.advance("opening", 0, None)
                    manifest = await prepare_table(source, options, data, artifact)
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
                    # A row expanded into items: its fields may read an item (`@item`), which is not a column.
                    expand = None
                    if (options or {}).get("expand"):
                        expand = normalize_expand(options["expand"], {options["expand"].get("field")})
                        expand_column = (resolve_column(expand["field"], available)
                                         if isinstance(available, list) else expand["field"])
                        if isinstance(available, list) and expand_column not in available:
                            raise ValueError("expand_column_missing")
                    columns = sorted({column for column in set(mapping) | recipe_inputs | extraction_inputs
                                      if not is_item_attribute(column)}
                                     | ({expand_column} if expand else set()) | {SHEET_ROW_KEY})
                    concept = compiled["concepts"][entry["conceptId"]]
                    # Fields read out of a cell's text, as a document's: rules on every row, AI on a bounded few.
                    cell_settings = normalize_ai_settings((options or {}).get("aiSettings"))
                    pacing = ai_pacing(limits, cell_settings)
                    cells = CellReader(extractions, {
                        "conceptId": entry["conceptId"], "conceptLabel": concept.get("label") or entry["conceptId"],
                        "source": source, "assetRef": asset_ref, "mappingVersion": entry["mappingVersion"],
                        "modelId": str(command_dump.get("modelId") or ""), "aiExtraction": ai_extraction,
                        "settings": cell_settings},
                        cache=extraction_cache, ai_rows=pacing["aiRows"],
                        concurrency=pacing["concurrency"], progress=progress) if extractions else None
                    row_total = manifest.get("rowCount") if isinstance(manifest, dict) else None
                    row_total = row_total if isinstance(row_total, int) else None
                    await progress.advance("rows", 0, row_total)
                    missing_cells: dict[str, int] = {}
                    read_rows = 0
                    offset = 0
                    while True:
                        page = await asyncio.to_thread(
                            query or query_parquet, artifact, columns=columns,
                            limit=QUERY_ROW_LIMIT, offset=offset)
                        constants = entry.get("constantMapping", {})
                        raws = page["rows"]
                        # The mapping's (else the admin's) per-source limit: the rest of the sheet is left unread.
                        record_cap = source_record_cap(limits, entry)
                        capped = len(raws) > record_cap - records
                        if capped:
                            raws = raws[:max(0, record_cap - records)]
                            complete_enumeration = sheet_complete = False
                        expand_gaps: list = []
                        if expand:
                            raws, expand_gaps = expand_rows(raws, expand, lambda raw: raw.get(expand_column),
                                                            lambda raw: raw.get(SHEET_ROW_KEY))
                        rows = []
                        for raw in raws:
                            renamed: dict = {"_row": raw.get(SHEET_ROW_KEY), **constants,
                                             **({"_item": raw["_item"]} if "_item" in raw else {})}
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
                                cell_evidence[(renamed["_row"], renamed.get("_item"))] = outcome["evidence"]
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
                            item = assertion["evidence"].get("item")
                            found = cell_evidence.get((assertion["evidence"].get("rowNumber"), item), {}).get(assertion["attribute"])
                            if found is not None:
                                assertion["evidence"] = found
                                if item is not None and is_item_attribute(found.get("column")):
                                    # Read out of an item: the cell is the expanded column's, the span the item's.
                                    found.pop("span", None)
                                    assertion["evidence"] = {**found, "column": expand_column, "item": item,
                                                             "itemField": found["column"]}
                            elif assertion["attribute"] in joined_sources:
                                # A recipe joining several columns or fields: every one it read.
                                assertion["evidence"]["recipeSources"] = joined_sources[assertion["attribute"]]
                        if expand_gaps:
                            output["gaps"].extend({**gap, "conceptId": entry["conceptId"], "assetRef": asset_ref}
                                                  for gap in expand_gaps)
                            output["counts"]["gaps"] = len(output["gaps"])
                        if cells is not None and (capped or page["returnedRows"] < QUERY_ROW_LIMIT):
                            output["gaps"].extend(cell_gaps(entry["conceptId"], asset_ref, extractions,
                                                            missing_cells, read_rows, cells.stats))
                            output["counts"]["gaps"] = len(output["gaps"])
                        per_concept.setdefault(entry["conceptId"], []).append(output)
                        outputs.append(output)
                        records += len(output["entities"])
                        gaps += len(output["gaps"])
                        offset += page["returnedRows"]
                        await progress.advance("rows", offset, row_total)
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
            if cache_key is not None and not ai_failed:
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
    rerun = {derivation["derivationId"] for derivation in validated["derivations"]}
    carried_links: list[dict] = []
    if carried is not None:
        read_concepts = set(per_concept) | ({carried["conceptId"]} if carried.get("conceptId") else set())
        rerun = derivations_to_rerun(validated["derivations"], read_concepts, carried.get("conceptId"))
        carried_links = carry_over(merged_by_concept, carried, read_concepts, rerun, validated["derivations"],
                                   {entry["conceptId"] for entry in validated["sources"]
                                    if entry.get("sourceKind") == "manual"})
        read_assets = {str(asset) for observation in observations
                       if (asset := (observation.get("assetRef") or {}).get("assetId"))}
        observations.extend(observation for observation in carried.get("sourceObservations", [])
                            if (observation.get("assetRef") or {}).get("assetId") not in read_assets)
        # The kept data is part of this result, so a refresh of the same sources over other data differs.
        dataset_fingerprints.add(f"carried:{carried['revisionId']}")
        complete_enumeration = complete_enumeration and carried.get("completeEnumeration", True)
    # Concepts made from another concept's records, once every source has been read.
    derived_links: list[dict] = []
    for derivation in validated["derivations"]:
        if derivation["derivationId"] not in rerun:
            continue
        source = merged_by_concept.get(derivation["sourceConceptId"])
        if source is None:
            continue
        target = compiled["concepts"][derivation["conceptId"]]
        # Shown as its own step: AI reading a concept made from another one can take a while.
        progress.phase = "making"
        progress.current = {"name": target.get("label") or derivation["conceptId"], "conceptId": derivation["conceptId"]}
        await progress.send(force=True)
        # Fields read out of a source field's text (rules, AI), taken by a recipe or fixed, with the
        # same readers as a sheet cell; a field copied as it is needs no reading.
        # A derivation expanding a field reads one item record per item (each recipient of a message).
        items, expand_gaps = derivation_items(derivation, source["entities"])
        read = await read_derived_fields(derivation, items, {
            "conceptId": derivation["conceptId"], "conceptLabel": target.get("label") or derivation["conceptId"],
            "source": {"assetId": f"derived:{derivation['derivationId']}",
                       "originalName": compiled["concepts"][derivation["sourceConceptId"]].get("label")
                       or derivation["sourceConceptId"]},
            "assetRef": {}, "modelId": str(command_dump.get("modelId") or ""), "aiExtraction": ai_extraction},
            cache=extraction_cache, limits=limits, progress=progress)
        derived = derive_concept(target, derivation, items, source["assertions"], read["readings"],
                                 max_entities=max(limits["maxRecordsPerSource"], MAX_MATERIALIZED_ENTITIES),
                                 max_assertions=max(limits["maxValuesPerRun"], MAX_ASSERTIONS))
        relation_id = (derivation.get("expand") or {}).get("relationId")
        if relation_id:
            forward = compiled["relations"][relation_id]["sourceConceptId"] == derivation["sourceConceptId"]
            derived_links.extend({"relationId": relation_id,
                                  "sourceEntityId": link["sourceEntityId"] if forward else link["targetEntityId"],
                                  "targetEntityId": link["targetEntityId"] if forward else link["sourceEntityId"],
                                  "matchingStrategy": "derived"} for link in derived["links"])
        if read["gaps"] or expand_gaps:
            derived["gaps"].extend(read["gaps"] + expand_gaps)
            derived["counts"]["gaps"] = len(derived["gaps"])
        # A concept made from another one reads no file: its records still show in the run's figures.
        progress.records += len(derived["entities"])
        progress.gaps += len(derived["gaps"])
        await progress.send(force=True)
        merged_by_concept[derivation["conceptId"]] = merge_derived(
            merged_by_concept.get(derivation["conceptId"]), derived)
        for key in counts:
            counts[key] += derived["counts"].get(key, 0)
    if progress.phase == "making":
        await progress.enter("linking")
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
    # Links grow with records: a run allowed more records may keep proportionally more links.
    max_relationships = max(MAX_TOTAL_RELATIONSHIPS, 2 * limits["maxRecordsPerRun"])
    relationships: list[dict] = []
    for binding in validated["relationBindings"]:
        relation = compiled["relations"][binding.get("relationId")]
        reference = binding["referenceField"]
        target = binding["targetField"]
        # One link past the cap is enough to know the cap is hit (below): no more are built.
        matched = match_relationships(
            relation,
            trimmed.get(relation["sourceConceptId"], []),
            trimmed.get(relation["targetConceptId"], []),
            reference, target, budget=max(0, max_relationships + 1 - len(relationships)))
        relationships.extend(matched["relationships"])
        gaps.extend(matched["gaps"])
    relationships.extend(link for link in derived_links
                         if link["sourceEntityId"] in kept_ids and link["targetEntityId"] in kept_ids)
    relationships.extend(manual_relationships(kept, manual_links, compiled["relations"]))
    if carried_links:
        made = {(link["relationId"], link["sourceEntityId"], link["targetEntityId"]) for link in relationships}
        relationships.extend(link for link in carried_links
                             if link["sourceEntityId"] in kept_ids and link["targetEntityId"] in kept_ids
                             and (link["relationId"], link["sourceEntityId"], link["targetEntityId"]) not in made)
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


def derivations_to_rerun(derivations: list[dict], read_concepts: set[str],
                         refreshed_concept: str | None = None) -> set[str]:
    """The derivations a concept refresh makes again: those making the refreshed concept (from the kept
    records of the concept it is made from), those reading a refreshed concept, and so on down."""
    refreshed = set(read_concepts)
    rerun: set[str] = {derivation["derivationId"] for derivation in derivations
                       if refreshed_concept and derivation["conceptId"] == refreshed_concept}
    refreshed.update(derivation["conceptId"] for derivation in derivations if derivation["derivationId"] in rerun)
    changed = True
    while changed:
        changed = False
        for derivation in derivations:
            if derivation["derivationId"] not in rerun and derivation["sourceConceptId"] in refreshed:
                rerun.add(derivation["derivationId"])
                refreshed.add(derivation["conceptId"])
                changed = True
    return rerun


def _derivation_of(item: dict, key: str) -> str | None:
    derived_from = (item.get(key) or {}).get("derivedFrom")
    return derived_from.get("derivationId") if isinstance(derived_from, dict) else None


def carry_over(merged_by_concept: dict[str, dict], carried: dict, read_concepts: set[str],
               rerun: set[str], derivations: list[dict], manual_concepts: set[str]) -> list[dict]:
    """Keep, from the data in use, what a concept refresh does not make again.

    A record read from a source is kept unless its concept was read again; a record a derivation made
    is kept unless that derivation runs again. Values a rerun derivation filled into a kept record are
    dropped, so the derivation fills them afresh. Returns the links to keep: those made by derivations
    or typed by people, which the run does not match again itself.
    """
    read_values: set[str] = set()  # records holding a value read from a source, not derived
    for assertion in carried.get("assertions", []):
        if _derivation_of(assertion, "evidence") is None:
            read_values.add(assertion["entityId"])
    entities_by_id: dict[str, dict] = {}
    direct: dict[str, list[dict]] = {}
    derived: dict[str, list[dict]] = {}
    for entity in carried.get("entities", []):
        derivation_id = _derivation_of(entity, "provenance")
        if derivation_id is not None and not (derivation_id in rerun and entity["entityId"] in read_values):
            if derivation_id in rerun:
                continue
            derived.setdefault(entity["conceptId"], []).append(entity)
        elif entity["conceptId"] in read_concepts:
            continue
        else:
            # A record a source gave and a rerun derivation completed keeps what the source gave.
            if derivation_id is not None:
                entity["provenance"] = {key: value for key, value in entity["provenance"].items()
                                        if key != "derivedFrom"}
            direct.setdefault(entity["conceptId"], []).append(entity)
        entities_by_id[entity["entityId"]] = entity
    values: dict[str, list[dict]] = {}
    for assertion in carried.get("assertions", []):
        entity = entities_by_id.get(assertion["entityId"])
        if entity is None:
            continue
        if _derivation_of(assertion, "evidence") in rerun:
            entity["attributes"].pop(assertion["attribute"], None)
            continue
        values.setdefault(assertion["entityId"], []).append(assertion)

    def part(entities: list[dict]) -> dict:
        return {"entities": entities, "gaps": [], "counts": {},
                "assertions": [assertion for entity in entities for assertion in values.get(entity["entityId"], [])]}

    for concept_id, entities in direct.items():
        merged_by_concept[concept_id] = part(entities)
    for concept_id, entities in derived.items():
        merged_by_concept[concept_id] = merge_derived(merged_by_concept.get(concept_id), part(entities))
    concept_of = {entity["entityId"]: entity["conceptId"] for entity in carried.get("entities", [])}
    rerun_relations = {relation for derivation in derivations if derivation["derivationId"] in rerun
                       and (relation := (derivation.get("expand") or {}).get("relationId"))}
    kept: list[dict] = []
    for link in carried.get("relationships", []):
        strategy = link.get("matchingStrategy")
        if strategy == "derived" and link["relationId"] not in rerun_relations:
            kept.append(link)
        elif strategy == "manual" and not ({concept_of.get(link["sourceEntityId"]),
                                             concept_of.get(link["targetEntityId"])} & manual_concepts):
            kept.append(link)
    return kept


async def load_carried_data(pool, command_dump: dict) -> dict | None:  # type: ignore[no-untyped-def]
    """The data in use a concept refresh keeps; None when the model has none yet."""
    from app.persistence.population_store import (get_active_binding, get_revision_reading,
                                                  list_revision_assertions, list_revision_entities,
                                                  list_revision_relationships)

    model_id = str(command_dump.get("modelId") or command_dump.get("model_id") or "")
    current = await get_active_binding(pool, model_id, "draft") if model_id else None
    if current is None:
        return None
    revision_id = current["data_revision_id"]
    payload = command_dump.get("payload") or {}
    reading = await get_revision_reading(pool, revision_id)
    return {"revisionId": revision_id, "conceptId": (payload.get("scope") or {}).get("conceptId"),
            "entities": await list_revision_entities(pool, revision_id, limit=1_000_000),
            "assertions": await list_revision_assertions(pool, revision_id),
            "relationships": await list_revision_relationships(pool, revision_id, limit=1_000_000),
            **reading}


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
    after = await list_revision_entities(pool, revision_id, limit=1_000_000)
    if is_concept_refresh(command_dump):
        # Sources of the concepts kept as they were are still in use, though this run did not read them.
        current_assets |= {asset for entity in after for asset in _entity_assets(entity)}
    return compare_revisions(await list_revision_entities(pool, previous_id, limit=1_000_000),
                             after, current_assets)


def is_concept_refresh(command_dump: dict) -> bool:
    payload = command_dump.get("payload", {})
    return payload.get("purpose") == "build" and (payload.get("scope") or {}).get("kind") == "concept"


def is_whole_model_build(command_dump: dict) -> bool:
    """A build whose result is the model's whole data: a full build, or a concept refresh, which
    carries every other concept over from the data in use."""
    payload = command_dump.get("payload", {})
    return payload.get("purpose") == "build" and (payload.get("scope") or {}).get("kind") in ("model", "concept")


async def has_draft_binding(pool, command_dump: dict) -> bool:  # type: ignore[no-untyped-def]
    """Whether the model already serves a draft graph that a partial result could replace."""
    from app.persistence.population_store import get_active_binding

    model_id = str(command_dump.get("modelId") or command_dump.get("model_id") or "")
    return bool(model_id) and await get_active_binding(pool, model_id, "draft") is not None


async def finalize_whole_model_build(pool, command_dump: dict,  # type: ignore[no-untyped-def]
                                     revision_id: str, progress: PopulationProgress | None = None) -> dict | None:
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
        # The graph is written on the AGE connection; progress reports on the worker's own pool.
        return await finalize_draft_revision(
            pool, age_pool, revision_id, progress.advance if progress is not None else None,
            batch_rows=run_limits(command_dump.get("payload"))["projectionBatchRows"])
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


def saved_rows_reporter(progress: PopulationProgress, total: int):  # type: ignore[no-untyped-def]
    """A ``SaveBudget.on_rows`` that reports the rows stored so far of ``total`` as one step."""
    saved = 0

    async def on_rows(count: int) -> None:
        nonlocal saved
        saved += count
        await progress.advance("entries", saved, total)

    return on_rows


async def persist_population_revision(pool, command_dump: dict, outcome: dict,
                                      progress: PopulationProgress | None = None) -> str:
    """Persist a computed population as an inert data revision (P6A, P6.16).

    ``progress`` is told after each written batch how many of all the rows (records, values and
    links) are stored; it reports on the worker's pool, outside the save connection's writes.

    Idempotent (ON CONFLICT DO NOTHING): a retried task re-stores the same
    revision without duplicates. The revision is inert until an explicit
    activation swaps the serving binding, so a stored-but-uncompleted task
    leaves serving state untouched.
    """
    from app.persistence.population_store import (SaveBudget, create_data_revision, list_model_corrections,
                                                  mirror_specification,
                                                  model_correction_sequence,
                                                  model_reset_generation, revision_id_for,
                                                  save_connection,
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
        outcome = apply_corrections(outcome, await list_model_corrections(pool, model_id, correction_sequence))
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
    # The admin's batch size and time per batch; the pool's own 10 s limit would cut a large run short.
    limits = run_limits(payload)
    entities = outcome.get("entities", [])
    split = on_rows = None
    if progress is not None:
        from app.persistence.population_store import split_assertions

        split = split_assertions(outcome.get("assertions", []))
        on_rows = saved_rows_reporter(
            progress, len(entities) + len(split[0]) + len(split[1]) + len(outcome.get("relationships", [])))
    budget = SaveBudget(rows=limits["saveBatchRows"], seconds=limits["saveStatementSeconds"], on_rows=on_rows)
    async with save_connection(pool, budget) as connection:
        await store_entities(connection, model_id=model_id, revision_id=revision_id,
                             entities=entities, budget=budget)
        await store_assertions(connection, model_id=model_id, revision_id=revision_id,
                               assertions=outcome.get("assertions", []), budget=budget, split=split)
        await store_relationships(connection, model_id=model_id, revision_id=revision_id,
                                  relationships=outcome.get("relationships", []), budget=budget)
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
        carried = await load_carried_data(pool, lease.payload) if is_concept_refresh(lease.payload) else None
        try:
            if is_concept_refresh(lease.payload) and carried is None:
                # Nothing to keep: one concept alone would replace the whole model's data.
                outcome = {"ok": False, "errorCode": "no_data_in_use"}
            else:
                outcome = await run_population_for_task(
                    lease.payload, manual_pool=pool, progress=progress,
                    extraction_cache=DocumentExtractionCache(pool, model_id) if model_id else None,
                    carried=carried)
            if outcome.get("ok") and outcome.get("purpose") != "preview":
                # The last chance to stop: after this the new data is saved.
                await progress.enter("saving")
            if await repository.cancel_requested(lease.job_id):
                raise RunCancelled()
            # Past the last chance to stop: the saving reports below never end the run.
            progress.cancellable = False
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

            revision_id = await persist_population_revision(pool, lease.payload, outcome, progress)
            persisted = await count_revision_rows(pool, revision_id)
            result = summarize_job_result(revision_id, outcome, persisted)
            # Measured against the data in use before this result can replace it.
            if is_whole_model_build(lease.payload):
                # Loads both revisions' records to compare them: a phase of its own, with no count.
                await progress.enter("comparing")
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
                if is_whole_model_build(lease.payload):
                    try:
                        await progress.enter("projecting")
                    except RunCancelled:
                        pass  # Already saved: a late stop request changes nothing.
                finalized = await finalize_whole_model_build(pool, lease.payload, revision_id, progress)
                if finalized is not None:
                    result.update({"projectionRef": finalized["projectionRef"],
                                   "boundEnvironment": finalized["environment"]})
                    # The new draft data gets its search index in its own job; a failure
                    # here never fails the build (reads request it again).
                    from app.graph_search.indexer import request_index_quietly
                    from app.graph_search.settings import IndexBuildSettings
                    from app.jobs.service import JobService

                    # The admin's index build knobs ride on the run (they never enter its fingerprint).
                    build = index_build_limits((lease.payload.get("payload") or {}).get("limits"))
                    await request_index_quietly(pool, JobService(repository).admit, revision_id,
                                                build=IndexBuildSettings.model_validate(build) if build else None)
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


# Changes each time a worker process starts: a lease under another boot id of the same
# node was left by a process that is gone (see release_abandoned_leases).
WORKER_BOOT_ID = uuid.uuid4().hex


def node_lease_prefix(hostname: str | None) -> str:
    return f"population-worker:{hostname or 'unknown'}:"


def lease_owner_for(hostname: str | None) -> str:
    return f"{node_lease_prefix(hostname)}{WORKER_BOOT_ID}:{uuid.uuid4().hex}"


async def _release_abandoned_leases(hostname: str) -> int:
    import os

    import asyncpg

    from app.persistence.postgres_jobs import PostgresJobRepository

    pool = await asyncpg.create_pool(os.environ["SEMANTIC_RUNTIME_DATABASE_URL"], min_size=1, max_size=1,
                                     command_timeout=10)
    try:
        prefix = node_lease_prefix(hostname)
        return await PostgresJobRepository(pool).release_abandoned_leases(
            node_prefix=prefix, boot_prefix=f"{prefix}{WORKER_BOOT_ID}:")
    finally:
        await pool.close()


@worker_ready.connect
def release_abandoned_leases(sender=None, **_kwargs) -> None:  # type: ignore[no-untyped-def]
    """A restarted worker hands back the runs its previous process was reading.

    Without this, a run asked to stop while its worker was restarted shows "Stopping"
    until its lease runs out (up to 15 minutes), and an unstopped one waits as long to
    be read again.
    """
    import asyncio

    hostname = getattr(sender, "hostname", None)
    if not hostname:
        return
    try:
        released = asyncio.run(_release_abandoned_leases(str(hostname)))
        if released:
            logger.info("Released runs left by this worker's previous process",
                        extra={"released": released})
    except Exception as exc:  # recovery still ends them when their lease runs out
        logger.warning("Releasing abandoned population leases failed",
                       extra={"error_code": type(exc).__name__[:100]})


@celery_app.task(bind=True, name="semantic-model-population.run", queue=POPULATION_QUEUES[1])
def populate_model(self, task_id: int) -> dict:  # type: ignore[no-untyped-def]
    import asyncio
    import os

    if isinstance(task_id, bool) or not isinstance(task_id, int):
        return {"ok": False, "errorCode": "invalid_task_reference"}
    max_attempts = max_attempts_from_env(os.environ.get("SEMANTIC_TASK_MAX_ATTEMPTS"))
    retry_seconds = retry_seconds_from_env(os.environ.get("SEMANTIC_TASK_RETRY_SECONDS"))
    try:
        return asyncio.run(_run_task(task_id, lease_owner_for(self.request.hostname)))
    except Exception as exc:
        logger.warning("Semantic population task failed, scheduling bounded retry",
                       extra={"error_code": type(exc).__name__[:100]})
        raise self.retry(exc=exc, countdown=retry_seconds, max_retries=max_attempts)
