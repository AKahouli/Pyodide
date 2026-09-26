"""P7 search-owned persistence (plan 7.1, P7.18). Parameterized repositories
over ``semantic_search``. Projections are derived per revision and rebuilt,
never edited; contexts are idempotent on their deterministic id."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any


def _json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


async def store_entity_projections(pool: Any,
                                   projections: list[dict[str, Any]]) -> int:
    if not projections:
        return 0
    await pool.executemany(
        """
        INSERT INTO semantic_search.entity_projections
          (entity_id, model_id, data_revision_id, concept_id, display_label,
           identity, search_keys)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
        ON CONFLICT (data_revision_id, entity_id) DO NOTHING
        """,
        [(projection["entityId"], projection["modelId"], projection["dataRevisionId"],
          projection.get("conceptId", ""), projection.get("displayLabel", ""),
          _json(projection.get("identity", {})), _json(projection.get("searchKeys", {})))
         for projection in projections],
    )
    return len(projections)


async def find_projection_candidates(pool: Any, *, model_id: str, revision_id: str,
                                     strategy: str, key: str, concept_id: str | None = None,
                                     limit: int = 25) -> list[dict[str, Any]]:
    """Bounded candidate lookup by precomputed strategy key (P7.3).

    Returns candidates only; the caller decides. The key must already be
    normalized exactly like the stored keys: ``normalize_identity_value``
    first, then ``match_value`` with the strategy (see ``match_candidates``,
    which applies both). A raw unnormalized key will miss under ``exact``."""
    if strategy not in ("exact", "case_insensitive", "normalized"):
        raise ValueError("invalid_matching_strategy")
    if not isinstance(key, str) or not key:
        raise ValueError("invalid_search_key")
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
        raise ValueError("invalid_search_limit")
    sql = ("SELECT entity_id, concept_id, display_label, identity FROM "
           "semantic_search.entity_projections "
           "WHERE model_id = $1 AND data_revision_id = $2 AND search_keys ->> $3 = $4")
    params: list[Any] = [model_id, revision_id, strategy, key]
    if concept_id is not None:
        sql += " AND concept_id = $5"
        params.append(concept_id)
    sql += f" ORDER BY entity_id LIMIT {limit}"
    rows = await pool.fetch(sql, *params)
    return [{"entityId": row["entity_id"], "conceptId": row["concept_id"],
             "displayLabel": row["display_label"], "identity": row["identity"]}
            for row in rows]


async def open_context(pool: Any, manifest: dict[str, Any]) -> str:
    """Open a context idempotently. Reopening refreshes the expiry and scope
    so an expired context is servable again; the deterministic id stays."""
    expires_at = manifest["expiresAt"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    row = await pool.fetchrow(
        """
        INSERT INTO semantic_search.contexts
          (id, actor_user_id, model_id, model_version_id, data_revision_id,
           source_scope, required_sources, coverage, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::timestamptz)
        ON CONFLICT (id) DO UPDATE
        SET source_scope = EXCLUDED.source_scope,
            required_sources = EXCLUDED.required_sources,
            coverage = EXCLUDED.coverage, expires_at = EXCLUDED.expires_at
        RETURNING id
        """,
        manifest["contextId"], manifest["actorUserId"], manifest["modelId"],
        manifest["modelVersionId"], manifest["dataRevisionId"],
        _json(manifest.get("sourceScope", [])), _json(manifest.get("requiredSources", [])),
        _json(manifest.get("coverage", {})), expires_at,
    )
    return row["id"] if row else manifest["contextId"]


async def get_context(pool: Any, context_id: str) -> dict[str, Any] | None:
    row = await pool.fetchrow(
        "SELECT id, actor_user_id, model_id, model_version_id, data_revision_id, "
        "source_scope, required_sources, coverage, expires_at "
        "FROM semantic_search.contexts WHERE id = $1",
        context_id,
    )
    return dict(row) if row else None


async def find_published_binding(pool: Any, projection_ref: str) -> dict[str, Any] | None:
    """The production binding serving this graph; drafts and old revisions have none."""
    row = await pool.fetchrow(
        "SELECT model_id, model_version_id, data_revision_id FROM semantic_runtime.active_bindings "
        "WHERE projection_ref = $1 AND environment = 'production'", projection_ref)
    return dict(row) if row else None


async def search_revision_entities(pool: Any, *, revision_id: str, terms: list[str],
                                   limit: int) -> list[dict[str, Any]]:
    patterns = ["%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
                for term in terms]
    rows = await pool.fetch(
        "SELECT id, concept_id, label, attributes, provenance FROM semantic_population.entities "
        "WHERE data_revision_id = $1 AND (label ILIKE ANY($2::text[]) "
        "OR attributes::text ILIKE ANY($2::text[])) LIMIT $3",
        revision_id, patterns, limit)
    return [{**dict(row), "attributes": _decode(row["attributes"]),
             "provenance": _decode(row["provenance"])} for row in rows]


async def revision_relationships(pool: Any, *, revision_id: str,
                                 entity_ids: list[str]) -> list[dict[str, Any]]:
    if not entity_ids:
        return []
    rows = await pool.fetch(
        "SELECT r.relation_id, r.source_entity_id, r.target_entity_id, "
        "s.concept_id AS source_concept_id, s.label AS source_label, "
        "t.concept_id AS target_concept_id, t.label AS target_label "
        "FROM semantic_population.relationships r "
        "JOIN semantic_population.entities s ON s.data_revision_id = r.data_revision_id AND s.id = r.source_entity_id "
        "JOIN semantic_population.entities t ON t.data_revision_id = r.data_revision_id AND t.id = r.target_entity_id "
        "WHERE r.data_revision_id = $1 AND r.state = 'accepted' "
        "AND (r.source_entity_id = ANY($2::text[]) OR r.target_entity_id = ANY($2::text[])) LIMIT 500",
        revision_id, entity_ids)
    return [dict(row) for row in rows]


def _decode(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else (value or {})
