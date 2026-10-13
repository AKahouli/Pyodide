"""A mapping's own record limit is a chosen sample (served as complete); only the admin's ceiling blocks.

Also: a run reading other values from the same inputs replaces the rows of a revision not yet in the graph.
"""

from __future__ import annotations

import json

import pytest

from app.persistence.population_store import content_digest, revision_id_for
from app.population.compiler import canonical_spec_hash
from app.population.run_limits import source_cap_is_users
from app.population.serving_policy import blocking_gap_kinds
from app.workers.population_tasks import persist_population_revision, run_population_for_task
from test_population_compiler import base_spec
from test_population_task import command, fake_fetch

TOTAL = 25000


def _prepare(source, options, data, output) -> dict:  # type: ignore[no-untyped-def]
    output.write_bytes(b"parquet-bytes")
    return {"datasetId": "ds_0123456789abcdef01234567", "rowCount": TOTAL}


def _query(path, *, columns=None, filters=None, limit=100, offset=0) -> dict:  # type: ignore[no-untyped-def]
    rows = [{"__sheetRow": i, "customer_id": f"C-{i}", "name": "X"} for i in range(2, 1002)]
    return {"columns": columns, "rows": rows, "returnedRows": 1000, "limit": limit, "offset": offset}


def _limited(max_records: int | None, admin: int | None = None) -> dict:
    entry = {"conceptId": "c1", "source": {"workspaceId": "6512f0a1c9e77a001234aaa1",
                                          "assetId": "6512f0a1c9e77a001234bbb1", "mimeType": "text/csv"},
             "options": {"sheetName": "messages"}, "mappingVersion": "map-v1",
             "columnMapping": {"customer_id": "customer_id", "name": "name"},
             **({"readLimits": {"maxRecords": max_records}} if max_records else {})}
    run = command(sources=[entry])
    if admin:
        run["payload"]["limits"] = {"maxRecordsPerSource": admin}
    return run


def test_only_a_limit_below_the_admin_ceiling_is_the_users():
    limits = {"maxRecordsPerSource": 100}
    assert source_cap_is_users(limits, {"readLimits": {"maxRecords": 10}})
    assert not source_cap_is_users(limits, {"readLimits": {"maxRecords": 100}})
    assert not source_cap_is_users(limits, {"readLimits": {"maxRecords": 400}})
    assert not source_cap_is_users(limits, {})
    assert not source_cap_is_users(limits, {"readLimits": {"maxRecords": True}})


@pytest.mark.asyncio
async def test_a_mapping_limit_is_a_complete_sample_that_serves():
    outcome = await run_population_for_task(_limited(10), fetch=fake_fetch, prepare=_prepare, query=_query)
    assert outcome["counts"]["materialized"] == 10
    assert outcome["completeEnumeration"] is True
    assert "enumeration_capped" not in {gap["kind"] for gap in outcome["gaps"]}
    assert blocking_gap_kinds(outcome["gaps"]) == []
    assert outcome["userSampleLimits"] == [{"conceptId": "c1", "sheetName": "messages", "limit": 10,
                                            "total": TOTAL, "read": 10}]


@pytest.mark.asyncio
async def test_the_admin_ceiling_still_blocks():
    outcome = await run_population_for_task(_limited(None, admin=100), fetch=fake_fetch, prepare=_prepare, query=_query)
    assert outcome["completeEnumeration"] is False
    assert blocking_gap_kinds(outcome["gaps"]) == ["enumeration_capped"]
    assert outcome["userSampleLimits"] == []
    # A mapping limit above the ceiling is the ceiling.
    above = await run_population_for_task(_limited(500, admin=100), fetch=fake_fetch, prepare=_prepare, query=_query)
    assert blocking_gap_kinds(above["gaps"]) == ["enumeration_capped"] and above["userSampleLimits"] == []


@pytest.mark.asyncio
async def test_a_reused_reading_keeps_its_sample_note():
    class Cache:
        def __init__(self) -> None:
            self.items: dict = {}

        async def get(self, key):  # type: ignore[no-untyped-def]
            return self.items.get(key)

        async def put(self, key, **kwargs):  # type: ignore[no-untyped-def]
            self.items[key] = kwargs["output"]

    cache = Cache()
    first = await run_population_for_task(_limited(10), fetch=fake_fetch, prepare=_prepare, query=_query,
                                          extraction_cache=cache)
    assert list(cache.items.values())[0]["completeEnumeration"] is True
    again = await run_population_for_task(_limited(10), fetch=fake_fetch, prepare=_prepare, query=_query,
                                          extraction_cache=cache)
    assert again["completeEnumeration"] is True and again["userSampleLimits"] == first["userSampleLimits"]


@pytest.mark.asyncio
async def test_a_concept_refresh_does_not_inherit_a_block_from_a_sampled_revision():
    carried = {"revisionId": "dr", "conceptId": "c2", "entities": [], "assertions": [], "relationships": [],
               "sourceObservations": [], "completeEnumeration": True,
               "userSampleLimits": [{"conceptId": "c1", "limit": 10, "read": 10, "total": TOTAL},
                                    {"conceptId": "c2", "limit": 5, "read": 5, "total": 50}]}
    refresh = command(sources=[])
    refresh["payload"]["scope"] = {"kind": "concept", "conceptId": "c2"}
    outcome = await run_population_for_task(refresh, carried=carried)
    assert outcome["ok"] is True and outcome["completeEnumeration"] is True
    # c1 stays the sample it was; c2, refreshed, reports its own (none here).
    assert outcome["userSampleLimits"] == [carried["userSampleLimits"][0]]
    assert blocking_gap_kinds(outcome["gaps"]) == []


class StoredPool:
    """Keeps the revision table and the record tables, as far as persist_population_revision reads them."""

    def __init__(self) -> None:
        self.revisions: dict[str, dict] = {}
        self.entities: dict[str, dict[str, str]] = {}
        self.deletes = 0

    def mark_projected(self, revision_id: str) -> None:
        self.revisions[revision_id]["projection_ref"] = "age:v2:pop_" + revision_id

    async def fetchval(self, sql: str, *params):  # type: ignore[no-untyped-def]
        return 0

    async def fetch(self, sql: str, *params):  # type: ignore[no-untyped-def]
        return []

    async def fetchrow(self, sql: str, *params):  # type: ignore[no-untyped-def]
        if "INSERT INTO semantic_population.data_revisions" in sql:
            self.revisions.setdefault(params[0], {"id": params[0], "projection_ref": None,
                                                 "coverage": params[7], "validation_state": "valid"})
            return {"id": params[0]}
        if "FROM semantic_population.data_revisions WHERE id = $1" in sql:
            return self.revisions.get(params[0])
        return {"id": "row"}

    async def executemany(self, sql: str, rows, timeout=None):  # type: ignore[no-untyped-def]
        if "INSERT INTO semantic_population.entities" in sql:
            for row in rows:
                self.entities.setdefault(row[2], {}).setdefault(row[0], row[6])

    async def execute(self, sql: str, *params, timeout=None):  # type: ignore[no-untyped-def]
        if sql.startswith("DELETE FROM semantic_population.entities"):
            self.deletes += 1
            self.entities[params[0]] = {}
        if sql.startswith("UPDATE semantic_population.data_revisions SET coverage"):
            self.revisions[params[0]]["coverage"] = params[1]

    def acquire(self):  # type: ignore[no-untyped-def]
        pool = self

        class Held:
            async def __aenter__(self):  # type: ignore[no-untyped-def]
                return pool

            async def __aexit__(self, *exc):  # type: ignore[no-untyped-def]
                return False

        return Held()

    def transaction(self):  # type: ignore[no-untyped-def]
        return self.acquire()


def _outcome(descriptions: list[str]) -> dict:
    return {"specHash": canonical_spec_hash(base_spec()),
            "executionFingerprint": "sha256:" + "f" * 64,
            "entities": [{"entityId": f"fait:{text}", "conceptId": "c1", "label": text,
                          "attributes": {"description": text}} for text in descriptions],
            "assertions": [], "relationships": [], "gaps": [], "counts": {}, "datasetFingerprints": ["sha256:abc"]}


@pytest.mark.asyncio
async def test_a_run_reading_other_values_replaces_a_revision_not_yet_in_the_graph():
    pool = StoredPool()
    first = await persist_population_revision(pool, command(), _outcome([f"a{n}" for n in range(10)]))
    # The AI is asked again and one answer differs: the record whose identity is the answer has another id.
    again = _outcome([f"a{n}" for n in range(9)] + ["other"])
    second = await persist_population_revision(pool, command(), again)
    assert second == first
    assert sorted(pool.entities[first]) == sorted([f"fait:a{n}" for n in range(9)] + ["fait:other"])
    assert len(pool.entities[first]) == 10
    assert pool.deletes == 1
    assert json.loads(pool.revisions[first]["coverage"])["contentDigest"] == content_digest(again["entities"], [], [])


@pytest.mark.asyncio
async def test_a_revision_already_in_the_graph_is_kept_and_other_rows_get_their_own():
    pool = StoredPool()
    first = await persist_population_revision(pool, command(), _outcome(["a", "b"]))
    pool.mark_projected(first)
    # Same rows: the revision is kept as it is (a retried task), nothing is deleted.
    assert await persist_population_revision(pool, command(), _outcome(["a", "b"])) == first
    assert pool.deletes == 0 and len(pool.entities[first]) == 2
    # Other rows: a revision of its own, the projected one is untouched.
    other = _outcome(["a", "c"])
    second = await persist_population_revision(pool, command(), other)
    assert second != first
    assert second == revision_id_for("v1", other["executionFingerprint"], ["sha256:abc"], 0,
                                     variant=content_digest(other["entities"], [], []))
    assert len(pool.entities[first]) == 2 and len(pool.entities[second]) == 2
