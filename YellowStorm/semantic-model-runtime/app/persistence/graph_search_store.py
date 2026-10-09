"""Graph search persistence (``semantic_graph_search``, migrations 022, 024, 025, 028, 030, 031 and 034).

A generation holds the search documents of one data revision for one
embedding profile. Indexers own a generation through a lease so a duplicate
delivery never writes alongside a live one; ``ready`` is final.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from app.persistence.partitions import (drop_generation_partitions, ensure_generation_partitions,
                                        with_partition_locks)

# A build with no progress for this long reads as stalled even before its lease runs out. Longer
# than the longest embedding call a build waits for.
STALL_AFTER_SECONDS = 600

_GENERATION_COLUMNS = (
    "index_id::text, model_id, data_revision_id, projection_ref, spec_hash, embedding_fingerprint, "
    "state, attempt, owner, job_id::text, expected_count, indexed_count, exact_only_count, "
    "failed_count, reused_count, embedding_calls, last_error_code, created_at, completed_at, "
    "passage_count, passage_indexed_count, passage_truncated_count, index_settings, vector_fingerprint, "
    "progress_stage, loaded_count, progress_at AS last_progress_at, "
    "COALESCE(state = 'indexing' AND (lease_until < now() "
    f"OR progress_at < now() - make_interval(secs => {STALL_AFTER_SECONDS})), false) AS stalled")

# Word index of a text: its words as written, and their French and English stems.
_LEXICAL_CONFIGS = ("simple", "french", "english")


def _tsvector(param: str) -> str:
    return " || ".join(f"to_tsvector('{config}', {param})" for config in _LEXICAL_CONFIGS)


def _tsquery(param: str) -> str:
    """A request (``documents.lexical_query`` text) matched as written or by its stems."""
    return "(" + " || ".join(f"to_tsquery('{config}', {param})" for config in _LEXICAL_CONFIGS) + ")"


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
    progressed = generation.get("last_progress_at")
    return {"indexId": generation["index_id"], "state": generation["state"],
            "embeddingFingerprint": generation["embedding_fingerprint"],
            "expectedCount": generation["expected_count"], "indexedCount": generation["indexed_count"],
            "exactOnlyCount": generation["exact_only_count"], "failedCount": generation["failed_count"],
            "reusedCount": generation["reused_count"], "embeddingCalls": generation["embedding_calls"],
            "lastErrorCode": generation["last_error_code"],
            "passageCount": generation.get("passage_count", 0),
            "passageIndexedCount": generation.get("passage_indexed_count", 0),
            "passageTruncatedCount": generation.get("passage_truncated_count", 0),
            "stage": generation.get("progress_stage") if generation["state"] == "indexing" else None,
            "loadedCount": generation.get("loaded_count", 0),
            # The worker stopped answering (lease expired, or no progress for a long while): what was
            # embedded is kept, and the build can be restarted.
            "stalled": bool(generation.get("stalled")),
            "lastProgressAt": progressed.isoformat() if hasattr(progressed, "isoformat") else progressed,
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


class _GenerationExists(Exception):
    """Another caller created the generation first; the partitions made for this attempt are undone."""


async def create_generation(pool: Any, *, model_id: str, data_revision_id: str, projection_ref: str,
                            spec_hash: str, fingerprint: str,
                            index_settings: dict[str, Any] | None = None,
                            vector_fingerprint: str | None = None) -> dict[str, Any]:
    """The generation of this revision and embedding profile, created with its partitions (migration
    031) when it does not exist. The id is chosen here so the partitions exist before the row: attaching
    them locks the generations table, and that must not upgrade a row lock."""
    if await get_generation(pool, data_revision_id, fingerprint) is None:
        index_id = str(uuid.uuid4())

        async def create(connection: Any) -> None:
            await ensure_generation_partitions(connection, index_id)
            row = await connection.fetchrow(
                "INSERT INTO semantic_graph_search.index_generations "
                "(index_id, model_id, data_revision_id, projection_ref, spec_hash, embedding_fingerprint, "
                " index_settings, vector_fingerprint) "
                "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8) "
                "ON CONFLICT (data_revision_id, embedding_fingerprint) DO NOTHING RETURNING index_id",
                index_id, model_id, data_revision_id, projection_ref, spec_hash, fingerprint,
                json.dumps(index_settings, sort_keys=True) if index_settings is not None else None,
                vector_fingerprint)
            if row is None:
                raise _GenerationExists()

        try:
            await with_partition_locks(pool, create)
        except _GenerationExists:
            pass
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
        "progress_at = now(), last_error_code = NULL "
        "WHERE index_id = $1::uuid AND (state = 'queued' OR (state = 'indexing' "
        "AND (owner = $2 OR lease_until IS NULL OR lease_until < now()))) RETURNING index_id",
        index_id, owner, lease_seconds)
    return row is not None


async def adopt_generation(pool: Any, index_id: str, job_id: str, owner: str) -> bool:
    """Take over a generation another attempt of the same job left held. The caller holds the job's
    task lease, which is exclusive: whoever owned the generation under this job is gone (a crashed
    attempt, a restarted worker), so waiting for its lease to run out only strands the build."""
    row = await pool.fetchrow(
        "UPDATE semantic_graph_search.index_generations SET owner = NULL, lease_until = NULL "
        "WHERE index_id = $1::uuid AND state = 'indexing' AND job_id = $2::uuid "
        "AND owner IS NOT NULL AND owner <> $3 RETURNING index_id", index_id, job_id, owner)
    return row is not None


async def renew_generation(pool: Any, index_id: str, owner: str, lease_seconds: int,
                           embedding_calls: int = 0) -> bool:
    """Extend the lease. Callers renew only after real progress (a wave stored, a page read, a chunk
    reused), never on a timer: a build that stops progressing must let its lease run out."""
    row = await pool.fetchrow(
        "UPDATE semantic_graph_search.index_generations "
        "SET lease_until = now() + make_interval(secs => $3), progress_at = now(), "
        "embedding_calls = embedding_calls + $4 "
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
        f"VALUES ($1::uuid, $2, $3, $4, $5, $6::text[], $7, {_tsvector('$8')}, $9, $10, $11::jsonb) "
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
            f"VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, {_tsvector('$11')}, $12, "
            "'pending', $13::text[]) ON CONFLICT (index_id, entity_id, ordinal) DO NOTHING", rows)
    return len(rows)


_VECTOR_TABLES = {"documents": "semantic_graph_search.entity_documents",
                  "passages": "semantic_graph_search.entity_passages"}


# Rows reused per statement: each one is written into the vector index (HNSW), so a bounded chunk keeps
# a statement well inside the worker's statement timeout, however large the revision.
CACHE_FILL_CHUNK_ROWS = 500


async def fill_from_cache(pool: Any, index_id: str, model_id: str, fingerprint: str | list[str],
                          kind: str = "documents", *, chunk_rows: int = CACHE_FILL_CHUNK_ROWS,
                          on_chunk: Callable[[int], Awaitable[bool]] | None = None) -> int:
    """Reuse vectors already computed for the same text: no model call. ``kind``: documents
    or passages (one cache: a vector depends only on the text and the vector space);
    ``fingerprint``: the cache keys of that space.

    Works ``chunk_rows`` records at a time, in record order (a record's passages go together), so no
    statement outgrows the timeout on a revision of hundreds of thousands. ``on_chunk`` receives the
    rows reused so far after each chunk and returns False to stop (the build was stopped, or lost its lease);
    what was reused stays reused. Returns the rows reused."""
    fingerprints = [fingerprint] if isinstance(fingerprint, str) else list(fingerprint)
    table = _VECTOR_TABLES[kind]
    reused = 0
    after = ""
    while True:
        row = await pool.fetchrow(
            "WITH chunk AS ("
            f"  SELECT DISTINCT entity_id FROM {table} "
            "   WHERE index_id = $1::uuid AND status = 'pending' AND entity_id > $2 "
            "   ORDER BY entity_id LIMIT $3), "
            f"updated AS (UPDATE {table} document "
            "  SET embedding = cache.embedding, status = 'ready' "
            "  FROM semantic_graph_search.embedding_cache cache "
            "  WHERE document.index_id = $1::uuid AND document.status = 'pending' "
            "  AND document.entity_id IN (SELECT entity_id FROM chunk) "
            "  AND cache.model_id = $4 AND cache.embedding_fingerprint = ANY($5::text[]) "
            "  AND cache.content_hash = document.content_hash RETURNING 1) "
            "SELECT (SELECT count(*) FROM updated) AS reused, (SELECT max(entity_id) FROM chunk) AS last_entity",
            index_id, after, chunk_rows, model_id, fingerprints)
        if row is None or row["last_entity"] is None:
            break
        after = row["last_entity"]
        if row["reused"]:
            reused += int(row["reused"])
            await pool.execute(
                "UPDATE semantic_graph_search.index_generations SET reused_count = reused_count + $2 "
                "WHERE index_id = $1::uuid", index_id, int(row["reused"]))
        if on_chunk is not None and not await on_chunk(reused):
            break
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


async def generation_counts(pool: Any, index_id: str) -> dict[str, int]:
    """What the generation holds now, counted in its tables: records by status, passages."""
    row = await pool.fetchrow(
        "SELECT count(*) AS total, count(*) FILTER (WHERE status = 'ready') AS ready, "
        "count(*) FILTER (WHERE status = 'exact_only') AS exact_only, "
        "count(*) FILTER (WHERE status = 'pending') AS pending, "
        "count(*) FILTER (WHERE diagnostics ? 'truncatedPassageFields') AS truncated "
        "FROM semantic_graph_search.entity_documents WHERE index_id = $1::uuid", index_id)
    passages = await pool.fetchrow(
        "SELECT count(*) AS total, count(*) FILTER (WHERE status = 'ready') AS ready "
        "FROM semantic_graph_search.entity_passages WHERE index_id = $1::uuid", index_id)
    return {"total": int(row["total"]), "ready": int(row["ready"]), "exact_only": int(row["exact_only"]),
            "pending": int(row["pending"]), "truncated": int(row["truncated"]),
            "passages": int(passages["total"]), "passages_ready": int(passages["ready"])}


async def record_progress(pool: Any, index_id: str, owner: str, *, stage: str, loaded: int, expected: int,
                          indexed: int = 0, exact_only: int = 0, passages: int = 0,
                          passages_indexed: int = 0) -> None:
    """Where the build is, for whoever follows it: one cheap update per batch, not per record. The
    final counts are set by ``finish_generation``."""
    await pool.execute(
        "UPDATE semantic_graph_search.index_generations "
        "SET progress_stage = $3, loaded_count = $4, expected_count = $5, indexed_count = $6, "
        "exact_only_count = $7, passage_count = $8, passage_indexed_count = $9 "
        "WHERE index_id = $1::uuid AND state = 'indexing' AND owner = $2",
        index_id, owner, stage, loaded, expected, indexed, exact_only, passages, passages_indexed)


async def finish_generation(pool: Any, index_id: str, owner: str, expected_count: int) -> str:
    """``ready`` when every record of the revision has a vector or is key-only, and every
    passage has a vector."""
    counts = await generation_counts(pool, index_id)
    complete = (counts["total"] == expected_count and counts["pending"] == 0
                and counts["passages_ready"] == counts["passages"])
    state = "ready" if complete else "failed"
    updated = await pool.fetchrow(
        "UPDATE semantic_graph_search.index_generations "
        "SET state = $3, owner = NULL, lease_until = NULL, expected_count = $4, "
        "indexed_count = $5, exact_only_count = $6, failed_count = $7, "
        "passage_count = $8, passage_indexed_count = $9, passage_truncated_count = $10, "
        "progress_stage = NULL, loaded_count = $4, "
        "last_error_code = CASE WHEN $3 = 'ready' THEN NULL ELSE 'index_incomplete' END, "
        "completed_at = CASE WHEN $3 = 'ready' THEN now() ELSE NULL END "
        "WHERE index_id = $1::uuid AND state = 'indexing' AND owner = $2 RETURNING state",
        index_id, owner, state, expected_count, counts["ready"], counts["exact_only"], counts["pending"],
        counts["passages"], counts["passages_ready"], counts["truncated"])
    return updated["state"] if updated else "lease_lost"


async def fail_generation(pool: Any, index_id: str, error_code: str, owner: str | None = None) -> None:
    await pool.execute(
        "UPDATE semantic_graph_search.index_generations "
        "SET state = 'failed', owner = NULL, lease_until = NULL, last_error_code = $2 "
        "WHERE index_id = $1::uuid AND state IN ('queued', 'indexing') "
        "AND ($3::text IS NULL OR owner = $3)",
        index_id, error_code[:100], owner)


async def prune_generations(pool: Any, model_id: str, keep_recent: int = 2) -> int:
    """Drop generations no binding serves, beyond the most recent few ready ones: their partitions
    first, then their rows."""
    async def prune(connection: Any) -> int:
        rows = await connection.fetch(
            "SELECT generation.index_id::text AS index_id FROM semantic_graph_search.index_generations generation "
            "WHERE generation.model_id = $1 AND generation.state IN ('ready', 'failed') "
            "AND NOT EXISTS (SELECT 1 FROM semantic_runtime.active_bindings binding "
            "  WHERE binding.model_id = generation.model_id "
            "  AND binding.data_revision_id = generation.data_revision_id) "
            "AND generation.index_id NOT IN (SELECT recent.index_id "
            "  FROM semantic_graph_search.index_generations recent "
            "  WHERE recent.model_id = $1 AND recent.state = 'ready' "
            "  ORDER BY recent.created_at DESC LIMIT $2) "
            "FOR UPDATE OF generation",
            model_id, keep_recent)
        index_ids = [row["index_id"] for row in rows]
        await drop_generation_partitions(connection, index_ids)
        result = await connection.execute(
            "DELETE FROM semantic_graph_search.index_generations WHERE index_id = ANY($1::uuid[])", index_ids)
        return int(result.split()[-1]) if isinstance(result, str) and result.startswith("DELETE") else 0

    return await with_partition_locks(pool, prune)


# Reads ---------------------------------------------------------------------

_VISIBLE = "($3::text[] IS NULL OR source_workspaces <@ $3::text[])"


async def lexical_candidates(pool: Any, index_id: str, tsquery: str | None, label_query: str,
                             concept_ids: list[str] | None, allowed_workspaces: list[str] | None,
                             limit: int) -> list[dict[str, Any]]:
    """Records sharing words with the query (``documents.lexical_query``), or whose name looks
    like it."""
    rows = await pool.fetch(
        "SELECT entity_id, "
        f"  COALESCE(ts_rank_cd(lexical, {_tsquery('$4')}), 0) "
        "  + similarity(label_key, $5) AS score "
        "FROM semantic_graph_search.entity_documents "
        f"WHERE index_id = $1::uuid AND ($2::text[] IS NULL OR concept_id = ANY($2::text[])) AND {_VISIBLE} "
        f"AND (($4::text IS NOT NULL AND lexical @@ {_tsquery('$4')}) "
        "     OR ($5 <> '' AND label_key % $5)) "
        "ORDER BY score DESC, entity_id LIMIT $6",
        index_id, concept_ids, allowed_workspaces, tsquery, label_query, limit)
    return [{"entityId": row["entity_id"], "score": float(row["score"])} for row in rows]


# Neighbours an approximate (HNSW) scan looks at, at least: more finds the true nearest more often.
MIN_EF_SEARCH = 100
# Passages looked at per record wanted, before keeping each record's best ones.
PASSAGES_SCANNED_PER_RECORD = 8


async def _nearest(pool: Any, sql: str, *args: Any, wanted: int) -> list[Any]:
    """Run a nearest-neighbour query through the HNSW index. The filters (generation, concept,
    workspaces) are applied while the index is walked (iterative scan), so a narrow filter
    still gets ``wanted`` rows; their order is fixed by the outer ORDER BY."""
    acquire = getattr(pool, "acquire", None)
    if acquire is None:  # a single connection (tests, scripts)
        return await pool.fetch(sql, *args)
    async with acquire() as connection, connection.transaction():
        await connection.execute(f"SET LOCAL hnsw.ef_search = {max(MIN_EF_SEARCH, min(wanted, 1000))}")
        await connection.execute("SET LOCAL hnsw.iterative_scan = relaxed_order")
        return await connection.fetch(sql, *args)


async def vector_candidates(pool: Any, index_id: str, vector: str, concept_ids: list[str] | None,
                            allowed_workspaces: list[str] | None, limit: int) -> list[dict[str, Any]]:
    """The cosine-nearest records, through the vector index (approximate, very close to exact)."""
    rows = await _nearest(
        pool,
        "SELECT entity_id, 1 - distance AS similarity FROM ("
        "  SELECT entity_id, embedding <=> $4::text::halfvec AS distance "
        "  FROM semantic_graph_search.entity_documents "
        f"  WHERE index_id = $1::uuid AND ($2::text[] IS NULL OR concept_id = ANY($2::text[])) AND {_VISIBLE} "
        "  AND status = 'ready' "
        "  ORDER BY embedding <=> $4::text::halfvec LIMIT $5) nearest "
        "ORDER BY distance, entity_id",
        index_id, concept_ids, allowed_workspaces, vector, limit, wanted=limit)
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


async def lexical_passage_candidates(pool: Any, index_id: str, tsquery: str | None,
                                     concept_ids: list[str] | None, allowed_workspaces: list[str] | None,
                                     limit: int, per_record: int = PASSAGES_PER_RECORD) -> list[dict[str, Any]]:
    """Records with a passage sharing words with the query (``documents.lexical_query``), ranked
    by their best passage; each with its best ``per_record`` passages."""
    if not tsquery:
        return []
    rows = await pool.fetch(
        "WITH scored AS ("
        f"  SELECT entity_id, ordinal, ts_rank_cd(lexical, {_tsquery('$4')}) AS score "
        "  FROM semantic_graph_search.entity_passages "
        f"  WHERE index_id = $1::uuid AND ($2::text[] IS NULL OR concept_id = ANY($2::text[])) AND {_VISIBLE} "
        f"  AND lexical @@ {_tsquery('$4')}), "
        "ranked AS (SELECT *, row_number() OVER (PARTITION BY entity_id ORDER BY score DESC, ordinal) AS place "
        "  FROM scored), "
        "best AS (SELECT entity_id, score FROM ranked WHERE place = 1 ORDER BY score DESC, entity_id LIMIT $5) "
        "SELECT ranked.entity_id, ranked.ordinal, ranked.score FROM ranked JOIN best USING (entity_id) "
        "WHERE ranked.place <= $6 ORDER BY best.score DESC, ranked.entity_id, ranked.place",
        index_id, concept_ids, allowed_workspaces, tsquery, limit, per_record)
    return _passage_hits(rows, "score")


async def vector_passage_candidates(pool: Any, index_id: str, vector: str, concept_ids: list[str] | None,
                                    allowed_workspaces: list[str] | None, limit: int,
                                    per_record: int = PASSAGES_PER_RECORD) -> list[dict[str, Any]]:
    """Records with the passages nearest the query (cosine, through the vector index), ranked by
    their best passage; each with its best ``per_record`` passages among the nearest ones."""
    scanned = limit * max(per_record, PASSAGES_SCANNED_PER_RECORD)
    rows = await _nearest(
        pool,
        "WITH scored AS ("
        "  SELECT entity_id, ordinal, 1 - (embedding <=> $4::text::halfvec) AS similarity "
        "  FROM semantic_graph_search.entity_passages "
        f"  WHERE index_id = $1::uuid AND ($2::text[] IS NULL OR concept_id = ANY($2::text[])) AND {_VISIBLE} "
        "  AND status = 'ready' ORDER BY embedding <=> $4::text::halfvec LIMIT $7), "
        "ranked AS (SELECT *, row_number() OVER (PARTITION BY entity_id ORDER BY similarity DESC, ordinal) "
        "  AS place FROM scored), "
        "best AS (SELECT entity_id, similarity FROM ranked WHERE place = 1 "
        "  ORDER BY similarity DESC, entity_id LIMIT $5) "
        "SELECT ranked.entity_id, ranked.ordinal, ranked.similarity FROM ranked JOIN best USING (entity_id) "
        "WHERE ranked.place <= $6 ORDER BY best.similarity DESC, ranked.entity_id, ranked.place",
        index_id, concept_ids, allowed_workspaces, vector, limit, per_record, scanned, wanted=scanned)
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
                           concept_ids: list[str] | None, allowed_workspaces: list[str] | None = None,
                           limit: int = 25) -> list[str]:
    """Records whose id, name or one key value is exactly the query (case aside), that the actor
    may read: the limit applies to those, so records hidden from them never crowd out a readable one.
    Reads the revision itself, so it works before the search index is ready."""
    rows = await pool.fetch(
        "SELECT id FROM semantic_population.entities entity "
        "WHERE data_revision_id = $1 AND ($4::text[] IS NULL OR concept_id = ANY($4::text[])) "
        "AND (id = $2 OR lower(label) = lower($2) OR ($3::text IS NOT NULL AND EXISTS ("
        "  SELECT 1 FROM jsonb_each_text(identity_key::jsonb) key WHERE key.value = $3))) "
        f"AND {_readable('entity', '$6')} "
        "ORDER BY id LIMIT $5",
        revision_id, text, identity_value, concept_ids, limit, allowed_workspaces)
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


async def fallback_generation(pool: Any, model_id: str, data_revision_id: str) -> dict[str, Any] | None:
    """The ready generation to search while the wanted one is built: the revision's own (other
    settings or text format) first, else the model's most recent one (earlier data)."""
    return _generation(await pool.fetchrow(
        f"SELECT {_GENERATION_COLUMNS} FROM semantic_graph_search.index_generations "
        "WHERE model_id = $1 AND state = 'ready' "
        "ORDER BY (data_revision_id = $2) DESC, completed_at DESC NULLS LAST, created_at DESC LIMIT 1",
        model_id, data_revision_id))


def _workspaces(alias: str) -> str:
    """The workspaces a stored record was read from, as a text array (none: manual records)."""
    return ("ARRAY(SELECT DISTINCT src.item -> 'assetRef' ->> 'workspaceId' FROM jsonb_array_elements("
            f"CASE WHEN jsonb_typeof({alias}.provenance -> 'sources') = 'array' THEN {alias}.provenance -> 'sources' "
            "ELSE '[]'::jsonb END) AS src(item) "
            "WHERE COALESCE(src.item -> 'assetRef' ->> 'workspaceId', '') <> '')")


def _readable(alias: str, param: str) -> str:
    """Every workspace the record was read from is in ``param`` (NULL: no restriction)."""
    return f"({param}::text[] IS NULL OR {_workspaces(alias)} <@ {param}::text[])"


_LINKS_OF = (
    "SELECT source_entity_id AS me, relation_id, 'outgoing' AS direction, target_entity_id AS other "
    "FROM semantic_population.relationships WHERE data_revision_id = $1 AND state = 'accepted' "
    "AND source_entity_id = ANY($2::text[]) "
    "UNION ALL "
    "SELECT target_entity_id, relation_id, 'incoming', source_entity_id "
    "FROM semantic_population.relationships WHERE data_revision_id = $1 AND state = 'accepted' "
    "AND target_entity_id = ANY($2::text[])")


async def linked_names(pool: Any, revision_id: str, entity_ids: list[str],
                       per_concept: int) -> dict[str, list[dict[str, Any]]]:
    """Per record, the names of the records linked to it (accepted links, either way) that were
    read from no workspace the record itself was not read from: at most ``per_concept`` per
    linked concept, in name order, and how many more (``{"conceptId", "more"}``)."""
    if not entity_ids:
        return {}
    rows = await pool.fetch(
        f"WITH links AS ({_LINKS_OF}), "
        "named AS ("
        "  SELECT DISTINCT links.me, other.id, other.concept_id, other.label "
        "  FROM links JOIN semantic_population.entities other "
        "    ON other.data_revision_id = $1 AND other.id = links.other "
        "  JOIN semantic_population.entities mine ON mine.data_revision_id = $1 AND mine.id = links.me "
        f"  WHERE other.id <> links.me AND COALESCE(other.label, '') <> '' "
        f"  AND {_workspaces('other')} <@ {_workspaces('mine')}), "
        "placed AS (SELECT *, row_number() OVER (PARTITION BY me, concept_id ORDER BY label, id) AS place, "
        "  count(*) OVER (PARTITION BY me, concept_id) AS total FROM named) "
        "SELECT me, concept_id, label, place, total FROM placed WHERE place <= $3 "
        "ORDER BY me, concept_id, place",
        revision_id, list(entity_ids), per_concept)
    result: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        items = result.setdefault(row["me"], [])
        items.append({"conceptId": row["concept_id"], "name": row["label"]})
        if row["place"] == per_concept and row["total"] > per_concept:
            items.append({"conceptId": row["concept_id"], "more": int(row["total"]) - per_concept})
    return result


async def neighbours(pool: Any, revision_id: str, entity_ids: list[str],
                     allowed_workspaces: list[str] | None, limit: int) -> list[dict[str, Any]]:
    """The records one accepted link away from ``entity_ids`` (either way) that the actor may
    read, with the link: at most ``limit`` rows."""
    if not entity_ids:
        return []
    rows = await pool.fetch(
        f"WITH links AS ({_LINKS_OF}) "
        "SELECT links.me, links.relation_id, links.direction, other.id AS other, other.concept_id "
        "FROM links JOIN semantic_population.entities other "
        "  ON other.data_revision_id = $1 AND other.id = links.other "
        f"WHERE {_readable('other', '$3')} "
        "ORDER BY links.me, links.relation_id, other.id LIMIT $4",
        revision_id, list(entity_ids), allowed_workspaces, limit)
    return [{"from": row["me"], "relationId": row["relation_id"], "direction": row["direction"],
             "to": row["other"], "conceptId": row["concept_id"]} for row in rows]


async def document_texts(pool: Any, index_id: str, entity_ids: list[str]) -> dict[str, str]:
    if not entity_ids:
        return {}
    rows = await pool.fetch(
        "SELECT entity_id, search_text FROM semantic_graph_search.entity_documents "
        "WHERE index_id = $1::uuid AND entity_id = ANY($2::text[])", index_id, entity_ids)
    return {row["entity_id"]: row["search_text"] for row in rows}


async def entity_attributes(pool: Any, revision_id: str, entity_ids: list[str]) -> dict[str, dict[str, Any]]:
    """The stored field values of some records: key fields and attributes together."""
    if not entity_ids:
        return {}
    rows = await pool.fetch(
        "SELECT id, identity_key, attributes FROM semantic_population.entities "
        "WHERE data_revision_id = $1 AND id = ANY($2::text[])", revision_id, list(entity_ids))
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        values: dict[str, Any] = {}
        for raw in (row["identity_key"], row["attributes"]):
            parsed = json.loads(raw) if isinstance(raw, str) else raw
            if isinstance(parsed, dict):
                values.update(parsed)
        result[row["id"]] = values
    return result


# Every workspace the linked record was read from is readable (manual records have none).
_LINKED_VISIBLE = (
    "($4::text[] IS NULL OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements("
    "CASE WHEN jsonb_typeof(o.provenance -> 'sources') = 'array' THEN o.provenance -> 'sources' "
    "ELSE '[]'::jsonb END) AS src(item) "
    "WHERE COALESCE(src.item -> 'assetRef' ->> 'workspaceId', '') <> '' "
    "AND NOT ((src.item -> 'assetRef' ->> 'workspaceId') = ANY($4::text[]))))")


async def link_counts(pool: Any, revision_id: str, seed_ids: list[str], relations: list[str] | None,
                      direction: str, allowed_workspaces: list[str] | None,
                      concept_ids: list[str] | None = None) -> list[dict[str, Any]]:
    """Distinct records linked to the seeds by accepted links, per relation, direction and
    linked concept (only ``concept_ids`` when given): all of them (``total``) and those the
    actor may see (``visible``)."""
    if not seed_ids:
        return []
    parts = []
    if direction in ("outgoing", "both"):
        parts.append("SELECT relation_id, 'outgoing' AS direction, target_entity_id AS other "
                     "FROM semantic_population.relationships WHERE data_revision_id = $1 "
                     "AND state = 'accepted' AND source_entity_id = ANY($2::text[]) "
                     "AND ($3::text[] IS NULL OR relation_id = ANY($3::text[]))")
    if direction in ("incoming", "both"):
        parts.append("SELECT relation_id, 'incoming' AS direction, source_entity_id AS other "
                     "FROM semantic_population.relationships WHERE data_revision_id = $1 "
                     "AND state = 'accepted' AND target_entity_id = ANY($2::text[]) "
                     "AND ($3::text[] IS NULL OR relation_id = ANY($3::text[]))")
    if not parts:
        return []
    rows = await pool.fetch(
        "SELECT l.relation_id, l.direction, o.concept_id, count(DISTINCT o.id) AS total, "
        f"count(DISTINCT o.id) FILTER (WHERE {_LINKED_VISIBLE}) AS visible "
        f"FROM ({' UNION ALL '.join(parts)}) l "
        "JOIN semantic_population.entities o ON o.data_revision_id = $1 AND o.id = l.other "
        "WHERE ($5::text[] IS NULL OR o.concept_id = ANY($5::text[])) "
        "GROUP BY l.relation_id, l.direction, o.concept_id ORDER BY l.relation_id, l.direction, o.concept_id",
        revision_id, list(seed_ids), list(relations) if relations else None, allowed_workspaces,
        list(concept_ids) if concept_ids else None)
    return [{"relationId": row["relation_id"], "direction": row["direction"], "conceptId": row["concept_id"],
             "total": int(row["total"]), "visible": int(row["visible"])} for row in rows]
