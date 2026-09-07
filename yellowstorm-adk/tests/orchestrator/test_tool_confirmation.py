"""Tool-confirmation HITL — proven on the real ADK engine with a scripted LLM.

A send tool marked require_confirmation must not run until the owner approves.
The executor LLM emits the send; ADK raises an `adk_request_confirmation`
interrupt (a different dialect than the `adk_request_input` used by ask/mail, so
hitl.confirmation_interrupts, not hitl.interrupt_ids, reports it). The gate PARKS
the turn — the send never fires on the first pass.

RESUME is ADK's OWN native confirmation, made to work through worky's workflow by
two worky-side changes (no ADK patch): every step is fed None node_input via a
silent join (so ADK's single_turn node doesn't append a trailing user turn that
would shadow the verdict), and steps run include_contents='default' (so the step
sees its own send call + result). With those, feeding back the ToolConfirmation
verdict makes ADK re-invoke the ORIGINAL gated tool by id: approve → the send
runs and the model continues in place from the result; decline → the model gets
"This tool call is rejected." and re-plans. These tests prove: on approve the
send fires exactly once through native re-execution and the model continues
seeing the result; on decline nothing is sent.

    <adk venv>/bin/python -m pytest tests/orchestrator/test_tool_confirmation.py
"""
import asyncio
import inspect
import os
import sys
import unittest.mock as mock
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from pydantic import PrivateAttr

from src.companion_ai import hitl, nodes as nodes_mod, service as svc
from src.companion_ai.plan import Plan, Step
from src.smart_rag.tools.search.tools import SearchToolADK


SENT: list = []
MODEL_CALLS: list = []
SAW_RESULT: list = []


class _GatedSender(BaseLlm):
    """Context-driven, like a real model: emit the send UNLESS the context already
    shows the send's result — in which case the send is done, so just finish. This
    is what makes native confirmation observable end-to-end: on the approve resume
    ADK re-executes the send itself and the model, seeing the result in its own
    scoped history (include_contents='default'), continues instead of resending. A
    fresh instance is built per workflow rebuild, so it must decide from CONTEXT,
    not internal counters."""

    def __init__(self):
        super().__init__(model="fake")

    async def generate_content_async(self, req, stream=False):
        MODEL_CALLS.append(1)
        saw_result = any(
            getattr(p, "function_response", None) is not None
            and p.function_response.name == "outlook_send_email"
            for c in (req.contents or []) for p in c.parts)
        if saw_result:  # the send already ran (approved) or was rejected (declined) → continue
            SAW_RESULT.append(1)
            yield LlmResponse(content=types.Content(role="model", parts=[
                types.Part(text="Suivi effectué.")]))
            return
        yield LlmResponse(content=types.Content(role="model", parts=[
            types.Part(function_call=types.FunctionCall(
                name="outlook_send_email",
                args={"to_recipients": ["x@y"], "subject": "Q3", "body": "b"},
                id="c1"))]))


async def _send(subject="", body="", to_recipients=None):
    SENT.append({"subject": subject, "body": body, "to_recipients": to_recipients})
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


async def _pause_then(verdict: str):
    """Drive the full pipeline to the gate, then resume it with NATIVE ADK
    confirmation (rebuild the workflow, feed back the ToolConfirmation verdict) —
    exactly what resume_turn does for a confirm interrupt.

    Returns (interrupts_from_pause, sent) so a test can assert what the gate
    parked and what actually went out after the verdict."""
    SENT.clear()
    MODEL_CALLS.clear()
    SAW_RESULT.clear()
    session_id = f"s_{verdict}"
    sessions = InMemorySessionService()

    def runner_factory(node, app_name):
        return Runner(node=node, app_name=app_name, session_service=sessions)

    with mock.patch.object(nodes_mod, "build_llm", lambda *a, **k: _GatedSender()), \
         mock.patch.object(svc.OrchestratorService, "_tools_for",
                           lambda self, c, s, u: [_outlook_tool()]):
        service = svc.OrchestratorService(runner_factory, _read_model(), planner_model="m")
        plan = Plan(id="p", title="t", goal="g", executor_id="e", executor_name="E",
                    steps=[Step(id="s1", kind="execute", description="send it")])
        wf, n2s = service._build_workflow(session_id, "u", plan, "fake", [{"c": 1}], None)
        await sessions.create_session(app_name=f"orch_{session_id}", user_id="u", session_id=session_id)
        interrupts = await service._drive(
            runner_factory(wf, f"orch_{session_id}"), session_id, "u", plan, n2s,
            types.Content(role="user", parts=[types.Part(text="go")]))
        assert SENT == [], f"send ran before approval: {SENT}"
        iid = next((i for i, _ in interrupts if i.startswith("confirm::")), None)
        assert iid, f"expected a confirm interrupt, got {interrupts}"

        # NATIVE resume: a fresh workflow over the SAME durable session, driven
        # with the ToolConfirmation verdict — ADK re-invokes the gated tool by id.
        wf2, n2s2 = service._build_workflow(session_id, "u", plan, "fake", [{"c": 1}], None)
        part = hitl.confirmation_resume_part(
            hitl.confirm_fc_id(iid), confirmed=(verdict == "approve"))
        await service._drive(
            runner_factory(wf2, f"orch_{session_id}"), session_id, "u", plan, n2s2,
            types.Content(role="user", parts=[part]))
        return interrupts, list(SENT)


def test_approve_reexecutes_the_send_natively_then_continues():
    """Approve: ADK's native processor re-invokes the frozen gated tool by id, so
    the send goes out exactly once (token-stamped through the real pipeline). The
    model then sees the send's result in its own scoped history and continues in
    place — no re-decision, no re-gate."""
    _, sent = asyncio.run(_pause_then("approve"))
    assert len(sent) == 1 and sent[0]["subject"].startswith("Q3"), sent
    assert SAW_RESULT, "the model never saw the send result — native continuation failed"


def test_decline_rejects_the_send_and_the_model_continues():
    """Decline: the verdict makes ADK return 'This tool call is rejected.' as the
    tool result — nothing is sent, and the model continues from the rejection."""
    _, sent = asyncio.run(_pause_then("decline"))
    assert sent == [], sent
    assert SAW_RESULT, "the model never saw the rejection — native continuation failed"


def test_capture_artifacts_preserves_the_confirmation_gate():
    """Root-cause guard: _capture_artifacts re-wraps every step tool into a fresh
    SearchToolADK AFTER _mail_stamping set require_confirmation. If that re-wrap
    drops the flag (the original bug), the send runs ungated — the tool still
    stamps/sends inside the inner func, so the gate vanishes silently."""
    async def tok():
        return "YW-x"

    tool = SearchToolADK(_send, {"function": {"name": "outlook_send_email", "description": "d",
        "parameters": {"type": "OBJECT", "properties": {}}}})
    gated = nodes_mod.stamp_send_email_tool(tool, token_provider=tok, on_sent=None)
    assert gated._require_confirmation is True
    captured = nodes_mod.capture_artifacts_tool(gated, on_artifact=AsyncMock())
    assert captured._require_confirmation is True, "capture wrapper dropped require_confirmation"


def test_gate_survives_the_full_build_workflow_tool_assembly():
    """The gate must hold through the REAL _build_workflow tool pipeline
    (mail-stamping → capture-artifacts → dynamic tools), not just a bare tool.
    This is the path that regressed while a bare-tool test still passed."""
    interrupts, _ = asyncio.run(_pause_then("approve"))
    assert any(i.startswith("confirm::") for i, _ in interrupts), interrupts


if __name__ == "__main__":
    test_approve_reexecutes_the_send_natively_then_continues()
    test_decline_rejects_the_send_and_the_model_continues()
    test_capture_artifacts_preserves_the_confirmation_gate()
    test_gate_survives_the_full_build_workflow_tool_assembly()
    print("ok  tool-confirmation: native gate parks the send; approve re-executes it once "
          "and the model continues; decline rejects it")
