from __future__ import annotations

import pytest

from app.datasource.asset_delivery import AssetFetchError
from app.population.compiler import canonical_spec_hash
from app.workers.population_tasks import (population_lease_seconds, run_population_for_payload,
                                          run_population_for_task)
from test_population_compiler import base_spec

SOURCE = {"workspaceId": "6512f0a1c9e77a001234aaa1",
          "assetId": "6512f0a1c9e77a001234bbb1", "mimeType": "text/csv"}


def command(spec=None, sources=None, bindings=None, purpose="build",
            spec_hash=None) -> dict:
    spec = base_spec() if spec is None else spec
    if sources is None:
        sources = [{"conceptId": "c1", "source": dict(SOURCE), "options": {},
                    "columnMapping": {"customer_id": "customer_id", "name": "name"},
                    "mappingVersion": "map-v1"}]
    return {
        "actorUserId": "u1", "modelId": "m1",
        "workspaceId": "6512f0a1c9e77a001234aaa1",
        "payload": {
            "modelVersionId": "v1",
            "specHash": canonical_spec_hash(spec) if spec_hash is None else spec_hash,
            "purpose": purpose, "scope": {"kind": "model"},
            "specification": spec, "sources": sources,
            "relationBindings": [] if bindings is None else bindings,
        },
    }


def test_valid_command_compiles():
    validated = run_population_for_payload(command())
    assert validated["ok"] is True
    assert set(validated["compiled"]["concepts"]) == {"c1", "c2"}
    assert len(validated["sources"]) == 1
    assert validated["purpose"] == "build"


def test_legacy_binding_infers_single_target_identity():
    sources = [{"conceptId": "c2", "source": dict(SOURCE), "options": {},
                "columnMapping": {"agreement_no": "agreement_no", "parent_ref": "parent_ref",
                                  "status": "status", "country": "country"},
                "mappingVersion": "map-v2"}]
    validated = run_population_for_payload(command(sources=sources, bindings=[{
        "relationId": "r1", "referenceField": "parent_ref"}]))
    assert validated["ok"] is True
    assert validated["relationBindings"] == [{
        "relationId": "r1", "referenceField": "parent_ref", "targetField": "agreement_no"}]


def test_valid_document_command_compiles_without_llm_configuration():
    source = {**SOURCE, "mimeType": "application/pdf", "originalName": "agreement.pdf"}
    validated = run_population_for_payload(command(sources=[{
        "conceptId": "c1", "sourceKind": "document", "source": source,
        "fieldMappings": [
            {"sourceField": "Customer ID", "targetAttribute": "customer_id", "mode": "extract"},
            {"sourceField": "document_name", "targetAttribute": "name", "mode": "metadata"},
        ], "mappingVersion": "map-v1",
    }]))
    assert validated["ok"] is True
    assert validated["sources"][0]["sourceKind"] == "document"


def _document_command(field_mappings: list[dict]) -> dict:
    source = {**SOURCE, "mimeType": "application/pdf", "originalName": "agreement.pdf"}
    return command(sources=[{
        "conceptId": "c1", "sourceKind": "document", "source": source,
        "fieldMappings": field_mappings, "mappingVersion": "map-v1",
    }])


def test_document_command_accepts_an_explicit_extraction_strategy():
    validated = run_population_for_payload(_document_command([
        {"sourceField": "Customer ID", "targetAttribute": "customer_id", "mode": "extract",
         "extractionStrategy": "deterministic"},
        {"sourceField": "document_name", "targetAttribute": "name", "mode": "metadata"},
    ]))
    assert validated["ok"] is True
    assert validated["sources"][0]["fieldMappings"][0]["extractionStrategy"] == "deterministic"


def test_document_command_rejects_unknown_extraction_strategy():
    validated = run_population_for_payload(_document_command([
        {"sourceField": "Customer ID", "targetAttribute": "customer_id", "mode": "extract",
         "extractionStrategy": "magic"},
    ]))
    assert validated["errorCode"] == "invalid_document_mapping"


def test_document_command_rejects_strategy_on_a_non_extract_mapping():
    validated = run_population_for_payload(_document_command([
        {"sourceField": "document_name", "targetAttribute": "name", "mode": "metadata",
         "extractionStrategy": "ai"},
    ]))
    assert validated["errorCode"] == "invalid_document_mapping"


def test_validator_rejects_execution_fingerprint_mismatch():
    payload = command()
    payload["payload"]["populationExecutionFingerprint"] = "sha256:" + "0" * 64
    assert run_population_for_payload(payload)["errorCode"] == "execution_fingerprint_mismatch"


def test_validator_rejects_before_any_fetch():
    assert run_population_for_payload({})["errorCode"] == "workspace_required"
    assert run_population_for_payload(None)["errorCode"] == "invalid_command"
    missing_ws = command()
    del missing_ws["workspaceId"]
    assert run_population_for_payload(missing_ws)["errorCode"] == "workspace_required"
    assert run_population_for_payload(command(purpose="explode"))["errorCode"] == "invalid_purpose"
    assert run_population_for_payload(command(spec_hash="sha256:0" * 8))["errorCode"] == \
        "spec_hash_mismatch"
    bad_spec = base_spec()
    bad_spec["concepts"][0]["identity"] = {"namespace": "", "keyComponents": []}
    assert run_population_for_payload(command(spec=bad_spec))["errorCode"] == \
        "invalid_specification"
    unknown = command(sources=[{"conceptId": "nope", "source": dict(SOURCE),
                                "columnMapping": {"a": "b"}}])
    assert run_population_for_payload(unknown)["errorCode"] == "unknown_concept"
    unmapped = command(sources=[{"conceptId": "c1", "source": dict(SOURCE),
                                 "columnMapping": {"name": "name"}}])
    assert run_population_for_payload(unmapped)["errorCode"] == "unmapped_identity"
    bad_binding = command(bindings=[{
        "relationId": "nope", "referenceField": "x", "targetField": "y"}])
    assert run_population_for_payload(bad_binding)["errorCode"] == "unknown_relation"
    non_identity_binding = command(bindings=[{
        "relationId": "r1", "referenceField": "parent_ref", "targetField": "country"}])
    assert run_population_for_payload(non_identity_binding)["errorCode"] == \
        "invalid_relation_bindings"
    missing_filter = command(sources=[{"conceptId": "c2", "source": dict(SOURCE),
                                       "columnMapping": {"agreement_no": "agreement_no",
                                                         "country": "country"}}])
    assert run_population_for_payload(missing_filter)["errorCode"] == "unmapped_filter_field"
    duplicate = command(sources=[{"conceptId": "c1", "source": dict(SOURCE),
                                  "columnMapping": {"a": "customer_id", "b": "customer_id",
                                                    "name": "name"}}])
    assert run_population_for_payload(duplicate)["errorCode"] == "duplicate_column_mapping"
    reserved = command(sources=[{"conceptId": "c1", "source": dict(SOURCE),
                                 "columnMapping": {"customer_id": "customer_id",
                                                   "row": "_row"}}])
    assert run_population_for_payload(reserved)["errorCode"] == "reserved_attribute_name"
    unknown_kind = command(sources=[{"conceptId": "c1", "sourceKind": "binary",
                                     "source": dict(SOURCE),
                                     "columnMapping": {"customer_id": "customer_id"}}])
    assert run_population_for_payload(unknown_kind)["errorCode"] == "invalid_source_kind"


CSV = b"customer_id,name\nC-1,Acme\nC-2,Globex\n"


async def fake_fetch(source: dict, actor: str) -> bytes:
    assert actor == "u1"
    return CSV


def fake_prepare(source: dict, options: dict | None, data: bytes, output) -> dict:  # type: ignore[no-untyped-def]
    output.write_bytes(b"parquet-bytes")
    return {"datasetId": "ds_0123456789abcdef01234567", "rowCount": 2}


def fake_query(path, *, columns=None, filters=None, limit=100, offset=0) -> dict:  # type: ignore[no-untyped-def]
    assert "__sheetRow" in (columns or [])
    return {"columns": columns, "rows": [
        {"__sheetRow": 2, "customer_id": "C-1", "name": "Acme"},
        {"__sheetRow": 3, "customer_id": "C-2", "name": "Globex"},
    ][offset:offset + limit], "returnedRows": max(0, 2 - offset), "limit": limit, "offset": offset}


@pytest.mark.asyncio
async def test_task_populates_from_prepared_rows():
    outcome = await run_population_for_task(command(), fetch=fake_fetch,
                                            prepare=fake_prepare, query=fake_query)
    assert outcome["ok"] is True
    assert outcome["jobState"] == "completed"
    assert outcome["completeEnumeration"] is True
    assert outcome["counts"]["materialized"] == 2
    assert {a["attribute"] for a in outcome["assertions"]} == {"name"}
    assert outcome["relationships"] == []
    assert outcome["sourceObservations"][0]["datasetId"] == "ds_0123456789abcdef01234567"


@pytest.mark.asyncio
async def test_task_reads_rows_after_first_page():
    rows = [{"__sheetRow": index + 2, "customer_id": f"C-{index}", "name": "X"}
            for index in range(1001)]

    def paged(path, *, columns=None, filters=None, limit=100, offset=0):  # type: ignore[no-untyped-def]
        page = rows[offset:offset + limit]
        return {"columns": columns, "rows": page, "returnedRows": len(page),
                "limit": limit, "offset": offset}

    outcome = await run_population_for_task(command(), fetch=fake_fetch,
                                            prepare=fake_prepare, query=paged)
    assert outcome["counts"]["materialized"] == 1001
    assert any(entity["identity"]["customer_id"] == "c-1000"
               for entity in outcome["entities"])


@pytest.mark.asyncio
async def test_task_merges_tabular_and_document_sources(monkeypatch: pytest.MonkeyPatch):
    import app.population.document as document

    async def populate(_connection, entry, _concept, _actor, **_kwargs):
        return {"entities": [{"entityId": "crm:doc", "conceptId": entry["conceptId"],
                              "namespace": "crm", "identity": {"customer_id": "c-3"},
                              "label": "C-3", "attributes": {}, "provenance": {"sources": []}}],
                "assertions": [], "gaps": [],
                "counts": {"scanned": 1, "excluded": 0, "queryable": 0,
                           "materialized": 1, "gaps": 0},
                "coverage": {"assetRef": {}, "status": "processed_complete"},
                "sourceObservation": {"assetRef": {"assetVersionId": "sha256:doc"}},
                "indexObservation": None}

    monkeypatch.setattr(document, "populate_document", populate)
    sources = command()["payload"]["sources"] + [{
        "conceptId": "c1", "sourceKind": "document",
        "source": {**SOURCE, "mimeType": "application/pdf", "originalName": "agreement.pdf"},
        "fieldMappings": [
            {"sourceField": "Customer ID", "targetAttribute": "customer_id", "mode": "extract"},
            {"sourceField": "document_name", "targetAttribute": "name", "mode": "metadata"},
        ], "mappingVersion": "map-v1",
    }]
    outcome = await run_population_for_task(
        command(sources=sources), fetch=fake_fetch, prepare=fake_prepare,
        query=fake_query, index_connection=object())
    assert outcome["counts"]["materialized"] == 3
    assert outcome["documentCoverage"][0]["status"] == "processed_complete"


@pytest.mark.asyncio
async def test_task_reports_progress_source_by_source(monkeypatch: pytest.MonkeyPatch):
    import app.population.document as document
    from app.workers.population_tasks import PopulationProgress

    async def populate(_connection, entry, _concept, _actor, **kwargs):
        assert kwargs["cache"] is cache
        return {"entities": [{"entityId": "crm:doc", "conceptId": entry["conceptId"],
                              "namespace": "crm", "identity": {"customer_id": "c-3"},
                              "label": "C-3", "attributes": {}, "provenance": {"sources": []}}],
                "assertions": [], "gaps": [], "reused": True,
                "counts": {"scanned": 1, "excluded": 0, "queryable": 0, "materialized": 1, "gaps": 0},
                "coverage": {"assetRef": {}, "status": "processed_complete"},
                "sourceObservation": {"assetRef": {"assetVersionId": "sha256:doc"}},
                "indexObservation": None}

    monkeypatch.setattr(document, "populate_document", populate)
    sources = command()["payload"]["sources"] + [{
        "conceptId": "c1", "sourceKind": "document",
        "source": {**SOURCE, "mimeType": "application/pdf", "originalName": "agreement.pdf"},
        "fieldMappings": [{"sourceField": "Customer ID", "targetAttribute": "customer_id", "mode": "extract"}],
        "mappingVersion": "map-v1",
    }]
    reports: list[dict] = []
    cache = MemoryCache()

    async def report(snapshot: dict) -> None:
        reports.append(snapshot)

    outcome = await run_population_for_task(
        command(sources=sources), fetch=fake_fetch, prepare=fake_prepare, query=fake_query,
        index_connection=object(), progress=PopulationProgress(report, min_interval=0),
        extraction_cache=cache)
    assert outcome["ok"] is True
    assert reports[0] == {**reports[0], "phase": "reading", "total": 2, "done": 0}
    finished = [item for item in reports if item["done"] == 2][0]
    assert finished["reused"] == 1 and finished["records"] == 3
    assert [item["name"] for item in finished["recent"]] == ["agreement.pdf", SOURCE["assetId"]]
    assert finished["recent"][0]["reused"] is True
    assert reports[-1]["phase"] == "linking"
    assert "reused" not in outcome["entities"][0]


@pytest.mark.asyncio
async def test_task_reports_capped_enumeration_and_fetch_failures(monkeypatch: pytest.MonkeyPatch):
    import app.workers.population_tasks as tasks

    monkeypatch.setattr(tasks, "MAX_TOTAL_ASSERTIONS", 1000)

    def capped(path, *, columns=None, filters=None, limit=100, offset=0) -> dict:  # type: ignore[no-untyped-def]
        rows = [{"__sheetRow": i, "customer_id": f"C-{i}", "name": "X"}
                for i in range(2, 1002)]
        return {"columns": columns, "rows": rows, "returnedRows": 1000,
                "limit": limit, "offset": offset}

    outcome = await run_population_for_task(command(), fetch=fake_fetch,
                                            prepare=fake_prepare, query=capped)
    assert outcome["completeEnumeration"] is False
    assert [g["kind"] for g in outcome["gaps"]] == ["enumeration_capped"]
    assert outcome["jobState"] == "completed_with_gaps"

    async def denied(source: dict, actor: str) -> bytes:
        raise AssetFetchError("workspace_forbidden")

    failed = await run_population_for_task(command(), fetch=denied,
                                           prepare=fake_prepare, query=fake_query)
    assert failed == {"ok": False, "errorCode": "workspace_forbidden"}


@pytest.mark.asyncio
async def test_persist_population_revision_writes_canonical_rows():
    from app.persistence.population_store import revision_id_for
    from app.workers.population_tasks import persist_population_revision

    calls: list = []

    class FakePool:
        async def fetchval(self, sql: str, *params):  # type: ignore[no-untyped-def]
            calls.append(("fetchval", sql, params))
            return 0

        async def fetchrow(self, sql: str, *params):  # type: ignore[no-untyped-def]
            calls.append(("fetchrow", sql, params))
            return {"id": "row-1", "sequence": 1}

        async def executemany(self, sql: str, rows):  # type: ignore[no-untyped-def]
            calls.append(("executemany", sql, list(rows)))

    spec_hash = canonical_spec_hash(base_spec())
    outcome = {
        "specHash": spec_hash,
        "executionFingerprint": run_population_for_payload(command())["executionFingerprint"],
        "entities": [{"entityId": "crm:aaa", "conceptId": "c1", "namespace": "crm",
                      "identity": {"customer_id": "x"}, "label": "X",
                      "attributes": {"name": "X"}, "provenance": {}}],
        "assertions": [{"entityId": "crm:aaa", "attribute": "name", "value": "X",
                        "origin": "source", "evidence": {}}],
        "relationships": [{"relationId": "r1", "sourceEntityId": "crm:aaa",
                           "targetEntityId": "crm:aaa", "matchingStrategy": "exact"}],
        "gaps": [], "counts": {}, "datasetFingerprints": ["sha256:abc"],
    }
    revision = await persist_population_revision(FakePool(), command(), outcome)
    assert revision == revision_id_for(
        "v1", outcome["executionFingerprint"], ["sha256:abc"], 0)
    statements = [sql for _, sql, *_ in calls]
    assert any("semantic_runtime.specifications" in sql for sql in statements)
    assert any("semantic_population.data_revisions" in sql for sql in statements)
    assert any("semantic_population.entities" in sql for sql in statements)
    assert any("semantic_population.assertions" in sql for sql in statements)
    assert any("semantic_population.relationships" in sql for sql in statements)
    assert any("validation_state" in sql for sql in statements)


def test_preview_result_carries_output_without_revision():
    from app.workers.population_tasks import preview_job_result

    outcome = {"ok": True, "jobState": "completed", "purpose": "preview",
               "entities": [{"entityId": "e1"}], "counts": {"materialized": 1}}
    result = preview_job_result(outcome)
    assert result["entities"] == [{"entityId": "e1"}]
    assert "dataRevisionId" not in result
    assert "ok" not in result and "jobState" not in result


def test_job_summary_uses_storage_counts_not_submitted_rows():
    from app.workers.population_tasks import summarize_job_result

    outcome = {"specHash": "sha256:" + "a" * 64, "purpose": "build",
               "completeEnumeration": True, "counts": {"materialized": 99},
               "gaps": [{"kind": "conflicting_values"}],
               "entities": [{"entityId": f"e{i}"} for i in range(99)],
               "assertions": [{"entityId": "e0"} for _ in range(200)],
               "relationships": []}
    summary = summarize_job_result("dr_1", outcome,
                                   {"entities": 7, "assertions": 9, "relationships": 0})
    assert summary["entityCount"] == 7
    assert summary["assertionCount"] == 9
    assert summary["relationshipCount"] == 0
    assert summary["gapKinds"] == ["conflicting_values"]


def test_lease_covers_sources_within_bounds():
    assert population_lease_seconds(1, 30) == 300
    assert population_lease_seconds(25, 300) == 1800
    assert population_lease_seconds(5000, 300) == 1800
    assert 300 <= population_lease_seconds(3, 30) <= 1800


def test_summarize_gaps_groups_missing_values_and_links():
    from app.workers.population_tasks import summarize_gaps

    specification = {"concepts": [{"conceptId": "c1", "allowedFields": ["id", "city", "name"],
                                   "identity": {"keyComponents": ["id"]}}]}
    outcome = {"entities": [{"conceptId": "c1", "attributes": {"name": "A"}},
                            {"conceptId": "c1", "attributes": {"name": "B", "city": "Paris"}}],
               "gaps": [{"kind": "unresolved_reference", "relationId": "r1", "sourceEntityId": "e1",
                         "referenceField": "customer_id", "referenceValue": "C099", "targetField": "id"},
                        {"kind": "unresolved_reference", "relationId": "r1"},
                        {"kind": "missing_identity", "conceptId": "c1", "rowNumber": 4, "field": "id",
                         "assetRef": {"workspaceId": "w1", "assetId": "a1", "assetVersionId": "v1"},
                         "values": {"name": "C"}}]}
    assert summarize_gaps(outcome, specification) == {
        "missingValues": [{"conceptId": "c1", "attribute": "city", "missing": 1, "total": 2}],
        "unresolvedLinks": [{"relationId": "r1", "kind": "unresolved_reference", "count": 2}],
        "other": [{"conceptId": "c1", "kind": "missing_identity", "count": 1, "fields": ["id"]}],
        # Examples keep where each gap comes from; a link gap without its record is only counted.
        "rowSamples": [{"conceptId": "c1", "kind": "missing_identity", "field": "id", "rowNumber": 4,
                        "asset": {"workspaceId": "w1", "assetId": "a1"}, "values": {"name": "C"}}],
        "linkSamples": [{"relationId": "r1", "kind": "unresolved_reference", "sourceEntityId": "e1",
                         "referenceField": "customer_id", "referenceValue": "C099", "targetField": "id"}],
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("stop_after_checks", [1, 2])
async def test_a_run_asked_to_stop_ends_as_stopped_without_saving(monkeypatch: pytest.MonkeyPatch, stop_after_checks: int):
    """Stopped while reading (first progress report) or just before saving: nothing is saved."""
    from datetime import datetime, timezone

    import asyncpg

    import app.workers.population_tasks as tasks
    from app.jobs.models import Lease
    from app.persistence.postgres_jobs import PostgresJobRepository

    lease = Lease(task_id=7, job_id="job-1", task_name="populate", payload=command(),
                  lease_epoch=1, lease_owner="worker", lease_expires_at=datetime.now(timezone.utc))
    calls: dict[str, int] = {"checks": 0, "cancel": 0, "complete": 0, "requeue": 0, "persist": 0}

    class Pool:
        async def close(self):
            return None

    async def create_pool(*_args, **_kwargs):
        return Pool()

    async def claim(*_args, **_kwargs):
        return lease

    async def checkpoint(*_args, **_kwargs):
        return True

    async def cancel_requested(_self, job_id):
        assert job_id == "job-1"
        calls["checks"] += 1
        return calls["checks"] >= stop_after_checks

    async def count(name):
        async def record(*_args, **_kwargs):
            calls[name] += 1
            return {"jobId": "job-1", "state": "cancelled"}
        return record

    async def run(_payload, *, progress, **_kwargs):
        await progress.begin(1)
        return {"ok": True, "purpose": "build", "jobState": "completed"}

    monkeypatch.setenv("SEMANTIC_RUNTIME_DATABASE_URL", "postgresql://test")
    monkeypatch.setattr(asyncpg, "create_pool", create_pool)
    monkeypatch.setattr(PostgresJobRepository, "claim_task", claim)
    monkeypatch.setattr(PostgresJobRepository, "checkpoint", checkpoint)
    monkeypatch.setattr(PostgresJobRepository, "cancel_requested", cancel_requested)
    for name, method in (("cancel", "cancel_task"), ("complete", "complete_task"), ("requeue", "requeue_task")):
        monkeypatch.setattr(PostgresJobRepository, method, await count(name))
    monkeypatch.setattr(tasks, "persist_population_revision", await count("persist"))
    monkeypatch.setattr(tasks, "run_population_for_task", run)

    assert await tasks._run_task(7, "worker") == {"ok": False, "errorCode": "cancelled", "jobState": "cancelled"}
    assert calls["checks"] == stop_after_checks
    assert (calls["cancel"], calls["complete"], calls["requeue"], calls["persist"]) == (1, 0, 0, 0)


def test_only_gaps_that_lose_data_block_serving():
    from app.population.serving_policy import blocking_gap_kinds, serving_decision

    assert blocking_gap_kinds([{"kind": "unresolved_reference"}, {"kind": "conflicting_values"},
                               {"kind": "unresolved_document_field"}, {"kind": "ai_extraction_unresolved"},
                               {"kind": "budget_exhausted", "scope": "read"}]) == []
    assert blocking_gap_kinds([{"kind": "enumeration_capped"}, {"kind": "source_unavailable"},
                               {"kind": "budget_exhausted", "scope": "retrieval"},
                               {"kind": "enumeration_capped"}]) == ["budget_exhausted", "enumeration_capped", "source_unavailable"]
    assert serving_decision([], has_current_draft=True) == "activate"
    assert serving_decision(["source_unavailable"], has_current_draft=True) == "keep_previous"
    # Nothing to protect yet: the partial graph is better than none.
    assert serving_decision(["source_unavailable"], has_current_draft=False) == "activate"


@pytest.mark.asyncio
@pytest.mark.parametrize(("gaps", "has_draft", "decision", "finalized"), [
    ([], True, "activate", 1),
    ([{"kind": "unresolved_reference"}], True, "activate", 1),
    ([{"kind": "source_unavailable"}], True, "keep_previous", 0),
    ([{"kind": "source_unavailable"}], False, "activate", 1),
])
async def test_a_partial_run_keeps_the_graph_in_use(monkeypatch: pytest.MonkeyPatch, gaps, has_draft, decision, finalized):
    """The revision is always saved; only a result not missing data replaces an existing draft graph."""
    from datetime import datetime, timezone

    import asyncpg

    import app.workers.population_tasks as tasks
    from app.jobs.models import Lease
    from app.persistence import population_store
    from app.persistence.postgres_jobs import PostgresJobRepository

    lease = Lease(task_id=7, job_id="job-1", task_name="populate", payload=command(),
                  lease_epoch=1, lease_owner="worker", lease_expires_at=datetime.now(timezone.utc))
    calls = {"persist": 0, "finalize": 0}
    completed: dict = {}

    class Pool:
        async def close(self):
            return None

    async def create_pool(*_args, **_kwargs):
        return Pool()

    async def claim(*_args, **_kwargs):
        return lease

    async def not_cancelled(*_args, **_kwargs):
        return False

    async def checkpoint(*_args, **_kwargs):
        return True

    async def complete(_self, **kwargs):
        completed.update(kwargs)

    async def run(_payload, *, progress, **_kwargs):
        return {"ok": True, "purpose": "build", "gaps": gaps,
                "jobState": "completed_with_gaps" if gaps else "completed"}

    async def persist(*_args, **_kwargs):
        calls["persist"] += 1
        return "rev-2"

    async def counts(*_args, **_kwargs):
        return {"entities": 1, "assertions": 1, "relationships": 0}

    async def finalize(*_args, **_kwargs):
        calls["finalize"] += 1
        return {"projectionRef": "pop_rev-2", "environment": "draft"}

    async def binding(_pool, model_id, environment="production"):
        assert (model_id, environment) == ("m1", "draft")
        return {"version": 3} if has_draft else None

    monkeypatch.setenv("SEMANTIC_RUNTIME_DATABASE_URL", "postgresql://test")
    monkeypatch.setattr(asyncpg, "create_pool", create_pool)
    monkeypatch.setattr(PostgresJobRepository, "claim_task", claim)
    monkeypatch.setattr(PostgresJobRepository, "checkpoint", checkpoint)
    monkeypatch.setattr(PostgresJobRepository, "cancel_requested", not_cancelled)
    monkeypatch.setattr(PostgresJobRepository, "complete_task", complete)
    monkeypatch.setattr(tasks, "run_population_for_task", run)
    monkeypatch.setattr(tasks, "persist_population_revision", persist)
    monkeypatch.setattr(population_store, "count_revision_rows", counts)
    monkeypatch.setattr(population_store, "get_active_binding", binding)
    monkeypatch.setattr(tasks, "finalize_whole_model_build", finalize)

    await tasks._run_task(7, "worker")
    assert calls == {"persist": 1, "finalize": finalized}
    assert completed["result"]["servingDecision"] == decision
    assert completed["result"]["dataRevisionId"] == "rev-2"
    assert ("boundEnvironment" in completed["result"]) is bool(finalized)


class MemoryCache:
    """Stands in for the stored readings: a JSON round trip, as the database does."""

    def __init__(self):  # type: ignore[no-untyped-def]
        self.rows: dict = {}

    async def get(self, key):  # type: ignore[no-untyped-def]
        import json
        return json.loads(self.rows[key]) if key in self.rows else None

    async def put(self, key, *, concept_id, asset_id, output):  # type: ignore[no-untyped-def]
        import json
        self.rows[key] = json.dumps(output, default=str)


@pytest.mark.asyncio
async def test_unchanged_sheet_reuses_its_reading():
    from app.workers.population_tasks import PopulationProgress

    cache = MemoryCache()
    prepared: list[int] = []

    def counting_prepare(*args, **kwargs):  # type: ignore[no-untyped-def]
        prepared.append(1)
        return fake_prepare(*args, **kwargs)

    first = await run_population_for_task(command(), fetch=fake_fetch, prepare=counting_prepare,
                                          query=fake_query, extraction_cache=cache)
    progress = PopulationProgress()
    second = await run_population_for_task(command(), fetch=fake_fetch, prepare=counting_prepare,
                                           query=fake_query, extraction_cache=cache, progress=progress)
    assert prepared == [1]
    assert progress.reused == 1 and progress.recent[0]["reused"] is True
    assert second["entities"] == first["entities"]
    assert second["assertions"] == first["assertions"]
    assert second["sourceObservations"] == first["sourceObservations"]

    # A changed mapping reads the sheet again.
    changed = command()
    changed["payload"]["sources"][0]["mappingVersion"] = "map-v2"
    await run_population_for_task(changed, fetch=fake_fetch, prepare=counting_prepare,
                                  query=fake_query, extraction_cache=cache)
    assert prepared == [1, 1]


def test_compare_revisions_counts_changes_and_names_files_no_longer_read():
    from app.workers.population_tasks import compare_revisions

    def entity(entity_id, asset, **attributes):  # type: ignore[no-untyped-def]
        return {"entityId": entity_id, "label": entity_id, "attributes": attributes,
                "provenance": {"sources": [{"assetRef": {"assetId": asset}}]}}

    before = [entity("a", "sheet", name="A"), entity("b", "sheet", name="B"),
              entity("gone", "old.pdf", title="T"), entity("typed", "manual:1", name="X")]
    after = [entity("a", "sheet", name="A"), entity("b", "sheet", name="B2"),
             entity("new", "sheet", name="N")]
    assert compare_revisions(before, after, {"sheet"}) == {
        "added": 1, "removed": 2, "changed": 1,
        "removedSources": [{"assetId": "old.pdf", "records": 1}]}
