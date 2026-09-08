"""Drive full worky workflows against the live service — gate, resume, amend,
concurrency. Uses the captured connector bindings (scripts/worky_e2e_runtask.py
builds the RunRequest); this adds resume + scenario driving.

    AGENTSTORE_PW=... WORKY_CAPTURE_DIR=/tmp/worky_capture \
    WORKY_PLANNER_MODEL=gpt-5.6-terra WORKY_EXECUTOR_MODEL=gpt-5.6-terra \
    python scripts/worky_e2e_drive.py <scenario>

scenarios: decline | approve | amend | concurrent   (default: decline)
"""
import os, sys, time, uuid
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import grpc, psycopg2
from src.grpc_generated import companion_ai_pb2 as pb, companion_ai_pb2_grpc as pb_grpc

import scripts.worky_e2e_runtask as base  # reuse _agents(), MESSAGE, USER, ADDR

RM_DSN = "postgresql://postgres:postgres@localhost:5432/companion_ai"


def _stub():
    ch = grpc.insecure_channel(base.ADDR)
    grpc.channel_ready_future(ch).result(timeout=8)
    return pb_grpc.CompanionAiStub(ch)


def _run(stub, sid, msg):
    return stub.RunTask(pb.RunRequest(
        user_id=base.USER, session_id=sid, message=msg, agents=base._agents(),
        user_name="Rabeb Sdiri", user_email="rsdiri@yellowsys.fr", user_role="Data Scientist"),
        timeout=30)


def _state(sid):
    """Read status + steps + the session interrupt straight from the read-model
    (GetSession can be slow under load; the read-model is authoritative)."""
    c = psycopg2.connect(RM_DSN); cur = c.cursor()
    cur.execute("select status, interrupt_id from sessions where id=%s", (sid,))
    row = cur.fetchone() or ("<none>", None)
    cur.execute("select title, status, interrupt_id from plan_steps where session_id=%s order by wave,ordinal", (sid,))
    steps = cur.fetchall(); c.close()
    return row[0], row[1], steps


def _wait(sid, timeout=180):
    last = None
    end = time.time() + timeout
    while time.time() < end:
        st, iid, steps = _state(sid)
        sig = (st, tuple(s[1] for s in steps))
        if sig != last:
            print(f"  status={st} interrupt={iid}")
            for t, s, ii in steps:
                print(f"     - [{s:9}] {t[:52]}")
            last = sig
        if st in ("waiting", "completed", "failed"):
            return st, iid, steps
        time.sleep(3)
    return _state(sid)


def _answer_for(iid, decision, steps):
    if iid and iid.startswith("confirm::"):
        return "approuver" if decision == "approve" else "refuser"
    # an ask: interrupt — answer generically (first concrete option)
    return "Hamdi Imed"


def _wait_change(sid, prev_iid, timeout=180):
    """After a resume, wait until the workflow actually MOVES: it leaves waiting,
    or parks on a DIFFERENT interrupt. Polling session.interrupt_id right after a
    resume sees the old value (the re-drive hasn't re-blocked yet), so a driver
    that resumes on the stale id just races itself — wait for a real change."""
    end = time.time() + timeout
    while time.time() < end:
        st, iid, steps = _state(sid)
        if st != "waiting" or iid != prev_iid:
            return st, iid, steps
        time.sleep(2)
    return _state(sid)


def drive(sid, decision, max_rounds=10):
    st, iid, steps = _wait(sid)
    rounds = 0
    while st == "waiting" and rounds < max_rounds:
        ans = _answer_for(iid, decision, steps)
        print(f"  >> resuming interrupt {iid} with {ans!r}")
        _run(_stub(), sid, ans)
        rounds += 1
        st, iid, steps = _wait_change(sid, iid)   # wait for the re-drive to settle
        print(f"  status={st} interrupt={iid}")
        for t, s, ii in steps:
            print(f"     - [{s:9}] {t[:52]}")
    print(f"  FINAL status={st}")
    return st


def scenario_single(decision):
    stub = _stub()
    sid = stub.CreateSession(pb.CreateSessionRequest(user_id=base.USER)).session_id
    print(f"[{decision}] session={sid}")
    _run(stub, sid, base.MESSAGE)
    return drive(sid, decision)


def scenario_amend():
    stub = _stub()
    sid = stub.CreateSession(pb.CreateSessionRequest(user_id=base.USER)).session_id
    print(f"[amend] session={sid}")
    _run(stub, sid, "Search the current price of Bitcoin and Ethereum and summarize both.")
    time.sleep(8)  # let the plan start executing
    print("  >> amending: add a step")
    _run(stub, sid, "Also add a short note comparing the two prices.")
    st, iid, steps = _wait(sid)
    print(f"  FINAL status={st}  steps={len(steps)}")
    return st


def scenario_concurrent():
    stub = _stub()
    sids = []
    for i in range(2):
        sid = stub.CreateSession(pb.CreateSessionRequest(user_id=base.USER)).session_id
        _run(stub, sid, f"What is the current price of Bitcoin? (req {i})")
        sids.append(sid); print(f"[concurrent] started {sid}")
    for sid in sids:
        st, _, _ = _wait(sid)
        print(f"  {sid} -> {st}")


if __name__ == "__main__":
    sc = sys.argv[1] if len(sys.argv) > 1 else "decline"
    if sc in ("decline", "approve"):
        scenario_single(sc)
    elif sc == "amend":
        scenario_amend()
    elif sc == "concurrent":
        scenario_concurrent()
    else:
        print("unknown scenario", sc)
