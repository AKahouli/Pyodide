from __future__ import annotations

import pytest

from app.persistence import search_store as store
from app.population.compiler import PopulationError
from app.search.dataset_lookup import lookup_query_backed_rows
from app.search.projections import build_entity_projections


class FakePool:
    def __init__(self, script: list) -> None:
        self.script = list(script)
        self.calls: list[tuple[str, tuple]] = []

    async def fetch(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.calls.append((sql, params))
        return self.script.pop(0)

    async def fetchrow(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.calls.append((sql, params))
        return self.script.pop(0)

    async def executemany(self, sql: str, rows) -> None:  # type: ignore[no-untyped-def]
        self.calls.append((sql, list(rows)))


@pytest.mark.asyncio
async def test_store_and_find_projection_candidates():
    pool = FakePool([])
    projections = build_entity_projections(
        [{"entityId": "e1", "conceptId": "c1", "label": "Acme",
          "identity": {"customer_id": "c-1"}, "attributes": {}}],
        model_id="m1", revision_id="dr_1")
    assert await store.store_entity_projections(pool, projections) == 1
    assert "semantic_search.entity_projections" in pool.calls[0][0]

    finder = FakePool([[{"entity_id": "e1", "concept_id": "c1",
                         "display_label": "Acme", "identity": {"customer_id": "c-1"}}]])
    candidates = await store.find_projection_candidates(
        finder, model_id="m1", revision_id="dr_1", strategy="exact", key="c-1")
    assert [c["entityId"] for c in candidates] == ["e1"]
    sql, params = finder.calls[0]
    assert params == ("m1", "dr_1", "exact", "c-1")
    assert "search_keys ->> $3 = $4" in sql

    with pytest.raises(ValueError):
        await store.find_projection_candidates(finder, model_id="m1", revision_id="dr_1",
                                               strategy="fuzzy", key="x")
    with pytest.raises(ValueError):
        await store.find_projection_candidates(finder, model_id="m1", revision_id="dr_1",
                                               strategy="exact", key="")


@pytest.mark.asyncio
async def test_open_and_get_context():
    from datetime import datetime

    manifest = {"contextId": "ctx_1", "actorUserId": "u1", "modelId": "m1",
                "modelVersionId": "v1", "dataRevisionId": "dr_1", "sourceScope": [],
                "requiredSources": [], "coverage": {}, "expiresAt": "2030-01-01T00:00:00+00:00"}
    pool = FakePool([{"id": "ctx_1"}])
    assert await store.open_context(pool, manifest) == "ctx_1"
    assert "semantic_search.contexts" in pool.calls[0][0]
    assert "DO UPDATE" in pool.calls[0][0]
    assert isinstance(pool.calls[0][1][-1], datetime)

    from datetime import timezone

    reopen = FakePool([{"id": "ctx_1"}])
    later = {**manifest, "expiresAt": "2031-01-01T00:00:00+00:00"}
    assert await store.open_context(reopen, later) == "ctx_1"
    assert reopen.calls[0][1][-1] == datetime(2031, 1, 1, tzinfo=timezone.utc)

    reader = FakePool([{"id": "ctx_1", "model_id": "m1"}])
    assert (await store.get_context(reader, "ctx_1"))["model_id"] == "m1"
    assert await store.get_context(FakePool([None]), "missing") is None


ENTRY = {"conceptId": "c1", "source": {"workspaceId": "w", "assetId": "a"},
         "options": {}, "columnMapping": {"customer_id": "customer_id", "status": "status"}}
CONCEPT = {"conceptId": "c1", "eligibility": {"field": "status", "op": "eq", "value": "ok"},
           "materialization": None, "allowedFields": ["customer_id", "status"],
           "keyComponents": ["customer_id"], "namespace": "crm", "populationMode": "materialized"}


def _page(rows: list[dict], total: int) -> dict:
    return {"columns": ["__sheetRow", "customer_id", "status"], "rows": rows,
            "returnedRows": total, "limit": 1000}


@pytest.mark.asyncio
async def test_lookup_applies_eligibility_and_reports_coverage():
    async def fetch(source: dict, actor: str) -> bytes:  # type: ignore[no-untyped-def]
        return b"csv"

    def prepare(source: dict, options: dict | None, data: bytes, output) -> dict:  # type: ignore[no-untyped-def]
        output.write_bytes(b"p")
        return {"datasetId": "ds_1"}

    def query(path, *, columns=None, filters=None, limit=100) -> dict:  # type: ignore[no-untyped-def]
        assert set(columns or []) == {"__sheetRow", "customer_id", "status"}
        return _page([{"__sheetRow": 2, "customer_id": "C-1", "status": "ok"},
                      {"__sheetRow": 3, "customer_id": "C-2", "status": "bad"}], 2)

    result = await lookup_query_backed_rows(ENTRY, CONCEPT, ["C-1", "C-9"],
                                            key_field="customer_id", actor="u1",
                                            fetch=fetch, prepare=prepare, query=query)
    assert [r["customer_id"] for r in result["rows"]] == ["C-1"]
    assert result["rows"][0]["_row"] == 2
    assert result["complete"] is True
    assert result["gaps"] == []


@pytest.mark.asyncio
async def test_lookup_prefers_recorded_artifact_and_falls_back():
    seen: list[str] = []

    async def fetch_dataset(source: dict, actor: str, manifest: dict, target) -> None:  # type: ignore[no-untyped-def]
        seen.append("dataset")
        target.write_bytes(b"p")

    def query(path, *, columns=None, filters=None, limit=100) -> dict:  # type: ignore[no-untyped-def]
        return _page([{"__sheetRow": 2, "customer_id": "C-1", "status": "ok"}], 1)

    observation = {"datasetId": "ds_1", "contentHash": "sha256:" + "a" * 64, "sizeBytes": 10}
    result = await lookup_query_backed_rows(ENTRY, CONCEPT, ["C-1"], key_field="customer_id",
                                            actor="u1", observation=observation,
                                            fetch_dataset=fetch_dataset, query=query)
    assert seen == ["dataset"]
    assert len(result["rows"]) == 1

    async def broken_dataset(source: dict, actor: str, manifest: dict, target) -> None:  # type: ignore[no-untyped-def]
        from app.datasource.asset_delivery import AssetFetchError
        raise AssetFetchError("dataset_unavailable")

    async def fetch(source: dict, actor: str) -> bytes:  # type: ignore[no-untyped-def]
        seen.append("reprepare")
        return b"csv"

    def prepare(source: dict, options: dict | None, data: bytes, output) -> dict:  # type: ignore[no-untyped-def]
        output.write_bytes(b"p")
        return {"datasetId": "ds_2"}

    fallback = await lookup_query_backed_rows(ENTRY, CONCEPT, ["C-1"], key_field="customer_id",
                                              actor="u1", observation=observation,
                                              fetch=fetch, fetch_dataset=broken_dataset,
                                              prepare=prepare, query=query)
    assert seen == ["dataset", "reprepare"]
    assert len(fallback["rows"]) == 1


@pytest.mark.asyncio
async def test_lookup_rejects_invalid_inputs():
    with pytest.raises(PopulationError):
        await lookup_query_backed_rows(ENTRY, CONCEPT, [], key_field="customer_id", actor="u1")
    with pytest.raises(PopulationError):
        await lookup_query_backed_rows(ENTRY, CONCEPT, ["C-1"], key_field="unmapped",
                                       actor="u1")
    hidden_filter = dict(CONCEPT, eligibility={"field": "secret", "op": "eq", "value": "x"})
    with pytest.raises(PopulationError):
        await lookup_query_backed_rows(ENTRY, hidden_filter, ["C-1"],
                                       key_field="customer_id", actor="u1")
    reserved = dict(ENTRY, columnMapping={**ENTRY["columnMapping"], "row": "_row"})
    with pytest.raises(PopulationError):
        await lookup_query_backed_rows(reserved, CONCEPT, ["C-1"],
                                       key_field="customer_id", actor="u1")
