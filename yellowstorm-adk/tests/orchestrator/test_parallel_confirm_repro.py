"""Repro: two PARALLEL approval-gated steps, then resume.

Live session 6a08c8fd… failed with
    RuntimeError: Replay divergence detected: … 'n_..._s3@1'
Its plan had two wave-1 send steps (ask Firas / ask Imed), both gated on
approval, plus a dependent report step, and one sibling additionally died on an
Azure API error. This reproduces the parallel-gate shape on the real ADK engine
and dumps the event stream so we can see whether approving one gate actually
executes its send or re-gates.

    <adk venv>/bin/python -m pytest tests/orchestrator/test_parallel_confirm_repro.py -s
"""
import asyncio
import inspect
import os
import sys
import uuid
import unittest.mock as mock
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from src.companion_ai.adk import hitl, nodes as nodes_mod, service as svc
from src.companion_ai.plan import Plan, Step
from src.smart_rag.tools.search.tools import SearchToolADK

SENT: list = []


class _GatedSender(BaseLlm):
    """Emit the send UNLESS the context already shows its result (then finish)."""
    def __init__(self):
        super().__init__(model="fake")

    async def generate_content_async(self, req, stream=False):
        saw = any(getattr(p, "function_response", None) is not None
                  and p.function_response.name == "outlook_send_email"
                  for c in (req.contents or []) for p in c.parts)
        if saw:
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(text="Suivi effectué.")]))
            return
        yield LlmResponse(content=types.Content(role="model", parts=[types.Part(
            function_call=types.FunctionCall(name="outlook_send_email",
                args={"to_recipients": ["x@y"], "subject": "Q3", "body": "b"},
                id=f"c_{uuid.uuid4().hex[:8]}"))]))  # unique per call, like a real model


async def _send(subject="", body="", to_recipients=None):
    SENT.append({"subject": subject, "to": to_recipients})
    return {"status": "success"}
_send.__name__ = "outlook_send_email"
_send.__signature__ = inspect.signature(_send)


def _outlook_tool():
    return SearchToolADK(_send, {"function": {"name": "outlook_send_email", "description": "d",
        "parameters": {"type": "OBJECT", "properties": {
            "subject": {"type": "STRING"}, "body": {"type": "STRING"},
            "to_recipients": {"type": "ARRAY", "items": {"type": "STRING"}}}}}})


def _read_model() -> MagicMock:
    rm = MagicMock()
    for m in ("upsert_steps", "set_step_status", "upsert_plan", "cancel_mail_waits",
              "bind_mail_wait_interrupt", "set_waiting", "set_session_status", "add_message",
              "add_message_component", "rebind_mail_wait", "register_mail_wait",
              "set_mail_wait_expected_from", "bind_teams_wait_target", "add_step_artifact"):
        setattr(rm, m, AsyncMock())
    rm.mail_token_for = AsyncMock(return_value=None)
    rm.outstanding_interrupts = AsyncMock(return_value=[])
    return rm


def _run():
    SENT.clear()
    session_id = "s_parallel"
    sessions = InMemorySessionService()

    def rf(node, app_name):
        return Runner(node=node, app_name=app_name, session_service=sessions)

    async def dump(tag):
        s = await sessions.get_session(app_name=f"orch_{session_id}", user_id="u", session_id=session_id)
        print(f"--- events {tag} ---")
        for e in s.events:
            for p in (e.content.parts if e.content else []):
                if getattr(p, "function_call", None):
                    print(f"  [{e.author}] CALL {p.function_call.name} id={p.function_call.id}")
                elif getattr(p, "function_response", None):
                    print(f"  [{e.author}] RESP {p.function_response.name} id={p.function_response.id}")
                elif getattr(p, "text", None):
                    print(f"  [{e.author}] text {p.text[:40]!r}")

    async def go():
        with mock.patch.object(nodes_mod, "build_llm", lambda *a, **k: _GatedSender()), \
             mock.patch.object(svc.OrchestratorService, "_tools_for",
                               lambda self, c, s, u: [_outlook_tool()]):
            service = svc.OrchestratorService(rf, _read_model(), planner_model="m")
            plan = Plan(id="p", title="t", goal="g", executor_id="e", executor_name="E", steps=[
                Step(id="sa", kind="execute", description="ask Firas"),
                Step(id="sb", kind="execute", description="ask Imed"),
                Step(id="sc", kind="execute", description="report", depends_on=["sa", "sb"])])
            await sessions.create_session(app_name=f"orch_{session_id}", user_id="u", session_id=session_id)

            wf, n2s = service._build_workflow(session_id, "u", plan, "fake", [{"c": 1}], None)
            interrupts = await service._drive(
                rf(wf, f"orch_{session_id}"), session_id, "u", plan, n2s,
                types.Content(role="user", parts=[types.Part(text="go")]))
            confirms = [i for i, _ in interrupts if i.startswith("confirm::")]
            print("PASS 1 confirms:", confirms)
            assert len(confirms) >= 2, f"expected two parallel gates, got {confirms}"
            await dump("after PASS 1")

            fcid = hitl.confirm_fc_id(confirms[0])
            print("feeding confirmation for id=", fcid)
            wf2, n2s2 = service._build_workflow(session_id, "u", plan, "fake", [{"c": 1}], None)
            part = hitl.confirmation_resume_part(fcid, confirmed=True)
            interrupts2 = await service._drive(
                rf(wf2, f"orch_{session_id}"), session_id, "u", plan, n2s2,
                types.Content(role="user", parts=[part]))
            print("PASS 2 interrupts:", [i for i, _ in interrupts2])
            print("SENT after 1st approve:", SENT)
            await dump("after PASS 2")

    asyncio.run(go())


def test_two_parallel_gates_resume():
    _run()


def _req_text(req) -> str:
    chunks = []
    si = getattr(getattr(req, "config", None), "system_instruction", None)
    if si:
        chunks.append(str(si))
    for c in (req.contents or []):
        for p in c.parts:
            if getattr(p, "text", None):
                chunks.append(p.text)
    return " ".join(chunks)


class _SenderOrBoom(_GatedSender):
    """Gated sender, except the step whose instruction carries 'BOOM' dies on its
    first model call — the live Azure/LiteLLM APIError on the parallel sibling."""
    async def generate_content_async(self, req, stream=False):
        if "BOOM" in _req_text(req):
            raise RuntimeError("litellm.APIError: AzureException APIError - simulated")
        async for r in super().generate_content_async(req, stream):
            yield r


def _run_failing_sibling():
    """sa gates on approval; sb (the 'BOOM' step) dies mid-run like s2 did live.
    Approve sa, then drive — reproduce the replay divergence if it's real."""
    SENT.clear()
    session_id = "s_fail_sibling"
    sessions = InMemorySessionService()

    def rf(node, app_name):
        return Runner(node=node, app_name=app_name, session_service=sessions)

    async def go():
        with mock.patch.object(nodes_mod, "build_llm", lambda *a, **k: _SenderOrBoom()), \
             mock.patch.object(svc.OrchestratorService, "_tools_for",
                               lambda self, c, s, u: [_outlook_tool()]):
            service = svc.OrchestratorService(rf, _read_model(), planner_model="m")
            plan = Plan(id="p", title="t", goal="g", executor_id="e", executor_name="E", steps=[
                Step(id="sa", kind="execute", description="ask Firas"),
                Step(id="sb", kind="execute", description="ask Imed BOOM"),
                Step(id="sc", kind="execute", description="report", depends_on=["sa", "sb"])])
            await sessions.create_session(app_name=f"orch_{session_id}", user_id="u", session_id=session_id)

            wf, n2s = service._build_workflow(session_id, "u", plan, "fake", [{"c": 1}], None)
            interrupts = await service._drive(
                rf(wf, f"orch_{session_id}"), session_id, "u", plan, n2s,
                types.Content(role="user", parts=[types.Part(text="go")]))
            confirms = [i for i, _ in interrupts if i.startswith("confirm::")]
            print("PASS 1 confirms:", confirms, "| statuses:",
                  {s.id: s.status.value for s in plan.steps})
            assert confirms, "sa should have gated"

            wf2, n2s2 = service._build_workflow(session_id, "u", plan, "fake", [{"c": 1}], None)
            part = hitl.confirmation_resume_part(hitl.confirm_fc_id(confirms[0]), confirmed=True)
            try:
                i2 = await service._drive(
                    rf(wf2, f"orch_{session_id}"), session_id, "u", plan, n2s2,
                    types.Content(role="user", parts=[part]))
                print("RESUME OK. interrupts:", [i for i, _ in i2], "| SENT:", SENT)
            except RuntimeError as e:
                print("RESUME RAISED:", type(e).__name__, "|", str(e)[:100])
                raise

    asyncio.run(go())


def test_gated_step_resume_with_failed_parallel_sibling():
    """Live 6a08c8fd: 'ask Firas' died on a LiteLLM/Azure APIError while 'ask Imed'
    was parked for approval; the resume then hit 'Replay divergence … s3@1'.

    Finding: a transient LLM API error on a step is NOT contained — it propagates
    straight out of the drive. Combined with a parked sibling and a resume, that
    is what corrupts the replay. The gate itself is fine (see the passing
    two-parallel-gates test); the fragility is the un-retried, un-contained model
    error on a parallel step."""
    import pytest
    with pytest.raises(RuntimeError, match="AzureException"):
        _run_failing_sibling()


if __name__ == "__main__":
    _run()
    _run_failing_sibling()
