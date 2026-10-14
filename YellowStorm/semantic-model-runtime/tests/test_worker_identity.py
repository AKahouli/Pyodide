from __future__ import annotations

import pytest

from app.jobs import worker_identity
from app.jobs.worker_identity import WorkerIdentity, process_instance_id, worker_identity


def _fresh_instance_id(monkeypatch: pytest.MonkeyPatch, env: str | None = None) -> str:
    monkeypatch.delenv("SEMANTIC_WORKER_INSTANCE_ID", raising=False)
    if env is not None:
        monkeypatch.setenv("SEMANTIC_WORKER_INSTANCE_ID", env)
    process_instance_id.cache_clear()
    try:
        return process_instance_id()
    finally:
        process_instance_id.cache_clear()


def test_instance_id_is_fresh_randomness_per_process(monkeypatch: pytest.MonkeyPatch):
    first = _fresh_instance_id(monkeypatch)
    second = _fresh_instance_id(monkeypatch)
    assert first and second and first != second


def test_deployment_hint_prepends_but_never_replaces_randomness(monkeypatch: pytest.MonkeyPatch):
    hinted = _fresh_instance_id(monkeypatch, env="pod-7")
    assert hinted.startswith("pod-7:") and hinted != "pod-7"


def test_identity_is_stable_per_process_and_unique_per_restart(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("SEMANTIC_WORKER_INSTANCE_ID", raising=False)
    worker_identity.cache_clear()
    process_instance_id.cache_clear()
    try:
        first = worker_identity("population", "semantic-population@host")
        again = worker_identity("population", "semantic-population@host")
        assert again is first
        assert again.instance_id == first.instance_id

    finally:
        worker_identity.cache_clear()
        process_instance_id.cache_clear()


def test_lease_owner_is_unique_per_run_and_carries_no_hostname():
    identity = WorkerIdentity(role="population", hostname="semantic-population@host-a", instance_id="i-1")
    owner = identity.lease_owner()
    assert owner.startswith("population-worker:i-1:")
    assert "host-a" not in owner
    assert identity.lease_owner() != owner


def test_heartbeat_id_is_one_row_per_instance():
    a = WorkerIdentity(role="search", hostname="same-host", instance_id="i-1")
    b = WorkerIdentity(role="search", hostname="same-host", instance_id="i-2")
    assert a.heartbeat_id != b.heartbeat_id
