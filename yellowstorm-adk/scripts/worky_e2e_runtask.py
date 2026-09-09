"""Worky E2E: send a REAL RunTask to the running orchestrator (no mocks).

This is the reference for the shape of a real worky turn request and how to
fire it against a live ADK service on :50051 — use it as the template for any
worky end-to-end test.

    python scripts/worky_e2e_runtask.py

Env:
    AGENTSTORE_PW   password for the agentstore postgres (agents come from there)

────────────────────────────────────────────────────────────────────────────
RunRequest structure  (grpc/proto/companion_ai/companion_ai.proto)
────────────────────────────────────────────────────────────────────────────
RunRequest {
  string user_id       # opaque id; a new turn OR a reply that resumes a plan
  string session_id    # from CreateSession; reuse to continue/resume a session
  string message       # the user's prompt for this turn
  repeated Skill            skills      # optional packaged skills (chatbot.proto)
  repeated ConnectorBinding connectors  # ← the MCP tools the executor may call
  repeated chatbot.Agent    agents      # planner + executor (+ personas)
  string user_name / user_email / user_role   # who the turn is for
}

chatbot.Agent {                      # (grpc/proto/chatbot.proto)
  id, name, description, prompt
  Chatbot chatbot { model, ... }     # LiteLLM model id, e.g. "azure/gpt-4.1"
  string  agent_type                 # "worky-planner" | "worky-executer" | "humain"
  repeated Tool  tools
  repeated Skill skills
}

ConnectorBinding {                   # (companion_ai.proto) ONE MCP server
  connector_id, connector_name
  mcp_transport_type                 # e.g. "streamable_http"
  mcp_server_url
  map<string,string> auth_headers    # ready-to-use HTTP headers (bearer, etc.)
  map<string,string> auth_env        # env vars for stdio transports
  repeated ConnectorAction actions   # enabled actions {action_key,label,schema}
  mcp_server_config_json             # full server config as JSON (fallback)
}

WHERE EACH PART COMES FROM (the gotcha):
  • agents      → agentstore postgres (public.agents), by agent_type_slug.
  • connectors  → the NestJS backend / Mongo connector store, NOT agentstore.
                  agentstore only LINKS agent↔connector by id
                  (public.agent_connectors); the runtime MCP url + auth_headers
                  live in the backend and are injected per-turn by
                  worky-turn-context.service.ts. So a fully faithful RunRequest
                  either (a) goes through the backend, or (b) has its connectors
                  captured from a real backend RunRequest and pasted below.
  • human agents (Firas/Imed) → public.agents rows with agent_type_slug='humain'.
                  The executor also discovers them at runtime via
                  find_human_agents (queries agentstore); the send_email /
                  send_teams gate fires on the CONNECTOR tool used to contact
                  them (e.g. outlook_send_email), which is why `connectors` must
                  be present for the approval gate to appear.

The send_email/send_teams approval gate (feature/rs-companion-ai-13-approve-user):
without a connector that publishes outlook_send_email / a teams send, there is
no tool to gate — the executor cannot actually send, so no approve/decline card
appears. Populate CONNECTORS to exercise the gate end-to-end.
────────────────────────────────────────────────────────────────────────────
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import grpc
import psycopg2

from src.grpc_generated import companion_ai_pb2 as pb
from src.grpc_generated import companion_ai_pb2_grpc as pb_grpc
from src.grpc_generated import chatbot_pb2

ADDR = "0.0.0.0:50051"
# The real owner whose OAuth tokens the captured bindings carry — run as them so
# human-agents/mail/connectors resolve for the right user. (From the X-user-id in
# the captured bindings.)
USER = os.environ.get("WORKY_E2E_USER", "698495f57320a103fb42c537")
FALLBACK_MODEL = "azure/gpt-4.1"

# Where the servicer's [worky][CAPTURE] dump wrote the per-agent bindings.
# Run a real turn with WORKY_CAPTURE_DIR set to this same path first; the tokens
# inside are short-lived (~1h for Graph/outlook/teams) — re-capture if expired.
CAPTURE_DIR = os.environ.get("WORKY_CAPTURE_DIR", "/tmp/worky_capture")

# The exact scenario under test (two parallel gated sends + a dependent report):
MESSAGE = ("search the current price of bitcoin and send it to firas and imed and "
           "ask them if they want to invest, if yes do a report and send it to them")

AGENTSTORE = dict(host="poc.postgres.yellowmind.ai", port=3515, user="postgres",
                  password=os.environ.get("AGENTSTORE_PW", ""), dbname="agentstore",
                  connect_timeout=8)


def _bindings_for(agent_type_slug: str) -> str:
    """The captured connector_bindings_json for this agent, or '' if none.
    Worky reads the executor's tools from HERE (agent_params), not the top-level
    request.connectors — that's the whole reason the gate needs this wired."""
    path = os.path.join(CAPTURE_DIR, f"bindings_{agent_type_slug}.json")
    try:
        with open(path) as f:
            return f.read()
    except FileNotFoundError:
        print(f"[e2e] WARN no captured bindings at {path} — the gate won't appear "
              f"without connectors. Run a real turn with WORKY_CAPTURE_DIR={CAPTURE_DIR} first.")
        return ""


def _agents():
    """Planner + executor pulled from the SAME agentstore the backend reads (model
    + instruction), with each agent's captured connector bindings attached to
    agent_params.connector_bindings_json — exactly the shape RunTask expects."""
    with psycopg2.connect(**AGENTSTORE) as c:
        cur = c.cursor()
        cur.execute("select agent_type_slug, name, llm_model, instruction from agents "
                    "where agent_type_slug in ('worky-planner','worky-executer') and is_active")
        rows = {r[0]: r for r in cur.fetchall()}
    # Override the model per agent when the agentstore model is out of quota
    # (WORKY_PLANNER_MODEL / WORKY_EXECUTOR_MODEL), e.g. "azure/gpt-4.1".
    override = {"worky-planner": os.environ.get("WORKY_PLANNER_MODEL"),
                "worky-executer": os.environ.get("WORKY_EXECUTOR_MODEL")}
    out = []
    for slug, aid in [("worky-planner", ""), ("worky-executer", "exec-e2e")]:
        _, name, model, instr = rows[slug]
        out.append(chatbot_pb2.Agent(
            agent_type=slug, name=name or slug, id=aid, prompt=instr or "",
            chatbot=chatbot_pb2.Chatbot(model=override[slug] or model or FALLBACK_MODEL),
            agent_params=chatbot_pb2.AgentParams(params={
                "connector_bindings_json": _bindings_for(slug),
                "user_id": USER})))
    return out


def _snapshot(stub, session_id):
    s = stub.GetSession(pb.GetSessionRequest(user_id=USER, session_id=session_id), timeout=15)
    return s.status, [(st.description, st.status) for st in s.plan.steps]


def main():
    ch = grpc.insecure_channel(ADDR)
    grpc.channel_ready_future(ch).result(timeout=5)
    stub = pb_grpc.CompanionAiStub(ch)

    session_id = stub.CreateSession(pb.CreateSessionRequest(user_id=USER)).session_id
    print(f"[e2e] session = {session_id}")

    r = stub.RunTask(pb.RunRequest(
        user_id=USER, session_id=session_id, message=MESSAGE, agents=_agents(),
        user_name="Rabeb Sdiri", user_email="rsdiri@yellowsys.fr",
        user_role="Data Scientist"), timeout=30)
    print(f"[e2e] run_id = {r.run_id} accepted={r.accepted}")

    # Poll the plan until it settles (a gate parks it as 'waiting').
    last = None
    for _ in range(60):
        status, steps = _snapshot(stub, session_id)
        sig = (status, tuple(st for _, st in steps))
        if sig != last:
            print(f"[e2e] status={status}")
            for d, st in steps:
                print(f"   - [{st:9}] {d[:70]}")
            last = sig
        if status in ("completed", "failed", "waiting"):
            break
        time.sleep(2)
    print(f"[e2e] FINAL status={status}  session={session_id}")


if __name__ == "__main__":
    main()
