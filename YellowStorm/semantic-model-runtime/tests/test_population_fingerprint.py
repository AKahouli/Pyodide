"""The run fingerprint is computed by the core and by the runtime: both must hash the same body."""

from __future__ import annotations

from app.workers.population_tasks import population_execution_fingerprint

SOURCE = {"conceptId": "c1", "sourceKind": "manual", "source": {"k": 1}, "mappingVersion": "v1"}
LIMITS = {"maxRunSources": 6000, "maxRecordsPerRun": 20000}


def test_admin_limits_are_part_of_the_fingerprint_like_in_the_core() -> None:
    # The same constant is asserted by the core's semantic-population-refresh spec.
    assert population_execution_fingerprint("h", [SOURCE], [], None, None, LIMITS) == \
        "sha256:ab3abd75d44f5015cbd71b617e7662c7f81db605e751cb0a2bf9575f0fdd1207"
    plain = population_execution_fingerprint("h", [SOURCE], [])
    assert plain != population_execution_fingerprint("h", [SOURCE], [], None, None, LIMITS)
    # No limit set by an admin: the fingerprint does not change.
    assert population_execution_fingerprint("h", [SOURCE], [], None, None, {}) == plain
    assert population_execution_fingerprint("h", [SOURCE], [], None, None, None) == plain


def test_save_limits_do_not_change_the_fingerprint() -> None:
    plain = population_execution_fingerprint("h", [SOURCE], [], None, None, LIMITS)
    saved = {**LIMITS, "saveBatchRows": 5000, "saveStatementSeconds": 120}
    assert population_execution_fingerprint("h", [SOURCE], [], None, None, saved) == plain
    only_save = {"saveBatchRows": 5000}
    assert population_execution_fingerprint("h", [SOURCE], [], None, None, only_save) ==         population_execution_fingerprint("h", [SOURCE], [])


def test_save_limits_are_read_in_range_and_default_to_the_pool_behaviour() -> None:
    from app.population.run_limits import run_limits

    assert run_limits({})["saveBatchRows"] == 2000 and run_limits({})["saveStatementSeconds"] == 10
    chosen = run_limits({"limits": {"saveBatchRows": 20000, "saveStatementSeconds": 120}})
    assert (chosen["saveBatchRows"], chosen["saveStatementSeconds"]) == (20000, 120)
    for given in ({"saveBatchRows": 99, "saveStatementSeconds": 4}, {"saveBatchRows": 50001, "saveStatementSeconds": 601},
                  {"saveBatchRows": True, "saveStatementSeconds": "30"}):
        kept = run_limits({"limits": given})
        assert (kept["saveBatchRows"], kept["saveStatementSeconds"]) == (2000, 10)


def test_save_limits_do_not_change_the_admission_hash_of_a_run() -> None:
    from app.jobs.service import _identity_command

    base = {"actorUserId": "u", "payload": {"specHash": "h", "limits": {"maxRunSources": 6000}}}
    saved = {"actorUserId": "u", "payload": {"specHash": "h", "limits": {
        "maxRunSources": 6000, "saveBatchRows": 5000, "saveStatementSeconds": 90}}}
    assert _identity_command(saved) == base
    only_save = {"actorUserId": "u", "payload": {"specHash": "h", "limits": {"saveBatchRows": 5000}}}
    assert _identity_command(only_save) == {"actorUserId": "u", "payload": {"specHash": "h"}}
    assert _identity_command(base) is base
    assert saved["payload"]["limits"]["saveBatchRows"] == 5000  # the command itself is untouched


def test_corrections_are_read_page_by_page_up_to_the_watermark() -> None:
    import asyncio
    from datetime import datetime, timezone

    from app.persistence.population_store import list_model_corrections

    stored = [{"sequence": n, "model_version_id": "v", "actor_user_id": "u", "reason": "", "target_identity": {},
               "action": "set", "payload": {}, "created_at": datetime.now(timezone.utc)} for n in range(1, 8)]

    class Pool:
        async def fetch(self, _sql, _model, after, up_to, page):  # type: ignore[no-untyped-def]
            return [row for row in stored if row["sequence"] > after and (up_to is None or row["sequence"] <= up_to)][:page]

    assert [c["sequence"] for c in asyncio.run(list_model_corrections(Pool(), "m", page=2))] == list(range(1, 8))
    assert [c["sequence"] for c in asyncio.run(list_model_corrections(Pool(), "m", 5, page=2))] == [1, 2, 3, 4, 5]


def test_a_key_many_records_share_does_not_build_every_link() -> None:
    from app.population.tabular import match_relationships

    compiled = {"matchingStrategy": "exact", "cardinality": "many_to_many", "relationId": "r"}
    side = [{"entityId": f"e{n}", "identityKey": {"k": "same"}, "attributes": {"k": "same"}} for n in range(300)]
    whole = match_relationships(compiled, side, side, "k", "k")
    assert len(whole["relationships"]) == 300 * 300
    bounded = match_relationships(compiled, side, side, "k", "k", budget=1001)
    assert len(bounded["relationships"]) == 1001
    assert match_relationships(compiled, side, side, "k", "k", budget=0)["relationships"] == []


def test_the_index_capabilities_are_read_once_per_database() -> None:
    import asyncio
    from types import SimpleNamespace

    from app.datasource import logical_index

    class Connection:
        _params = SimpleNamespace(database="index")
        _addr = ("db", 5432)
        queries = 0

        async def fetchval(self, _sql):  # type: ignore[no-untyped-def]
            self.queries += 1
            return "16.1"

        async def fetch(self, _sql, _names):  # type: ignore[no-untyped-def]
            self.queries += 1
            return []

    logical_index.clear_capability_cache()
    connection = Connection()
    first = asyncio.run(logical_index.detect_capabilities(connection))
    asyncio.run(logical_index.detect_capabilities(connection))
    assert connection.queries == 4  # one reading: server version, extensions, tables, columns
    first["tables"].append("changed")  # a caller's change never reaches the next one
    assert "changed" not in asyncio.run(logical_index.detect_capabilities(connection))["tables"]
    logical_index.clear_capability_cache()
