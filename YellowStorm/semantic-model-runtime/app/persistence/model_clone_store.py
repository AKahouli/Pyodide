"""Copy a model's current draft data into a freshly cloned model.

The clone gets one new data revision holding the source's draft revision rows (entities,
aliases, assertions, relationships), the model's review items and corrections, and its
committed manual snapshots. Every concept, relation, mapping, model and version id the
caller maps is rewritten, in columns and inside JSON alike. The search index and the
embeddings are not copied (the clone requests its own index), nor is the document
extraction cache, whose keys hash the model id. Source documents are never touched.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from app.persistence.population_store import ModelJobsRunning, _TERMINAL_JOB_STATES
from app.population.compiler import canonical_spec_hash

_UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
_BATCH = 2000


class CloneTargetNotEmpty(Exception):
    """The target model already holds data; a clone only ever fills an empty model."""


class IdRemapper:
    """Rewrite every mapped id found in a string or a JSON value; other text is left as is."""

    def __init__(self, id_map: dict[str, str]):
        self.map = {key.lower(): value for key, value in id_map.items() if key and value}

    def text(self, value: str | None) -> str | None:
        if value is None or not self.map:
            return value
        return _UUID.sub(lambda match: self.map.get(match.group(0).lower(), match.group(0)), value)

    def json(self, value: Any) -> Any:
        if value is None:
            return None
        decoded = json.loads(value) if isinstance(value, str) else value
        return json.loads(self.text(json.dumps(decoded, ensure_ascii=False)) or "null")

    def dumps(self, value: Any, default: str = "{}") -> str:
        if value is None:
            return default
        return json.dumps(self.json(value), ensure_ascii=False)


def clone_revision_id(target_model_id: str, source_revision_id: str) -> str:
    body = f"clone:{target_model_id}:{source_revision_id}"
    return "dr_" + hashlib.sha256(body.encode("utf-8")).hexdigest()[:24]


def clone_snapshot_id(target_model_id: str, source_snapshot_id: str) -> str:
    return "m" + hashlib.sha1(f"clone:{target_model_id}:{source_snapshot_id}".encode()).hexdigest()


async def clone_model_data(pool: Any, *, source_model_id: str, target_model_id: str,
                           target_model_version_id: str,
                           id_map: dict[str, str],
                           planned: dict[str, Any] | None = None) -> dict[str, Any]:
    """Copy the source's draft data into ``target_model_id`` in one transaction.

    Returns ``{"copied": False, "reason": "no_data"}`` when the source has no draft data,
    else the new revision id and the copied counts. The caller projects the graph and
    activates the revision afterwards (``activate_cloned_revision``).
    ``planned`` (the clone's own specification, hash, home workspace and execution fingerprint)
    replaces the remapped source specification, so the copy reads as current for the back.
    Raises ``ModelJobsRunning`` while a job of the source runs and ``CloneTargetNotEmpty``
    when the target already has data."""
    async with pool.acquire() as connection:
        async with connection.transaction():
            await connection.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                                     f"purge:{source_model_id}")
            await connection.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                                     f"purge:{target_model_id}")
            running = await connection.fetchval(
                "SELECT count(*) FROM semantic_jobs.jobs WHERE model_id = $1 "
                "AND NOT (state = ANY($2::text[]))", source_model_id, list(_TERMINAL_JOB_STATES))
            if running:
                raise ModelJobsRunning(source_model_id)
            if await connection.fetchval(
                    "SELECT EXISTS (SELECT 1 FROM semantic_population.data_revisions WHERE model_id = $1) "
                    "OR EXISTS (SELECT 1 FROM semantic_runtime.active_bindings WHERE model_id = $1)",
                    target_model_id):
                raise CloneTargetNotEmpty(target_model_id)
            binding = await connection.fetchrow(
                "SELECT model_version_id, data_revision_id FROM semantic_runtime.active_bindings "
                "WHERE model_id = $1 AND environment = 'draft'", source_model_id)
            if binding is None:
                return {"copied": False, "reason": "no_data"}
            source_revision_id = binding["data_revision_id"]
            revision = await connection.fetchrow(
                "SELECT * FROM semantic_population.data_revisions WHERE id = $1", source_revision_id)
            if revision is None:
                return {"copied": False, "reason": "no_data"}
            remap = IdRemapper({**id_map, source_model_id: target_model_id,
                                revision["model_version_id"]: target_model_version_id,
                                binding["model_version_id"]: target_model_version_id})
            new_revision_id = clone_revision_id(target_model_id, source_revision_id)

            spec = await connection.fetchrow(
                "SELECT home_workspace_id, specification FROM semantic_runtime.specifications "
                "WHERE model_id = $1 AND model_version_id = $2 AND spec_hash = $3 "
                "ORDER BY selected_at DESC, id DESC LIMIT 1",
                source_model_id, revision["model_version_id"], revision["spec_hash"])
            if spec is None and planned is None:
                return {"copied": False, "reason": "no_specification"}
            if planned is not None:
                home_workspace_id = planned["homeWorkspaceId"]
                specification = planned["specification"]
                spec_hash = planned["specHash"]
                execution_fingerprint = planned.get("executionFingerprint") or revision["execution_fingerprint"]
            else:
                home_workspace_id = spec["home_workspace_id"]
                specification = remap.json(spec["specification"])
                spec_hash = canonical_spec_hash(specification)
                execution_fingerprint = revision["execution_fingerprint"]
            await connection.execute(
                "INSERT INTO semantic_runtime.specifications "
                "(home_workspace_id, model_id, model_version_id, spec_hash, specification) "
                "VALUES ($1, $2, $3, $4, $5::jsonb) "
                "ON CONFLICT (home_workspace_id, model_id, model_version_id, spec_hash) "
                "DO UPDATE SET selected_at = clock_timestamp()",
                home_workspace_id, target_model_id, target_model_version_id, spec_hash,
                json.dumps(specification, ensure_ascii=False))

            # Corrections first: the revision records the sequence it already includes.
            sequence_map: dict[int, int] = {}
            on_revision: list[int] = []
            corrections = await connection.fetch(
                "SELECT * FROM semantic_population.corrections WHERE model_id = $1 ORDER BY sequence",
                source_model_id)
            for row in corrections:
                sequence_map[int(row["sequence"])] = int(await connection.fetchval(
                    "INSERT INTO semantic_population.corrections (model_id, model_version_id, actor_user_id, "
                    "reason, target_identity, action, payload, data_revision_id, created_at) "
                    "VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, NULL, $8) RETURNING sequence",
                    target_model_id, remap.text(row["model_version_id"]), row["actor_user_id"],
                    row["reason"], remap.dumps(row["target_identity"]), row["action"],
                    remap.dumps(row["payload"]), row["created_at"]))
                if row["data_revision_id"] == source_revision_id:
                    on_revision.append(sequence_map[int(row["sequence"])])
            watermark = int(revision["correction_sequence"] or 0)
            included = [new for old, new in sequence_map.items() if old <= watermark]
            correction_sequence = max(included) if included else 0

            await connection.execute(
                "INSERT INTO semantic_population.data_revisions (id, model_id, model_version_id, spec_hash, "
                "source_observations, correction_sequence, projection_ref, coverage, validation_state, "
                "execution_fingerprint) VALUES ($1, $2, $3, $4, $5::jsonb, $6, NULL, $7::jsonb, 'valid', $8)",
                new_revision_id, target_model_id, target_model_version_id, spec_hash,
                remap.dumps(revision["source_observations"], "[]"), correction_sequence,
                remap.dumps(revision["coverage"]), execution_fingerprint)
            await connection.execute(
                "UPDATE semantic_population.corrections SET data_revision_id = $2 "
                "WHERE model_id = $1 AND sequence = ANY($3::bigint[])", target_model_id, new_revision_id,
                on_revision)

            counts = {"entities": 0, "aliases": 0, "assertions": 0, "relationships": 0}
            counts["entities"] = await _copy(
                connection, "SELECT * FROM semantic_population.entities WHERE data_revision_id = $1 ORDER BY id",
                source_revision_id,
                "INSERT INTO semantic_population.entities (id, model_id, data_revision_id, concept_id, namespace, "
                "identity_key, label, attributes, provenance) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)",
                lambda r: (remap.text(r["id"]), target_model_id, new_revision_id, remap.text(r["concept_id"]),
                           r["namespace"], remap.text(r["identity_key"]), r["label"],
                           remap.dumps(r["attributes"]), remap.dumps(r["provenance"])))
            counts["aliases"] = await _copy(
                connection, "SELECT * FROM semantic_population.entity_identities WHERE data_revision_id = $1 "
                "ORDER BY alias_namespace, alias_key", source_revision_id,
                "INSERT INTO semantic_population.entity_identities (entity_id, data_revision_id, alias_namespace, "
                "alias_key) VALUES ($1, $2, $3, $4)",
                lambda r: (remap.text(r["entity_id"]), new_revision_id, r["alias_namespace"],
                           remap.text(r["alias_key"])))
            counts["assertions"] = await _copy(
                connection, "SELECT * FROM semantic_population.assertions WHERE data_revision_id = $1 ORDER BY id",
                source_revision_id,
                "INSERT INTO semantic_population.assertions (model_id, data_revision_id, entity_id, attribute, "
                "value, origin, validation_state, evidence, mapping_version, created_at) "
                "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)",
                lambda r: (target_model_id, new_revision_id, remap.text(r["entity_id"]), r["attribute"],
                           r["value"], r["origin"], r["validation_state"], remap.dumps(r["evidence"]),
                           r["mapping_version"], r["created_at"]))
            counts["relationships"] = await _copy(
                connection, "SELECT * FROM semantic_population.relationships WHERE data_revision_id = $1 ORDER BY id",
                source_revision_id,
                "INSERT INTO semantic_population.relationships (model_id, data_revision_id, relation_id, "
                "source_entity_id, target_entity_id, matching_strategy, state, created_at) "
                "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
                lambda r: (target_model_id, new_revision_id, remap.text(r["relation_id"]),
                           remap.text(r["source_entity_id"]), remap.text(r["target_entity_id"]),
                           r["matching_strategy"], r["state"], r["created_at"]))

            reviews = await connection.fetch(
                "SELECT * FROM semantic_population.review_items WHERE model_id = $1 "
                "AND (data_revision_id IS NULL OR data_revision_id = $2) ORDER BY created_at",
                source_model_id, source_revision_id)
            for row in reviews:
                await connection.execute(
                    "INSERT INTO semantic_population.review_items (model_id, model_version_id, data_revision_id, "
                    "kind, state, prompt, candidates, evidence, resolution, resolved_by, resolved_at, created_at) "
                    "VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12)",
                    target_model_id, remap.text(row["model_version_id"]),
                    new_revision_id if row["data_revision_id"] else None, row["kind"], row["state"],
                    row["prompt"], remap.dumps(row["candidates"], "[]"), remap.dumps(row["evidence"]),
                    None if row["resolution"] is None else remap.dumps(row["resolution"]),
                    row["resolved_by"], row["resolved_at"], row["created_at"])

            snapshots = await connection.fetch(
                "SELECT * FROM semantic_population.manual_snapshots WHERE model_id = $1 "
                "AND committed_at IS NOT NULL ORDER BY created_at", source_model_id)
            for row in snapshots:
                new_id = clone_snapshot_id(target_model_id, row["id"])
                await connection.execute(
                    "INSERT INTO semantic_population.manual_snapshots (id, model_id, row_count, link_count, "
                    "committed_at, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
                    new_id, target_model_id, row["row_count"], row["link_count"], row["committed_at"],
                    row["created_at"])
                await _copy(
                    connection, 'SELECT * FROM semantic_population.manual_rows WHERE snapshot_id = $1 ORDER BY row_key',
                    row["id"],
                    'INSERT INTO semantic_population.manual_rows (snapshot_id, concept_id, row_key, label, "values") '
                    "VALUES ($1, $2, $3, $4, $5::jsonb)",
                    lambda r, new_id=new_id: (new_id, remap.text(r["concept_id"]), remap.text(r["row_key"]),
                                              r["label"], remap.dumps(r["values"])))
                await _copy(
                    connection, "SELECT * FROM semantic_population.manual_links WHERE snapshot_id = $1 "
                    "ORDER BY relation_id, source_row_key, target_row_key", row["id"],
                    "INSERT INTO semantic_population.manual_links (snapshot_id, relation_id, source_row_key, "
                    "target_row_key) VALUES ($1, $2, $3, $4)",
                    lambda r, new_id=new_id: (new_id, remap.text(r["relation_id"]),
                                              remap.text(r["source_row_key"]), remap.text(r["target_row_key"])))
    return {"copied": True, "sourceRevisionId": source_revision_id, "revisionId": new_revision_id,
            "specHash": spec_hash, "correctionSequence": correction_sequence,
            "counts": {**counts, "reviewItems": len(reviews), "corrections": len(corrections),
                       "manualSnapshots": len(snapshots)}}


async def _copy(connection: Any, select_sql: str, source_id: str, insert_sql: str, transform) -> int:  # type: ignore[no-untyped-def]
    total = 0
    batch: list[tuple] = []
    async for row in connection.cursor(select_sql, source_id, prefetch=_BATCH):
        batch.append(transform(row))
        if len(batch) >= _BATCH:
            await connection.executemany(insert_sql, batch)
            total += len(batch)
            batch = []
    if batch:
        await connection.executemany(insert_sql, batch)
        total += len(batch)
    return total


async def activate_cloned_revision(pool: Any, *, model_id: str, model_version_id: str,
                                   revision_id: str, projection_ref: str,
                                   correction_sequence: int) -> None:
    """Serve the copied revision as the clone's draft data (the clone has no binding yet)."""
    await pool.execute(
        "INSERT INTO semantic_runtime.active_bindings (model_id, environment, model_version_id, "
        "data_revision_id, projection_ref, correction_sequence) VALUES ($1, 'draft', $2, $3, $4, $5) "
        "ON CONFLICT (model_id, environment) DO NOTHING",
        model_id, model_version_id, revision_id, projection_ref, correction_sequence)
