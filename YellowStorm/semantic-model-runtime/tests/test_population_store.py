from __future__ import annotations

import pytest

from app.persistence.population_store import revision_id_for


def test_revision_id_is_deterministic():
    fingerprint = "sha256:" + "a" * 64
    first = revision_id_for("v1", fingerprint, ["sha256:abc", "sha256:def"], 2)
    assert first.startswith("dr_") and len(first) == 27
    assert revision_id_for("v1", fingerprint, ["sha256:def", "sha256:abc"], 2) == first
    assert revision_id_for("v1", "sha256:" + "b" * 64, ["sha256:abc", "sha256:def"], 2) != first
    assert revision_id_for("v1", fingerprint, ["sha256:abc"], 2) != first
    assert revision_id_for("v1", fingerprint, ["sha256:abc", "sha256:def"], 3) != first


@pytest.mark.asyncio
async def test_cas_create_and_update_sql_shapes():
    calls: list[tuple[str, tuple]] = []

    class FakePool:
        def acquire(self):  # type: ignore[no-untyped-def]
            return self

        async def __aenter__(self):  # type: ignore[no-untyped-def]
            return self

        async def __aexit__(self, *_args):  # type: ignore[no-untyped-def]
            return None

        def transaction(self):  # type: ignore[no-untyped-def]
            return self

        async def fetchrow(self, sql: str, *params):  # type: ignore[no-untyped-def]
            calls.append((sql, params))
            return {"version": 1} if "RETURNING version" in sql else {"id": "x"}

    from app.persistence.population_store import cas_active_binding

    assert await cas_active_binding(
        FakePool(), model_id="m1", expected_version=None, model_version_id="v1",
        data_revision_id="dr_1", projection_ref="p", correction_sequence=0,
        spec_hash="sha256:" + "a" * 64) is True
    assert "ON CONFLICT (model_id, environment) DO NOTHING" in calls[0][0]
    assert await cas_active_binding(
        FakePool(), model_id="m1", expected_version=4, model_version_id="v1",
        data_revision_id="dr_2", projection_ref="p", correction_sequence=1,
        spec_hash="sha256:" + "a" * 64) is True
    assert "AND version = $7" in calls[1][0]
    assert calls[1][1][-2] == 4


@pytest.mark.asyncio
async def test_entity_listing_filters_before_limit():
    calls: list[tuple[str, tuple]] = []

    class FakePool:
        async def fetch(self, sql: str, *params):  # type: ignore[no-untyped-def]
            calls.append((sql, params))
            return []

    from app.persistence.population_store import list_revision_entities

    assert await list_revision_entities(FakePool(), "dr_1", 25, "c1") == []
    assert "FROM semantic_population.entities" in calls[0][0]
    assert "concept_id = $3" in calls[0][0]
    assert calls[0][1] == ("dr_1", 25, "c1")
