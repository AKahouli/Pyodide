"""The health report a scope may read, and a records page that shows every concept."""

from __future__ import annotations

import pytest

from app.api import population_routes as routes
from app.persistence import population_store as store

HEALTH = {"version": 1, "concepts": {
    "visible": {"conceptId": "visible", "workspaceIds": ["ws-a"], "rowsRead": 10},
    "hidden": {"conceptId": "hidden", "workspaceIds": ["ws-a", "ws-b"], "rowsRead": 99},
    "typed": {"conceptId": "typed", "workspaceIds": [], "rowsRead": 1}}}


def test_health_is_untouched_when_nothing_is_hidden_and_absent_when_never_built():
    assert routes._scoped_health(HEALTH, ["ws-a"], set()) is HEALTH
    assert routes._scoped_health(None, ["ws-a"], {"x"}) is None
    assert routes._scoped_health("old", ["ws-a"], set()) is None


def test_a_concept_with_a_source_outside_the_scope_is_left_out_of_the_health_report():
    scoped = routes._scoped_health(HEALTH, ["ws-a"], {"record-in-ws-b"})
    assert sorted(scoped["concepts"]) == ["typed", "visible"]
    assert scoped["version"] == 1


class QuotaPool:
    def __init__(self) -> None:
        self.calls: list[tuple] = []

    async def fetch(self, sql: str, *params):  # type: ignore[no-untyped-def]
        self.calls.append((sql, params))
        return []


@pytest.mark.asyncio
async def test_a_records_page_takes_its_share_of_each_concept_in_one_statement():
    pool = QuotaPool()
    assert await store.list_revision_entities_visible(pool, "dr", 25, None, ["ws-a"], quotas={}) == []
    assert pool.calls == []
    await store.list_revision_entities_visible(pool, "dr", 25, None, ["ws-a"], quotas={"b": 7, "a": 18})
    sql, params = pool.calls[0]
    assert "CROSS JOIN LATERAL" in sql and "LIMIT q.quota" in sql
    assert params == ("dr", ["a", "b"], [18, 7], ["ws-a"])
