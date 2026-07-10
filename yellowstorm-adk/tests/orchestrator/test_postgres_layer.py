"""Postgres layer tests — run against a live Postgres in a throwaway schema.

Proves the multi-worker SKIP LOCKED claim (no task claimed twice under
concurrency) and the read-model projection round-trip. Skips cleanly if no
Postgres is reachable.

    <adk venv>/bin/python tests/orchestrator/test_postgres_layer.py
"""
import asyncio
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import asyncpg

from src.companion_ai import mcp_tasks, readmodel

DSN = dict(host=os.getenv("PGHOST", "localhost"), port=int(os.getenv("PGPORT", "5432")),
           database=os.getenv("PGDATABASE", "manus"), user=os.getenv("PGUSER", "manus"),
           password=os.getenv("PGPASSWORD", "manus"))
SCHEMA = "orch_test_" + uuid.uuid4().hex[:8]


async def _pool():
    try:
        return await asyncio.wait_for(asyncpg.create_pool(min_size=2, max_size=8, **DSN), timeout=5)
    except Exception as e:
        print(f"SKIP: Postgres not reachable ({e})")
        return None


async def test_claim_is_exclusive_under_concurrency(pool):
    await mcp_tasks.init_schema(pool, SCHEMA)
    N = 25
    for i in range(N):
        await mcp_tasks.enqueue(pool, session_id=f"s{i}", user_id="u",
                                task_id=f"t{i}", server_name="reminder", schema=SCHEMA)

    claimed_by = {}   # task_row_id -> worker
    async def worker(wid):
        while True:
            row = await mcp_tasks.claim(pool, wid, schema=SCHEMA)
            if row is None:
                return
            assert row["id"] not in claimed_by, f"row {row['id']} claimed twice!"
            claimed_by[row["id"]] = wid
            await asyncio.sleep(0.001)

    await asyncio.gather(*(worker(f"w{k}") for k in range(6)))
    assert len(claimed_by) == N, (len(claimed_by), N)
    assert len(set(claimed_by.values())) > 1, "expected work spread across workers"
    print(f"ok  SKIP LOCKED: {N} tasks claimed exactly once across {len(set(claimed_by.values()))} workers")


async def test_requeue_and_fail(pool):
    rid = await mcp_tasks.enqueue(pool, session_id="s", user_id="u",
                                  task_id="tx", server_name="reminder", schema=SCHEMA)
    row = await mcp_tasks.claim(pool, "w", schema=SCHEMA)
    while row["id"] != rid:
        row = await mcp_tasks.claim(pool, "w", schema=SCHEMA)
    st = await mcp_tasks.requeue(pool, rid, max_attempts=2, reason="boom", schema=SCHEMA)
    assert st == "pending", st                      # first failure → back to pending
    await mcp_tasks.claim(pool, "w", schema=SCHEMA)  # claim it again
    st = await mcp_tasks.requeue(pool, rid, max_attempts=2, reason="boom", schema=SCHEMA)
    assert st == "failed", st                        # budget exhausted → failed
    print("ok  requeue: retries then fails at the attempt budget")


async def test_readmodel_roundtrip(pool):
    rm = readmodel.ReadModel(pool, schema=SCHEMA)
    await readmodel.init_schema(pool, SCHEMA)
    sid = "sess1"
    await rm.ensure_session(sid, "u1", "My task", "running")
    await rm.upsert_plan(sid, "p1", "Report", "Build a report", "running")
    await rm.upsert_steps(sid, [
        ("a", 0, 0, "pending", "gather", "", ""),
        ("b", 1, 1, "pending", "write", "a", ""),
    ])
    await rm.set_step_status(sid, "a", "completed", agent="w_a", result="got data")
    await rm.set_step_status(sid, "b", "blocked", blocked_reason="need input")
    await rm.add_message("m1", sid, "user", "do it")

    async with pool.acquire() as con:
        a = await con.fetchrow(f'SELECT * FROM "{SCHEMA}".plan_steps WHERE session_id=$1 AND step_id=$2', sid, "a")
        b = await con.fetchrow(f'SELECT * FROM "{SCHEMA}".plan_steps WHERE session_id=$1 AND step_id=$2', sid, "b")
        msg = await con.fetchval(f'SELECT content FROM "{SCHEMA}".messages WHERE id=$1', "m1")
    assert a["status"] == "completed" and a["result"] == "got data" and a["agent"] == "w_a"
    assert b["status"] == "blocked" and b["blocked_reason"] == "need input"
    assert msg == "do it"
    print("ok  read-model: session/plan/steps/messages project + read back")


async def main():
    pool = await _pool()
    if pool is None:
        return
    try:
        await test_claim_is_exclusive_under_concurrency(pool)
        await test_requeue_and_fail(pool)
        await test_readmodel_roundtrip(pool)
        print("\nall postgres-layer tests passed")
    finally:
        async with pool.acquire() as con:
            await con.execute(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE')
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
