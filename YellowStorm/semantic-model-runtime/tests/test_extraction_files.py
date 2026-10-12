"""Large cached readings live in chunk rows; an unchanged source is found without fetching it."""

from __future__ import annotations

import json
import os
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio

from app.persistence.extraction_cache import (EXTERNAL_KEY, DocumentExtractionCache, decode_output,
                                              encode_output, extraction_cache_key)
from app.workers.population_tasks import PopulationProgress, run_population_for_task
from test_population_task import CSV, SOURCE, command, fake_prepare

KEY = extraction_cache_key({"sheet": "a"})
DSN = os.environ.get("SEMANTIC_RUNTIME_TEST_DATABASE_URL")
ROOT = Path(__file__).resolve().parents[1]


def reading(pages: int, per_page: int = 50) -> dict:
    return {"outputs": [{"entities": [{"entityId": f"e{page}-{n}", "label": "x" * 40} for n in range(per_page)],
                         "assertions": [], "gaps": [], "counts": {"gaps": 0}} for page in range(pages)],
            "observation": {"contentHash": "sha256:abc", "rowCount": pages * per_page},
            "completeEnumeration": False}


def test_a_large_reading_round_trips_through_chunks():
    output = reading(pages=5)
    pointer, chunks = encode_output(output, inline_max_bytes=2000, chunk_bytes=300)
    assert pointer["outputs"] == 5 and pointer["chunks"] == len(chunks) > 1
    assert pointer["sizeBytes"] == sum(len(chunk) for chunk in chunks)
    assert all(len(chunk) <= 300 for chunk in chunks)
    assert decode_output(pointer, chunks) == output


def test_a_small_reading_stays_in_the_row():
    assert encode_output(reading(pages=2), inline_max_bytes=1_000_000) is None
    assert encode_output({"entities": []}, inline_max_bytes=1) is None


def test_missing_or_damaged_chunks_are_a_miss():
    pointer, chunks = encode_output(reading(pages=5), inline_max_bytes=2000, chunk_bytes=300)
    assert decode_output(pointer, chunks[:-1]) is None  # a chunk is missing
    assert decode_output(pointer, []) is None
    flipped = [chunks[0][:-1] + bytes([chunks[0][-1] ^ 1])] + chunks[1:]
    assert decode_output(pointer, flipped) is None  # digest differs
    assert decode_output({**pointer, "outputs": 6}, chunks) is None  # fewer lines than promised
    assert decode_output({**pointer, "sha256": "0" * 64}, chunks) is None
    assert decode_output("garbage", chunks) is None


class FakePool:
    """The two cache tables, enough for the cache's statements (the pool is its own connection)."""

    def __init__(self) -> None:
        self.rows: dict[str, dict] = {}
        self.chunks: dict[str, dict[int, bytes]] = {}
        self.locks: list[str] = []

    async def fetchval(self, sql: str, key: str):
        row = self.rows.get(key)
        return row["output"] if row else None

    async def fetch(self, sql: str, key: str):
        assert "document_extraction_chunks" in sql
        return [{"data": data} for _ordinal, data in sorted(self.chunks.get(key, {}).items())]

    async def execute(self, sql: str, *args):
        if sql.startswith("SELECT pg_advisory_xact_lock"):
            self.locks.append(args[0])
        elif sql.startswith("DELETE FROM semantic_population.document_extraction_chunks"):
            self.chunks.pop(args[0], None)
        elif sql.startswith("DELETE FROM semantic_population.document_extractions"):
            model_id, concept_id, asset_id, key = args
            for k in [k for k, row in self.rows.items() if k != key and
                      (row["model"], row["concept"], row["asset"]) == (model_id, concept_id, asset_id)]:
                self.delete_row(k)
        else:
            key, model_id, concept_id, asset_id, body = args
            self.rows[key] = {"model": model_id, "concept": concept_id, "asset": asset_id, "output": body}

    def delete_row(self, key: str) -> None:
        """What a purge does; the foreign key cascade takes the chunks."""
        del self.rows[key]
        self.chunks.pop(key, None)

    async def executemany(self, sql: str, records):
        # Chunks reference their row, so it is written first.
        assert all(key in self.rows for key, _ordinal, _data in records)
        for key, ordinal, data in records:
            self.chunks.setdefault(key, {})[ordinal] = data

    def acquire(self):
        return self

    def transaction(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


@pytest.mark.asyncio
async def test_the_cache_keeps_a_pointer_in_the_row_and_the_reading_in_chunks():
    pool = FakePool()
    cache = DocumentExtractionCache(pool, "m1", inline_max_bytes=2000, chunk_bytes=300)
    output = reading(pages=5)
    await cache.put(KEY, concept_id="c1", asset_id="a#s", output=output)
    row = json.loads(pool.rows[KEY]["output"])
    assert set(row) == {EXTERNAL_KEY} and row[EXTERNAL_KEY]["outputs"] == 5
    assert len(pool.chunks[KEY]) == row[EXTERNAL_KEY]["chunks"] > 1 and pool.locks == [KEY]
    assert await cache.get(KEY) == output

    # Writing the same key again replaces its chunks rather than adding to them.
    await cache.put(KEY, concept_id="c1", asset_id="a#s", output=output)
    assert len(pool.chunks[KEY]) == row[EXTERNAL_KEY]["chunks"]

    # A newer reading of the same sheet replaces the older one, chunks included.
    newer = extraction_cache_key({"sheet": "b"})
    await cache.put(newer, concept_id="c1", asset_id="a#s", output=reading(pages=6))
    assert list(pool.rows) == [newer] and list(pool.chunks) == [newer]

    # Chunks lost or damaged behind the row's back are a miss, not an error.
    saved = dict(pool.chunks[newer])
    pool.chunks[newer] = {ordinal: data for ordinal, data in saved.items() if ordinal != 0}
    assert await cache.get(newer) is None
    pool.chunks[newer] = {**saved, 0: saved[0][:-1] + bytes([saved[0][-1] ^ 1])}
    assert await cache.get(newer) is None
    pool.chunks[newer] = saved
    assert await cache.get(newer) == reading(pages=6)

    # A purge of the row takes its chunks (cascade).
    pool.delete_row(newer)
    assert pool.chunks == {} and await cache.get(newer) is None

    # A small reading stays inline.
    small = extraction_cache_key({"sheet": "c"})
    await cache.put(small, concept_id="c1", asset_id="a#t", output={"outputs": [], "observation": {}})
    assert json.loads(pool.rows[small]["output"]) == {"outputs": [], "observation": {}}
    assert small not in pool.chunks and await cache.get(small) == {"outputs": [], "observation": {}}


@pytest_asyncio.fixture
async def database():
    if not DSN:
        pytest.skip("SEMANTIC_RUNTIME_TEST_DATABASE_URL not set")
    connection = await asyncpg.connect(DSN)
    try:
        await connection.execute("DROP SCHEMA IF EXISTS semantic_population CASCADE")
        await connection.execute("CREATE SCHEMA semantic_population")
        for name in ("020_document_extraction_cache.sql", "033_extraction_output_chunks.sql"):
            await connection.execute((ROOT / "migrations" / name).read_text(encoding="utf-8"))
    finally:
        await connection.close()
    pool = await asyncpg.create_pool(DSN, min_size=1, max_size=4)
    yield pool
    await pool.close()


@pytest.mark.asyncio
async def test_chunks_in_postgres_round_trip_replace_and_cascade(database: asyncpg.Pool):
    cache = DocumentExtractionCache(database, "m1", inline_max_bytes=2000, chunk_bytes=300)
    output = reading(pages=8)
    await cache.put(KEY, concept_id="c1", asset_id="a#s", output=output)
    count = "SELECT count(*) FROM semantic_population.document_extraction_chunks"
    stored = await database.fetchval(count)
    assert stored > 1 and await cache.get(KEY) == output

    await cache.put(KEY, concept_id="c1", asset_id="a#s", output=output)  # same key: replaced, not added to
    assert await database.fetchval(count) == stored

    newer = extraction_cache_key({"sheet": "b"})
    await cache.put(newer, concept_id="c1", asset_id="a#s", output=reading(pages=3))  # a newer reading
    assert await database.fetchval("SELECT count(*) FROM semantic_population.document_extractions") == 1
    assert await database.fetchval(
        "SELECT count(DISTINCT cache_key) FROM semantic_population.document_extraction_chunks") == 1

    await database.execute("UPDATE semantic_population.document_extraction_chunks SET data = 'x'::bytea "
                           "WHERE ordinal = 0")
    assert await cache.get(newer) is None  # damaged: a miss

    await database.execute("DELETE FROM semantic_population.document_extractions WHERE model_id = 'm1'")
    assert await database.fetchval(count) == 0  # a purge takes the chunks


# ----- the population run -----

VERSIONED = {**SOURCE, "contentHash": "0123456789abcdef0123456789abcdef"}


class Counting:
    def __init__(self) -> None:
        self.fetched = 0
        self.checked = 0
        self.prepared = 0

    async def fetch(self, source: dict, actor: str) -> bytes:
        self.fetched += 1
        return CSV

    async def metadata(self, source: dict, actor: str) -> dict:
        self.checked += 1
        return source

    def prepare(self, *args, **kwargs) -> dict:  # type: ignore[no-untyped-def]
        self.prepared += 1
        return fake_prepare(*args, **kwargs)


def small_query(path, *, columns=None, filters=None, limit=100, offset=0) -> dict:  # type: ignore[no-untyped-def]
    rows = [{"__sheetRow": 2, "customer_id": "C-1", "name": "Acme"},
            {"__sheetRow": 3, "customer_id": "C-2", "name": "Globex"}]
    return {"columns": columns, "rows": rows[offset:offset + limit], "returnedRows": max(0, 2 - offset),
            "limit": limit, "offset": offset}


def one_source(source: dict) -> dict:
    return command(sources=[{"conceptId": "c1", "source": dict(source), "options": {},
                             "columnMapping": {"customer_id": "customer_id", "name": "name"},
                             "mappingVersion": "map-v1"}])


@pytest.mark.asyncio
async def test_an_unchanged_versioned_source_is_not_fetched():
    cache = DocumentExtractionCache(FakePool(), "m1")
    work = Counting()
    run = dict(fetch=work.fetch, metadata_fetch=work.metadata, prepare=work.prepare, query=small_query,
               extraction_cache=cache)
    first = await run_population_for_task(one_source(VERSIONED), **run)
    assert first["ok"] is True and (work.fetched, work.checked, work.prepared) == (1, 0, 1)

    progress = PopulationProgress()
    second = await run_population_for_task(one_source(VERSIONED), progress=progress, **run)
    assert (work.fetched, work.checked, work.prepared) == (1, 1, 1)  # access re-checked, nothing downloaded
    assert progress.reused == 1 and progress.recent[0]["reused"] is True
    assert second["entities"] == first["entities"] and second["sourceObservations"] == first["sourceObservations"]
    assert second["completeEnumeration"] is True

    # A re-uploaded file (another content hash) is fetched and read again.
    changed = await run_population_for_task(one_source({**VERSIONED, "contentHash": "f" * 32}), **run)
    assert changed["ok"] is True and (work.fetched, work.prepared) == (2, 2)


@pytest.mark.asyncio
async def test_a_source_changed_behind_the_run_is_refused_without_reading_the_cache():
    from app.datasource.asset_delivery import AssetFetchError

    cache = DocumentExtractionCache(FakePool(), "m1")
    work = Counting()
    run = dict(fetch=work.fetch, prepare=work.prepare, query=small_query, extraction_cache=cache)
    await run_population_for_task(one_source(VERSIONED), metadata_fetch=work.metadata, **run)

    async def changed(source: dict, actor: str) -> dict:
        raise AssetFetchError("asset_changed")

    outcome = await run_population_for_task(one_source(VERSIONED), metadata_fetch=changed, **run)
    assert outcome == {"ok": False, "errorCode": "asset_changed"}


@pytest.mark.asyncio
async def test_a_source_without_a_content_version_is_fetched_and_keyed_by_its_bytes():
    cache = DocumentExtractionCache(FakePool(), "m1")
    work = Counting()
    run = dict(fetch=work.fetch, metadata_fetch=work.metadata, prepare=work.prepare, query=small_query,
               extraction_cache=cache)
    await run_population_for_task(one_source(SOURCE), **run)
    await run_population_for_task(one_source(SOURCE), **run)
    assert (work.fetched, work.checked, work.prepared) == (2, 0, 1)


@pytest.mark.asyncio
async def test_a_sheet_over_the_old_twenty_thousand_record_cap_is_reused_from_chunks():
    total = 25_000

    def query(path, *, columns=None, filters=None, limit=100, offset=0) -> dict:  # type: ignore[no-untyped-def]
        count = max(0, min(limit, total - offset))
        rows = [{"__sheetRow": offset + n + 2, "customer_id": f"C-{offset + n}", "name": f"Name {offset + n}"}
                for n in range(count)]
        return {"columns": columns, "rows": rows, "returnedRows": count, "limit": limit, "offset": offset}

    pool = FakePool()
    cache = DocumentExtractionCache(pool, "m1")
    work = Counting()
    command_dump = one_source(VERSIONED)
    command_dump["payload"]["limits"] = {"maxRecordsPerSource": 50_000, "maxRecordsPerRun": 50_000,
                                         "maxValuesPerRun": 500_000}
    run = dict(fetch=work.fetch, metadata_fetch=work.metadata, prepare=work.prepare, query=query,
               extraction_cache=cache)
    first = await run_population_for_task(command_dump, **run)
    assert first["ok"] is True and first["counts"]["materialized"] == total
    assert len(pool.chunks) == 1 and len(next(iter(pool.chunks.values()))) >= 1

    second = await run_population_for_task(command_dump, **run)
    assert (work.fetched, work.prepared) == (1, 1)
    assert second["counts"]["materialized"] == total and second["entities"] == first["entities"]

    # The chunks are lost: the sheet is read again, and cached again.
    pool.chunks.clear()
    third = await run_population_for_task(command_dump, **run)
    assert (work.fetched, work.prepared) == (2, 2) and third["entities"] == first["entities"]
    assert len(pool.chunks) == 1
