"""Phase 3 deterministic discovery slice (P3.3-P3.4, P3.6, P3.11).

Pure domain + durable-payload wiring. No DB, no network, no heavy libs.
"""

from __future__ import annotations

import pytest

from app.datasource.discovery import (
    discover,
    discovery_profile_id,
    parser_fingerprint,
    plan_ingestion,
    preview_source,
    requires_cross_workspace_authorization,
    resolve_asset_ref,
    validate_archive_safety,
)
from app.jobs.recovery import (
    backoff_seconds,
    classify_expired,
    max_attempts_from_env,
    retry_seconds_from_env,
)
from app.workers.datasource_tasks import (
    attempts_exhausted,
    build_mapping_preview,
    discover_asset,
    run_discovery_for_payload,
)


def test_mapping_preview_resolves_only_bounded_persisted_samples() -> None:
    profile = {
        "samples": [
            {"__sheetRow": 2, "customer_id": "C1", "name": "Acme"},
            {"__sheetRow": 3, "customer_id": "C1", "name": "Duplicate"},
            {"__sheetRow": 4, "customer_id": "", "name": "Missing"},
        ],
        "fieldProfiles": [{"name": "customer_id", "type": "text", "sample": "C1",
                           "populatedRatio": 2 / 3, "uniqueRatio": 0.5}],
        "warnings": [{"code": "sample", "message": "This is a bounded sample."}],
    }
    result = build_mapping_preview(profile, {
        "fieldMappings": [
            {"sourceField": "customer_id", "targetAttribute": "id", "mode": "direct"},
            {"sourceField": "name", "targetAttribute": "name", "mode": "direct"},
        ],
        "identityFields": ["id"],
    })

    assert result is not None
    assert [item["values"]["name"] for item in result["entities"]] == ["Acme"]
    assert result["stats"] == {"scannedRows": 3, "resolvedEntities": 1,
                               "duplicateKeysSkipped": 1, "nullIdentitySkipped": 1}
    assert result["identityEvidence"][0]["name"] == "id"

XLSX = {"workspaceId": "6512f0a1c9e77a001234aaa1", "assetId": "6512f0a1c9e77a001234bbb2",
        "originalName": "customer-registry.xlsx",
        "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "sizeBytes": 184320, "contentHash": "9f2a1c0e5b6d7a8b9c0d1e2f3a4b5c6d",
        "uploadedAt": "2026-09-10T08:30:00.000Z", "indexingStatus": None}
CSV = {"workspaceId": "6512f0a1c9e77a001234aaa1", "assetId": "6512f0a1c9e77a001234ccc3",
       "originalName": "pricing-2026-08.csv", "mimeType": "text/csv",
       "sizeBytes": 52428800, "contentHash": None,
       "uploadedAt": "2026-09-11T14:02:11.000Z", "indexingStatus": None}
INDEXED_DOC = {"workspaceId": "6512f0a1c9e77a001234aaa1", "assetId": "6512f0a1c9e77a001234ddd4",
               "originalName": "msa-acme-2026.pdf", "mimeType": "application/pdf",
               "sizeBytes": 2411724, "contentHash": None,
               "uploadedAt": "2026-09-05T09:15:00.000Z", "indexingStatus": "completed",
               "indexObservationId": "obs_e16f7a2b4c5d6e7f8091a2b3",
               "sections": 42, "blocks": 913, "visualContentPending": False}
UNINDEXED_DOC = {"workspaceId": "6512f0a1c9e77a001234aaa1", "assetId": "6512f0a1c9e77a001234eee5",
                 "originalName": "sop-expenses-draft.docx",
                 "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                 "sizeBytes": 884736, "contentHash": None,
                 "uploadedAt": "2026-09-12T16:44:00.000Z", "indexingStatus": "failed"}


def test_asset_ref_md5_is_partial():
    ref = resolve_asset_ref(XLSX)
    assert ref["assetVersionId"] == "md5:9f2a1c0e5b6d7a8b9c0d1e2f3a4b5c6d"
    assert ref["sourceVersionVerification"] == "partial"


def test_asset_ref_presigned_upload_is_unknown_observation():
    ref = resolve_asset_ref(CSV)
    assert ref["assetVersionId"].startswith("obs:6512f0a1c9e77a001234ccc3:")
    assert ref["sourceVersionVerification"] == "unknown"


def test_observation_suffix_is_version_specific():
    first = resolve_asset_ref(CSV)["assetVersionId"]
    reuploaded = resolve_asset_ref({**CSV, "uploadedAt": "2026-09-12T10:00:00.000Z"})["assetVersionId"]
    assert reuploaded != first
    assert resolve_asset_ref(CSV)["assetVersionId"] == first


def test_asset_ref_completed_index_is_partial_with_observation():
    ref = resolve_asset_ref(INDEXED_DOC)
    assert ref["sourceVersionVerification"] == "partial"
    assert ref["indexObservationId"] == "obs_e16f7a2b4c5d6e7f8091a2b3"


def test_asset_ref_failed_index_is_unknown():
    ref = resolve_asset_ref(UNINDEXED_DOC)
    assert ref["sourceVersionVerification"] == "unknown"


def test_asset_ref_live_ready_index_is_partial():
    live = resolve_asset_ref({**INDEXED_DOC, "indexingStatus": "ready"})
    assert live["sourceVersionVerification"] == "partial"
    assert discover({**INDEXED_DOC, "indexingStatus": "ready"})["status"] == "ready"


def test_asset_ref_rejects_non_hex_identity():
    with pytest.raises(ValueError, match="invalid_asset_identity"):
        resolve_asset_ref({"workspaceId": "ws-1", "assetId": "6512f0a1c9e77a001234bbb2"})


def test_cross_workspace_detection_and_default_deny():
    home, other = "6512f0a1c9e77a001234aaa1", "6512f0a1c9e77a001234fff6"
    assert requires_cross_workspace_authorization(home, other) is True
    assert requires_cross_workspace_authorization(home, home) is False
    # An absent home workspace is treated as requiring authorization; the
    # caller rejects it outright, so it can never skip the check.
    assert requires_cross_workspace_authorization(None, other) is True
    assert requires_cross_workspace_authorization("", other) is True
    # No authoritative verifier is wired yet: cross-workspace fails closed
    # rather than trusting caller-asserted grants.
    cross = {**XLSX, "workspaceId": other}
    denied = run_discovery_for_payload({
        "actorUserId": "u", "workspaceId": home, "payload": {
            "source": cross,
            "grants": {"homeWorkspaceGrant": "granted", "sourceWorkspaceGrant": "granted"}}})
    assert denied == {"ok": False, "errorCode": "workspace_forbidden"}


def test_cross_workspace_uses_execution_time_verifier_not_payload_grants():
    home, other = "6512f0a1c9e77a001234aaa1", "6512f0a1c9e77a001234fff6"
    cross = {**XLSX, "workspaceId": other}
    payload = {"actorUserId": "u", "workspaceId": home,
               "payload": {"source": cross,
                           "grants": {"homeWorkspaceGrant": "granted",
                                      "sourceWorkspaceGrant": "granted"}}}
    seen: list[dict] = []

    def verifier(*, actor_user_id, home_workspace_id, source_workspace_id):
        seen.append({"actor": actor_user_id, "home": home_workspace_id,
                     "source": source_workspace_id})
        return True

    assert run_discovery_for_payload(payload, authorize=verifier)["ok"] is True
    assert seen == [{"actor": "u", "home": home, "source": other}]

    # Revocation after admission: the payload still says "granted", but the
    # authoritative check at execution time denies it.
    def revoked(*, actor_user_id, home_workspace_id, source_workspace_id):
        return False

    assert run_discovery_for_payload(payload, authorize=revoked) == {
        "ok": False, "errorCode": "workspace_forbidden"}

    # An unverifiable decision also fails closed.
    def broken(*, actor_user_id, home_workspace_id, source_workspace_id):
        raise ConnectionError("authorization service unavailable")

    assert run_discovery_for_payload(payload, authorize=broken) == {
        "ok": False, "errorCode": "workspace_forbidden"}

    # Same-workspace discovery needs no verifier at all.
    assert run_discovery_for_payload({"actorUserId": "u", "workspaceId": home,
                                      "payload": {"source": XLSX}})["ok"] is True

    # A class implementing the published Protocol is invoked the same way.
    class ClassVerifier:
        def __call__(self, *, actor_user_id, home_workspace_id, source_workspace_id):
            return True

    assert run_discovery_for_payload(payload, authorize=ClassVerifier())["ok"] is True


def test_discovery_statuses_match_fixtures():
    assert discover(XLSX)["status"] == "ready"
    assert discover(CSV)["status"] == "ready"
    assert discover(INDEXED_DOC)["status"] == "ready"
    unindexed = discover(UNINDEXED_DOC)
    assert unindexed["status"] == "indexing_required"
    assert any(w["code"] == "indexing_required" for w in unindexed["warnings"])
    assert unindexed["coverage"] == {"sampled": False, "completeProfileDone": False}
    # A spreadsheet is read from the file itself: failed or missing indexing never blocks it.
    for indexing in (None, "none", "pending", "failed"):
        assert discover({**XLSX, "indexingStatus": indexing})["status"] == "ready"


def test_discovery_terminal_statuses():
    assert discover({**XLSX, "mimeType": "application/x-msaccess"})["status"] == "unsupported"
    assert discover({**XLSX, "protected": True})["status"] == "protected"
    assert discover({**XLSX, "corrupt": True})["status"] == "corrupt"


def test_discovery_never_uses_llm_and_missing_stays_missing():
    profile = discover(CSV)
    assert profile["semanticFindings"] == []
    assert profile["metadata"]["contentHash"] is None
    assert profile["metadata"]["uploadedAt"] == "2026-09-11T14:02:11.000Z"


def test_discovery_metadata_omits_absent_strings_never_null():
    profile = discover({"workspaceId": "6512f0a1c9e77a001234aaa1",
                        "assetId": "6512f0a1c9e77a001234bbb2"})
    assert profile["status"] == "unsupported"
    assert "originalName" not in profile["metadata"]
    assert "mimeType" not in profile["metadata"]
    assert all(v is not None for k, v in profile["metadata"].items()
               if k in ("originalName", "mimeType"))


def _assert_profile_shape(profile: dict) -> None:
    assert {"profileId", "profileRevision", "assetRef", "parserFingerprint", "status",
            "metadata", "structure", "samples", "warnings", "coverage"} <= set(profile)
    assert profile["profileRevision"] == 1
    assert profile["status"] in ("ready", "partial", "unsupported", "protected",
                                 "corrupt", "indexing_required")
    assert profile["assetRef"]["sourceVersionVerification"] in ("verified", "partial", "unknown")
    assert isinstance(profile["warnings"], list) and isinstance(profile["samples"], list)
    assert set(profile["coverage"]) == {"sampled", "completeProfileDone"}
    assert profile["coverage"]["completeProfileDone"] is False


def test_generated_profiles_validate_against_frozen_json_schemas():
    """Contract conformance, not just field presence.

    Metadata-only scope: this slice performs no source read, so
    ``coverage.sampled`` is false and samples are empty until the bounded
    sampling slice lands. The profile must still be schema-valid.
    """
    import json
    from pathlib import Path

    jsonschema = pytest.importorskip("jsonschema")
    from referencing import Registry, Resource

    contracts = Path(__file__).resolve().parents[1] / "contracts" / "v1"
    asset = json.loads((contracts / "asset-ref.schema.json").read_text(encoding="utf-8"))
    profile_schema = json.loads(
        (contracts / "discovery-profile.schema.json").read_text(encoding="utf-8"))
    registry = Registry().with_resources([
        (asset["$id"], Resource.from_contents(asset)),
        (profile_schema["$id"], Resource.from_contents(profile_schema)),
    ])

    for source in (XLSX, CSV, INDEXED_DOC, UNINDEXED_DOC,
                   {**XLSX, "mimeType": "application/x-msaccess"},
                   {**XLSX, "protected": True}, {**XLSX, "corrupt": True}):
        profile = discover(source)
        jsonschema.Draft7Validator(profile_schema, registry=registry).validate(profile)
        assert profile["coverage"] == {"sampled": False, "completeProfileDone": False}
        assert profile["samples"] == []


def test_fixture_files_match_expected_resolution():
    import json
    from pathlib import Path

    fixtures = Path(__file__).parent / "contracts" / "fixtures"
    for name in ("xlsx-source", "csv-source", "indexed-document", "unindexed-document"):
        case = json.loads((fixtures / f"{name}.fixture.json").read_text(encoding="utf-8"))
        source = case["source"]
        expected = case["expectedResolution"]
        ref = resolve_asset_ref(source)
        assert ref["workspaceId"] == expected["assetRef"]["workspaceId"]
        assert ref["assetId"] == expected["assetRef"]["assetId"]
        assert ref["sourceVersionVerification"] == expected["assetRef"]["sourceVersionVerification"]
        if expected["assetRef"]["assetVersionId"].startswith(("md5:", "sha256:")):
            assert ref["assetVersionId"] == expected["assetRef"]["assetVersionId"]
        else:
            assert ref["assetVersionId"].startswith(f"obs:{source['assetId']}:")
        profile = discover(source)
        assert profile["status"] == expected["discovery"]["status"]
        _assert_profile_shape(profile)
        # Fixtures capture full Phase 3 discovery (samples present); this
        # metadata-only slice deliberately emits no samples yet.
        assert expected["discovery"]["coverage"]["sampled"] is True
        assert profile["coverage"]["sampled"] is False
    cross = json.loads((fixtures / "cross-workspace-selection.fixture.json").read_text(encoding="utf-8"))
    home = cross["homeWorkspace"]["workspaceId"]
    denied = run_discovery_for_payload({"actorUserId": "u", "workspaceId": home,
                                        "payload": {"source": cross["selectedSource"]}})
    assert denied == {"ok": False, "errorCode": "workspace_forbidden"}


def test_fingerprint_and_profile_id_are_deterministic():
    assert parser_fingerprint({"sheets": ["A"]}) == parser_fingerprint({"sheets": ["A"]})
    assert parser_fingerprint({"sheets": ["A"]}) != parser_fingerprint({"sheets": ["B"]})
    ref = resolve_asset_ref(XLSX)
    fp = parser_fingerprint(None)
    assert discovery_profile_id(ref, fp) == discovery_profile_id(ref, fp)
    # The same bytes in another workspace are another file: its profile must not collide.
    assert discovery_profile_id({**ref, "workspaceId": "other"}, fp) != discovery_profile_id(ref, fp)


def test_archive_safety_bounds_and_traversal():
    assert validate_archive_safety(detected_format="csv", compressed_bytes=10) == []
    big = validate_archive_safety(detected_format="xlsx", compressed_bytes=60 * 1024 * 1024)
    assert any(w["code"] == "source_too_large" for w in big)
    with pytest.raises(ValueError, match="archive_path_traversal"):
        validate_archive_safety(detected_format="xlsx", compressed_bytes=10, paths=["../evil.sh"])


def test_plan_ingestion_mapping():
    assert plan_ingestion(discover(XLSX))["decision"] == "prepare_dataset"
    assert plan_ingestion(discover(INDEXED_DOC))["decision"] == "read_via_index"
    assert plan_ingestion(discover(UNINDEXED_DOC))["decision"] == "require_indexing"
    assert preview_source(CSV)["ingestionPlan"]["decision"] == "prepare_dataset"


def test_payload_wiring_tabular_ready_is_completed():
    outcome = run_discovery_for_payload(
        {"actorUserId": "u", "workspaceId": XLSX["workspaceId"],
         "payload": {"source": XLSX}})
    assert outcome["ok"] is True and outcome["jobState"] == "completed"


def test_payload_wiring_indexing_required_is_gaps_and_forbidden_fails_closed():
    gaps = run_discovery_for_payload(
        {"actorUserId": "u", "workspaceId": UNINDEXED_DOC["workspaceId"],
         "payload": {"source": UNINDEXED_DOC}})
    assert gaps["ok"] is True and gaps["jobState"] == "completed_with_gaps"
    src = {**XLSX, "workspaceId": "6512f0a1c9e77a001234fff6"}
    # A canonical home workspace is required and is never inferred from the
    # payload, so omission cannot skip authorization.
    assert run_discovery_for_payload({"actorUserId": "u", "payload": {"source": XLSX}}) == {
        "ok": False, "errorCode": "workspace_required"}
    assert run_discovery_for_payload({"actorUserId": "u", "workspaceId": "",
                                      "payload": {"source": XLSX}}) == {
        "ok": False, "errorCode": "workspace_required"}
    assert run_discovery_for_payload({"actorUserId": "u", "workspaceId": 42,
                                      "payload": {"source": XLSX}}) == {
        "ok": False, "errorCode": "workspace_required"}
    # A payload claiming the source workspace as home is rejected.
    spoofed = run_discovery_for_payload({
        "actorUserId": "u", "workspaceId": "6512f0a1c9e77a001234aaa1",
        "payload": {"source": src, "homeWorkspaceId": src["workspaceId"],
                    "grants": {"homeWorkspaceGrant": "granted",
                               "sourceWorkspaceGrant": "granted"}}})
    assert spoofed == {"ok": False, "errorCode": "workspace_forbidden"}
    # Canonical top-level workspaceId fences cross-workspace reads.
    top_level = run_discovery_for_payload({"actorUserId": "u",
                                           "workspaceId": "6512f0a1c9e77a001234aaa1",
                                           "payload": {"source": src}})
    assert top_level == {"ok": False, "errorCode": "workspace_forbidden"}
    # A cross-workspace job with no actor cannot be verified.
    assert run_discovery_for_payload({"workspaceId": "6512f0a1c9e77a001234aaa1",
                                      "payload": {"source": src}}) == {
        "ok": False, "errorCode": "workspace_forbidden"}
    assert run_discovery_for_payload({}) == {"ok": False, "errorCode": "invalid_command"}


@pytest.mark.parametrize("bad", [None, [], "x", {"payload": None},
                                 {"payload": {"source": {"assetId": "nope"}}},
                                 {"payload": {"source": {**XLSX, "workspaceId": "bad"},
                                              "homeWorkspaceId": "6512f0a1c9e77a001234aaa1"}},
                                 {"payload": {"source": XLSX, "homeWorkspaceId": "bad",
                                              "grants": {"homeWorkspaceGrant": "granted",
                                                         "sourceWorkspaceGrant": "granted"}}},
                                 {"payload": {"source": XLSX,
                                              "grants": "not-a-dict",
                                              "homeWorkspaceId": "6512f0a1c9e77a001234fff6"}}])
def test_malformed_payloads_never_raise(bad):
    assert run_discovery_for_payload(bad)["ok"] is False


def test_task_rejects_non_int_reference_without_touching_broker():
    assert discover_asset("1") == {"ok": False, "errorCode": "invalid_task_reference"}
    assert discover_asset(True) == {"ok": False, "errorCode": "invalid_task_reference"}


def test_infra_failure_retries_in_worker_path_and_is_bounded(monkeypatch: pytest.MonkeyPatch):
    import app.workers.datasource_tasks as tasks

    monkeypatch.setenv("SEMANTIC_RUNTIME_DATABASE_URL", "postgresql://test")

    # Deterministic outcomes still return normally (no retry, no failure).
    async def completed(task_id, lease_owner):
        return {"ok": True}
    monkeypatch.setattr(tasks, "_run_task", completed)
    assert tasks.discover_asset(7) == {"ok": True}

    calls = {"n": 0}

    async def boom(task_id, lease_owner):
        calls["n"] += 1
        raise ConnectionError("db down")
    monkeypatch.setattr(tasks, "_run_task", boom)

    # Worker path (eager stands in for the worker request context). Celery's
    # retry is the only mechanism that requeues under 5.3.6, and max_retries
    # bounds it: the task body runs 1 + max_attempts times, then the attempt
    # fails terminally instead of redelivering forever.
    result = tasks.discover_asset.apply(args=[7])
    assert calls["n"] == 1 + 3
    assert result.failed() is True
    assert tasks.discover_asset.override_max_retries == 3

    calls["n"] = 0
    monkeypatch.setenv("SEMANTIC_TASK_MAX_ATTEMPTS", "5")
    result = tasks.discover_asset.apply(args=[7])
    assert calls["n"] == 1 + 5
    assert result.failed() is True


def test_failed_tasks_are_rejected_not_acknowledged():
    from app.workers.celery_app import celery_app

    assert celery_app.conf.task_acks_late is True
    assert celery_app.conf.task_acks_on_failure_or_timeout is False
    assert celery_app.conf.task_reject_on_worker_lost is True


def test_attempt_cap_is_bounded_and_env_validated():
    assert attempts_exhausted(1, 3) is False
    assert attempts_exhausted(4, 3) is True
    assert max_attempts_from_env(None) == 3
    assert max_attempts_from_env("5") == 5
    assert max_attempts_from_env("0") == 3
    assert max_attempts_from_env("nope") == 3
    assert retry_seconds_from_env(None) == 30
    assert retry_seconds_from_env("45") == 45
    assert retry_seconds_from_env("-1") == 30
    assert classify_expired(1, 3) == "requeue"
    assert classify_expired(4, 3) == "exhaust"
    assert backoff_seconds(30, 1) == 30
    assert backoff_seconds(30, 3) == 90
    assert backoff_seconds(30, 999) == 600


def test_domain_import_pulls_no_heavy_libs():
    """Hermetic: importing the discovery domain must not initialize parser,
    embedding, or query-engine libraries, regardless of what sibling tests
    already imported in this process."""
    import subprocess
    import sys as _sys
    from pathlib import Path

    code = ("import sys, app.datasource.discovery; "
            "heavy = [m for m in ('openpyxl', 'xlrd', 'duckdb', 'torch', "
            "'sentence_transformers') if m in sys.modules]; "
            "assert not heavy, heavy; print('lazy-ok')")
    completed = subprocess.run(
        [_sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True, text=True, timeout=60,
    )
    assert completed.returncode == 0, completed.stderr
    assert "lazy-ok" in completed.stdout
