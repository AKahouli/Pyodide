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

from src.companion_ai.adk import nodes as nodes_mod
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


async def dummy_search(query: str, role: str = "") -> str:
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


class _LoopingLlm(BaseLlm):
    """Calls the SAME tool with the SAME args every round, until it sees the
    stuck-loop nudge appear in its own incoming request — then switches to
    real text, standing in for a model that actually responds to being told
    to stop re-checking and move on."""

    _n: int = PrivateAttr(default=0)

    def __init__(self):
        super().__init__(model="fake")
        object.__setattr__(self, "_n", 0)

    async def generate_content_async(self, llm_request, stream=False):
        object.__setattr__(self, "_n", self._n + 1)
        saw_nudge = any(
            "not tell you anything new" in (getattr(p, "text", "") or "")
            for c in llm_request.contents for p in (c.parts or []))
        if saw_nudge:
            yield LlmResponse(content=types.Content(role="model", parts=[
                types.Part(text="Moving on now.")]))
            return
        yield LlmResponse(content=types.Content(role="model", parts=[
            types.Part(function_call=types.FunctionCall(
                name="dummy_search", args={"query": "same"}, id=f"call_{self._n}"))
        ]))


async def test_a_step_stuck_repeating_the_same_tool_call_gets_nudged_to_move_on(monkeypatch):
    """Seen live: a step re-verified the same already-confirmed
    find_human_agents lookup 7+ times, identical args, identical successful
    result every time, making no other progress — a model reasoning stall,
    not a budget problem. Must be caught well before the full step-call
    budget (MAX_STEP_MODEL_CALLS=15) grinds through blind, and — unlike the
    budget-exhausted fallback — with tools still available, so the step can
    actually act on the nudge instead of being forced into a no-tools
    final answer."""
    scripted = _LoopingLlm()
    monkeypatch.setattr(nodes_mod, "build_llm", lambda *a, **k: scripted)

    factory = nodes_mod.make_llm_node_factory(model_name="fake", tools=[FunctionTool(dummy_search)])
    step = Step(id="s1", kind="execute", description="Find and confirm someone.")
    agent: LlmAgent = factory(step, "s1")

    session_service = InMemorySessionService()
    await session_service.create_session(app_name="test", user_id="u1", session_id="sess1")
    runner = Runner(app_name="test", agent=agent, session_service=session_service)

    events = [e async for e in runner.run_async(
        user_id="u1", session_id="sess1",
        new_message=types.Content(role="user", parts=[types.Part(text="go")]))]

    final_text = events[-1].content.parts[0].text
    assert final_text == "Moving on now."
    # Broke out right after the stuck-loop window, nowhere near the full budget.
    assert scripted._n <= nodes_mod.STUCK_LOOP_WINDOW + 1


async def test_a_step_repeating_DIFFERENT_tool_calls_is_not_flagged_as_stuck(monkeypatch):
    """Only IDENTICAL repeats look like a stall — a step that keeps calling
    the same tool with genuinely different arguments each time (e.g. trying
    several names) is making progress and must not get nudged to stop."""
    class _VariedLlm(BaseLlm):
        _n: int = PrivateAttr(default=0)

        def __init__(self):
            super().__init__(model="fake")
            object.__setattr__(self, "_n", 0)

        async def generate_content_async(self, llm_request, stream=False):
            object.__setattr__(self, "_n", self._n + 1)
            n = self._n
            if n > 4:
                yield LlmResponse(content=types.Content(role="model", parts=[
                    types.Part(text="Done searching.")]))
                return
            yield LlmResponse(content=types.Content(role="model", parts=[
                types.Part(function_call=types.FunctionCall(
                    name="dummy_search", args={"query": f"candidate {n}"}, id=f"call_{n}"))
            ]))

    scripted = _VariedLlm()
    monkeypatch.setattr(nodes_mod, "build_llm", lambda *a, **k: scripted)

    factory = nodes_mod.make_llm_node_factory(model_name="fake", tools=[FunctionTool(dummy_search)])
    step = Step(id="s1", kind="execute", description="Find and confirm someone.")
    agent: LlmAgent = factory(step, "s1")

    session_service = InMemorySessionService()
    await session_service.create_session(app_name="test", user_id="u1", session_id="sess1")
    runner = Runner(app_name="test", agent=agent, session_service=session_service)

    events = [e async for e in runner.run_async(
        user_id="u1", session_id="sess1",
        new_message=types.Content(role="user", parts=[types.Part(text="go")]))]

    final_text = events[-1].content.parts[0].text
    assert final_text == "Done searching."
    assert scripted._n == 5  # never short-circuited early by the loop nudge


async def test_a_step_rechecking_the_same_target_with_jittered_args_gets_nudged(monkeypatch):
    """Seen live: find_human_agents('Firas Kahia') called 6+ times across one
    step, but the args shape changed almost every round (sometimes bare
    {'name': ...}, sometimes with an added role='', sometimes paired with a
    lookup for a different name, sometimes interleaved with an unrelated
    search_m365 call) -- never 3 byte-identical rounds in a row, so the old
    exact-match check missed it entirely. The nudge must fire on the
    repeated SUBJECT being looked up, not the literal arg dict. (Uses
    dummy_search, the tool actually registered on this test agent, but the
    args jitter the same way: same 'name' target, role='' added on and off.)"""
    class _JitteringLlm(BaseLlm):
        _n: int = PrivateAttr(default=0)

        def __init__(self):
            super().__init__(model="fake")
            object.__setattr__(self, "_n", 0)

        async def generate_content_async(self, llm_request, stream=False):
            object.__setattr__(self, "_n", self._n + 1)
            saw_nudge = any(
                "not tell you anything new" in (getattr(p, "text", "") or "")
                for c in llm_request.contents for p in (c.parts or []))
            if saw_nudge:
                yield LlmResponse(content=types.Content(role="model", parts=[
                    types.Part(text="Moving on now.")]))
                return
            # Same subject every round, args shape jittered -- never
            # byte-identical to the previous round.
            variants = [
                {"query": "Firas Kahia"},
                {"query": "Firas Kahia", "role": ""},
                {"query": "Firas Kahia"},
            ]
            args = variants[(self._n - 1) % len(variants)]
            yield LlmResponse(content=types.Content(role="model", parts=[
                types.Part(function_call=types.FunctionCall(
                    name="dummy_search", args=args, id=f"call_{self._n}"))
            ]))

    scripted = _JitteringLlm()
    monkeypatch.setattr(nodes_mod, "build_llm", lambda *a, **k: scripted)

    factory = nodes_mod.make_llm_node_factory(model_name="fake", tools=[FunctionTool(dummy_search)])
    step = Step(id="s1", kind="execute", description="Find and confirm someone.")
    agent: LlmAgent = factory(step, "s1")

    session_service = InMemorySessionService()
    await session_service.create_session(app_name="test", user_id="u1", session_id="sess1")
    runner = Runner(app_name="test", agent=agent, session_service=session_service)

    events = [e async for e in runner.run_async(
        user_id="u1", session_id="sess1",
        new_message=types.Content(role="user", parts=[types.Part(text="go")]))]

    final_text = events[-1].content.parts[0].text
    assert final_text == "Moving on now."
    assert scripted._n <= nodes_mod.STUCK_LOOP_WINDOW + 1
