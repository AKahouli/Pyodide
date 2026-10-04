"""Datasource worker entry point (Phase 3).

Heavy parser libraries stay lazily imported inside task bodies, so importing
the API never initializes them (see ``test_api_skeleton``). The Celery task
claims the durable ``semantic_jobs`` lease, runs the pure deterministic
domain in :mod:`app.datasource.discovery`, then completes with fencing.
Only task references cross RabbitMQ; canonical inputs stay in PostgreSQL.
"""

from __future__ import annotations

import logging
import hashlib
import json

from app.datasource.email_archive import resolve_column
from app.jobs.recovery import max_attempts_from_env, retry_seconds_from_env

from .celery_app import DATASOURCE_QUEUES, celery_app

logger = logging.getLogger(__name__)
ASSET_FETCH_WALL_SECONDS = 35


def build_mapping_preview(profile: dict, draft: object) -> dict | None:
    """Resolve a bounded UI sample without exposing parser-sized data to NestJS."""
    if not isinstance(draft, dict):
        return None
    mappings = draft.get("fieldMappings")
    identities = draft.get("identityFields", [])
    if not isinstance(mappings, list) or not isinstance(identities, list):
        return None
    limit = draft.get("limit", 50)
    limit = min(limit, 50) if isinstance(limit, int) and not isinstance(limit, bool) else 50
    samples = profile.get("samples", [])
    profiles = profile.get("fieldProfiles", [])
    extractions, extraction_warning = _cell_extractions(mappings)
    recipes, recipe_warning = _row_recipes(mappings, set(extractions))
    entities, seen = [], set()
    null_skipped = duplicate_skipped = 0
    for row in samples if isinstance(samples, list) else []:
        if not isinstance(row, dict) or len(entities) >= limit:
            continue
        values, fields = shape_row(mappings, extractions, recipes, row)
        identity = [("" if values.get(key) is None else str(values[key])).strip().lower() for key in identities]
        if identities and any(not value for value in identity):
            null_skipped += 1
            continue
        key_source = "\0".join(identity) if identities else json.dumps(values, sort_keys=True, default=str)
        entity_key = hashlib.sha256(key_source.encode()).hexdigest()[:16]
        if entity_key in seen:
            duplicate_skipped += 1
            continue
        seen.add(entity_key)
        label = next((str(values.get(key)) for key in identities if values.get(key) is not None), "")
        if not label and values:
            label = str(next(iter(values.values())) or "")
        entities.append({"entityKey": entity_key, "label": label, "values": values,
                         "provenance": {"rowNumber": row.get("__sheetRow"), "fields": fields}})
    evidence = []
    for target in identities:
        source = next((item.get("sourceField") for item in mappings
                       if isinstance(item, dict) and item.get("targetAttribute") == target), None)
        names = {item.get("name") for item in profiles if isinstance(item, dict)}
        source = resolve_column(source, names) if isinstance(source, str) else source
        match = next((item for item in profiles
                      if isinstance(item, dict) and item.get("name") == source), None)
        if match:
            evidence.append({**match, "name": target})
    warnings = [item.get("message") for item in profile.get("warnings", [])
                if isinstance(item, dict) and isinstance(item.get("message"), str)]
    if recipe_warning:
        warnings.append(recipe_warning)
    if extraction_warning:
        warnings.append(extraction_warning)
    elif any(spec["extractionStrategy"] == "ai" for spec in extractions.values()):
        warnings.append("Fields read with AI are left empty here: try them in each field's result preview.")
    return {"entities": entities,
            "stats": {"scannedRows": len(samples), "resolvedEntities": len(entities),
                      "duplicateKeysSkipped": duplicate_skipped,
                      "nullIdentitySkipped": null_skipped},
            "identityEvidence": evidence, "warnings": warnings}


def shape_row(mappings: list, extractions: dict, recipes: dict, row: dict) -> tuple[dict, dict]:
    """One sheet row's field values as a run reads them, without AI: a column as it is, a fixed value,
    a value read out of a cell by rules, then the recipes. Says per field how it was read and, for a
    recipe, the columns or fields it read."""
    from app.population.cell_fields import cell_text, extraction_columns, read_row_rules
    from app.population.computed_fields import apply_row_recipes, recipe_sources

    values: dict[str, object] = {}
    fields: dict[str, dict] = {}
    for mapping in mappings:
        if not isinstance(mapping, dict) or mapping.get("mode") == "ignore":
            continue
        target = mapping.get("targetAttribute")
        if not isinstance(target, str) or not target:
            continue
        if mapping.get("mode") == "constant":
            values[target] = mapping.get("constantValue")
            fields[target] = {"method": "fixed_value"}
        elif mapping.get("mode") == "direct" and isinstance(mapping.get("sourceField"), str):
            column = resolve_column(mapping["sourceField"], row)
            values[target] = row.get(column)
            fields[target] = {"method": "direct_mapping", "reference": column}
    # Fields read out of a cell by rules, as a run reads them; AI is only run by the field preview.
    if extractions:
        cells = {column: cell_text(row.get(resolve_column(column, row))) for column in extraction_columns(extractions)}
        read = read_row_rules(extractions, cells, row_number=row.get("__sheetRow"))
        for target, spec in extractions.items():
            values[target] = read["values"].get(target)
            found = read["evidence"].get(target)
            fields[target] = {"method": "semantic_extraction",
                              **({"reference": spec["column"]} if spec.get("column") else {}),
                              **({"quote": found["quote"]} if found and found.get("quote") else {})}
    # The same recipes as a run, before the identity is read.
    if recipes:
        apply_row_recipes(recipes, values, row, lambda name: resolve_column(name, row))
        for target, spec in recipes.items():
            sources = recipe_sources(spec)
            fields[target] = {**{key: value for key, value in fields.get(target, {}).items() if key != "quote"},
                              "method": fields.get(target, {}).get("method", "direct_mapping"), "sources": sources}
            if len(sources) == 1 and spec["input"]["kind"] == "column":
                fields[target]["reference"] = resolve_column(sources[0], row)
    return values, fields


def shape_sheet_rows(mappings: list, rows: list) -> dict:
    """Sample rows of a sheet shaped as a run would (no AI): values and how each was read, per row."""
    extractions, extraction_warning = _cell_extractions(mappings)
    recipes, recipe_warning = _row_recipes(mappings, set(extractions))
    shaped = []
    for row in rows:
        values, fields = shape_row(mappings, extractions, recipes, row)
        shaped.append({"rowNumber": row.get("__sheetRow"), "values": values, "fields": fields})
    warnings = [warning for warning in (recipe_warning, extraction_warning) if warning]
    if not extraction_warning and any(spec["extractionStrategy"] == "ai" for spec in extractions.values()):
        warnings.append("Fields read with AI are left empty in this preview: they are read when the data is updated.")
    return {"rows": shaped, "warnings": warnings}


def _row_recipes(mappings: list, extracted: set | None = None) -> tuple[dict, str | None]:
    """The recipes of the drafted sheet fields (a transformed column, or a field taken from a column or
    another field), or none and why when one cannot be used."""
    from app.population.computed_fields import normalize_row_recipes
    from app.population.document_rules import RuleError

    shaped = [item for item in mappings if isinstance(item, dict) and item.get("mode") in ("direct", "computed")
              and isinstance(item.get("targetAttribute"), str)]
    raw = {item["targetAttribute"]: item["computed"] for item in shaped if item.get("computed") is not None}
    if not raw:
        return {}, None
    try:
        fixed = {item["targetAttribute"] for item in mappings if isinstance(item, dict) and item.get("mode") == "constant"
                 and isinstance(item.get("targetAttribute"), str)}
        return normalize_row_recipes(raw, {item["targetAttribute"] for item in shaped} | fixed | (extracted or set())), None
    except RuleError as exc:
        return {}, f"A field's transformation cannot be used: {exc}"


def _cell_extractions(mappings: list) -> tuple[dict, str | None]:
    """The drafted fields read out of a cell, or none and why when one cannot be used."""
    from app.population.cell_fields import extractions_from_mappings, normalize_field_extractions
    from app.population.document_rules import RuleError

    try:
        return normalize_field_extractions(extractions_from_mappings(mappings)), None
    except RuleError as exc:
        return {}, f"A field's reading rules cannot be used: {exc}"


def with_mapping_preview(result: dict, command_dump: dict) -> dict:
    if not result.get("ok") or not isinstance(result.get("profile"), dict):
        return result
    payload = command_dump.get("payload") if isinstance(command_dump, dict) else None
    draft = payload.get("mappingPreview") if isinstance(payload, dict) else None
    preview = build_mapping_preview(
        {**result["profile"], "fieldProfiles": result.get(
            "fieldProfiles", result["profile"].get("fieldProfiles", []))}, draft
    )
    return {**result, "mappingPreview": preview} if preview is not None else result


def attempts_exhausted(attempt_count: int, max_attempts: int) -> bool:
    return attempt_count > max_attempts


def task_lease_seconds(parser_timeout: int) -> int:
    """Cover fetch, parser wall time, forced termination, and DB completion."""
    return max(120, parser_timeout + ASSET_FETCH_WALL_SECONDS + 25)


def run_discovery_for_payload(command_dump: dict, *, authorize=None,
                              data: bytes | None = None) -> dict:
    """Pure durable-payload entry point (no DB, no I/O). Shared by task/tests.

    Never raises: every deterministic validation failure maps to an
    ``errorCode`` so the worker can fence the task to a terminal state.
    The home workspace comes from the canonical top-level ``JobCommand``
    (``workspaceId``), not just the inner payload, so cross-workspace
    selections cannot bypass authorization when ``homeWorkspaceId`` is
    absent from the inner command.

    Cross-workspace access is authorized at execution time through the
    authoritative ``authorize`` verifier (default: deny). The payload's own
    grant claims are ignored: a queued job may not assert its own permission,
    and a revoked grant must not be resurrected from the payload.
    """
    from app.datasource.discovery import (
        deny_cross_workspace_verifier,
        preview_source,
        requires_cross_workspace_authorization,
    )

    try:
        if not isinstance(command_dump, dict):
            return {"ok": False, "errorCode": "invalid_command"}
        inner = command_dump.get("payload", command_dump)
        if not isinstance(inner, dict):
            return {"ok": False, "errorCode": "invalid_command"}
        source = inner.get("source", inner)
        if not isinstance(source, dict) or "assetId" not in source:
            return {"ok": False, "errorCode": "invalid_command"}
        options = inner.get("options")
        # The canonical top-level JobCommand workspace is the authenticated
        # home and is required: it is never inferred from the payload, and an
        # inner homeWorkspaceId may only repeat it. Omitting or spoofing it
        # cannot skip the execution-time authorization check.
        top_ws = command_dump.get("workspaceId")
        if top_ws is None:
            top_ws = command_dump.get("workspace_id")
        if not isinstance(top_ws, str) or not top_ws:
            return {"ok": False, "errorCode": "workspace_required"}
        inner_ws = inner.get("homeWorkspaceId")
        if inner_ws is not None and (not isinstance(inner_ws, str) or inner_ws != top_ws):
            return {"ok": False, "errorCode": "workspace_forbidden"}
        home_ws = top_ws

        if requires_cross_workspace_authorization(home_ws, source.get("workspaceId")):
            actor = command_dump.get("actorUserId") or inner.get("actorUserId")
            if not isinstance(actor, str) or not actor:
                return {"ok": False, "errorCode": "workspace_forbidden"}
            verifier = authorize or deny_cross_workspace_verifier
            try:
                allowed = bool(verifier(actor_user_id=actor, home_workspace_id=home_ws,
                                        source_workspace_id=source.get("workspaceId", "")))
            except Exception:
                # An unverifiable authorization decision fails closed.
                return {"ok": False, "errorCode": "workspace_forbidden"}
            if not allowed:
                return {"ok": False, "errorCode": "workspace_forbidden"}

        preview = preview_source(source, options if isinstance(options, dict) else None, data)
    except ValueError as exc:
        return {"ok": False, "errorCode": str(exc) or "invalid_source"}
    profile = preview["profile"]
    gaps = profile.get("status") in ("partial", "indexing_required")
    return with_mapping_preview(
        {"ok": True, **preview,
         "jobState": "completed_with_gaps" if gaps else "completed"},
        command_dump,
    )


async def run_discovery_for_task(command_dump: dict, *, fetch=None, upload=None) -> dict:
    """Add execution-time authorized bytes to the otherwise-pure discovery."""
    import asyncio

    from pathlib import Path
    import os
    import tempfile

    from app.datasource.asset_delivery import (AssetFetchError, asset_fetch_wall_seconds,
                                                fetch_workspace_asset, upload_prepared_dataset)
    from app.datasource.parser_sandbox import prepare_dataset_subprocess, run_preview_subprocess

    if not isinstance(command_dump, dict):
        return run_discovery_for_payload(command_dump)
    inner = command_dump.get("payload", command_dump)
    source = inner.get("source", inner) if isinstance(inner, dict) else None
    options = inner.get("options") if isinstance(inner, dict) else None
    if not isinstance(source, dict):
        return run_discovery_for_payload(command_dump)
    authorized_metadata = run_discovery_for_payload(command_dump, authorize=lambda **_: True)
    if not authorized_metadata.get("ok"):
        return authorized_metadata
    metadata_profile = authorized_metadata["profile"]
    is_tabular = metadata_profile.get("structure", {}).get("kind") in {"csv", "xlsx", "email_archive"}
    if metadata_profile.get("status") != "ready" or not is_tabular:
        return run_discovery_for_payload(command_dump)
    actor = command_dump.get("actorUserId") or command_dump.get("actor_user_id")
    if not isinstance(actor, str) or not actor:
        return {"ok": False, "errorCode": "invalid_command"}
    from app.datasource.discovery import is_email_archive

    temp_root = os.environ.get("SEMANTIC_TASK_TEMP_DIR")
    try:
        with tempfile.TemporaryDirectory(prefix="semantic-dataset-", dir=temp_root) as directory:
            # An e-mail archive can be far larger than a workbook: it goes to disk, not memory.
            to_file = {"target": Path(directory) / "source.bin"} if is_email_archive(source.get("mimeType")) else {}
            try:
                async with asyncio.timeout(asset_fetch_wall_seconds(source)):
                    data = await (fetch or fetch_workspace_asset)(source, actor, **to_file)
            except AssetFetchError as exc:
                return {"ok": False, "errorCode": exc.code}
            if to_file:
                # Discovery of an archive previews its first e-mails; the full read happens at population.
                preview = await asyncio.to_thread(
                    run_preview_subprocess, source, options if isinstance(options, dict) else None, data)
                profile = preview["profile"]
                gaps = profile.get("status") in ("partial", "indexing_required")
                return with_mapping_preview(
                    {"ok": True, **preview, "jobState": "completed_with_gaps" if gaps else "completed"},
                    command_dump)
            artifact = Path(directory) / "dataset.parquet"
            preview = await asyncio.to_thread(
                prepare_dataset_subprocess, source,
                options if isinstance(options, dict) else None, data, artifact,
            )
            uploader = upload or upload_prepared_dataset
            async with asyncio.timeout(ASSET_FETCH_WALL_SECONDS):
                await uploader(source, actor, preview["dataset"], artifact)
    except ValueError as exc:
        return {"ok": False, "errorCode": str(exc) or "parser_failed"}
    except AssetFetchError as exc:
        return {"ok": False, "errorCode": exc.code}
    profile = preview["profile"]
    gaps = profile.get("status") in ("partial", "indexing_required")
    return with_mapping_preview(
        {"ok": True, **preview,
         "jobState": "completed_with_gaps" if gaps else "completed"},
        command_dump,
    )


async def _run_task(task_id: int, lease_owner: str) -> dict:
    import asyncpg

    from app.jobs.models import StaleLease
    from app.persistence.postgres_jobs import PostgresJobRepository
    from app.datasource.parser_sandbox import parser_timeout_seconds

    from .celery_app import DATASOURCE_QUEUES as _QUEUES
    import os

    max_attempts = max_attempts_from_env(os.environ.get("SEMANTIC_TASK_MAX_ATTEMPTS"))
    retry_seconds = retry_seconds_from_env(os.environ.get("SEMANTIC_TASK_RETRY_SECONDS"))
    pool = await asyncpg.create_pool(
        os.environ["SEMANTIC_RUNTIME_DATABASE_URL"], min_size=1, max_size=2,
        command_timeout=10,
        server_settings={"application_name": "semantic-model-datasource-worker",
                         "statement_timeout": "10s", "lock_timeout": "2s",
                         "idle_in_transaction_session_timeout": "10s"},
    )
    lease = None
    try:
        repository = PostgresJobRepository(pool)
        lease = await repository.claim_task(task_id=task_id, queue_name=_QUEUES[1],
                                            lease_owner=lease_owner,
                                            lease_seconds=task_lease_seconds(parser_timeout_seconds()))
        if lease is None:
            return {"ok": False, "errorCode": "lease_unavailable"}
        if attempts_exhausted(lease.attempt_count, max_attempts):
            # Bounded redelivery: fence to a terminal failed state instead of
            # rejecting forever after the DB comes back.
            try:
                await repository.complete_task(task_id=task_id, lease_owner=lease_owner,
                                               lease_epoch=lease.lease_epoch, job_state="failed",
                                               result=None, error_code="attempts_exhausted")
            except StaleLease:
                return {"ok": False, "errorCode": "stale_lease"}
            return {"ok": False, "errorCode": "attempts_exhausted"}
        # Deterministic source/parser failures are returned as outcomes. I/O,
        # configuration, backend 5xx, and other infrastructure failures must
        # escape to the requeue path below instead of becoming terminal jobs.
        from app.datasource.discovery import parser_fingerprint, resolve_asset_ref

        inner = lease.payload.get("payload") if isinstance(lease.payload, dict) else None
        source = inner.get("source") if isinstance(inner, dict) else None
        cached = None
        if isinstance(source, dict):
            try:
                fingerprint = resolve_asset_ref(source)["assetVersionId"]
                options = inner.get("options") if isinstance(inner.get("options"), dict) else None
                cached = await repository.get_cached_discovery_profile(
                    lease.payload, fingerprint, parser_fingerprint(options))
            except ValueError:
                pass
        if cached is not None:
            gaps = cached.get("status") in ("partial", "indexing_required")
            outcome = with_mapping_preview(
                {"ok": True, "profile": cached,
                 "fieldProfiles": cached.get("fieldProfiles", []),
                 "jobState": "completed_with_gaps" if gaps else "completed"},
                lease.payload,
            )
        else:
            outcome = await run_discovery_for_task(lease.payload)
        if not outcome.get("ok"):
            try:
                await repository.complete_task(task_id=task_id, lease_owner=lease_owner,
                                               lease_epoch=lease.lease_epoch, job_state="failed",
                                               result=None, error_code=outcome["errorCode"])
            except StaleLease:
                return {"ok": False, "errorCode": "stale_lease"}
            return outcome
        result = {key: value for key, value in outcome.items()
                  if key not in {"ok", "jobState"}}
        try:
            await repository.complete_task(task_id=task_id, lease_owner=lease_owner,
                                           lease_epoch=lease.lease_epoch,
                                           job_state=outcome["jobState"], result=result)
        except StaleLease:
            return {"ok": False, "errorCode": "stale_lease"}
        return {"ok": True, **result, "jobState": outcome["jobState"]}
    except Exception as exc:
        # Infra/control-plane failure after a successful claim: release the
        # lease and reset the outbox row so the next dispatch (or the
        # dispatcher's lease-expiry recovery) reclaims it. If even this fails
        # the lease simply expires and recovery picks it up. Then re-raise so
        # the broker does not treat the delivery as handled.
        if lease is not None:
            try:
                await PostgresJobRepository(pool).requeue_task(
                    task_id=task_id, lease_owner=lease_owner, lease_epoch=lease.lease_epoch,
                    error_code=type(exc).__name__, retry_seconds=retry_seconds)
            except Exception as requeue_exc:
                logger.warning("Semantic discovery requeue failed; lease recovery will retry",
                               extra={"error_code": type(requeue_exc).__name__[:100]})
        raise
    finally:
        await pool.close()


@celery_app.task(bind=True, name="semantic-model-datasource.discover", queue=DATASOURCE_QUEUES[1])
def discover_asset(self, task_id: int) -> dict:  # type: ignore[no-untyped-def]
    import asyncio
    import os
    import uuid

    if isinstance(task_id, bool) or not isinstance(task_id, int):
        # Deterministic invalid reference: ack it, nothing to retry.
        return {"ok": False, "errorCode": "invalid_task_reference"}
    max_attempts = max_attempts_from_env(os.environ.get("SEMANTIC_TASK_MAX_ATTEMPTS"))
    retry_seconds = retry_seconds_from_env(os.environ.get("SEMANTIC_TASK_RETRY_SECONDS"))
    try:
        return asyncio.run(_run_task(task_id, f"datasource-worker:{uuid.uuid4().hex}"))
    except Exception as exc:
        # Infra/control-plane failure. Celery 5.3.6 rejects failure/timeout with
        # requeue=False when acks_on_failure_or_timeout is off, so a bare raise
        # would discard the delivery. self.retry is the only path that
        # genuinely redelivers, and max_retries bounds it so a permanent
        # misconfiguration (for example a missing DSN) cannot loop forever.
        # The dispatcher's lease/outbox recovery covers the case where the
        # retry budget is exhausted. No payloads or secrets are logged.
        logger.warning("Semantic discovery task failed, scheduling bounded retry",
                       extra={"error_code": type(exc).__name__[:100]})
        raise self.retry(exc=exc, countdown=retry_seconds, max_retries=max_attempts)
