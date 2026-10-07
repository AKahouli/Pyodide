from __future__ import annotations

import pytest

from app.persistence import manual_store
from app.workers.population_tasks import run_population_for_payload, run_population_for_task
from test_population_compiler import base_spec
from test_population_task import command

SNAPSHOT = "manual_snapshot_1"
MANUAL = {"workspaceId": "ws", "assetId": f"manual:{SNAPSHOT}", "snapshotId": SNAPSHOT}


def manual_spec() -> dict:
    spec = base_spec()
    spec["relations"].append({"relationId": "r2", "key": "refers", "label": "refers",
                              "sourceConceptId": "c1", "targetConceptId": "c1",
                              "cardinality": "many_to_many", "matchingStrategy": "normalized"})
    spec["sourceScope"].append({"workspaceId": "ws", "assetId": MANUAL["assetId"]})
    return spec


def manual_command() -> dict:
    return command(spec=manual_spec(), sources=[{
        "conceptId": "c1", "sourceKind": "manual", "source": dict(MANUAL), "options": {},
        "columnMapping": {"name": "name", "country": "country"}, "mappingVersion": "manual-v1"}])


class ManualPool:
    def __init__(self, committed: bool = True) -> None:
        self.committed = committed

    async def fetchval(self, sql: str, *params):  # type: ignore[no-untyped-def]
        return self.committed

    async def fetch(self, sql: str, *params):  # type: ignore[no-untyped-def]
        if "manual_links" in sql:
            return [{"relation_id": "r2", "source_row_key": "rec-1", "target_row_key": "rec-2"},
                    {"relation_id": "r2", "source_row_key": "rec-1", "target_row_key": "gone"}]
        return [{"row_key": "rec-1", "label": "Acme", "values": {"name": "Acme", "country": "FR"}},
                {"row_key": "rec-2", "label": "", "values": '{"name": "Globex"}'}]


def test_manual_source_needs_a_snapshot_but_no_key_mapping():
    assert run_population_for_payload(manual_command())["ok"] is True
    broken = manual_command()
    del broken["payload"]["sources"][0]["source"]["snapshotId"]
    assert run_population_for_payload(broken)["errorCode"] == "invalid_sources"


@pytest.mark.asyncio
async def test_manual_rows_become_entities_with_their_links():
    outcome = await run_population_for_task(manual_command(), manual_pool=ManualPool())
    assert outcome["ok"] is True
    by_label = {entity["label"]: entity for entity in outcome["entities"]}
    assert set(by_label) == {"Acme", "Globex"}
    assert by_label["Acme"]["identity"] == {"customer_id": "rec-1"}
    assert outcome["relationships"] == [{
        "relationId": "r2", "sourceEntityId": by_label["Acme"]["entityId"],
        "targetEntityId": by_label["Globex"]["entityId"], "matchingStrategy": "manual"}]
    assert SNAPSHOT in outcome["datasetFingerprints"]


@pytest.mark.asyncio
async def test_uncommitted_snapshot_is_refused():
    outcome = await run_population_for_task(manual_command(), manual_pool=ManualPool(committed=False))
    assert outcome == {"ok": False, "errorCode": "manual_snapshot_unavailable"}


class Connection:
    def __init__(self, snapshot: dict | None, stored: tuple[int, int] = (2, 1)) -> None:
        self.snapshot = snapshot
        self.stored = list(stored)
        self.executed: list[str] = []

    def transaction(self):  # type: ignore[no-untyped-def]
        return Context(self)

    async def execute(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.executed.append(sql)

    async def executemany(self, sql: str, rows):  # type: ignore[no-untyped-def]
        self.executed.append(sql)

    async def fetchrow(self, sql: str, *params):  # type: ignore[no-untyped-def]
        return self.snapshot

    async def fetchval(self, sql: str, *params):  # type: ignore[no-untyped-def]
        return self.stored.pop(0)


class Context:
    def __init__(self, value) -> None:  # type: ignore[no-untyped-def]
        self.value = value

    async def __aenter__(self):  # type: ignore[no-untyped-def]
        return self.value

    async def __aexit__(self, *_args) -> None:
        return None


class Pool:
    def __init__(self, connection: Connection) -> None:
        self.connection = connection

    def acquire(self) -> Context:
        return Context(self.connection)


@pytest.mark.asyncio
async def test_commit_checks_counts_and_seals_once():
    open_snapshot = {"model_id": "m1", "committed_at": None, "row_count": None, "link_count": None}
    assert await manual_store.commit_snapshot(
        Pool(Connection(open_snapshot)), model_id="m1", snapshot_id=SNAPSHOT, row_count=2, link_count=1)
    with pytest.raises(manual_store.ManualSnapshotError, match="snapshot_count_mismatch"):
        await manual_store.commit_snapshot(
            Pool(Connection(open_snapshot)), model_id="m1", snapshot_id=SNAPSHOT, row_count=3, link_count=1)
    sealed = {**open_snapshot, "committed_at": "now", "row_count": 2, "link_count": 1}
    assert not await manual_store.commit_snapshot(
        Pool(Connection(sealed)), model_id="m1", snapshot_id=SNAPSHOT, row_count=2, link_count=1)
    resent = Connection(sealed)
    await manual_store.append_batch(Pool(resent), model_id="m1", snapshot_id=SNAPSHOT,
                                    rows=[{"conceptId": "c1", "rowKey": "rec-1", "values": {}}], links=[])
    assert not any("manual_rows" in sql for sql in resent.executed)


def test_core_fingerprint_without_constants_is_accepted():
    """The core omits an empty constantMapping; the runtime must hash it the same way."""
    from app.workers.population_tasks import population_execution_fingerprint

    payload = manual_command()
    source = payload["payload"]["sources"][0]
    core_view = [{**source, "sourceKind": "manual"}]
    payload["payload"]["populationExecutionFingerprint"] = population_execution_fingerprint(
        payload["payload"]["specHash"], core_view, [])
    assert run_population_for_payload(payload)["ok"] is True
