"""Tiny interactive driver for a live worky session — one action per call, so a
multi-message scenario (send / update / modify / cancel / resume) can be driven
step by step with pauses for real mail/Teams replies.

    python scripts/worky_cli.py create
    python scripts/worky_cli.py send    <sid> "message"
    python scripts/worky_cli.py status  <sid>
    python scripts/worky_cli.py stop    <sid>          # StopSession (cancel)
    python scripts/worky_cli.py deliver <sid> <token> <from_email> "reply body"
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import grpc, psycopg2
from src.grpc_generated import companion_ai_pb2 as pb, companion_ai_pb2_grpc as pb_grpc
import scripts.worky_e2e_runtask as base

RM = "postgresql://postgres:postgres@localhost:5432/companion_ai"


def stub():
    ch = grpc.insecure_channel(base.ADDR); grpc.channel_ready_future(ch).result(timeout=8)
    return pb_grpc.CompanionAiStub(ch)


def status(sid):
    c = psycopg2.connect(RM); cur = c.cursor()
    cur.execute("select status, interrupt_id from sessions where id=%s", (sid,))
    s = cur.fetchone() or ("?", None)
    print(f"session status={s[0]}  interrupt={s[1]}")
    cur.execute("select title, status, interrupt_id, left(result,60) from plan_steps where session_id=%s order by wave,ordinal", (sid,))
    for t, st, ii, res in cur.fetchall():
        tag = " <-INT" if ii else ""
        print(f"   - [{st:9}] {t[:52]}{tag}")
    cur.execute("select token, expected_from, status from mail_waits where session_id=%s", (sid,))
    w = cur.fetchall()
    if w: print("   mail_waits:", w)
    c.close()


def main():
    a = sys.argv[1]
    if a == "create":
        print(stub().CreateSession(pb.CreateSessionRequest(user_id=base.USER)).session_id)
    elif a == "send":
        sid, msg = sys.argv[2], sys.argv[3]
        r = stub().RunTask(pb.RunRequest(
            user_id=base.USER, session_id=sid, message=msg, agents=base._agents(),
            user_name="Rabeb Sdiri", user_email="rsdiri@yellowsys.fr", user_role="Data Scientist"), timeout=30)
        print(f"accepted={r.accepted} run={r.run_id}")
    elif a == "status":
        status(sys.argv[2])
    elif a == "stop":
        r = stub().StopSession(pb.StopSessionRequest(user_id=base.USER, session_id=sys.argv[2]))
        print("stopped:", r)
    elif a == "deliver":
        sid, token, frm, body = sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
        r = stub().DeliverMailReply(pb.DeliverMailReplyRequest(
            token=token, reply_from=frm, reply_body=body))
        print("delivered:", r)
    else:
        print("unknown", a)


if __name__ == "__main__":
    main()
