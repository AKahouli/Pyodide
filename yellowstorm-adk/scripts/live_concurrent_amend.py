"""Live test of concurrent plan-amend serialization against a running
orchestrator on 0.0.0.0:50051.

Flow:
  1. create a session
  2. run an initial multi-step plan (LLM-only steps, no connectors) that stays
     'executing' long enough to amend
  3. once it's executing, fire TWO amends CONCURRENTLY (two threads)
  4. read the plan back and assert BOTH amends' steps landed

The per-session lock in converse_turn serializes the two amends; watch the
orchestrator logs for two sequential '[worky] converse ◄' lines with a growing
step count (the second planned after the first applied).

Usage:  python scripts/live_concurrent_amend.py [model]
"""
import concurrent.futures as cf
import os
import sys
import time

import grpc
import psycopg

from src.grpc_generated import companion_ai_pb2 as pb
from src.grpc_generated import companion_ai_pb2_grpc as pb_grpc
from src.grpc_generated import chatbot_pb2

ADDR = "0.0.0.0:50051"
USER = "live-amend-user"
PLANNER_TYPE = "worky-planner"
EXECUTOR_TYPE = "worky-executer"
FALLBACK_MODEL = "gpt-5.6-terra"  # executor row has no model; planner is gpt-5.6-terra

# Authoritative agent config comes from the SAME agentstore the backend reads,
# so this reproduces exactly what a real RunTask carries (model + instruction).
AGENTSTORE = dict(host="poc.postgres.yellowmind.ai", port=3515, user="postgres",
                  password=os.environ.get("AGENTSTORE_PW", ""), dbname="agentstore",
                  connect_timeout=8)


def _agents():
    with psycopg.connect(**AGENTSTORE) as c:
        cur = c.cursor()
        cur.execute("select agent_type_slug, name, llm_model, instruction from agents "
                    "where agent_type_slug in (%s,%s) and is_active",
                    (PLANNER_TYPE, EXECUTOR_TYPE))
        rows = {r[0]: r for r in cur.fetchall()}
    out = []
    for i, (slug, aid) in enumerate([(PLANNER_TYPE, ""), (EXECUTOR_TYPE, "exec-live")]):
        _, name, model, instr = rows[slug]
        out.append(chatbot_pb2.Agent(
            agent_type=slug, name=name or slug, id=aid, prompt=instr or "",
            chatbot=chatbot_pb2.Chatbot(model=model or FALLBACK_MODEL)))
    return out


def _run(stub, session_id, message):
    r = stub.RunTask(pb.RunRequest(
        user_id=USER, session_id=session_id, message=message, agents=_agents(),
        user_name="Rabeb Sdiri", user_email="rsdiri@yellowsys.fr", user_role="Data Scientist"),
        timeout=30)
    return r.run_id


def _snapshot(stub, session_id):
    s = stub.GetSession(pb.GetSessionRequest(user_id=USER, session_id=session_id), timeout=15)
    return s.status, [(st.description, st.status) for st in s.plan.steps]


def main():
    ch = grpc.insecure_channel(ADDR)
    grpc.channel_ready_future(ch).result(timeout=5)
    stub = pb_grpc.CompanionAiStub(ch)

    session_id = stub.CreateSession(pb.CreateSessionRequest(user_id=USER)).session_id
    print(f"[live] session = {session_id}")

    # A long SEQUENTIAL chain so the plan keeps executing long enough for two
    # ~15s amend-plans to complete before it finishes (each step depends on the
    # previous, so they run one wave at a time — not in parallel).
    initial = ("Write an 8-part story about a lighthouse keeper, as EIGHT separate "
               "SEQUENTIAL steps where each step depends on the previous one "
               "(step 2 depends on step 1, step 3 on step 2, and so on). "
               "Each step writes one short paragraph continuing the story.")
    run_id = _run(stub, session_id, initial)
    print(f"[live] initial plan run_id = {run_id} — waiting for it to execute...")

    # Wait until the plan is executing (status running + steps present).
    deadline = time.time() + 60
    while time.time() < deadline:
        status, steps = _snapshot(stub, session_id)
        if status == "running" and steps:
            print(f"[live] executing: status={status} steps={len(steps)}")
            break
        time.sleep(1)
    else:
        print("[live] plan never reached executing state — aborting")
        sys.exit(2)

    # Fire two amends CONCURRENTLY.
    print("[live] firing TWO concurrent amends (Jupiter + Saturn)...")
    with cf.ThreadPoolExecutor(max_workers=2) as ex:
        f1 = ex.submit(_run, stub, session_id, "Also add a step: write a short paragraph about Jupiter.")
        f2 = ex.submit(_run, stub, session_id, "Also add a step: write a short paragraph about Saturn.")
        print(f"[live] amend run_ids = {f1.result()}  {f2.result()}")

    # Poll for the amends to plan + apply (each ~15s, serialized by the lock),
    # up to 120s or until both landed / the plan completes.
    jup = sat = False
    for _ in range(40):
        status, steps = _snapshot(stub, session_id)
        blob = " ".join(d.lower() for d, _ in steps)
        jup, sat = "jupiter" in blob, "saturn" in blob
        if (jup and sat) or status in ("completed", "failed"):
            break
        time.sleep(3)
    print(f"\n[live] FINAL status={status}  steps={len(steps)}")
    for d, st in steps:
        print(f"   - [{st:9}] {d[:60]}")

    print(f"\n[live] Jupiter step present: {jup}")
    print(f"[live] Saturn  step present: {sat}")
    if jup and sat:
        print("[live] PASS — both concurrent amends landed.")
    else:
        print("[live] MISSING an amend — a concurrent update was lost.")
        sys.exit(3)


if __name__ == "__main__":
    main()
