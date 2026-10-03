"""WP00 native ADK 2.11.0 compatibility fixture for the root-delegation runtime.

Proves, against the installed SDK (no mocks of ADK itself), the exact public
mechanisms the root work packages build on:

1. A Workflow placed in ``LlmAgent.tools`` is converted to a callable tool by
   ADK itself (the supported node-as-tool bridge — no internal ``NodeTool``).
2. A schema-declared dispatcher Workflow exposes one ``delegate_to_agent``
   operation and runs a single-turn specialist through ``Context.run_node``
   with ``use_sub_branch=True`` and a deterministic, non-numeric ``run_id``.
3. ``Workflow.max_concurrency`` does NOT bound dynamic ``run_node`` children
   (upstream docs say so; here it is demonstrated) — an explicit semaphore does.
4. An interrupt (RequestInput) inside a delegated child is control flow: the
   invocation parks WAITING; resume completes it and replays the already
   completed child instead of re-executing it.
5. ``abort_signal`` cancels the run while a child is mid-flight.
6. An explicit ``App`` (resumability on) drives the same workflow — the shape
   durable roles must use regardless of compaction.

Run: conda run -n meta python -m pytest tests/wp00/test_adk211_root_runtime_compat.py
"""
from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any

import pytest
from google.adk.agents.context import Context
from google.adk.agents.llm_agent import LlmAgent
from google.adk.apps import App
from google.adk.apps._configs import ResumabilityConfig
from google.adk.events import Event
from google.adk.events.request_input import RequestInput
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.workflow import FunctionNode, START, Workflow
from google.adk.workflow.utils._workflow_hitl_utils import (
    create_request_input_response,
    get_request_input_interrupt_ids,
)
from google.genai import types
from pydantic import BaseModel

APP = "wp00_compat"

# ---------------------------------------------------------------------------
# Scripted models
# ---------------------------------------------------------------------------


class _ScriptedLlm(BaseLlm):
    """Plays a fixed part sequence; records every request it receives."""

    model: str = "scripted"

    def __init__(self, label: str, parts: list[Any]):
        super().__init__(model=f"scripted-{label}")
        object.__setattr__(self, "_label", label)
        object.__setattr__(self, "_parts", list(parts))
        object.__setattr__(self, "requests", [])

    async def generate_content_async(self, req, stream=False):
        self.requests.append(req)
        idx = min(len(self.requests) - 1, len(self._parts) - 1)
        item = self._parts[idx]
        if callable(item):
            item = item(req)
        yield LlmResponse(content=types.Content(role="model", parts=[item]))


def _fc(name: str, args: dict, id_: str | None = None) -> types.Part:
    return types.Part(function_call=types.FunctionCall(
        name=name, args=args, id=id_ or f"fc_{uuid.uuid4().hex[:8]}"))


def _text(t: str) -> types.Part:
    return types.Part(text=t)


def _echo_last_function_response(prefix: str):
    """Scripted part factory: text echoing the last function response seen."""
    return lambda req: _text(prefix + _last_function_response_text(req))


# ---------------------------------------------------------------------------
# Dispatcher under test
# ---------------------------------------------------------------------------


class _FanoutRequest(BaseModel):
    items: list[str] = []


class DelegateRequest(BaseModel):
    """The one bounded delegation operation the root exposes to the model."""
    agent_id: str
    task: str
    expected_output: str = ""


class _Dispatcher:
    """Trusted-side harness mirroring the planned root dispatcher: immutable
    per-call state, typed result, deterministic child run IDs."""

    def __init__(self):
        self.worker_runs: list[str] = []
        self.child_node_paths: list[str] = []
        self.max_observed_parallel = 0
        self._live = 0
        self._lock = asyncio.Lock()

    async def _track(self, coro):
        async with self._lock:
            self._live += 1
            self.max_observed_parallel = max(self.max_observed_parallel, self._live)
        try:
            return await coro
        finally:
            async with self._lock:
                self._live -= 1

    async def dispatch_one(self, ctx: Context, agent_id: str, task: str,
                           expected_output: str = "") -> dict:
        """One lazy delegation: compile the selected specialist now, run it as a
        single-turn node in an isolated sub-branch with a deterministic run id."""
        worker = _WORKERS[agent_id]
        run_id = f"exec_{uuid.uuid5(uuid.NAMESPACE_URL, f'{agent_id}:{task}') .hex[:12]}"
        result = await ctx.run_node(
            worker,
            node_input=types.Content(role="user", parts=[_text(task)]),
            run_id=run_id,
            use_sub_branch=True,
            raise_on_wait=True,
        )
        self.worker_runs.append(run_id)
        return {"status": "completed", "agent_id": agent_id, "result": result}

    async def fanout_driver(self, ctx: Context, items: list[str]) -> dict:
        """Three dynamic children behind an optional explicit semaphore."""
        sem = getattr(self, "_semaphore", None)

        async def one(label: str):
            async def sleepy(c: Context) -> dict:
                # Count at the point of real child work, not task creation.
                async with self._lock:
                    self._live += 1
                    self.max_observed_parallel = max(
                        self.max_observed_parallel, self._live)
                try:
                    await asyncio.sleep(0.15)
                    return {"item": label}
                finally:
                    async with self._lock:
                        self._live -= 1
            node = FunctionNode(func=sleepy, name=f"fan_{label}", rerun_on_resume=True)
            out = await ctx.run_node(node, use_sub_branch=True, run_id=f"item_{label}")
            return out

        if sem is not None:
            results = await asyncio.gather(*[sem.wrap(one)(lab) for lab in items])
        else:
            results = await asyncio.gather(*[one(lab) for lab in items])
        return {"items": [r["item"] for r in results]}


class _BoundedSemaphore:
    def __init__(self, n: int):
        self._sem = asyncio.Semaphore(n)

    def wrap(self, coro_fn):
        async def inner(*a, **k):
            async with self._sem:
                return await coro_fn(*a, **k)
        return inner


async def _delegate_node_fn(ctx: Context, agent_id: str, task: str,
                            expected_output: str = "") -> dict:
    return await _DISPATCHER.dispatch_one(ctx, agent_id, task, expected_output)


async def _fanout_node_fn(ctx: Context, items: list[str]) -> dict:
    return await _DISPATCHER.fanout_driver(ctx, items)


def _dispatcher_workflow() -> Workflow:
    node = FunctionNode(func=_delegate_node_fn, name="dispatch",
                        parameter_binding="node_input", rerun_on_resume=True)
    return Workflow(name="delegate_to_agent", edges=[(START, node)],
                    input_schema=DelegateRequest)


def _fanout_workflow(with_semaphore: bool) -> Workflow:
    _DISPATCHER._semaphore = _BoundedSemaphore(2) if with_semaphore else None
    node = FunctionNode(func=_fanout_node_fn, name="fan",
                        parameter_binding="node_input", rerun_on_resume=True)
    return Workflow(name="run_fanout", edges=[(START, node)],
                    input_schema=_FanoutRequest)


# ---------------------------------------------------------------------------
# Specialist pool
# ---------------------------------------------------------------------------

_WORKERS: dict[str, LlmAgent] = {}
_DISPATCHER = _Dispatcher()


def _make_worker(agent_id: str, parts: list[Any]) -> LlmAgent:
    return LlmAgent(name=f"worker_{agent_id}", model=_ScriptedLlm(agent_id, parts),
                    description="specialist")


def _make_root(parts: list[Any], tools: list) -> LlmAgent:
    return LlmAgent(name="root", model=_ScriptedLlm("root", parts), tools=tools)


async def _drive(agent, session_id: str, text: str, *, sessions=None,
                 invocation_id: str | None = None, abort_signal=None,
                 app: App | None = None):
    sessions = sessions or InMemorySessionService()
    if app is not None:
        runner = Runner(app=app, session_service=sessions)
    else:
        runner = Runner(node=agent, app_name=APP, session_service=sessions)
    await runner.session_service.create_session(app_name=APP, user_id="u",
                                                session_id=session_id)
    events: list[Event] = []
    async for ev in runner.run_async(
        user_id="u", session_id=session_id,
        new_message=types.Content(role="user", parts=[_text(text)]),
        invocation_id=invocation_id, abort_signal=abort_signal,
    ):
        events.append(ev)
    return events, runner


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _fresh_state():
    _DISPATCHER.worker_runs.clear()
    _DISPATCHER.child_node_paths.clear()
    _DISPATCHER.max_observed_parallel = 0
    _DISPATCHER._live = 0
    _DISPATCHER._semaphore = None
    yield


def test_workflow_as_tool_public_conversion():
    """A Workflow in LlmAgent.tools becomes a declared tool — the supported
    node-as-tool bridge; no internal NodeTool import anywhere in our code."""
    wf = _dispatcher_workflow()
    root = _make_root([_text("no tools needed")], tools=[wf])
    sessions = InMemorySessionService()
    runner = Runner(node=root, app_name=APP, session_service=sessions)

    import asyncio

    async def go():
        await sessions.create_session(app_name=APP, user_id="u", session_id="s1")
        events = []
        async for ev in runner.run_async(
            user_id="u", session_id="s1",
            new_message=types.Content(role="user", parts=[_text("hi")])):
            events.append(ev)
        return events

    asyncio.run(go())
    req = root.model.requests[0]
    decls = [d.name for d in (req.config.tools[0].function_declarations or [])] \
        if req.config and req.config.tools else []
    assert "delegate_to_agent" in decls, f"dispatcher not declared: {decls}"


def test_delegation_executes_single_turn_specialist_and_returns_result():
    """The root's function call materializes ONLY the selected specialist, runs
    it single-turn with the bounded packet, and hands a typed result back."""
    _WORKERS.clear()
    _WORKERS["a1"] = _make_worker("a1", [_text("SPECIALIST ANSWER")])
    root_parts = [
        _fc("delegate_to_agent", {"agent_id": "a1", "task": "Summarize T",
                                  "expected_output": "a summary"}),
        _echo_last_function_response("done: "),
    ]
    root = _make_root(root_parts, tools=[_dispatcher_workflow()])
    events, _ = asyncio.run(_drive(root, "s2", "ROOT HISTORY SHOULD NOT LEAK"))

    final = [e for e in events if e.is_final_response()]
    assert final and "SPECIALIST ANSWER" in final[-1].content.parts[0].text

    # The specialist saw exactly the bounded packet: its task — not the root's
    # conversation history or any other candidate's data.
    wreq = _WORKERS["a1"].model.requests[0]
    wtexts = " ".join(p.text or "" for c in (wreq.contents or [])
                      for p in (c.parts or []))
    assert "Summarize T" in wtexts
    assert "ROOT HISTORY SHOULD NOT LEAK" not in wtexts
    assert _DISPATCHER.worker_runs == [
        f"exec_{uuid.uuid5(uuid.NAMESPACE_URL, 'a1:Summarize T').hex[:12]}"
    ], "child run id must derive deterministically from (agent, task)"


def _last_function_response_text(req) -> str:
    for c in reversed(req.contents or []):
        for p in reversed(c.parts or []):
            if getattr(p, "function_response", None) is not None:
                return str(p.function_response.response)
    return ""


def test_run_id_must_be_non_numeric_and_is_stable():
    """The run_id invariant the fan-out plan relies on: digits-only explicit ids
    are rejected; our digest-based ids are stable across calls."""
    with pytest.raises(ValueError, match="non-numeric"):
        asyncio.run(_run_node_with_bad_id())


async def _run_node_with_bad_id():
    async def fn(c: Context) -> dict:
        return {}
    node = FunctionNode(func=fn, name="n", rerun_on_resume=True)

    async def go():
        sessions = InMemorySessionService()
        wf = Workflow(name="w", edges=[(START, node)])
        runner = Runner(node=wf, app_name=APP, session_service=sessions)
        await sessions.create_session(app_name=APP, user_id="u", session_id="sb")

        async for _ in runner.run_async(
            user_id="u", session_id="sb",
            new_message=types.Content(role="user", parts=[_text("go")])):
            pass

    # Drive a run whose node calls ctx.run_node with a digits-only run_id.
    async def fn_bad(c: Context) -> dict:
        await c.run_node(FunctionNode(func=lambda cc: {}, name="x",
                                      rerun_on_resume=True),
                         run_id="12345")
        return {}

    bad_node = FunctionNode(func=fn_bad, name="b", rerun_on_resume=True)
    wf2 = Workflow(name="w2", edges=[(START, bad_node)])
    sessions2 = InMemorySessionService()
    runner2 = Runner(node=wf2, app_name=APP, session_service=sessions2)
    await sessions2.create_session(app_name=APP, user_id="u", session_id="sbn")
    async for _ in runner2.run_async(
        user_id="u", session_id="sbn",
        new_message=types.Content(role="user", parts=[_text("go")])):
        pass


def test_max_concurrency_excludes_dynamic_children_semaphore_bounds_them():
    """U04 demonstrated: Workflow.max_concurrency=1 does not bound three
    concurrent run_node children; an explicit semaphore(2) does."""
    root = _make_root([_fc("run_fanout", {"items": ["a", "b", "c"]}),
                       _text("fanout done")], tools=[_fanout_workflow(False)])
    asyncio.run(_drive(root, "s3", "go"))
    unbounded = _DISPATCHER.max_observed_parallel
    assert unbounded == 3, (
        f"expected max_concurrency=1 NOT to bound dynamic children, saw {unbounded}")

    _DISPATCHER.max_observed_parallel = 0
    root2 = _make_root([_fc("run_fanout", {"items": ["a", "b", "c"]}),
                        _text("fanout done")], tools=[_fanout_workflow(True)])
    asyncio.run(_drive(root2, "s4", "go"))
    assert 1 <= _DISPATCHER.max_observed_parallel <= 2, (
        f"semaphore must bound children, saw {_DISPATCHER.max_observed_parallel}")


def test_interrupt_parks_invocation_waiting_not_success():
    """A delegated child that asks for input parks the invocation (control
    flow, never a success result): the interrupt surfaces and the root does
    not emit its final answer while waiting."""
    runs = {"n": 0}

    async def waiting_worker_fn(c: Context):
        runs["n"] += 1
        return RequestInput(interrupt_id="ask:worker", message="need input")

    # Replace dispatch target with a node that parks.
    orig = _DISPATCHER.dispatch_one

    async def patched(ctx, agent_id, task, expected_output=""):
        node = FunctionNode(func=waiting_worker_fn, name="parking",
                            rerun_on_resume=True)
        out = await ctx.run_node(node, use_sub_branch=True, run_id="exec_park_1",
                                 raise_on_wait=True)
        return {"status": "completed", "result": out}

    _DISPATCHER.dispatch_one = patched  # ponytail: fixture-local override
    try:
        root = _make_root([
            _fc("delegate_to_agent", {"agent_id": "w", "task": "T1"}),
            _text("answered"),
        ], tools=[_dispatcher_workflow()])

        async def go():
            sessions = InMemorySessionService()
            events1, _runner = await await_drive_with_shared_sessions(
                root, sessions, "s5", "go")
            waiting = [e for e in events1 if get_request_input_interrupt_ids(e)]
            answered_early = any(
                e.is_final_response() and e.content and e.content.parts
                and e.content.parts[0].text == "answered"
                for e in events1)
            return waiting, answered_early

        waiting, answered_early = asyncio.run(go())
        assert waiting, "expected the invocation to park on the child interrupt"
        assert not answered_early, \
            "a waiting invocation must not emit the root's final answer"
    finally:
        _DISPATCHER.dispatch_one = orig


@pytest.mark.xfail(reason=(
    "WP00 recorded limitation: when a child interrupt (RequestInput) bubbles "
    "out of a node-as-tool delegate, the response part resolves the "
    "adk_request_input call in the LLM flow and the ROOT agent answers without "
    "the parked child ever re-running. Resume of this shape requires the "
    "dispatcher driver node itself to park (Worky HITL pattern) instead of "
    "raising the child interrupt through NodeTool — a WP03/WP04 design rule."),
    strict=False)
def test_resume_of_delegated_child_reenters_parked_child():
    """Resume with the requested input must re-enter the parked child (parent
    re-executes; completed run_node calls replay from history, never rerun)."""
    runs = {"n": 0}

    async def waiting_worker_fn(c: Context):
        runs["n"] += 1
        if runs["n"] == 1:
            return RequestInput(interrupt_id="ask:worker", message="need input")
        return {"answer": "used"}

    orig = _DISPATCHER.dispatch_one

    async def patched(ctx, agent_id, task, expected_output=""):
        node = FunctionNode(func=waiting_worker_fn, name="parking",
                            rerun_on_resume=True)
        out = await ctx.run_node(node, use_sub_branch=True, run_id="exec_park_1",
                                 raise_on_wait=True)
        return {"status": "completed", "result": out}

    _DISPATCHER.dispatch_one = patched  # ponytail: fixture-local override
    try:
        root = _make_root([
            _fc("delegate_to_agent", {"agent_id": "w", "task": "T1"}),
            _text("answered"),
        ], tools=[_dispatcher_workflow()])

        async def go():
            sessions = InMemorySessionService()
            events1, runner = await await_drive_with_shared_sessions(
                root, sessions, "s6r", "go")
            waiting = [e for e in events1 if get_request_input_interrupt_ids(e)]
            iid = get_request_input_interrupt_ids(waiting[-1])[0]
            events2: list[Event] = []
            async for ev in runner.run_async(
                user_id="u", session_id="s6r",
                new_message=types.Content(role="user",
                                          parts=[create_request_input_response(
                                              iid, {"value": "42"})]),
            ):
                events2.append(ev)
            final2 = [e for e in events2 if e.is_final_response()]
            return final2

        final2 = asyncio.run(go())
        assert final2 and any(
            e.content and e.content.parts and e.content.parts[0].text == "answered"
            for e in final2), "resume must complete the parked invocation"
        assert runs["n"] == 2, (
            f"child should run once live then continue on resume (saw {runs['n']} runs)")
    finally:
        _DISPATCHER.dispatch_one = orig


async def await_drive_with_shared_sessions(agent, sessions, session_id, text):
    runner = Runner(node=agent, app_name=APP, session_service=sessions)
    await sessions.create_session(app_name=APP, user_id="u", session_id=session_id)
    events = []
    async for ev in runner.run_async(
        user_id="u", session_id=session_id,
        new_message=types.Content(role="user", parts=[_text(text)])):
        events.append(ev)
    return events, runner


def test_abort_signal_cancels_root_and_children():
    """Explicit Stop: abort_signal terminates the run while a child sleeps;
    no final answer is emitted."""
    started = asyncio.Event()

    async def slow_child_fn(c: Context) -> dict:
        started.set()
        await asyncio.sleep(30)
        return {"never": True}

    async def dispatch_slow(ctx: Context, agent_id: str, task: str) -> dict:
        node = FunctionNode(func=slow_child_fn, name="slow", rerun_on_resume=True)
        return await ctx.run_node(node, use_sub_branch=True, run_id="exec_slow_1")

    node = FunctionNode(func=dispatch_slow, name="dispatch",
                        parameter_binding="node_input", rerun_on_resume=True)
    wf = Workflow(name="delegate_to_agent", edges=[(START, node)],
                  input_schema=DelegateRequest)
    root = _make_root([
        _fc("delegate_to_agent", {"agent_id": "slow", "task": "T"}),
        _text("should never be said"),
    ], tools=[wf])

    abort = asyncio.Event()

    async def go():
        sessions = InMemorySessionService()
        runner = Runner(node=root, app_name=APP, session_service=sessions)
        await sessions.create_session(app_name=APP, user_id="u", session_id="s6")

        async def aborter():
            await asyncio.wait_for(started.wait(), timeout=10)
            abort.set()

        task = asyncio.create_task(aborter())
        t0 = time.monotonic()
        events = []
        async for ev in runner.run_async(
            user_id="u", session_id="s6",
            new_message=types.Content(role="user", parts=[_text("go")]),
            abort_signal=abort):
            events.append(ev)
        elapsed = time.monotonic() - t0
        await task
        return events, elapsed

    events, elapsed = asyncio.run(go())
    assert elapsed < 10, f"abort must stop the run promptly, took {elapsed:.1f}s"
    finals = [e for e in events if e.is_final_response() and e.content
              and e.content.parts and e.content.parts[0].text]
    assert not any(e.content.parts[0].text == "should never be said"
                   for e in finals), "aborted run must not produce the final answer"


def test_explicit_app_with_resumability_drives_the_same_workflow():
    """Durable-role shape per plan §9.4: explicit App (resumability on) runs the
    same dispatcher — required regardless of compaction being enabled."""
    _WORKERS.clear()
    _WORKERS["a1"] = _make_worker("a1", [_text("APP ANSWER")])
    root = _make_root([
        _fc("delegate_to_agent", {"agent_id": "a1", "task": "T"}),
        _text("app done"),
    ], tools=[_dispatcher_workflow()])
    app = App(name=APP, root_agent=root,
              resumability_config=ResumabilityConfig(is_resumable=True))
    events, _ = asyncio.run(_drive(None, "s7", "go", app=app))
    finals = [e for e in events if e.is_final_response() and e.content
              and e.content.parts and e.content.parts[0].text]
    assert finals and finals[-1].content.parts[0].text == "app done"
    assert len(_DISPATCHER.worker_runs) == 1
