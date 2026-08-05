"""A step must never loop forever calling tools with no natural stopping
point. nodes.py's before_model_callback (_stop_after_n_calls) caps a single
step (ADK's own RunConfig.max_llm_calls is invocation-wide and hard-aborts
the whole run instead) and forces a real text answer once tripped, rather
than a canned non-answer a caller could mistake for a genuine one.

Uses the real ADK engine with a scripted LLM that always emits a function
call, unless the request has no tools left — the forced-recovery signal.
"""
from pydantic import PrivateAttr

from google.adk.agents import LlmAgent
from google.adk.models import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools import FunctionTool
from google.genai import types

from src.companion_ai import nodes as nodes_mod
from src.companion_ai.plan import Step


class _NeverStopsLlm(BaseLlm):
    """Always emits the same tool call — unless the request has no tools
    left (the forced-recovery signal), in which case it emits real text."""

    _n: int = PrivateAttr(default=0)

    def __init__(self):
        super().__init__(model="fake")
        object.__setattr__(self, "_n", 0)

    async def generate_content_async(self, llm_request, stream=False):
        object.__setattr__(self, "_n", self._n + 1)
        if not llm_request.config.tools:
            yield LlmResponse(content=types.Content(role="model", parts=[
                types.Part(text="Best answer using what I already found: no.")]))
            return
        yield LlmResponse(content=types.Content(role="model", parts=[
            types.Part(function_call=types.FunctionCall(
                name="dummy_search", args={"query": f"attempt {self._n}"}, id=f"call_{self._n}"))
        ]))


async def dummy_search(query: str) -> str:
    return "no useful result"


async def test_step_stops_after_max_model_calls_instead_of_looping_forever(monkeypatch):
    monkeypatch.setattr(nodes_mod, "MAX_STEP_MODEL_CALLS", 3)
    scripted = _NeverStopsLlm()
    monkeypatch.setattr(nodes_mod, "build_llm", lambda *a, **k: scripted)

    factory = nodes_mod.make_llm_node_factory(model_name="fake", tools=[FunctionTool(dummy_search)])
    step = Step(id="s1", kind="execute", description="Do something that never resolves.")
    agent: LlmAgent = factory(step, "s1")

    session_service = InMemorySessionService()
    await session_service.create_session(app_name="test", user_id="u1", session_id="sess1")
    runner = Runner(app_name="test", agent=agent, session_service=session_service)

    events = [e async for e in runner.run_async(
        user_id="u1", session_id="sess1",
        new_message=types.Content(role="user", parts=[types.Part(text="go")]))]

    assert events, "expected at least the forced-recovery event"
    final_text = events[-1].content.parts[0].text
    # A REAL answer, not a blank "I'm stopping" the caller could mistake for one.
    assert final_text == "Best answer using what I already found: no."
    # The model itself was called at most cap+1 times — not indefinitely.
    assert scripted._n <= 4


class _RecordingLlm(BaseLlm):
    """Like _NeverStopsLlm, but also records the nudge text sent on the
    forced-recovery (no-tools) call, so a test can inspect exactly what the
    model was told to do once cut off."""

    _n: int = PrivateAttr(default=0)
    _last_nudge: str = PrivateAttr(default="")

    def __init__(self):
        super().__init__(model="fake")
        object.__setattr__(self, "_n", 0)
        object.__setattr__(self, "_last_nudge", "")

    async def generate_content_async(self, llm_request, stream=False):
        object.__setattr__(self, "_n", self._n + 1)
        if not llm_request.config.tools:
            object.__setattr__(self, "_last_nudge", llm_request.contents[-1].parts[0].text)
            yield LlmResponse(content=types.Content(role="model", parts=[
                types.Part(text="Escalation could not be completed within this turn.")]))
            return
        yield LlmResponse(content=types.Content(role="model", parts=[
            types.Part(function_call=types.FunctionCall(
                name="dummy_search", args={"query": f"attempt {self._n}"}, id=f"call_{self._n}"))
        ]))


async def test_a_persona_step_never_fabricates_a_decision_when_cut_off(monkeypatch):
    """A persona step that exhausts its budget before finishing its
    prepare/email/await_reply chain must say plainly that escalation didn't
    happen — never "give your best answer", which is exactly the fabricated
    decision the whole persona redesign forbids (regression: an earlier
    version reused the generic non-persona nudge here and the persona
    answered in the real person's place instead of admitting it never
    reached them)."""
    monkeypatch.setattr(nodes_mod, "MAX_PERSONA_STEP_MODEL_CALLS", 3)
    scripted = _RecordingLlm()
    monkeypatch.setattr(nodes_mod, "build_llm", lambda *a, **k: scripted)

    factory = nodes_mod.make_llm_node_factory(model_name="fake", tools=[FunctionTool(dummy_search)])
    step = Step(id="s1", kind="execute", description="Should we approve this?",
                is_persona=True, assignee_name="Oussama", assignee_role="Investment approver.")
    agent: LlmAgent = factory(step, "s1")

    session_service = InMemorySessionService()
    await session_service.create_session(app_name="test", user_id="u1", session_id="sess1")
    runner = Runner(app_name="test", agent=agent, session_service=session_service)

    events = [e async for e in runner.run_async(
        user_id="u1", session_id="sess1",
        new_message=types.Content(role="user", parts=[types.Part(text="go")]))]

    assert events, "expected at least the forced-recovery event"
    nudge = scripted._last_nudge
    assert "give your best answer" not in nudge.lower()
    assert "do not invent" in nudge.lower() or "do not fabricate" in nudge.lower() \
        or "not invent" in nudge.lower()
    assert "Oussama" in nudge
