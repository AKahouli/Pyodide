"""Graph search persistence (``semantic_graph_search``, migrations 022, 024 and 025).

A generation holds the search documents of one data revision for one
embedding profile. Indexers own a generation through a lease so a duplicate
delivery never writes alongside a live one; ``ready`` is final.
"""

from __future__ import annotations

import json
from typing import Any

_GENERATION_COLUMNS = (
    "index_id::text, model_id, data_revision_id, projection_ref, spec_hash, embedding_fingerprint, "
    "state, attempt, owner, job_id::text, expected_count, indexed_count, exact_only_count, "
    "failed_count, reused_count, embedding_calls, last_error_code, created_at, completed_at, "
    "passage_count, passage_indexed_count, passage_truncated_count, index_settings")


def _generation(row: Any) -> dict[str, Any] | None:
    if not row:
        return None
    generation = dict(row)
    settings = generation.get("index_settings")
    if isinstance(settings, str):
        generation["index_settings"] = json.loads(settings)
    return generation


def public_generation(generation: dict[str, Any] | None) -> dict[str, Any]:
    if generation is None:
        return {"indexId": None, "state": "missing", "embeddingFingerprint": None}
    completed = generation.get("completed_at")
    return {"indexId": generation["index_id"], "state": generation["state"],
            "embeddingFingerprint": generation["embedding_fingerprint"],
            "expectedCount": generation["expected_count"], "indexedCount": generation["indexed_count"],
            "exactOnlyCount": generation["exact_only_count"], "failedCount": generation["failed_count"],
            "reusedCount": generation["reused_count"], "embeddingCalls": generation["embedding_calls"],
            "lastErrorCode": generation["last_error_code"],
            "passageCount": generation.get("passage_count", 0),
            "passageIndexedCount": generation.get("passage_indexed_count", 0),
            "passageTruncatedCount": generation.get("passage_truncated_count", 0),
            "completedAt": completed.isoformat() if hasattr(completed, "isoformat") else completed}


async def get_generation(pool: Any, data_revision_id: str, fingerprint: str) -> dict[str, Any] | None:
    return _generation(await pool.fetchrow(
        f"SELECT {_GENERATION_COLUMNS} FROM semantic_graph_search.index_generations "
        "WHERE data_revision_id = $1 AND embedding_fingerprint = $2",
        data_revision_id, fingerprint))


async def latest_generation(pool: Any, data_revision_id: str, embedding_fingerprint: str) -> dict[str, Any] | None:
    """The revision's most recently requested generation for this embedding profile, whatever
    its index settings."""
    return _generation(await pool.fetchrow(
        f"SELECT {_GENERATION_COLUMNS} FROM semantic_graph_search.index_generations "
        "WHERE data_revision_id = $1 AND (embedding_fingerprint = $2 OR embedding_fingerprint LIKE $2 || ':ix:%') "
        "ORDER BY created_at DESC LIMIT 1", data_revision_id, embedding_fingerprint))


async def latest_index_settings(pool: Any, model_id: str, embedding_fingerprint: str) -> dict[str, Any] | None:
    """The index settings of the model's most recently requested generation for this profile
    (None: defaults, or no generation yet)."""
    value = await pool.fetchval(
        "SELECT index_settings FROM semantic_graph_search.index_generations "
        "WHERE model_id = $1 AND (embedding_fingerprint = $2 OR embedding_fingerprint LIKE $2 || ':ix:%') "
        "ORDER BY created_at DESC LIMIT 1", model_id, embedding_fingerprint)
    return json.loads(value) if isinstance(value, str) else value


async def get_generation_by_id(pool: Any, index_id: str) -> dict[str, Any] | None:
    return _generation(await pool.fetchrow(
        f"SELECT {_GENERATION_COLUMNS} FROM semantic_graph_search.index_generations "
        "WHERE index_id = $1::uuid", index_id))


async def create_generation(pool: Any, *, model_id: str, data_revision_id: str, projection_ref: str,
                            spec_hash: str, fingerprint: str,
                            index_settings: dict[str, Any] | None = None) -> dict[str, Any]:
    await pool.execute(
        "INSERT INTO semantic_graph_search.index_generations "
        "(model_id, data_revision_id, projection_ref, spec_hash, embedding_fingerprint, index_settings) "
        "VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT (data_revision_id, embedding_fingerprint) DO NOTHING",
        model_id, data_revision_id, projection_ref, spec_hash, fingerprint,
        json.dumps(index_settings, sort_keys=True) if index_settings is not None else None)
    generation = await get_generation(pool, data_revision_id, fingerprint)
    assert generation is not None
    return generation


async def retry_generation(pool: Any, index_id: str) -> dict[str, Any] | None:
    """Move a failed generation back to the queue under a new attempt number."""
    return _generation(await pool.fetchrow(
        "UPDATE semantic_graph_search.index_generations "
        "SET state = 'queued', attempt = attempt + 1, owner = NULL, lease_until = NULL, job_id = NULL "
        f"WHERE index_id = $1::uuid AND state = 'failed' RETURNING {_GENERATION_COLUMNS}",
        index_id))


async def set_generation_job(pool: Any, index_id: str, attempt: int, job_id: str) -> None:
    await pool.execute(
        "UPDATE semantic_graph_search.index_generations SET job_id = $3::uuid "
        "WHERE index_id = $1::uuid AND attempt = $2", index_id, attempt, job_id)


async def claim_generation(pool: Any, index_id: str, owner: str, lease_seconds: int) -> bool:
    row = await pool.fetchrow(
        "UPDATE semantic_graph_search.index_generations "
        "SET state = 'indexing', owner = $2, lease_until = now() + make_interval(secs => $3), "
        "last_error_code = NULL "
        "WHERE index_id = $1::uuid AND (state = 'queued' OR (state = 'indexing' "
        "AND (owner = $2 OR lease_until IS NULL OR lease_until < now()))) RETURNING index_id",
        index_id, owner, lease_seconds)
    return row is not None


async def renew_generation(pool: Any, index_id: str, owner: str, lease_seconds: int,
                           embedding_calls: int = 0) -> bool:
    row = await pool.fetchrow(
        "UPDATE semantic_graph_search.index_generations "
        "SET lease_until = now() + make_interval(secs => $3), embedding_calls = embedding_calls + $4 "
        "WHERE index_id = $1::uuid AND state = 'indexing' AND owner = $2 RETURNING index_id",
        index_id, owner, lease_seconds, embedding_calls)
    return row is not None


async def insert_documents(pool: Any, index_id: str, documents: list[dict[str, Any]]) -> None:
    if not documents:
        return
    await pool.executemany(
        "INSERT INTO semantic_graph_search.entity_documents "
        "(index_id, entity_id, concept_id, label, label_key, source_workspaces, search_text, lexical, "
        " content_hash, status, diagnostics) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6::text[], $7, to_tsvector('simple', $8), $9, $10, $11::jsonb) "
        "ON CONFLICT (index_id, entity_id) DO NOTHING",
        [(index_id, document["entityId"], document["conceptId"], document["label"],
          document["labelKey"], document["sourceWorkspaces"], document["searchText"],
          document["lexicalText"], document["contentHash"],
          "exact_only" if document["exactOnly"] else "pending",
          json.dumps(document["diagnostics"], sort_keys=True))
         for document in documents])


async def insert_passages(pool: Any, index_id: str, documents: list[dict[str, Any]]) -> int:
    """The passages of ``documents`` (``build_document`` shape); returns how many."""
    rows = [(index_id, document["entityId"], passage["ordinal"], document["conceptId"],
             passage["fieldKey"], passage["fieldLabel"], passage["start"], passage["end"],
             passage["text"], passage["searchText"], passage["lexicalText"], passage["contentHash"],
             document["sourceWorkspaces"])
            for document in documents for passage in document.get("passages") or []]
    if rows:
        await pool.executemany(
            "INSERT INTO semantic_graph_search.entity_passages "
            "(index_id, entity_id, ordinal, concept_id, field_key, field_label, start_offset, end_offset, "
            " passage_text, search_text, lexical, content_hash, status, source_workspaces) "
            "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, to_tsvector('simple', $11), $12, "
            "'pending', $13::text[]) ON CONFLICT (index_id, entity_id, ordinal) DO NOTHING", rows)
    return len(rows)


_VECTOR_TABLES = {"documents": "semantic_graph_search.entity_documents",
                  "passages": "semantic_graph_search.entity_passages"}


async def fill_from_cache(pool: Any, index_id: str, model_id: str, fingerprint: str,
                          kind: str = "documents") -> int:
    """Reuse vectors already computed for the same text: no model call. ``kind``: documents
    or passages (one cache: a vector depends only on the text and the profile)."""
    result = await pool.execute(
        f"UPDATE {_VECTOR_TABLES[kind]} document "
        "SET embedding = cache.embedding, status = 'ready' "
        "FROM semantic_graph_search.embedding_cache cache "
        "WHERE document.index_id = $1::uuid AND document.status = 'pending' "
        "AND cache.model_id = $2 AND cache.embedding_fingerprint = $3 "
        "AND cache.content_hash = document.content_hash",
        index_id, model_id, fingerprint)
    reused = int(result.split()[-1]) if isinstance(result, str) and result.startswith("UPDATE") else 0
    if reused:
        await pool.execute(
            "UPDATE semantic_graph_search.index_generations SET reused_count = reused_count + $2 "
            "WHERE index_id = $1::uuid", index_id, reused)
    return reused


async def pending_documents(pool: Any, index_id: str, limit: int) -> list[dict[str, Any]]:
    rows = await pool.fetch(
        "SELECT entity_id, search_text, content_hash FROM semantic_graph_search.entity_documents "
        "WHERE index_id = $1::uuid AND status = 'pending' ORDER BY entity_id LIMIT $2",
        index_id, limit)
    return [dict(row) for row in rows]


async def pending_passages(pool: Any, index_id: str, limit: int) -> list[dict[str, Any]]:
    rows = await pool.fetch(
        "SELECT entity_id, ordinal, search_text, content_hash FROM semantic_graph_search.entity_passages "
        "WHERE index_id = $1::uuid AND status = 'pending' ORDER BY entity_id, ordinal LIMIT $2",
        index_id, limit)
    return [dict(row) for row in rows]


async def store_passage_vectors(pool: Any, *, index_id: str, model_id: str, fingerprint: str,
                                vectors: list[tuple[str, int, str, str]]) -> None:
    """``vectors``: (entity_id, ordinal, content_hash, pgvector text). One transaction per batch."""
    async with pool.acquire() as connection:
        async with connection.transaction():
            await connection.executemany(
                "UPDATE semantic_graph_search.entity_passages "
                "SET embedding = $4::text::halfvec, status = 'ready' "
                "WHERE index_id = $1::uuid AND entity_id = $2 AND ordinal = $3 AND status = 'pending'",
                [(index_id, entity_id, ordinal, vector) for entity_id, ordinal, _, vector in vectors])
            await connection.executemany(
                "INSERT INTO semantic_graph_search.embedding_cache "
                "(model_id, embedding_fingerprint, content_hash, embedding) "
                "VALUES ($1, $2, $3, $4::text::halfvec) ON CONFLICT DO NOTHING",
                [(model_id, fingerprint, content_hash, vector)
                 for _, _, content_hash, vector in vectors])


async def store_vectors(pool: Any, *, index_id: str, model_id: str, fingerprint: str,
                        vectors: list[tuple[str, str, str]]) -> None:
    """``vectors``: (entity_id, content_hash, pgvector text). One transaction per batch."""
    async with pool.acquire() as connection:
        async with connection.transaction():
            await connection.executemany(
                "UPDATE semantic_graph_search.entity_documents "
                "SET embedding = $3::text::halfvec, status = 'ready' "
                "WHERE index_id = $1::uuid AND entity_id = $2 AND status = 'pending'",
                [(index_id, entity_id, vector) for entity_id, _, vector in vectors])
            await connection.executemany(
                "INSERT INTO semantic_graph_search.embedding_cache "
                "(model_id, embedding_fingerprint, content_hash, embedding) "
                "VALUES ($1, $2, $3, $4::text::halfvec) ON CONFLICT DO NOTHING",
                [(model_id, fingerprint, content_hash, vector)
                 for _, content_hash, vector in vectors])


async def finish_generation(pool: Any, index_id: str, owner: str, expected_count: int) -> str:
    """``ready`` when every record of the revision has a vector or is key-only, and every
    passage has a vector."""
    row = await pool.fetchrow(
        "SELECT count(*) AS total, count(*) FILTER (WHERE status = 'ready') AS ready, "
        "count(*) FILTER (WHERE status = 'exact_only') AS exact_only, "
        "count(*) FILTER (WHERE status = 'pending') AS pending, "
        "count(*) FILTER (WHERE diagnostics ? 'truncatedPassageFields') AS truncated "
        "FROM semantic_graph_search.entity_documents WHERE index_id = $1::uuid", index_id)
    passages = await pool.fetchrow(
        "SELECT count(*) AS total, count(*) FILTER (WHERE status = 'ready') AS ready "
        "FROM semantic_graph_search.entity_passages WHERE index_id = $1::uuid", index_id)
    complete = (int(row["total"]) == expected_count and int(row["pending"]) == 0
                and int(passages["ready"]) == int(passages["total"]))
    state = "ready" if complete else "failed"
    updated = await pool.fetchrow(
        "UPDATE semantic_graph_search.index_generations "
        "SET state = $3, owner = NULL, lease_until = NULL, expected_count = $4, "
        "indexed_count = $5, exact_only_count = $6, failed_count = $7, "
        "passage_count = $8, passage_indexed_count = $9, passage_truncated_count = $10, "
        "last_error_code = CASE WHEN $3 = 'ready' THEN NULL ELSE 'index_incomplete' END, "
        "completed_at = CASE WHEN $3 = 'ready' THEN now() ELSE NULL END "
        "WHERE index_id = $1::uuid AND state = 'indexing' AND owner = $2 RETURNING state",
        index_id, owner, state, expected_count, int(row["ready"]), int(row["exact_only"]),
        int(row["pending"]), int(passages["total"]), int(passages["ready"]), int(row["truncated"]))
    return updated["state"] if updated else "lease_lost"


async def fail_generation(pool: Any, index_id: str, error_code: str, owner: str | None = None) -> None:
    await pool.execute(
        "UPDATE semantic_graph_search.index_generations "
        "SET state = 'failed', owner = NULL, lease_until = NULL, last_error_code = $2 "
        "WHERE index_id = $1::uuid AND state IN ('queued', 'indexing') "
        "AND ($3::text IS NULL OR owner = $3)",
        index_id, error_code[:100], owner)


async def prune_generations(pool: Any, model_id: str, keep_recent: int = 2) -> int:
    """Drop generations no binding serves, beyond the most recent few ready ones."""
    result = await pool.execute(
        "DELETE FROM semantic_graph_search.index_generations generation "
        "WHERE generation.model_id = $1 AND generation.state IN ('ready', 'failed') "
        "AND NOT EXISTS (SELECT 1 FROM semantic_runtime.active_bindings binding "
        "  WHERE binding.model_id = generation.model_id "
        "  AND binding.data_revision_id = generation.data_revision_id) "
        "AND generation.index_id NOT IN (SELECT recent.index_id "
        "  FROM semantic_graph_search.index_generations recent "
        "  WHERE recent.model_id = $1 AND recent.state = 'ready' "
        "  ORDER BY recent.created_at DESC LIMIT $2)",
        model_id, keep_recent)
    return int(result.split()[-1]) if isinstance(result, str) and result.startswith("DELETE") else 0


# Reads ---------------------------------------------------------------------

_VISIBLE = "($3::text[] IS NULL OR source_workspaces <@ $3::text[])"


async def lexical_candidates(pool: Any, index_id: str, terms: list[str], label_query: str,
                             concept_ids: list[str] | None, allowed_workspaces: list[str] | None,
                             limit: int) -> list[dict[str, Any]]:
    """Records sharing words with the query, or whose name looks like it."""
    tsquery = " | ".join(terms) if terms else None
    rows = await pool.fetch(
        "SELECT entity_id, "
        "  COALESCE(ts_rank_cd(lexical, to_tsquery('simple', $4)), 0) "
        "  + similarity(label_key, $5) AS score "
        "FROM semantic_graph_search.entity_documents "
        f"WHERE index_id = $1::uuid AND ($2::text[] IS NULL OR concept_id = ANY($2::text[])) AND {_VISIBLE} "
        "AND (($4::text IS NOT NULL AND lexical @@ to_tsquery('simple', $4)) "
        "     OR ($5 <> '' AND label_key % $5)) "
        "ORDER BY score DESC, entity_id LIMIT $6",
        index_id, concept_ids, allowed_workspaces, tsquery, label_query, limit)
    return [{"entityId": row["entity_id"], "score": float(row["score"])} for row in rows]


async def vector_candidates(pool: Any, index_id: str, vector: str, concept_ids: list[str] | None,
                            allowed_workspaces: list[str] | None, limit: int) -> list[dict[str, Any]]:
    """Exact cosine nearest records (no approximate index: the reference ranking)."""
    rows = await pool.fetch(
        "SELECT entity_id, 1 - (embedding <=> $4::text::halfvec) AS similarity "
        "FROM semantic_graph_search.entity_documents "
        f"WHERE index_id = $1::uuid AND ($2::text[] IS NULL OR concept_id = ANY($2::text[])) AND {_VISIBLE} "
        "AND status = 'ready' "
        "ORDER BY embedding <=> $4::text::halfvec, entity_id LIMIT $5",
        index_id, concept_ids, allowed_workspaces, vector, limit)
    return [{"entityId": row["entity_id"], "similarity": float(row["similarity"])} for row in rows]


PASSAGES_PER_RECORD = 2


def _passage_hits(rows: list[Any], score: str) -> list[dict[str, Any]]:
    """Rows (one per kept passage, best first per record) grouped by record, in record order."""
    records: dict[str, dict[str, Any]] = {}
    for row in rows:
        record = records.setdefault(row["entity_id"], {"entityId": row["entity_id"], score: float(row[score]),
                                                       "passages": []})
        record["passages"].append({"ordinal": int(row["ordinal"]), score: float(row[score])})
    return list(records.values())


async def lexical_passage_candidates(pool: Any, index_id: str, terms: list[str],
                                     concept_ids: list[str] | None, allowed_workspaces: list[str] | None,
                                     limit: int, per_record: int = PASSAGES_PER_RECORD) -> list[dict[str, Any]]:
    """Records with a passage sharing words with the query, ranked by their best passage;
    each with its best ``per_record`` passages."""
    if not terms:
        return []
    rows = await pool.fetch(
        "WITH scored AS ("
        "  SELECT entity_id, ordinal, ts_rank_cd(lexical, to_tsquery('simple', $4)) AS score "
        "  FROM semantic_graph_search.entity_passages "
        f"  WHERE index_id = $1::uuid AND ($2::text[] IS NULL OR concept_id = ANY($2::text[])) AND {_VISIBLE} "
        "  AND lexical @@ to_tsquery('simple', $4)), "
        "ranked AS (SELECT *, row_number() OVER (PARTITION BY entity_id ORDER BY score DESC, ordinal) AS place "
        "  FROM scored), "
        "best AS (SELECT entity_id, score FROM ranked WHERE place = 1 ORDER BY score DESC, entity_id LIMIT $5) "
        "SELECT ranked.entity_id, ranked.ordinal, ranked.score FROM ranked JOIN best USING (entity_id) "
        "WHERE ranked.place <= $6 ORDER BY best.score DESC, ranked.entity_id, ranked.place",
        index_id, concept_ids, allowed_workspaces, " | ".join(terms), limit, per_record)
    return _passage_hits(rows, "score")


async def vector_passage_candidates(pool: Any, index_id: str, vector: str, concept_ids: list[str] | None,
                                    allowed_workspaces: list[str] | None, limit: int,
                                    per_record: int = PASSAGES_PER_RECORD) -> list[dict[str, Any]]:
    """Records with the passages nearest the query (exact cosine), ranked by their best
    passage; each with its best ``per_record`` passages."""
    rows = await pool.fetch(
        "WITH scored AS ("
        "  SELECT entity_id, ordinal, 1 - (embedding <=> $4::text::halfvec) AS similarity "
        "  FROM semantic_graph_search.entity_passages "
        f"  WHERE index_id = $1::uuid AND ($2::text[] IS NULL OR concept_id = ANY($2::text[])) AND {_VISIBLE} "
        "  AND status = 'ready'), "
        "ranked AS (SELECT *, row_number() OVER (PARTITION BY entity_id ORDER BY similarity DESC, ordinal) "
        "  AS place FROM scored), "
        "best AS (SELECT entity_id, similarity FROM ranked WHERE place = 1 "
        "  ORDER BY similarity DESC, entity_id LIMIT $5) "
        "SELECT ranked.entity_id, ranked.ordinal, ranked.similarity FROM ranked JOIN best USING (entity_id) "
        "WHERE ranked.place <= $6 ORDER BY best.similarity DESC, ranked.entity_id, ranked.place",
        index_id, concept_ids, allowed_workspaces, vector, limit, per_record)
    return _passage_hits(rows, "similarity")


async def passage_texts(pool: Any, index_id: str, keys: list[tuple[str, int]]) -> dict[tuple[str, int], dict[str, Any]]:
    """Field, offsets and text of some passages, by (entity_id, ordinal)."""
    if not keys:
        return {}
    rows = await pool.fetch(
        "SELECT passage.entity_id, passage.ordinal, passage.field_key, passage.field_label, "
        "passage.start_offset, passage.end_offset, passage.passage_text "
        "FROM semantic_graph_search.entity_passages passage "
        "JOIN unnest($2::text[], $3::int[]) AS wanted(entity_id, ordinal) "
        "  ON wanted.entity_id = passage.entity_id AND wanted.ordinal = passage.ordinal "
        "WHERE passage.index_id = $1::uuid",
        index_id, [key[0] for key in keys], [key[1] for key in keys])
    return {(row["entity_id"], int(row["ordinal"])): {
        "fieldKey": row["field_key"], "fieldLabel": row["field_label"], "start": int(row["start_offset"]),
        "end": int(row["end_offset"]), "text": row["passage_text"]} for row in rows}


async def exact_entity_ids(pool: Any, revision_id: str, text: str, identity_value: str | None,
                           concept_ids: list[str] | None, limit: int = 25) -> list[str]:
    """Records whose id, name or one key value is exactly the query (case aside).
    Reads the revision itself, so it works before the search index is ready."""
    rows = await pool.fetch(
        "SELECT id FROM semantic_population.entities "
        "WHERE data_revision_id = $1 AND ($4::text[] IS NULL OR concept_id = ANY($4::text[])) "
        "AND (id = $2 OR lower(label) = lower($2) OR ($3::text IS NOT NULL AND EXISTS ("
        "  SELECT 1 FROM jsonb_each_text(identity_key::jsonb) key WHERE key.value = $3))) "
        "ORDER BY id LIMIT $5",
        revision_id, text, identity_value, concept_ids, limit)
    return [row["id"] for row in rows]


async def entity_rows(pool: Any, revision_id: str, entity_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not entity_ids:
        return {}
    rows = await pool.fetch(
        "SELECT id, concept_id, label, identity_key, provenance FROM semantic_population.entities "
        "WHERE data_revision_id = $1 AND id = ANY($2::text[])", revision_id, list(entity_ids))
    result = {}
    for row in rows:
        identity = row["identity_key"]
        provenance = row["provenance"]
        result[row["id"]] = {
            "entityId": row["id"], "conceptId": row["concept_id"], "label": row["label"],
            "identity": json.loads(identity) if isinstance(identity, str) else dict(identity or {}),
            "provenance": json.loads(provenance) if isinstance(provenance, str) else dict(provenance or {}),
        }
    return result


async def document_texts(pool: Any, index_id: str, entity_ids: list[str]) -> dict[str, str]:
    if not entity_ids:
        return {}
    rows = await pool.fetch(
        "SELECT entity_id, search_text FROM semantic_graph_search.entity_documents "
        "WHERE index_id = $1::uuid AND entity_id = ANY($2::text[])", index_id, entity_ids)
    return {row["entity_id"]: row["search_text"] for row in rows}
