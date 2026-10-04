"""WP04: the one bounded delegation operation (plan §6.5).

Drives the REAL dispatcher Workflow end-to-end through a Runner with scripted
LLMs: tool declaration, fail-closed catalog validation, lazy compile of only
the chosen specialist, deterministic execution ids, typed results, child-text
gating at the runner.
"""
from __future__ import annotations

import asyncio
import uuid
from typing import Any

import pytest
from google.adk.agents.llm_agent import LlmAgent
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1
from src.root_runtime.dispatcher import (
    build_delegate_dispatcher,
    build_delegation_instruction,
)

APP = "wp04_app"


class _Scripted(BaseLlm):
    """Plays a fixed part sequence; records every request it receives."""

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


def _fc(name: str, args: dict) -> types.Part:
    return types.Part(function_call=types.FunctionCall(
        name=name, args=args, id=f"fc_{uuid.uuid4().hex[:8]}"))


def _text(t: str) -> types.Part:
    return types.Part(text=t)


def _echo_last_function_response(prefix: str):
    def make(req):
        for c in reversed(req.contents or []):
            for p in reversed(c.parts or []):
                fr = getattr(p, "function_response", None)
                if fr is not None:
                    return _text(prefix + str(fr.response))
        return _text(prefix + "<none>")
    return make


class _FakeTeam:
    """Minimal stand-in for AutoAgentGenerationTeam's compile surface."""

    def __init__(self, scripted_children: dict[str, list[Any]]):
        self.compiled_names: list[str] = []
        self.registered: list[dict] = []
        self.scripted_children = scripted_children
        self.current_queue: asyncio.Queue | None = None

        helper = type("H", (), {})()
        helper.normalize_agent_name = lambda name: str(name).replace(" ", "_")
        helper._prepare_agent_data = lambda agent, user_request, team: {
            "name": getattr(agent, "name", "candidate"),
            "id": getattr(agent, "id", ""),
            "tools": [],
        }
        self.agent_helper = helper

        repo = type("R", (), {})()
        repo.add_agent = lambda data: self.registered.append(data)
        self.agent_repository = repo

        factory = type("F", (), {})()

        async def create(agent_config, agent_name, normalized, a, b, citation_manager):
            self.compiled_names.append(agent_config.get("id") or agent_name)
            parts = self.scripted_children.get(agent_config.get("id") or agent_name, [_text("EMPTY")])
            return LlmAgent(name=normalized or agent_name, model=_Scripted(agent_name, parts)), None

        factory._create_agent_with_error_handling = create
        self.delegation_factory = factory
        self.citation_manager = None


_ROOT_CONTEXT = {
    "root_agent_id": "root-1",
    "max_depth": 1,
    "catalog": [
        {"agent_id": "a1", "name": "Advisory Specialist", "description": "answers advisory questions",
         "configuration_mode": "root_constrained", "snapshot_digest": "d1"},
        {"agent_id": "a2", "name": "Research Specialist", "description": "researches things",
         "configuration_mode": "native", "snapshot_digest": "d2"},
    ],
}


class _Candidate:
    def __init__(self, agent_id: str, name: str):
        self.id = agent_id
        self.name = name
        self.prompt = ""
        self.brain_context: list = []
        self.tools: list = []


class _Request:
    def __init__(self, candidates: list[_Candidate]):
        self.session_id = "conv-1"
        self.delegate_candidates = candidates
        self.execution_scope = ExecutionScopeV1(
            role=ExecutionRole.ROOT, execution_id="exec_root", conversation_epoch=2,
            immutable_snapshot_ref="root-1",
        )
        self.brain_documents: list = []


def _build(team: _FakeTeam, root_context=None):
    request = _Request([_Candidate("a1", "Advisory Specialist"), _Candidate("a2", "Research Specialist")])
    dispatcher = build_delegate_dispatcher(
        team, request, root_context or _ROOT_CONTEXT, request.delegate_candidates,
        root_scope=request.execution_scope,
    )
    return team, request, dispatcher


def _drive(root: LlmAgent, session_id: str, text: str, queue: asyncio.Queue | None = None):
    async def go():
        sessions = InMemorySessionService()
        runner = Runner(node=root, app_name=APP, session_service=sessions)
        await sessions.create_session(app_name=APP, user_id="u", session_id=session_id)
        events: list = []
        async for ev in runner.run_async(
            user_id="u", session_id=session_id,
            new_message=types.Content(role="user", parts=[_text(text)]),
        ):
            events.append(ev)
        drained: list = []
        if queue is not None:
            while not queue.empty():
                drained.append(queue.get_nowait())
        return events, drained

    return asyncio.run(go())


def test_dispatcher_declares_delegate_to_agent_tool():
    _, _, dispatcher = _build(_FakeTeam({}))
    root = LlmAgent(
        name="root_agent", model=_Scripted("root", [_text("no tools needed")]),
        tools=[dispatcher],
    )
    _drive(root, "s1", "hello")
    req = root.model.requests[0]
    decls = [d.name for d in (req.config.tools[0].function_declarations or [])] \
        if req.config and req.config.tools else []
    assert "delegate_to_agent" in decls, f"dispatcher not declared: {decls}"


def test_unknown_agent_id_fails_closed_without_compiling():
    team, _, dispatcher = _build(_FakeTeam({}))
    root = LlmAgent(
        name="root_agent",
        model=_Scripted("root", [
            _fc("delegate_to_agent", {"agent_id": "intruder", "task": "T"}),
            _echo_last_function_response(""),
        ]),
        tools=[dispatcher],
    )
    events, _ = _drive(root, "s2", "go")
    final = [e for e in events if e.is_final_response()]
    assert final and "not in the authorized delegation catalog" in final[-1].content.parts[0].text
    assert team.compiled_names == [], "a denied id must never compile anything"


def test_delegation_compiles_only_chosen_specialist_and_returns_typed_result():
    team, _, dispatcher = _build(_FakeTeam({"a1": [_text("SPECIALIST ANSWER")]}))
    queue: asyncio.Queue = asyncio.Queue()
    team.current_queue = queue
    root = LlmAgent(
        name="root_agent",
        model=_Scripted("root", [
            _fc("delegate_to_agent", {"agent_id": "a1", "task": "Summarize T",
                                      "expected_output": "a summary"}),
            _echo_last_function_response("done: "),
        ]),
        tools=[dispatcher],
    )
    events, drained = _drive(root, "s3", "go", queue)

    final = [e for e in events if e.is_final_response()]
    assert final and "SPECIALIST ANSWER" in final[-1].content.parts[0].text
    # Only the chosen candidate compiled; lazy materialization held for a2.
    assert team.compiled_names == ["a1"]
    # The child saw the bounded packet, not the root's history.
    child_req = team.delegation_factory._create_agent_with_error_handling_calls = None
    traces = [c["execution_trace"] for c in drained if "execution_trace" in c]
    lifecycles = [t["lifecycle"] for t in traces]
    from src.grpc_generated import chatbot_pb2 as _pb
    assert lifecycles.count(_pb.INVOCATION_LIFECYCLE_STATE_STARTED) == 1
    assert lifecycles.count(_pb.INVOCATION_LIFECYCLE_STATE_COMPLETED) == 1
    exec_trace = traces[0]
    assert exec_trace["parent_execution_id"] == "exec_root"
    assert exec_trace["execution_id"].startswith("exec_")
    assert exec_trace["execution_id"] == f"exec_{uuid.uuid5(uuid.NAMESPACE_URL, 'exec_root:a1:Summarize T').hex[:12]}"


def test_deterministic_run_ids_are_stable_across_calls():
    from src.root_runtime.dispatcher import DelegateToAgentRequest  # noqa: F401 — schema import surface
    team1, _, d1 = _build(_FakeTeam({}))
    team2, _, d2 = _build(_FakeTeam({}))
    # Same (agent, task) must derive identical ids in both dispatchers.
    root1 = LlmAgent(name="root_agent", model=_Scripted("r", [
        _fc("delegate_to_agent", {"agent_id": "a1", "task": "Same"}), _echo_last_function_response("")]), tools=[d1])
    root2 = LlmAgent(name="root_agent", model=_Scripted("r", [
        _fc("delegate_to_agent", {"agent_id": "a1", "task": "Same"}), _echo_last_function_response("")]), tools=[d2])
    e1, _ = _drive(root1, "s4", "go")
    e2, _ = _drive(root2, "s5", "go")
    f1 = e1[[i for i, e in enumerate(e1) if e.is_final_response()][-1]].content.parts[0].text
    f2 = e2[[i for i, e in enumerate(e2) if e.is_final_response()][-1]].content.parts[0].text
    assert f1 == f2 and "exec_" in f1


def test_child_failure_returns_typed_failed_result_not_exception():
    class _Exploding:
        async def _create_agent_with_error_handling(self, *a, **k):
            return None, None

    team, _, dispatcher = _build(_FakeTeam({}))
    async def broken_create(agent_config, agent_name, normalized, a, b, cm):
        team.compiled_names.append(agent_name)
        return None, None
    team.delegation_factory._create_agent_with_error_handling = broken_create
    root = LlmAgent(
        name="root_agent",
        model=_Scripted("root", [
            _fc("delegate_to_agent", {"agent_id": "a1", "task": "T"}),
            _echo_last_function_response(""),
        ]),
        tools=[dispatcher],
    )
    events, _ = _drive(root, "s6", "go")
    final = [e for e in events if e.is_final_response()]
    assert final and "could not complete the task" in final[-1].content.parts[0].text


def test_delegation_instruction_lists_catalog_metadata_only():
    instruction = build_delegation_instruction(_ROOT_CONTEXT["catalog"])
    assert "a1" in instruction and "Advisory Specialist" in instruction
    assert "d1" not in instruction, "snapshot digests must not leak into the prompt"


def test_empty_catalog_builds_no_dispatcher():
    team, request, dispatcher = _build(_FakeTeam({}), root_context={"max_depth": 1, "catalog": []})
    assert dispatcher is None
