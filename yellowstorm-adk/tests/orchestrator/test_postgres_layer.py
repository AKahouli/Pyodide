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
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import asyncpg
import pytest
import pytest_asyncio

from src.companion_ai import mail_token, mcp_tasks, readmodel

# One pool, one loop, for the whole module: the tests share a schema and run in
# order, and a per-test loop would strand the pool's connections on a dead one.
pytestmark = pytest.mark.asyncio(loop_scope="module")

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


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def pool():
    """Without this these tests error out under pytest instead of running, which
    is how they silently drifted from the code they cover. Skip (don't error)
    when there is no Postgres, so the suite stays green off-infra."""
    p = await _pool()
    if p is None:
        pytest.skip("Postgres not reachable")
    try:
        yield p
    finally:
        async with p.acquire() as con:
            await con.execute(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE')
        await p.close()


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
    # (step_id, ordinal, wave, status, kind, question, title, description, depends_on, assignee, assignee_name, assignee_role, is_persona, is_dynamic_delegate)
    await rm.upsert_steps(sid, [
        ("a", 0, 0, "pending", "execute", "", "Gather", "gather the data", "", "", "", "", False, False),
        ("b", 1, 1, "pending", "execute", "", "Write", "write it up", "a", "", "", "", False, False),
    ])
    await rm.set_step_status(sid, "a", "completed", result="got data")
    await rm.set_step_status(sid, "b", "blocked", blocked_reason="need input")
    await rm.add_message("m1", sid, "user", "do it")

    async with pool.acquire() as con:
        a = await con.fetchrow(f'SELECT * FROM "{SCHEMA}".plan_steps WHERE session_id=$1 AND step_id=$2', sid, "a")
        b = await con.fetchrow(f'SELECT * FROM "{SCHEMA}".plan_steps WHERE session_id=$1 AND step_id=$2', sid, "b")
        msg = await con.fetchval(f'SELECT content FROM "{SCHEMA}".messages WHERE id=$1', "m1")
    assert a["status"] == "completed" and a["result"] == "got data"
    assert b["status"] == "blocked" and b["blocked_reason"] == "need input"
    assert msg == "do it"
    print("ok  read-model: session/plan/steps/messages project + read back")


async def test_outstanding_interrupts_are_tracked_per_step(pool):
    """Several steps can be parked at once, each with its own interrupt id, and
    the set survives across runs — ADK only reports an interrupt on the run that
    raises it, so this table is the only record of what is still waiting."""
    rm = readmodel.ReadModel(pool, schema=SCHEMA)
    await readmodel.init_schema(pool, SCHEMA)
    await readmodel.init_schema(pool, SCHEMA)   # migration must be idempotent
    sid = "sess_interrupts"
    await rm.ensure_session(sid, "u1", "Two questions", "running")
    await rm.upsert_steps(sid, [
        ("a", 0, 0, "pending", "ask", "A?", "Ask A", "", "", "", "", "", False, False),
        ("b", 1, 0, "pending", "ask", "B?", "Ask B", "", "", "", "", "", False, False),
    ])

    await rm.set_step_status(sid, "a", "blocked", blocked_reason="awaiting user input",
                             interrupt_id="ask:plan@1/a@1")
    await rm.set_step_status(sid, "b", "blocked", blocked_reason="awaiting user input",
                             interrupt_id="ask:plan@1/b@1")
    assert await rm.outstanding_interrupts(sid) == [
        ("ask:plan@1/a@1", "a"), ("ask:plan@1/b@1", "b")], "both steps should be parked"

    # Answering 'a' clears only its interrupt; 'b' stays parked and resumable.
    await rm.set_step_status(sid, "a", "completed", result="AAA")
    assert await rm.outstanding_interrupts(sid) == [("ask:plan@1/b@1", "b")], \
        "resuming one step must not clear the other's interrupt"

    await rm.set_step_status(sid, "b", "completed", result="BBB")
    assert await rm.outstanding_interrupts(sid) == [], "no step should be parked once both answered"
    print("ok  read-model: interrupts tracked per step, cleared independently")


async def test_a_reply_claims_its_wait_exactly_once(pool):
    """Graph retries a notification it thinks failed, and duplicates are normal.
    A second delivery must not resume the step again — that would answer an
    answered question and run the plan on the same reply twice."""
    rm = readmodel.ReadModel(pool, schema=SCHEMA)
    await readmodel.init_schema(pool, SCHEMA)
    token = mail_token.mint()
    await rm.register_mail_wait(token, session_id="s1", step_id="m", user_id="u1",
                                expected_from="x@example.com")
    await rm.bind_mail_wait_interrupt("s1", "m", "mail:plan@1/m@1")

    # Ten concurrent deliveries of the same notification; exactly one wins.
    claims = await asyncio.gather(
        *[rm.claim_mail_wait(token, reply_from="x@example.com") for _ in range(10)])
    won = [c for c in claims if c is not None]
    assert len(won) == 1, f"expected exactly one claim to win, got {len(won)}"
    assert won[0]["session_id"] == "s1" and won[0]["step_id"] == "m"
    assert won[0]["interrupt_id"] == "mail:plan@1/m@1"

    assert await rm.claim_mail_wait(token) is None, "a matched wait must not re-claim"
    assert await rm.claim_mail_wait("YW-nosuchtoken") is None, "unknown token must not resolve"
    print("ok  mail wait: claimed exactly once under concurrent deliveries")


async def test_a_wait_only_resolves_for_its_expected_sender(pool):
    """A wait registered for a specific recipient must not be claimed by a reply
    from someone else. Repro of the observed bug: an await_reply step waiting on
    rabeb@ was resolved by an email from agara@, because claim was token-only and
    never checked the sender."""
    rm = readmodel.ReadModel(pool, schema=SCHEMA)
    await readmodel.init_schema(pool, SCHEMA)
    token = mail_token.mint()
    await rm.register_mail_wait(token, session_id="s7", step_id="rabeb-e2e",
                                user_id="u1", expected_from="rabeb@yellowsys.fr")
    await rm.bind_mail_wait_interrupt("s7", "rabeb-e2e", "mail:plan@1/rabeb-e2e@1")

    # The wrong sender must NOT claim it.
    assert await rm.claim_mail_wait(token, reply_from="agara@yellowsys.fr") is None, \
        "a reply from the wrong sender must not resolve the wait"

    # The wait is still live, so the right sender still resolves it exactly once.
    won = await rm.claim_mail_wait(token, reply_from="Rabeb Sdiri <rabeb@yellowsys.fr>")
    assert won is not None and won["step_id"] == "rabeb-e2e", \
        "the expected sender must resolve the wait"
    print("ok  mail wait: only the expected sender resolves the wait")


async def test_deliver_mail_reply_rpc_refuses_a_wrong_sender(pool):
    """End-to-end through the gRPC entrypoint: a DeliverMailReply carrying the
    right token but the WRONG sender must not deliver, must not resume the plan,
    and must leave the wait open for the real recipient's reply."""
    from unittest.mock import AsyncMock, MagicMock
    from src.grpc_server import companion_ai_servicer as srv

    rm = readmodel.ReadModel(pool, schema=SCHEMA)
    await readmodel.init_schema(pool, SCHEMA)
    token = mail_token.mint()
    await rm.register_mail_wait(token, session_id="s10", step_id="await-rabeb",
                                user_id="u1", expected_from="rabeb@yellowsys.fr")
    await rm.bind_mail_wait_interrupt("s10", "await-rabeb", "mail:plan@1/await-rabeb@1")

    svc_mock = MagicMock(resume_turn=AsyncMock())
    servicer = srv.CompanionAiServicer(svc_mock, rm)
    request = MagicMock(token=token, reply_body="looks fine to me",
                        reply_from="agara@yellowsys.fr", agents=[], connectors=[])

    resp = await servicer.DeliverMailReply(request, MagicMock())

    assert resp.delivered is False, "a wrong-sender reply must not be delivered"
    svc_mock.resume_turn.assert_not_awaited()  # the plan must not resume on it
    # The wait is untouched: the real recipient can still claim it.
    won = await rm.claim_mail_wait(token, reply_from="rabeb@yellowsys.fr")
    assert won is not None and won["step_id"] == "await-rabeb", \
        "the wrong-sender attempt must leave the wait open for the real sender"
    print("ok  DeliverMailReply: wrong sender refused, wait left open")


async def test_expected_from_is_recorded_at_send_then_enforced(pool):
    """End-to-end of the fix: the wait is minted at projection with no sender
    (the recipient isn't known yet), the recipient is recorded when the mail is
    sent, and from then on only that sender resolves the wait."""
    rm = readmodel.ReadModel(pool, schema=SCHEMA)
    await readmodel.init_schema(pool, SCHEMA)
    token = mail_token.mint()
    # Minted at plan projection — no expected_from yet.
    await rm.register_mail_wait(token, session_id="s9", step_id="await", user_id="u1")
    await rm.bind_mail_wait_interrupt("s9", "await", "mail:plan@1/await@1")
    # Recorded when the send_email tool actually sends (sole recipient).
    await rm.set_mail_wait_expected_from(token, "rabeb@yellowsys.fr")
    # Now the wrong sender can't claim it, the right one can.
    assert await rm.claim_mail_wait(token, reply_from="agara@yellowsys.fr") is None
    won = await rm.claim_mail_wait(token, reply_from="rabeb@yellowsys.fr")
    assert won is not None and won["step_id"] == "await"
    print("ok  mail wait: expected_from recorded at send, then enforced")


async def test_a_multi_recipient_wait_resolves_for_any_recipient_only(pool):
    """A mail to several people can be answered by any of them, so the wait
    accepts a reply from any recipient — but still rejects a stranger (and worky's
    own outgoing copy, whose sender is none of the recipients)."""
    rm = readmodel.ReadModel(pool, schema=SCHEMA)
    await readmodel.init_schema(pool, SCHEMA)
    token = mail_token.mint()
    await rm.register_mail_wait(token, session_id="s11", step_id="await", user_id="u1")
    await rm.bind_mail_wait_interrupt("s11", "await", "mail:plan@1/await@1")
    # Recorded at send: two recipients, comma-joined.
    await rm.set_mail_wait_expected_from(token, "amine@yellowsys.fr,firas@yellowsys.fr")
    # A stranger cannot claim it.
    assert await rm.claim_mail_wait(token, reply_from="rabeb@yellowsys.fr") is None
    # The second recipient (case-insensitive, full header) can.
    won = await rm.claim_mail_wait(token, reply_from="Firas <Firas@Yellowsys.FR>")
    assert won is not None and won["step_id"] == "await"
    print("ok  mail wait: any recipient resolves a multi-recipient wait, strangers don't")


async def test_a_wait_with_no_expected_sender_still_resolves(pool):
    """Backward compatibility: when expected_from is NULL (nothing to check
    against), any reply carrying the token resolves it, as before."""
    rm = readmodel.ReadModel(pool, schema=SCHEMA)
    await readmodel.init_schema(pool, SCHEMA)
    token = mail_token.mint()
    await rm.register_mail_wait(token, session_id="s8", step_id="m", user_id="u1")
    await rm.bind_mail_wait_interrupt("s8", "m", "mail:plan@1/m@1")
    won = await rm.claim_mail_wait(token, reply_from="anyone@example.com")
    assert won is not None and won["step_id"] == "m", \
        "with no expected sender, any reply still resolves the wait"
    print("ok  mail wait: unconstrained wait resolves for any sender")


async def test_waits_are_cancelled_and_expired_out_of_the_waiting_set(pool):
    rm = readmodel.ReadModel(pool, schema=SCHEMA)
    await readmodel.init_schema(pool, SCHEMA)
    past = datetime.now(timezone.utc) - timedelta(days=1)
    future = datetime.now(timezone.utc) + timedelta(days=1)

    stale = mail_token.mint()
    fresh = mail_token.mint()
    await rm.register_mail_wait(stale, session_id="s2", step_id="m1", user_id="u",
                                interrupt_id="mail:1", expires_at=past)
    await rm.register_mail_wait(fresh, session_id="s2", step_id="m2", user_id="u",
                                interrupt_id="mail:2", expires_at=future)
    assert await rm.mail_token_for("s2", "m2") == fresh

    expired = await rm.expire_mail_waits()
    assert [e["token"] for e in expired] == [stale], "only the past-due wait should expire"
    assert await rm.claim_mail_wait(stale) is None, "an expired wait must not still resolve"
    assert await rm.expire_mail_waits() == [], "expiry must not re-fire"

    # Stopping the session drops what is left, so no subscription is renewed for it.
    await rm.cancel_mail_waits("s2")
    assert await rm.claim_mail_wait(fresh) is None, "a cancelled wait must not resolve"
    print("ok  mail wait: expiry and cancellation remove it from the waiting set")


async def test_a_reply_that_beats_the_parking_is_not_deliverable(pool):
    """The token exists from plan projection, but until the step actually parks
    there is no interrupt to resume. A reply arriving in that window must not be
    consumed — it would be claimed, marked matched, and resume nothing."""
    rm = readmodel.ReadModel(pool, schema=SCHEMA)
    await readmodel.init_schema(pool, SCHEMA)
    token = mail_token.mint()
    await rm.register_mail_wait(token, session_id="s3", step_id="m", user_id="u")

    assert await rm.mail_token_for("s3", "m") == token, "the send step must find its token"
    assert await rm.claim_mail_wait(token) is None, "unparked wait must not be claimable"

    await rm.bind_mail_wait_interrupt("s3", "m", "mail:plan_s3@1/m@1")
    won = await rm.claim_mail_wait(token)
    assert won is not None and won["interrupt_id"] == "mail:plan_s3@1/m@1"
    print("ok  mail wait: deliverable only once the step has parked")


async def main():
    pool = await _pool()
    if pool is None:
        return
    try:
        await test_claim_is_exclusive_under_concurrency(pool)
        await test_requeue_and_fail(pool)
        await test_readmodel_roundtrip(pool)
        await test_outstanding_interrupts_are_tracked_per_step(pool)
        await test_a_reply_claims_its_wait_exactly_once(pool)
        await test_waits_are_cancelled_and_expired_out_of_the_waiting_set(pool)
        await test_a_reply_that_beats_the_parking_is_not_deliverable(pool)
        print("\nall postgres-layer tests passed")
    finally:
        async with pool.acquire() as con:
            await con.execute(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE')
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
