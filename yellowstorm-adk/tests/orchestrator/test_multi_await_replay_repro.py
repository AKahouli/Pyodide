"""Harness: several runtime create_task(await_reply) awaits, gated sends, resume.

Context — live session 05e79169… (and ad91efd4…) failed with
    RuntimeError: Replay divergence detected: Timed out waiting for sequence key
                 'b4d01f486156@1' to be unblocked.
Its plan grew mid-run into many is_dynamic_delegate steps, including THREE
create_task(kind='await_reply') awaits AND a FAILED dynamic step, with a
deep fan-in report. On a later resume ADK's linear replay barrier could not
re-linearise the incrementally-recorded dynamic nodes.

This drives that shape on the real ADK engine: two gated-send steps that each
approve, send, and register a create_task(kind='await_reply'), then resume both
parked awaits. FINDING: this clean multi-await path resumes WITHOUT diverging —
so the bug is not simply "several awaits". The live divergence coincided with an
uncontained FAILED dynamic step (matching test_parallel_confirm_repro's finding
that an un-retried step error + a parked sibling + a resume is what corrupts the
replay). Extending this harness with such a failure is the path to the full
divergence repro; for now it is the regression guard that any barrier fix must
keep green (the clean tangle must stay resumable).

    <adk venv>/bin/python -m pytest tests/orchestrator/test_multi_await_replay_repro.py -s
"""
import asyncio
import inspect
import os
import sys
import uuid
import unittest.mock as mock
from unittest.mock import AsyncMock, MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from src.companion_ai.adk import hitl, nodes as nodes_mod, service as svc
from src.companion_ai.plan import Plan, Step, Status
from src.smart_rag.tools.search.tools import SearchToolADK

SENT: list = []


def _saw(req, name: str) -> bool:
    return any(getattr(p, "function_response", None) is not None
              and p.function_response.name == name
              for c in (req.contents or []) for p in c.parts)


class _SendThenAwait(BaseLlm):
    """Executor that sends a mail, then registers a create_task(await_reply),
    then finishes — the exact runtime shape that grows the plan with a dynamic
    await per send step."""
    def __init__(self):
        super().__init__(model="fake")

    async def generate_content_async(self, req, stream=False):
        if not _saw(req, "outlook_send_email"):
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(
                function_call=types.FunctionCall(
                    name="outlook_send_email",
                    args={"to_recipients": ["x@y.com"], "subject": "Q", "body": "b"},
                    id=f"snd_{uuid.uuid4().hex[:8]}"))]))
            return
        if not _saw(req, "create_task"):
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(
                function_call=types.FunctionCall(
                    name="create_task",
                    args={"kind": "await_reply",
                          "description": "Wait for the recipient's reply and act on it."},
                    id=f"tsk_{uuid.uuid4().hex[:8]}"))]))
            return
        yield LlmResponse(content=types.Content(role="model",
            parts=[types.Part(text="Mail sent; awaiting reply.")]))


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


class _SendAwaitOrBoom(_SendThenAwait):
    """Like _SendThenAwait, but a step whose task carries 'ACTBOOM' dies on its
    first model call — the uncontained litellm/Azure error a live dynamic step
    hit ('recherche complémentaire' in session 05e79169). The create_task from a
    step tagged '[sbmark]' stamps ACTBOOM into its follow-up, so only that
    await's 'act on reply' step blows up — after both awaits have parked."""
    async def generate_content_async(self, req, stream=False):
        text = _req_text(req)
        if "ACTBOOM" in text:
            raise RuntimeError("litellm.APIError: AzureException APIError - simulated")
        if _saw(req, "outlook_send_email") and not _saw(req, "create_task"):
            desc = ("ACTBOOM act on the reply" if "[sbmark]" in text
                    else "Act on the reply")
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(
                function_call=types.FunctionCall(
                    name="create_task",
                    args={"kind": "await_reply", "description": desc},
                    id=f"tsk_{uuid.uuid4().hex[:8]}"))]))
            return
        async for r in super().generate_content_async(req, stream):
            yield r


class _SendAwaitSoftFail(_SendThenAwait):
    """Like _SendAwaitOrBoom, but the tagged follow-up SELF-REPORTS failure
    (STEP_FAILED) instead of raising — a soft failure that marks the step failed
    WITHOUT aborting the drive, so the plan continues past it exactly as the live
    'recherche complémentaire' step did before a later resume diverged."""
    async def generate_content_async(self, req, stream=False):
        text = _req_text(req)
        if "ACTBOOM" in text:
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(
                text="STEP_FAILED: simulated compute error")]))
            return
        if _saw(req, "outlook_send_email") and not _saw(req, "create_task"):
            desc = ("ACTBOOM act on the reply" if "[sbmark]" in text else "Act on the reply")
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(
                function_call=types.FunctionCall(
                    name="create_task", args={"kind": "await_reply", "description": desc},
                    id=f"tsk_{uuid.uuid4().hex[:8]}"))]))
            return
        async for r in super().generate_content_async(req, stream):
            yield r


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
              "set_mail_wait_expected_from", "bind_teams_wait_target", "add_step_artifact",
              "upsert_step"):
        setattr(rm, m, AsyncMock())
    # A newly-minted eager token exists after send, so create_task(await_reply)
    # rebinds it rather than refusing (moved=True short-circuits the refusal).
    rm.rebind_mail_wait = AsyncMock(return_value=True)
    rm.mail_token_for = AsyncMock(return_value="YW-tok")
    rm.outstanding_interrupts = AsyncMock(return_value=[])
    return rm


def _service(rf, rm):
    return svc.OrchestratorService(rf, rm, planner_model="m")


def _drive_repro():
    """Two send+await steps grow the plan into two dynamic awaits; resume both.
    Returns nothing — raises RuntimeError('Replay divergence') if the bug fires."""
    SENT.clear()
    session_id = "s_multi_await"
    sessions = InMemorySessionService()

    def rf(node, app_name):
        return Runner(node=node, app_name=app_name, session_service=sessions)

    async def go():
        with mock.patch.object(nodes_mod, "build_llm", lambda *a, **k: _SendThenAwait()), \
             mock.patch.object(svc.OrchestratorService, "_tools_for",
                               lambda self, c, s, u: [_outlook_tool()]):
            service = _service(rf, _read_model())
            plan = Plan(id="p", title="t", goal="g", executor_id="e", executor_name="E", steps=[
                Step(id="sa", kind="execute", description="Email A and await reply"),
                Step(id="sb", kind="execute", description="Email B and await reply"),
                Step(id="sc", kind="execute", description="Report", depends_on=["sa", "sb"])])
            await sessions.create_session(app_name=f"orch_{session_id}", user_id="u", session_id=session_id)

            def drive(msg_part):
                wf, n2s = service._build_workflow(session_id, "u", plan, "fake", [{"c": 1}], None)
                return service._drive_until_quiescent(
                    rf(wf, f"orch_{session_id}"), session_id, "u", plan, n2s,
                    types.Content(role="user", parts=[msg_part]),
                    model="fake", connectors=[{"c": 1}], executor_prompt=None)

            # PASS 1 — the two gated sends park on approval cards.
            interrupts = await drive(types.Part(text="go"))
            confirms = [i for i, _ in interrupts if i.startswith("confirm::")]
            print("PASS 1 confirms:", confirms)
            assert len(confirms) >= 2, f"expected two gates, got {interrupts}"

            # Approve each gate → its send runs → create_task(await_reply) grows the
            # plan and its await parks. After both, two dynamic awaits are parked.
            mails: list = []
            for c in confirms:
                out = await drive(hitl.confirmation_resume_part(
                    hitl.confirm_fc_id(c), confirmed=True))
                for i, _ in out:
                    if i.startswith("mail:") and i not in mails:
                        mails.append(i)
                print("after approve", c[:20], "-> interrupts:", [i for i, _ in out])
            print("SENT:", SENT, "| parked awaits:", mails)
            print("steps:", [(s.id, s.kind, s.status.value) for s in plan.steps])
            assert len(mails) >= 2, f"expected >=2 parked awaits, got {mails}"

            # Resume each parked await, rebuild each time (as the mail webhook does).
            # This is where the linear replay barrier diverges on the tangled awaits.
            for idx, iid in enumerate(mails):
                out = await drive(hitl.resume_part(iid, {"value": f"Reply {idx}: go ahead."}))
                print(f"RESUME {idx} ({iid}) ok. interrupts:", [i for i, _ in out])

    asyncio.run(go())


@pytest.mark.xfail(reason=(
    "ADK 2.11.0 replay sequence-barrier (_replay_manager) times out waiting for a "
    "dynamic-node sequence key when the rebuilt graph replays after the plan grew "
    "await nodes; these guards were green on 2.8.0. Worky is outside the "
    "adk11-migration scope; capability stays gated until an upstream fix. WP00."),
    strict=False)
def test_multi_await_resume_does_not_diverge():
    """Regression guard: two gated sends, each spawning a create_task(await_reply),
    then both awaits resumed — the clean multi-await tangle must stay resumable.
    Any replay-barrier fix must keep this green. Run with -s to see the trace."""
    _drive_repro()


def _drive_with_failure():
    """Same shape, but sb's await follow-up dies uncontained (ACTBOOM). Returns
    the list of errors seen across the resume passes so the test can inspect
    whether the failure stays contained or corrupts the replay."""
    SENT.clear()
    session_id = "s_multi_await_boom"
    sessions = InMemorySessionService()

    def rf(node, app_name):
        return Runner(node=node, app_name=app_name, session_service=sessions)

    errors: list = []

    async def go():
        with mock.patch.object(nodes_mod, "build_llm", lambda *a, **k: _SendAwaitOrBoom()), \
             mock.patch.object(svc.OrchestratorService, "_tools_for",
                               lambda self, c, s, u: [_outlook_tool()]):
            service = _service(rf, _read_model())
            plan = Plan(id="p", title="t", goal="g", executor_id="e", executor_name="E", steps=[
                Step(id="sa", kind="execute", description="Email A and await reply"),
                Step(id="sb", kind="execute", description="Email B and await reply [sbmark]"),
                Step(id="sc", kind="execute", description="Report", depends_on=["sa", "sb"])])
            await sessions.create_session(app_name=f"orch_{session_id}", user_id="u", session_id=session_id)

            def drive(msg_part):
                wf, n2s = service._build_workflow(session_id, "u", plan, "fake", [{"c": 1}], None)
                return service._drive_until_quiescent(
                    rf(wf, f"orch_{session_id}"), session_id, "u", plan, n2s,
                    types.Content(role="user", parts=[msg_part]),
                    model="fake", connectors=[{"c": 1}], executor_prompt=None)

            interrupts = await drive(types.Part(text="go"))
            confirms = [i for i, _ in interrupts if i.startswith("confirm::")]
            mails: list = []
            for c in confirms:
                out = await drive(hitl.confirmation_resume_part(hitl.confirm_fc_id(c), confirmed=True))
                for i, _ in out:
                    if i.startswith("mail:") and i not in mails:
                        mails.append(i)
            print("parked awaits:", mails)

            for idx, iid in enumerate(mails):
                try:
                    await drive(hitl.resume_part(iid, {"value": f"Reply {idx}: go ahead."}))
                    print(f"RESUME {idx} ok")
                except Exception as e:  # noqa: BLE001
                    errors.append(f"RESUME {idx}: {type(e).__name__}: {str(e)[:90]}")
                    print(errors[-1])
                    print("   steps:", [(s.id[:12], s.kind, s.status.value,
                          [d[:8] for d in s.depends_on]) for s in plan.steps])

            # A further rebuild+drive AFTER the uncontained failure — the live
            # divergence surfaced on a resume that came after a failed step.
            try:
                await drive(types.Part(text="continue"))
                print("FINAL drive ok")
            except Exception as e:  # noqa: BLE001
                errors.append(f"FINAL: {type(e).__name__}: {str(e)[:110]}")
                print(errors[-1])

    asyncio.run(go())
    return errors


def test_uncontained_failure_repro():
    """EXPLORATORY (expected RED before the fix): an uncontained dynamic-step
    failure among parked awaits. Prints what surfaces — a raw APIError, or a
    'Replay divergence'. This is the harness for the containment fix."""
    errors = _drive_with_failure()
    print("ALL ERRORS:", errors)
    assert errors, "expected the ACTBOOM follow-up to fail"


# --- DURABLE session variant (the divergence needs a persisted session) ------

def _durable_service():
    import tempfile
    from google.adk.sessions import DatabaseSessionService
    db_path = tempfile.NamedTemporaryFile(suffix=".db", delete=False).name
    return DatabaseSessionService(db_url=f"sqlite+aiosqlite:///{db_path}")


def _drive_durable(n_awaits: int, boom_on: int | None, *, resume_order=None, soft=False):
    """Drive n_awaits gated-send+create_task(await_reply) steps on a DURABLE
    (sqlite) session — the shape that produced the live 'Replay divergence'.
    boom_on: index of the send step whose await follow-up dies uncontained, or
    None for the clean case. Returns (errors, last_status)."""
    SENT.clear()
    session_id = "s_durable"
    sessions = _durable_service()

    def rf(node, app_name):
        return Runner(node=node, app_name=app_name, session_service=sessions)

    errors: list = []
    if boom_on is None:
        llm = _SendThenAwait
    elif soft:
        llm = _SendAwaitSoftFail
    else:
        llm = _SendAwaitOrBoom

    async def go():
        with mock.patch.object(nodes_mod, "build_llm", lambda *a, **k: llm()), \
             mock.patch.object(svc.OrchestratorService, "_tools_for",
                               lambda self, c, s, u: [_outlook_tool()]):
            service = _service(rf, _read_model())
            steps = []
            for k in range(n_awaits):
                mark = " [sbmark]" if k == boom_on else ""
                steps.append(Step(id=f"s{k}", kind="execute",
                                  description=f"Email {k} and await reply{mark}"))
            steps.append(Step(id="sr", kind="execute", description="Report",
                              depends_on=[f"s{k}" for k in range(n_awaits)]))
            plan = Plan(id="p", title="t", goal="g", executor_id="e", executor_name="E", steps=steps)
            await sessions.create_session(app_name=f"orch_{session_id}", user_id="u", session_id=session_id)

            def drive(msg_part):
                wf, n2s = service._build_workflow(session_id, "u", plan, "fake", [{"c": 1}], None)
                return service._drive_until_quiescent(
                    rf(wf, f"orch_{session_id}"), session_id, "u", plan, n2s,
                    types.Content(role="user", parts=[msg_part]),
                    model="fake", connectors=[{"c": 1}], executor_prompt=None)

            interrupts = await drive(types.Part(text="go"))
            confirms = [i for i, _ in interrupts if i.startswith("confirm::")]
            mails: list = []
            for c in confirms:
                out = await drive(hitl.confirmation_resume_part(hitl.confirm_fc_id(c), confirmed=True))
                for i, _ in out:
                    if i.startswith("mail:") and i not in mails:
                        mails.append(i)
            print(f"[durable n={n_awaits} boom={boom_on}] parked awaits:", len(mails))

            order = resume_order if resume_order is not None else list(range(len(mails)))
            for idx in order:
                if idx >= len(mails):
                    continue
                try:
                    await drive(hitl.resume_part(mails[idx], {"value": f"Reply {idx}."}))
                    print(f"  RESUME {idx} ok")
                except Exception as e:  # noqa: BLE001
                    tag = "DIVERGENCE" if "Replay divergence" in str(e) else type(e).__name__
                    errors.append(f"RESUME {idx}: {tag}: {str(e)[:100]}")
                    print("  " + errors[-1])

    asyncio.run(go())
    return errors


@pytest.mark.xfail(reason=(
    "ADK 2.11.0 replay sequence-barrier divergence on grown-plan resume; see "
    "test_multi_await_resume_does_not_diverge. WP00."), strict=False)
def test_durable_clean_multi_await_resumes():
    """Clean 3-await case on a DURABLE session resumes without diverging —
    durability alone is NOT the trigger."""
    errors = _drive_durable(3, boom_on=None)
    assert not errors, f"clean durable multi-await should not error: {errors}"


def test_durable_uncontained_failure_aborts_the_run():
    """The reproducible root of the live 'Replay divergence': an UNCONTAINED
    dynamic-step failure. On a durable session it surfaces as ADK's
    DynamicNodeFailError (in-memory it re-raises the model error on every resume,
    see test_uncontained_failure_repro). Either way the run is corrupted — this
    is the failure the containment fix must neutralise.

    NOTE: the literal 'Replay divergence … sequence key' message is the
    NON-DETERMINISTIC downstream manifestation of this same uncontained failure
    (a 15s barrier race); it does not reproduce reliably in-process, so we anchor
    the fix on the deterministic symptom — the run must not abort here."""
    from google.adk.workflow._errors import DynamicNodeFailError
    raised = None
    try:
        _drive_durable(3, boom_on=1, resume_order=[0, 2, 1], soft=False)
    except (DynamicNodeFailError, RuntimeError) as e:
        raised = e
    assert raised is not None, "uncontained failure should currently corrupt the run"


@pytest.mark.xfail(reason=(
    "ADK 2.11.0 replay sequence-barrier divergence on grown-plan resume; see "
    "test_multi_await_resume_does_not_diverge. WP00."), strict=False)
def test_durable_contained_failure_stays_resumable():
    """The TARGET behavior the fix delivers: when the same failure is CONTAINED
    (self-reported STEP_FAILED, no raise), the plan continues and every other
    await still resumes cleanly on a durable session — no abort, no divergence.
    This is the proof-of-fix anchor: the containment fix must make the uncontained
    case behave like this one."""
    errors = _drive_durable(3, boom_on=1, resume_order=[0, 2, 1], soft=True)
    assert not errors, f"a contained failure must not break sibling resumes: {errors}"


if __name__ == "__main__":
    _drive_repro()
