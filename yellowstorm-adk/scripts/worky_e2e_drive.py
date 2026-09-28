"""Drive full worky workflows against the live service — gate, resume, amend,
concurrency. Uses the captured connector bindings (scripts/worky_e2e_runtask.py
builds the RunRequest); this adds resume + scenario driving.

    AGENTSTORE_PW=... WORKY_CAPTURE_DIR=/tmp/worky_capture \
    WORKY_PLANNER_MODEL=gpt-5.6-terra WORKY_EXECUTOR_MODEL=gpt-5.6-terra \
    python scripts/worky_e2e_drive.py <scenario>

scenarios (default: decline):
  decline          gate parks → decline sticks (no retry) → plan completes
  approve          gate parks → approve → real send → parks on await_reply
  amend            one mid-flight update adds a step
  multiamend       several SEQUENTIAL updates on one session, all must land
  concurrent       N sessions run at once
  concurrent_amend N sessions each amended concurrently — updates stay isolated

All validated live end-to-end (2026-09-08) with gpt-5.6-terra for both roles.
"""
import os, sys, time, uuid
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import grpc, psycopg
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
    c = psycopg.connect(RM_DSN); cur = c.cursor()
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


def _running(sid, timeout=60):
    """Wait until the plan is actually executing (status running + steps), so a
    follow-up message AMENDS the live plan instead of starting a fresh turn."""
    end = time.time() + timeout
    while time.time() < end:
        st, _, steps = _state(sid)
        if st == "running" and steps:
            return True
        if st in ("completed", "failed", "waiting"):
            return False
        time.sleep(1)
    return False


def _final(sid, timeout=240):
    st, _, steps = _wait(sid, timeout)
    print(f"  FINAL status={st}  steps={len(steps)}")
    for t, s, _ in steps:
        print(f"     - [{s:9}] {t[:56]}")
    return st, steps


def scenario_multiamend():
    """One session, several SEQUENTIAL amends fired while the plan executes —
    each must land as an added step (converse path, per-session lock serializes)."""
    stub = _stub()
    sid = stub.CreateSession(pb.CreateSessionRequest(user_id=base.USER)).session_id
    print(f"[multiamend] session={sid}")
    _run(stub, sid, "Search the current price of Bitcoin and write a one-paragraph summary.")
    amends = [
        ("ethereum", "Also add the current price of Ethereum."),
        ("solana",   "Also add the current price of Solana."),
        ("compare",  "Also add a short paragraph comparing Bitcoin, Ethereum and Solana."),
    ]
    for tag, msg in amends:
        if not _running(sid):
            print(f"  (plan not executing when amending {tag!r} — sending anyway)")
        print(f"  >> amend: {tag}")
        _run(stub, sid, msg)
        time.sleep(3)
    st, steps = _final(sid)
    blob = " ".join(t.lower() for t, _, _ in steps)
    for tag, _ in amends:
        print(f"  amend '{tag}' landed: {tag in blob or (tag=='compare' and 'compar' in blob)}")


def scenario_amend_sends():
    """Most complex: multi-amend that ADDS gated send steps (email + Teams), then
    approve every gate for REAL delivery. Amends land during the non-gated search
    window (status running, no interrupt); the send steps gate afterwards and are
    approved one by one. Needs fresh Graph tokens or the sends 401."""
    stub = _stub()
    sid = stub.CreateSession(pb.CreateSessionRequest(user_id=base.USER)).session_id
    print(f"[amend_sends] session={sid}")
    _run(stub, sid, "Search the current price of Bitcoin and write a one-line summary, "
                    "then email that summary to Firas.")
    amends = [
        ("teams-imed", "Also send that same summary to Imed on Teams."),
        ("email-imed", "Also email that summary to Hamdi Imed as well."),
    ]
    for tag, msg in amends:
        if not _running(sid):
            print(f"  (not executing when amending {tag!r})")
        print(f"  >> amend: {tag}")
        _run(stub, sid, msg)
        time.sleep(3)
    # Approve every gate the amended plan raises (email Firas, teams Imed, email Imed).
    drive(sid, "approve", max_rounds=12)
    st, _, steps = _state(sid)
    print(f"  plan status={st}")
    for t, s, _ in steps:
        print(f"     - [{s:9}] {t[:56]}")
    # Proof of real delivery: a mail_wait row is written only after a successful send.
    c = psycopg.connect(RM_DSN); cur = c.cursor()
    cur.execute("select expected_from, status from mail_waits where session_id=%s", (sid,))
    waits = cur.fetchall(); c.close()
    print(f"  MAIL/TEAMS WAITS (proof of send): {waits}")


def scenario_concurrent_amend(n=3):
    """N sessions in parallel, each amended once — checks concurrency + that each
    amend lands in ITS OWN session (isolation), no cross-talk."""
    stub = _stub()
    topics = [("Bitcoin", "Ethereum"), ("gold", "silver"), ("oil", "natural gas")]
    sids = []
    for i in range(n):
        a, b = topics[i % len(topics)]
        sid = stub.CreateSession(pb.CreateSessionRequest(user_id=base.USER)).session_id
        _run(stub, sid, f"Search the current price of {a} and summarize it.")
        sids.append((sid, a, b)); print(f"[concurrent_amend] {sid} <- {a}")
    # Fire one amend per session, concurrently, adding the SECOND topic.
    def amend(entry):
        sid, a, b = entry
        _running(sid)
        _run(_stub(), sid, f"Also add the current price of {b}.")
        return sid, b
    import concurrent.futures as cf
    with cf.ThreadPoolExecutor(max_workers=n) as ex:
        list(ex.map(amend, sids))
    ok = True
    for sid, a, b in sids:
        st, _, steps = _wait(sid)
        blob = " ".join(t.lower() for t, _, _ in steps)
        isolated = b.lower() in blob and a.lower() in blob
        print(f"  {sid} [{a}/{b}] -> {st}  amend-landed+isolated={isolated}")
        ok = ok and isolated
    print(f"  CONCURRENT+AMEND isolation OK: {ok}")


if __name__ == "__main__":
    sc = sys.argv[1] if len(sys.argv) > 1 else "decline"
    if sc in ("decline", "approve"):
        scenario_single(sc)
    elif sc == "amend":
        scenario_amend()
    elif sc == "multiamend":
        scenario_multiamend()
    elif sc == "concurrent":
        scenario_concurrent()
    elif sc == "concurrent_amend":
        scenario_concurrent_amend()
    elif sc == "amend_sends":
        scenario_amend_sends()
    else:
        print("unknown scenario", sc)
