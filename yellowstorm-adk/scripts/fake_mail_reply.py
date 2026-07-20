"""Pretend a reply arrived, without Microsoft Graph in the loop.

Everything between the plan and the resumed step is real — the token, the wait
registry, the claim, DeliverMailReply, the resume. The only thing faked is the
mail itself, which is exactly the part that needs a public webhook and a real
mailbox. Use it to exercise the whole chain locally.

    # what is this session waiting for?
    python scripts/fake_mail_reply.py --session <aiSessionId>

    # answer it
    python scripts/fake_mail_reply.py --session <aiSessionId> --reply "Yellow Systems."

Run from yellowstorm-adk/ with the project venv.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncpg
import grpc

from src.companion_ai.config import get_orchestrator_settings
from src.grpc_generated import companion_ai_pb2 as pb
from src.grpc_generated import companion_ai_pb2_grpc as pb_grpc


async def waits_for(session_id: str) -> list[dict]:
    s = get_orchestrator_settings()
    pool = await asyncpg.create_pool(s.readmodel_dsn(), min_size=1, max_size=2)
    try:
        async with pool.acquire() as con:
            if not await con.fetchval(
                    "SELECT to_regclass($1)",
                    f"{s.ORCHESTRATOR_READMODEL_SCHEMA}.mail_waits"):
                print("mail_waits does not exist yet — restart worky once so it "
                      "runs init_schema, then try again.")
                return []
            rows = await con.fetch(
                f'SELECT w.token, w.step_id, w.status, w.interrupt_id, w.expires_at, '
                f'       s.title, s.status AS step_status '
                f'FROM "{s.ORCHESTRATOR_READMODEL_SCHEMA}".mail_waits w '
                f'LEFT JOIN "{s.ORCHESTRATOR_READMODEL_SCHEMA}".plan_steps s '
                f'  ON s.session_id = w.session_id AND s.step_id = w.step_id '
                f'WHERE w.session_id = $1 ORDER BY w.created_at',
                session_id)
        return [dict(r) for r in rows]
    finally:
        await pool.close()


async def deliver(token: str, reply: str, sender: str) -> None:
    target = os.getenv("ORCHESTRATOR_GRPC_TARGET", "localhost:50051")
    api_key = os.getenv("GRPC_API_KEY") or os.getenv("API_KEY") or ""
    metadata = [("x-api-key", api_key)] if api_key else []

    async with grpc.aio.insecure_channel(target) as channel:
        stub = pb_grpc.CompanionAiStub(channel)
        resp = await stub.DeliverMailReply(
            pb.DeliverMailReplyRequest(token=token, reply_body=reply, reply_from=sender),
            metadata=metadata)
    if resp.delivered:
        print(f"delivered -> session={resp.session_id} step={resp.step_id}")
        print("the step is resuming; watch the board and the worky logs")
    else:
        print("delivered=false — the token is unknown, expired, already answered, "
              "or its step has not parked yet")


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--session", required=True, help="the stream's aiSessionId")
    ap.add_argument("--reply", help="the reply body; omit to just list the waits")
    ap.add_argument("--from", dest="sender", default="tester@example.com")
    args = ap.parse_args()

    rows = await waits_for(args.session)
    if not rows:
        print("no mail waits for this session — did the planner emit an await_reply step?")
        return

    for r in rows:
        parked = "parked" if r["interrupt_id"] else "NOT PARKED YET (send step still running)"
        print(f"  {r['status']:9} {parked:40} step={r['step_id']} "
              f"({r['title'] or '?'}) token={r['token'][:12]}…")

    if not args.reply:
        print("\npass --reply '<text>' to answer the first waiting one")
        return

    ready = [r for r in rows if r["status"] == "waiting" and r["interrupt_id"]]
    if not ready:
        print("\nnothing is waiting and parked — nothing to answer")
        return
    print()
    await deliver(ready[0]["token"], args.reply, args.sender)


if __name__ == "__main__":
    asyncio.run(main())
