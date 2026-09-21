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


def _json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def revision_id_for(model_version_id: str, spec_hash: str, dataset_fingerprints: list[str],
                    correction_sequence: int) -> str:
    """Deterministic data-revision id for a fixed spec, inputs and watermark."""
    body = _json({"modelVersionId": model_version_id, "specHash": spec_hash,
                  "datasets": sorted(dataset_fingerprints),
                  "correctionSequence": correction_sequence})
    return "dr_" + hashlib.sha256(body.encode("utf-8")).hexdigest()[:24]


async def mirror_specification(pool: Any, *, home_workspace_id: str, model_id: str,
                               model_version_id: str, spec_hash: str,
                               specification: dict[str, Any]) -> str:
    """Insert an immutable snapshot; edited drafts receive a new hash-keyed row."""
    row = await pool.fetchrow(
        """
        INSERT INTO semantic_runtime.specifications
          (home_workspace_id, model_id, model_version_id, spec_hash, specification)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (home_workspace_id, model_id, model_version_id, spec_hash) DO NOTHING
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
                               source_observations: list[dict[str, Any]],
                               correction_sequence: int,
                               coverage: dict[str, Any]) -> str:
    row = await pool.fetchrow(
        """
        INSERT INTO semantic_population.data_revisions
          (id, model_id, model_version_id, spec_hash, source_observations,
           correction_sequence, coverage)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
        """,
        revision_id, model_id, model_version_id, spec_hash, _json(source_observations),
        correction_sequence, _json(coverage),
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


async def open_review_item(pool: Any, *, model_id: str, model_version_id: str,
                           data_revision_id: str | None, kind: str, prompt: str,
                           candidates: list[dict[str, Any]],
                           evidence: dict[str, Any]) -> str:
    row = await pool.fetchrow(
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
    return row["id"]


async def resolve_review_item(pool: Any, *, review_id: str, model_id: str,
                              resolution: dict[str, Any], resolved_by: str) -> bool:
    row = await pool.fetchrow(
        """
        UPDATE semantic_population.review_items
        SET state = 'resolved', resolution = $3::jsonb, resolved_by = $4,
            resolved_at = now()
        WHERE id = $1::uuid AND model_id = $2 AND state = 'open'
        RETURNING id
        """,
        review_id, model_id, _json(resolution), resolved_by,
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
        "SELECT id, model_id, model_version_id, spec_hash, correction_sequence, "
        "projection_ref, coverage, validation_state "
        "FROM semantic_population.data_revisions WHERE id = $1",
        revision_id,
    )
    return dict(row) if row else None


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
                             correction_sequence: int) -> bool:
    """Compare-and-swap the serving tuple. ``expected_version=None`` creates."""
    if expected_version is None:
        row = await pool.fetchrow(
            """
            INSERT INTO semantic_runtime.active_bindings
              (model_id, environment, model_version_id, data_revision_id,
               projection_ref, correction_sequence)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (model_id, environment) DO NOTHING
            RETURNING version
            """,
            model_id, environment, model_version_id, data_revision_id,
            projection_ref, correction_sequence,
        )
        return row is not None
    row = await pool.fetchrow(
        """
        UPDATE semantic_runtime.active_bindings
        SET model_version_id = $3, data_revision_id = $4, projection_ref = $5,
            correction_sequence = $6, version = version + 1, updated_at = now()
        WHERE model_id = $1 AND environment = $2 AND version = $7
        RETURNING version
        """,
        model_id, environment, model_version_id, data_revision_id,
        projection_ref, correction_sequence, expected_version,
    )
    return row is not None


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


async def set_revision_projection(pool: Any, revision_id: str, projection_ref: str) -> bool:
    row = await pool.fetchrow(
        "UPDATE semantic_population.data_revisions SET projection_ref = $2 "
        "WHERE id = $1 AND projection_ref IS NULL RETURNING id",
        revision_id, projection_ref,
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


async def list_revision_entities(pool: Any, revision_id: str,
                                 limit: int = 10000) -> list[dict[str, Any]]:
    rows = await pool.fetch(
        "SELECT id, concept_id, namespace, label, attributes FROM semantic_population.entities "
        "WHERE data_revision_id = $1 ORDER BY id LIMIT $2",
        revision_id, limit,
    )
    return [{"entityId": row["id"], "conceptId": row["concept_id"],
             "namespace": row["namespace"], "label": row["label"],
             "attributes": json.loads(row["attributes"]) if isinstance(row["attributes"], str)
             else dict(row["attributes"])} for row in rows]


async def list_revision_relationships(pool: Any, revision_id: str,
                                      limit: int = 10000) -> list[dict[str, Any]]:
    rows = await pool.fetch(
        "SELECT relation_id, source_entity_id, target_entity_id, matching_strategy "
        "FROM semantic_population.relationships WHERE data_revision_id = $1 "
        "ORDER BY relation_id, source_entity_id, target_entity_id LIMIT $2",
        revision_id, limit,
    )
    return [{"relationId": row["relation_id"], "sourceEntityId": row["source_entity_id"],
             "targetEntityId": row["target_entity_id"],
             "matchingStrategy": row["matching_strategy"]} for row in rows]
