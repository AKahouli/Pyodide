"""P6 canonical population persistence (plan 7.1/7.2, P6.1-P6.3).

Parameterized repositories over the runtime-owned ``semantic_runtime`` and
``semantic_population`` schemas. Assertions persist independently from serving
values; activation moves through a compare-and-swap binding so a stale worker
can never flip the serving pointer. All functions take a pool/connection with
asyncpg-style ``fetch/fetchval/fetchrow/execute/executemany``.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from app.persistence.ui_signal_outbox import enqueue_ui_signal


def _json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def revision_id_for(model_version_id: str, execution_fingerprint: str,
                    dataset_fingerprints: list[str], correction_sequence: int,
                    reset_generation: int = 0) -> str:
    """Deterministic data-revision id for a fixed spec, inputs and watermark.

    A model whose data was cleared counts its resets, so its next build is a
    new revision rather than one kept for another environment."""
    from app.population.engine_version import population_engine_version

    body = _json({"modelVersionId": model_version_id,
                  "engine": population_engine_version(),
                  "executionFingerprint": execution_fingerprint,
                  "datasets": sorted(dataset_fingerprints),
                  "correctionSequence": correction_sequence,
                  **({"resetGeneration": reset_generation} if reset_generation else {})})
    return "dr_" + hashlib.sha256(body.encode("utf-8")).hexdigest()[:24]


async def mirror_specification(pool: Any, *, home_workspace_id: str, model_id: str,
                               model_version_id: str, spec_hash: str,
                               specification: dict[str, Any],
                               select_current: bool = False) -> str:
    """Store an immutable snapshot; only admission advances its selection time."""
    row = await pool.fetchrow(
        f"""
        INSERT INTO semantic_runtime.specifications
          (home_workspace_id, model_id, model_version_id, spec_hash, specification)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (home_workspace_id, model_id, model_version_id, spec_hash)
        {"DO UPDATE SET selected_at = clock_timestamp()" if select_current else "DO NOTHING"}
        RETURNING id::text
        """,
        home_workspace_id, model_id, model_version_id, spec_hash, _json(specification),
    )
    if row is not None:
        return row["id"]
    existing = await pool.fetchrow(
        "SELECT id::text, spec_hash FROM semantic_runtime.specifications "
        "WHERE home_workspace_id = $1 AND model_id = $2 AND model_version_id = $3 "
        "AND spec_hash = $4",
        home_workspace_id, model_id, model_version_id, spec_hash,
    )
    if existing is None:
        raise ValueError("specification_conflict")
    return existing["id"]


async def create_data_revision(pool: Any, *, revision_id: str, model_id: str,
                               model_version_id: str, spec_hash: str,
                               execution_fingerprint: str,
                               source_observations: list[dict[str, Any]],
                               correction_sequence: int,
                               coverage: dict[str, Any]) -> str:
    row = await pool.fetchrow(
        """
        INSERT INTO semantic_population.data_revisions
          (id, model_id, model_version_id, spec_hash, execution_fingerprint,
           source_observations, correction_sequence, coverage)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
        """,
        revision_id, model_id, model_version_id, spec_hash, execution_fingerprint,
        _json(source_observations), correction_sequence, _json(coverage),
    )
    return row["id"] if row else revision_id


async def store_entities(pool: Any, *, model_id: str, revision_id: str,
                         entities: list[dict[str, Any]]) -> int:
    if not entities:
        return 0
    await pool.executemany(
        """
        INSERT INTO semantic_population.entities
          (id, model_id, data_revision_id, concept_id, namespace, identity_key,
           label, attributes, provenance)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
        ON CONFLICT (data_revision_id, id) DO NOTHING
        """,
        [(entity["entityId"], model_id, revision_id, entity.get("conceptId", ""),
          entity.get("namespace", ""),
          _json(entity.get("identity", {})), entity.get("label", ""),
          _json(entity.get("attributes", {})), _json(entity.get("provenance", {})))
         for entity in entities],
    )
    return len(entities)


async def store_entity_aliases(pool: Any, *, revision_id: str,
                               aliases: list[dict[str, Any]]) -> int:
    if not aliases:
        return 0
    await pool.executemany(
        """
        INSERT INTO semantic_population.entity_identities
          (entity_id, data_revision_id, alias_namespace, alias_key)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (data_revision_id, alias_namespace, alias_key) DO NOTHING
        """,
        [(alias["entityId"], revision_id, alias["aliasNamespace"], alias["aliasKey"])
         for alias in aliases],
    )
    return len(aliases)


async def store_assertions(pool: Any, *, model_id: str, revision_id: str,
                           assertions: list[dict[str, Any]]) -> int:
    if not assertions:
        return 0
    await pool.executemany(
        """
        INSERT INTO semantic_population.assertions
          (model_id, data_revision_id, entity_id, attribute, value, origin,
           evidence, mapping_version)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
        ON CONFLICT (data_revision_id, entity_id, attribute) DO NOTHING
        """,
        [(model_id, revision_id, assertion["entityId"], assertion["attribute"],
          assertion.get("value"), assertion.get("origin", "source"),
          _json(assertion.get("evidence", {})),
          (assertion.get("evidence", {}) or {}).get("mappingVersion"))
         for assertion in assertions],
    )
    return len(assertions)


async def store_relationships(pool: Any, *, model_id: str, revision_id: str,
                              relationships: list[dict[str, Any]]) -> int:
    if not relationships:
        return 0
    await pool.executemany(
        """
        INSERT INTO semantic_population.relationships
          (model_id, data_revision_id, relation_id, source_entity_id,
           target_entity_id, matching_strategy)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (data_revision_id, relation_id, source_entity_id,
                     target_entity_id) DO NOTHING
        """,
        [(model_id, revision_id, relationship["relationId"],
          relationship["sourceEntityId"], relationship["targetEntityId"],
          relationship.get("matchingStrategy"))
         for relationship in relationships],
    )
    return len(relationships)


async def record_correction(pool: Any, *, model_id: str, model_version_id: str,
                            actor_user_id: str, reason: str, target_identity: dict[str, Any],
                            action: str, payload: dict[str, Any] | None = None,
                            data_revision_id: str | None = None) -> int:
    row = await pool.fetchrow(
        """
        INSERT INTO semantic_population.corrections
          (model_id, model_version_id, actor_user_id, reason, target_identity,
           action, payload, data_revision_id)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8)
        RETURNING sequence
        """,
        model_id, model_version_id, actor_user_id, reason, _json(target_identity),
        action, _json(payload or {}), data_revision_id,
    )
    return int(row["sequence"])


async def model_correction_sequence(pool: Any, model_id: str) -> int:
    value = await pool.fetchval(
        "SELECT COALESCE(MAX(sequence), 0) FROM semantic_population.corrections "
        "WHERE model_id = $1",
        model_id,
    )
    return int(value or 0)


async def list_model_corrections(pool: Any, model_id: str,
                                 limit: int = 5000) -> list[dict[str, Any]]:
    """Every correction of a model in sequence order (undos included)."""
    rows = await pool.fetch(
        "SELECT sequence, model_version_id, actor_user_id, reason, target_identity, "
        "action, payload, created_at FROM semantic_population.corrections "
        "WHERE model_id = $1 ORDER BY sequence LIMIT $2",
        model_id, limit,
    )
    result = []
    for row in rows:
        values = dict(row)
        target = values.get("target_identity") or {}
        payload = values.get("payload") or {}
        created = values.get("created_at")
        result.append({
            "sequence": int(values["sequence"]),
            "modelVersionId": values.get("model_version_id"),
            "actorUserId": values.get("actor_user_id"),
            "reason": values.get("reason") or "",
            "targetIdentity": json.loads(target) if isinstance(target, str) else dict(target),
            "action": values["action"],
            "payload": json.loads(payload) if isinstance(payload, str) else dict(payload),
            "createdAt": created.isoformat() if hasattr(created, "isoformat") else created,
        })
    return result


async def open_review_item(pool: Any, *, model_id: str, model_version_id: str,
                           data_revision_id: str | None, kind: str, prompt: str,
                           candidates: list[dict[str, Any]],
                           evidence: dict[str, Any], emit_signal: bool = False) -> str:
    async with pool.acquire() as connection:
        async with connection.transaction():
            row = await connection.fetchrow(
                """
                INSERT INTO semantic_population.review_items
                  (model_id, model_version_id, data_revision_id, kind, prompt,
                   candidates, evidence)
                VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
                RETURNING id::text
                """,
                model_id, model_version_id, data_revision_id, kind, prompt,
                _json(candidates), _json(evidence),
            )
            if emit_signal:
                await enqueue_ui_signal(
                    connection, model_id=model_id, event_type="review-items-changed",
                    resource=row["id"],
                    payload={"resource": row["id"], "status": "open",
                             "reason": "review_created"},
                )
            return row["id"]


async def resolve_review_item(pool: Any, *, review_id: str, model_id: str,
                              resolution: dict[str, Any], resolved_by: str,
                              emit_signal: bool = False) -> bool:
    async with pool.acquire() as connection:
        async with connection.transaction():
            row = await connection.fetchrow(
                """
                UPDATE semantic_population.review_items
                SET state = 'resolved', resolution = $3::jsonb, resolved_by = $4,
                    resolved_at = now()
                WHERE id = $1::uuid AND model_id = $2 AND state = 'open'
                RETURNING id
                """,
                review_id, model_id, _json(resolution), resolved_by,
            )
            if row is not None and emit_signal:
                await enqueue_ui_signal(
                    connection, model_id=model_id, event_type="review-items-changed",
                    resource=review_id,
                    payload={"resource": review_id, "status": "resolved",
                             "reason": "review_resolved"},
                )
            return row is not None


async def get_specification(pool: Any, home_workspace_id: str, model_id: str,
                            model_version_id: str, spec_hash: str) -> dict[str, Any] | None:
    row = await pool.fetchrow(
        "SELECT id::text, spec_hash, specification FROM semantic_runtime.specifications "
        "WHERE home_workspace_id = $1 AND model_id = $2 AND model_version_id = $3 "
        "AND spec_hash = $4",
        home_workspace_id, model_id, model_version_id, spec_hash,
    )
    return dict(row) if row else None


async def get_review_item(pool: Any, review_id: str) -> dict[str, Any] | None:
    row = await pool.fetchrow(
        "SELECT id::text, model_id, model_version_id, data_revision_id, kind, state, "
        "prompt, candidates, evidence, resolution, resolved_by "
        "FROM semantic_population.review_items WHERE id = $1::uuid",
        review_id,
    )
    return dict(row) if row else None


async def get_data_revision(pool: Any, revision_id: str) -> dict[str, Any] | None:
    row = await pool.fetchrow(
        "SELECT id, model_id, model_version_id, spec_hash, execution_fingerprint, correction_sequence, "
        "projection_ref, coverage, validation_state "
        "FROM semantic_population.data_revisions WHERE id = $1",
        revision_id,
    )
    return dict(row) if row else None


async def get_revision_specification(pool: Any, revision_id: str) -> dict[str, Any] | None:
    row = await pool.fetchrow(
        "SELECT specification FROM semantic_runtime.specifications specification "
        "JOIN semantic_population.data_revisions revision "
        "ON specification.model_id = revision.model_id "
        "AND specification.model_version_id = revision.model_version_id "
        "AND specification.spec_hash = revision.spec_hash "
        "WHERE revision.id = $1 ORDER BY specification.created_at DESC LIMIT 1",
        revision_id,
    )
    if row is None:
        return None
    value = row["specification"]
    return json.loads(value) if isinstance(value, str) else dict(value)


async def model_reset_generation(pool: Any, model_id: str) -> int:
    value = await pool.fetchval(
        "SELECT generation FROM semantic_population.model_data_resets WHERE model_id = $1",
        model_id,
    )
    return int(value or 0)


_TERMINAL_JOB_STATES = ("completed", "completed_with_gaps", "failed", "cancelled", "superseded")


class PopulationRunning(Exception):
    """A build of the model is still going on; its data cannot be cleared under it."""


async def purge_model_data(pool: Any, model_id: str, *,
                           forget_document_reading: bool = False,
                           emit_signal: bool = False) -> dict[str, Any]:
    """Clear what builds produced for a model, so the next build starts from nothing.

    The model's settings stay: specification, corrections and hand-typed records
    (manual snapshots). Data served to another environment (published) stays
    until that environment moves on. Returns the projection graphs no longer
    referenced, for the caller to drop from the graph database."""
    async with pool.acquire() as connection:
        async with connection.transaction():
            # One purge at a time per model, and none while a build runs.
            await connection.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                                     f"purge:{model_id}")
            running = await connection.fetchval(
                "SELECT count(*) FROM semantic_jobs.jobs WHERE model_id = $1 "
                "AND job_type = 'population.run' AND NOT (state = ANY($2::text[]))",
                model_id, list(_TERMINAL_JOB_STATES),
            )
            if running:
                raise PopulationRunning(model_id)
            await connection.execute(
                "DELETE FROM semantic_runtime.active_bindings "
                "WHERE model_id = $1 AND environment = 'draft'", model_id)
            kept = {row["data_revision_id"] for row in await connection.fetch(
                "SELECT data_revision_id FROM semantic_runtime.active_bindings "
                "WHERE model_id = $1", model_id)}
            removed = await connection.fetch(
                "DELETE FROM semantic_population.data_revisions "
                "WHERE model_id = $1 AND NOT (id = ANY($2::text[])) "
                "RETURNING id, projection_ref", model_id, sorted(kept))
            review_items = await connection.fetchval(
                "WITH gone AS (DELETE FROM semantic_population.review_items "
                "WHERE model_id = $1 AND (data_revision_id IS NULL "
                "OR NOT (data_revision_id = ANY($2::text[]))) RETURNING 1) "
                "SELECT count(*) FROM gone", model_id, sorted(kept))
            # Finished builds would otherwise be handed back as "already done".
            jobs = await connection.fetchval(
                "WITH gone AS (DELETE FROM semantic_jobs.jobs WHERE model_id = $1 "
                "AND job_type = 'population.run' AND state = ANY($2::text[]) RETURNING 1) "
                "SELECT count(*) FROM gone", model_id, list(_TERMINAL_JOB_STATES))
            readings = 0
            if forget_document_reading:
                readings = await connection.fetchval(
                    "WITH gone AS (DELETE FROM semantic_population.document_extractions "
                    "WHERE model_id = $1 RETURNING 1) SELECT count(*) FROM gone", model_id)
            generation = await connection.fetchval(
                "INSERT INTO semantic_population.model_data_resets (model_id) VALUES ($1) "
                "ON CONFLICT (model_id) DO UPDATE SET generation = "
                "semantic_population.model_data_resets.generation + 1, reset_at = now() "
                "RETURNING generation", model_id)
            if emit_signal:
                await enqueue_ui_signal(
                    connection, model_id=model_id, event_type="data-revision-changed",
                    resource="draft",
                    payload={"resource": "draft", "status": "cleared", "reason": "data_cleared"},
                )
    return {
        "modelId": model_id,
        "resetGeneration": int(generation),
        "revisions": len(removed),
        "keptRevisions": len(kept),
        "reviewItems": int(review_items or 0),
        "jobs": int(jobs or 0),
        "documentReadings": int(readings or 0),
        "projections": sorted({row["projection_ref"] for row in removed
                               if row["projection_ref"]}),
    }


class ModelJobsRunning(Exception):
    """A job of the model is queued or running; the model cannot be deleted under it."""


# Every runtime table keyed by the model id, children before parents. Rows hanging off them
# (entities -> identities, snapshots -> manual rows/links, generations -> entity documents,
# jobs -> tasks/events/outbox) go with them by cascade.
_MODEL_TABLES = (
    "semantic_jobs.ui_signal_outbox",
    "semantic_graph_search.embedding_cache",
    "semantic_graph_search.index_generations",
    "semantic_runtime.active_bindings",
    "semantic_population.review_items",
    "semantic_population.corrections",
    "semantic_population.relationships",
    "semantic_population.assertions",
    "semantic_population.entities",
    "semantic_population.document_extractions",
    "semantic_population.data_revisions",
    "semantic_population.manual_snapshots",
    "semantic_population.model_data_resets",
    "semantic_runtime.specifications",
    "semantic_datasource.mapping_health",
    "semantic_jobs.jobs",
)
_UUID_MODEL_TABLES = frozenset({"semantic_jobs.ui_signal_outbox", "semantic_datasource.mapping_health"})


async def delete_model(pool: Any, model_id: str) -> dict[str, Any]:
    """Forget a model entirely: every runtime row keyed by it, in one transaction.

    Refuses while one of its jobs is not finished (the caller must wait or cancel it).
    Idempotent: a model with no rows deletes nothing. Returns the projection graphs
    that were referenced, for the caller to drop from the graph database."""
    async with pool.acquire() as connection:
        async with connection.transaction():
            await connection.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                                     f"purge:{model_id}")
            running = await connection.fetchval(
                "SELECT count(*) FROM semantic_jobs.jobs WHERE model_id = $1 "
                "AND NOT (state = ANY($2::text[]))", model_id, list(_TERMINAL_JOB_STATES))
            if running:
                raise ModelJobsRunning(model_id)
            refs = await connection.fetch(
                "SELECT projection_ref FROM semantic_population.data_revisions WHERE model_id = $1 "
                "UNION SELECT projection_ref FROM semantic_runtime.active_bindings WHERE model_id = $1 "
                "UNION SELECT projection_ref FROM semantic_graph_search.index_generations "
                "WHERE model_id = $1", model_id)
            counts: dict[str, int] = {}
            for table in _MODEL_TABLES:
                # Two small tables key the model as a uuid; compare as text so any id is accepted.
                column = "model_id::text" if table in _UUID_MODEL_TABLES else "model_id"
                deleted = await connection.fetchval(
                    f"WITH gone AS (DELETE FROM {table} WHERE {column} = $1 RETURNING 1) "
                    "SELECT count(*) FROM gone", model_id)
                counts[table] = int(deleted or 0)
    return {"modelId": model_id, "deleted": counts,
            "projections": sorted({row["projection_ref"] for row in refs if row["projection_ref"]})}


async def get_active_binding(pool: Any, model_id: str,
                             environment: str = "production") -> dict[str, Any] | None:
    row = await pool.fetchrow(
        "SELECT model_id, environment, model_version_id, data_revision_id, "
        "projection_ref, correction_sequence, version "
        "FROM semantic_runtime.active_bindings WHERE model_id = $1 AND environment = $2",
        model_id, environment,
    )
    return dict(row) if row else None


async def cas_active_binding(pool: Any, *, model_id: str, environment: str = "production",
                             expected_version: int | None, model_version_id: str,
                             data_revision_id: str, projection_ref: str,
                             correction_sequence: int, spec_hash: str,
                             emit_signal: bool = False) -> bool:
    """Compare-and-swap the serving tuple. ``expected_version=None`` creates."""
    async with pool.acquire() as connection:
        async with connection.transaction():
            row = await _cas_active_binding(
                connection, model_id=model_id, environment=environment,
                expected_version=expected_version, model_version_id=model_version_id,
                data_revision_id=data_revision_id, projection_ref=projection_ref,
                correction_sequence=correction_sequence, spec_hash=spec_hash,
            )
            if row is not None and emit_signal:
                await enqueue_ui_signal(
                    connection, model_id=model_id, event_type="data-revision-changed",
                    resource=environment,
                    payload={"dataRevision": int(row["version"]), "resource": environment,
                             "status": "ready", "reason": "population_activated"},
                )
            return row is not None


async def _cas_active_binding(connection: Any, *, model_id: str, environment: str,
                               expected_version: int | None, model_version_id: str,
                               data_revision_id: str, projection_ref: str,
                               correction_sequence: int, spec_hash: str):  # type: ignore[no-untyped-def]
    current_spec = """
        SELECT spec_hash FROM semantic_runtime.specifications
        WHERE model_id = $1 AND model_version_id = $3
        ORDER BY selected_at DESC, id DESC LIMIT 1
    """
    if expected_version is None:
        return await connection.fetchrow(
            f"""
            INSERT INTO semantic_runtime.active_bindings
              (model_id, environment, model_version_id, data_revision_id,
               projection_ref, correction_sequence)
            SELECT $1, $2, $3, $4, $5, $6
            WHERE ({current_spec}) = $7
            ON CONFLICT (model_id, environment) DO NOTHING
            RETURNING version
            """,
            model_id, environment, model_version_id, data_revision_id,
            projection_ref, correction_sequence, spec_hash,
        )
    return await connection.fetchrow(
        f"""
        UPDATE semantic_runtime.active_bindings
        SET model_version_id = $3, data_revision_id = $4, projection_ref = $5,
            correction_sequence = $6, version = version + 1, updated_at = now()
        WHERE model_id = $1 AND environment = $2 AND version = $7
          AND ({current_spec}) = $8
        RETURNING version
        """,
        model_id, environment, model_version_id, data_revision_id,
        projection_ref, correction_sequence, expected_version, spec_hash,
    )


async def set_revision_validation(pool: Any, revision_id: str, state: str) -> bool:
    """Advance validation out of ``pending`` only: a retried worker can never
    flip a revision a human marked ``invalid`` back to ``valid``."""
    if state not in ("valid", "invalid", "superseded"):
        raise ValueError("invalid_validation_state")
    row = await pool.fetchrow(
        "UPDATE semantic_population.data_revisions SET validation_state = $2 "
        "WHERE id = $1 AND validation_state = 'pending' RETURNING id",
        revision_id, state,
    )
    return row is not None


async def set_revision_projection(pool: Any, revision_id: str, projection_ref: str,
                                  expected_projection_ref: str | None = None) -> bool:
    row = await pool.fetchrow(
        "UPDATE semantic_population.data_revisions SET projection_ref = $2 "
        "WHERE id = $1 AND projection_ref IS NOT DISTINCT FROM $3 RETURNING id",
        revision_id, projection_ref, expected_projection_ref,
    )
    return row is not None


async def count_revision_rows(pool: Any, revision_id: str) -> dict[str, int]:
    row = await pool.fetchrow(
        "SELECT (SELECT count(*) FROM semantic_population.entities WHERE data_revision_id = $1) "
        "AS entities, (SELECT count(*) FROM semantic_population.assertions "
        "WHERE data_revision_id = $1) AS assertions, "
        "(SELECT count(*) FROM semantic_population.relationships WHERE data_revision_id = $1) "
        "AS relationships",
        revision_id,
    )
    return {"entities": int(row["entities"]), "assertions": int(row["assertions"]),
            "relationships": int(row["relationships"])}


async def count_revision_entities_by_concept(pool: Any, revision_id: str) -> dict[str, int]:
    rows = await pool.fetch(
        "SELECT concept_id, count(*) AS entities FROM semantic_population.entities "
        "WHERE data_revision_id = $1 GROUP BY concept_id",
        revision_id,
    )
    return {str(row["concept_id"]): int(row["entities"]) for row in rows}


async def list_revision_entities(pool: Any, revision_id: str,
                                 limit: int = 50000,
                                 concept_id: str | None = None) -> list[dict[str, Any]]:
    rows = await pool.fetch(
        "SELECT id, concept_id, namespace, label, attributes, provenance, identity_key "
        "FROM semantic_population.entities WHERE data_revision_id = $1 "
        "AND ($3::text IS NULL OR concept_id = $3) ORDER BY id LIMIT $2",
        revision_id, limit, concept_id,
    )
    result = []
    for row in rows:
        values = dict(row)
        result.append({
            "entityId": values["id"], "conceptId": values["concept_id"],
            "namespace": values["namespace"], "label": values["label"],
            "attributes": json.loads(values["attributes"])
            if isinstance(values["attributes"], str) else dict(values["attributes"]),
            "provenance": json.loads(values.get("provenance") or "{}")
            if isinstance(values.get("provenance"), str)
            else dict(values.get("provenance") or {}),
            "identity": _json_object(values.get("identity_key")),
        })
    return result


async def search_revision_entities(pool: Any, revision_id: str, concept_id: str, *,
                                   query: str | None = None, limit: int = 50,
                                   offset: int = 0) -> tuple[int, list[dict[str, Any]]]:
    """A page of one concept's records, optionally narrowed to those whose name or values contain ``query``."""
    pattern = None
    if query and query.strip():
        escaped = query.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
    where = ("data_revision_id = $1 AND concept_id = $2 "
             "AND ($3::text IS NULL OR label ILIKE $3 OR attributes::text ILIKE $3 "
             "OR identity_key ILIKE $3)")
    total = await pool.fetchval(
        f"SELECT count(*) FROM semantic_population.entities WHERE {where}",
        revision_id, concept_id, pattern)
    rows = await pool.fetch(
        "SELECT id, concept_id, namespace, label, attributes, provenance, identity_key "
        f"FROM semantic_population.entities WHERE {where} "
        "ORDER BY lower(label), id LIMIT $4 OFFSET $5",
        revision_id, concept_id, pattern, limit, offset)
    entities = []
    for row in rows:
        values = dict(row)
        entities.append({
            "entityId": values["id"], "conceptId": values["concept_id"],
            "namespace": values["namespace"], "label": values["label"],
            "attributes": json.loads(values["attributes"])
            if isinstance(values["attributes"], str) else dict(values["attributes"]),
            "provenance": json.loads(values.get("provenance") or "{}")
            if isinstance(values.get("provenance"), str)
            else dict(values.get("provenance") or {}),
            # The matching key, normalized; key fields are not repeated among the attributes.
            "identity": _json_object(values.get("identity_key")),
        })
    return int(total or 0), entities


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except ValueError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return dict(value) if isinstance(value, dict) else {}


def _origin_of(evidence: dict[str, Any], origin: str | None) -> dict[str, Any]:
    asset_ref = evidence.get("assetRef") or {}
    result: dict[str, Any] = {
        "kind": "human" if origin == "human" else (
            "metadata" if evidence.get("origin") == "metadata" else
            "ai" if evidence.get("origin") == "ai" else "source"),
        "assetId": asset_ref.get("assetId"),
    }
    correction = evidence.get("correction")
    if isinstance(correction, dict):
        result["correctedBy"] = correction.get("actorUserId")
        result["originalValue"] = correction.get("originalValue")
        result["correctionSequence"] = correction.get("correctionSequence")
    for source, target in (("rowNumber", "rowNumber"), ("column", "column"),
                           ("pageNumber", "pageNumber"), ("sheet", "sheet")):
        if evidence.get(source) is not None:
            result[target] = evidence[source]
    # A value taken from another concept's record: which record, and how it was chosen.
    derived = evidence.get("derivedFrom")
    if isinstance(derived, dict):
        result["derivedFrom"] = {key: derived.get(key) for key in (
            "conceptId", "entityId", "label", "attribute", "rule", "distinctValues", "records")}
        # A value read out of the source field's text (rules, AI), by a recipe or fixed: how, and where.
        result["derivedFrom"].update({key: derived[key] for key in ("method", "span", "attributes")
                                      if derived.get(key) is not None})
    # A recipe joining several fields or columns: every one it read.
    if isinstance(evidence.get("recipeSources"), list):
        result["recipeSources"] = evidence["recipeSources"]
    return result


async def list_entity_origins(pool: Any, revision_id: str,
                              entity_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Where each attribute value of the given entities came from."""
    if not entity_ids:
        return {}
    rows = await pool.fetch(
        "SELECT entity_id, attribute, origin, evidence FROM semantic_population.assertions "
        "WHERE data_revision_id = $1 AND entity_id = ANY($2::text[])",
        revision_id, list(entity_ids),
    )
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        evidence = row["evidence"]
        evidence = json.loads(evidence) if isinstance(evidence, str) else dict(evidence or {})
        result.setdefault(row["entity_id"], {})[row["attribute"]] = _origin_of(
            evidence, row["origin"])
    return result


async def list_revision_relationships(pool: Any, revision_id: str,
                                      limit: int = 20000) -> list[dict[str, Any]]:
    rows = await pool.fetch(
        "SELECT relation_id, source_entity_id, target_entity_id, matching_strategy "
        "FROM semantic_population.relationships WHERE data_revision_id = $1 "
        "ORDER BY relation_id, source_entity_id, target_entity_id LIMIT $2",
        revision_id, limit,
    )
    return [{"relationId": row["relation_id"], "sourceEntityId": row["source_entity_id"],
             "targetEntityId": row["target_entity_id"],
             "matchingStrategy": row["matching_strategy"]} for row in rows]
