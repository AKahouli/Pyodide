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
    child_execution_id,
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
        helper._prepare_agent_data = lambda agent, user_request, team, **kwargs: {
            "name": agent.get("name", "candidate"),
            "id": agent.get("id", ""),
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
    assert len(exec_trace["execution_id"]) == 24
    assert int(exec_trace["execution_id"], 16) >= 0
    assert exec_trace["producer_role"] == _pb.EXECUTION_ROLE_LIBRARY_WORKER


def test_distinct_native_calls_do_not_merge_identical_tasks():
    from src.root_runtime.dispatcher import DelegateToAgentRequest  # noqa: F401 — schema import surface
    team1, _, d1 = _build(_FakeTeam({}))
    team2, _, d2 = _build(_FakeTeam({}))
    # Identical task text in distinct native calls must stay separate.
    root1 = LlmAgent(name="root_agent", model=_Scripted("r", [
        _fc("delegate_to_agent", {"agent_id": "a1", "task": "Same"}), _echo_last_function_response("")]), tools=[d1])
    root2 = LlmAgent(name="root_agent", model=_Scripted("r", [
        _fc("delegate_to_agent", {"agent_id": "a1", "task": "Same"}), _echo_last_function_response("")]), tools=[d2])
    e1, _ = _drive(root1, "s4", "go")
    e2, _ = _drive(root2, "s5", "go")
    f1 = e1[[i for i, e in enumerate(e1) if e.is_final_response()][-1]].content.parts[0].text
    f2 = e2[[i for i, e in enumerate(e2) if e.is_final_response()][-1]].content.parts[0].text
    assert f1 != f2 and "execution_id" in f1


def test_native_branch_identity_is_stable_on_replay():
    branch = "delegate_to_agent@native-call"
    assert child_execution_id("root", branch) == child_execution_id("root", branch)
    assert child_execution_id("root", branch) != child_execution_id("root", "delegate_to_agent@another-call")
    with pytest.raises(ValueError):
        child_execution_id("root", "")


@pytest.mark.asyncio
async def test_worker_compilation_does_not_inherit_root_context(monkeypatch):
    from types import SimpleNamespace
    from src.root_runtime.dispatcher import _compile_candidate
    from src.smart_rag.agents.core.helpers import AgentHelper
    from src.smart_rag.agents.factories.base_factory import AgentFactory

    root_config = SimpleNamespace(brain_ids=["root-space"], workspace_names=["root-space"],
        brain_documents=[{"id": "root-doc"}], chatbot_name="root-model",
        attachment_context="ROOT_ATTACHMENT", attached_images=[{"filename": "root.png"}],
        connector_repo={"repo_id": "root-repo"}, skills=[{"id": "root-skill"}])
    captured = {}

    class Factory:
        config = root_config
        chatbot_name = "root-model"
        _image_input = "root-image"
        agent_factory = AgentFactory(None, None)

        async def _create_agent_with_error_handling(self, *args):
            raise AssertionError("intercepted by compiler")

    async def compile_capture(data, name, normalized, scope, create, citations):
        captured.update(data=data, factory=create.__self__)
        return SimpleNamespace(agent="compiled")

    monkeypatch.setattr("src.root_runtime.dispatcher.compile_worker", compile_capture)
    team = _FakeTeam({})
    team.agent_helper = AgentHelper
    team.delegation_factory = Factory()
    team.delegation_factory.agent_factory.set_web_preview_tool_config({"instructions": "ROOT_PREVIEW"})
    candidate = {"id": "worker", "name": "worker", "prompt": "own prompt", "tools": [],
        "brain_ids": ["own-space"], "brain_documents": [{"id": "own-doc"}],
        "chatbot_name": "own-model"}
    request = SimpleNamespace(brain_documents=[{"id": "root-doc"}],
        attachment_context="ROOT_ATTACHMENT")
    assert await _compile_candidate(team, request, candidate, None) == "compiled"
    assert captured["data"]["brain_documents"] == [{"id": "own-doc"}]
    assert captured["data"]["prompt"] == "own prompt"
    isolated = captured["factory"]
    assert isolated.config.brain_ids == ["own-space"]
    assert isolated.chatbot_name == "own-model"
    assert isolated.config.attachment_context is None
    assert isolated.config.connector_repo is None and isolated.config.skills is None
    assert isolated._image_input is None and isolated.config.attached_images is None
    isolated.agent_factory.set_web_preview_tool_config({"prompt": "OWN_PREVIEW"})
    assert "ROOT_PREVIEW" not in isolated.agent_factory.web_preview_tool_config.values()
    assert team.delegation_factory.agent_factory.web_preview_tool_config["instructions"] == "ROOT_PREVIEW"
    assert team.delegation_factory.agent_factory.web_preview_tool_config["prompt"] == ""
    assert root_config.brain_ids == ["root-space"]
    assert root_config.attachment_context == "ROOT_ATTACHMENT"


def test_distinct_calls_compile_separate_scoped_children():
    team, _, dispatcher = _build(_FakeTeam({"a1": [_text("RESULT")]}))
    queue = asyncio.Queue()
    team.current_queue = queue
    arguments = {"agent_id": "a1", "task": "Same task"}
    root = LlmAgent(name="root_agent", model=_Scripted("root", [
        _fc("delegate_to_agent", arguments), _fc("delegate_to_agent", arguments),
        _echo_last_function_response("done: "),
    ]), tools=[dispatcher])
    _, chunks = _drive(root, "separate-scopes", "go", queue)
    from src.grpc_generated import chatbot_pb2 as pb
    starts = [chunk["execution_trace"]["execution_id"] for chunk in chunks
              if chunk.get("execution_trace", {}).get("lifecycle") == pb.INVOCATION_LIFECYCLE_STATE_STARTED]
    assert len(starts) == len(set(starts)) == 2
    assert team.compiled_names == ["a1", "a1"]


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


def test_worker_native_model_receives_task_packet_without_root_history():
    team = _FakeTeam({'a1': [_text('worker done')]})
    original_factory = team.delegation_factory._create_agent_with_error_handling
    models = []

    async def capture_factory(*args):
        agent, toolkit = await original_factory(*args)
        models.append(agent.model)
        return agent, toolkit

    team.delegation_factory._create_agent_with_error_handling = capture_factory
    team, request, tool = _build(team)
    root = LlmAgent(name='root_agent', model=_Scripted('root', [
        _fc('delegate_to_agent', {'agent_id': 'a1', 'task': 'WORKER_PACKET_ONLY'}), _text('done'),
    ]), tools=[tool])
    _drive(root, 'isolated-child', 'ROOT_PRIVATE_HISTORY_MUST_NOT_LEAK')
    assert models and models[0].requests
    contents = str(models[0].requests[0].contents)
    assert 'WORKER_PACKET_ONLY' in contents
    assert 'ROOT_PRIVATE_HISTORY_MUST_NOT_LEAK' not in contents


def test_temporary_tool_is_optional_root_only_and_works_without_library_catalog(monkeypatch):
    from src.root_runtime import delegate_resolver
    from src.grpc_generated import chatbot_pb2 as pb
    scope = ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id='1' * 24)
    context = {'root_agent_id': 'root-1', 'temporary_workers_enabled': True, 'catalog': [], 'max_depth': 1}
    team, request, _ = _build(_FakeTeam({}))
    team.current_queue = asyncio.Queue()
    admitted, settled = [], []

    async def resolve(current, call_id, branch, task, expected, refs):
        execution_id = child_execution_id(current.execution_id, branch)
        admitted.append((execution_id, branch))
        team.scripted_children[execution_id] = [_text('TEMPORARY_RESULT')]
        return {'executionId': execution_id, 'candidate': _Candidate(execution_id, 'Temporary worker')}

    async def settle(current, child_id, status, text=None, evidence=None):
        settled.append((child_id, status, text))
        return {'status': status}

    monkeypatch.setattr(delegate_resolver, 'resolve_temporary_definition', resolve)
    monkeypatch.setattr(delegate_resolver, 'settle_delegate', settle)
    tool = build_delegate_dispatcher(team, request, context, [], root_scope=scope, temporary=True)
    assert tool.name == 'spawn_temporary_worker'
    assert 'agent_id' not in tool._get_declaration().parameters_json_schema['properties']
    root = LlmAgent(name='root_agent', model=_Scripted('root', [
        _fc('spawn_temporary_worker', {'task': 'focused task'}), _echo_last_function_response('result: '),
    ]), tools=[tool])
    events, chunks = _drive(root, 'temporary-empty-pool', 'go', team.current_queue)
    assert admitted and 'spawn_temporary_worker@' in admitted[0][1]
    assert settled == [(admitted[0][0], 'completed', 'TEMPORARY_RESULT')]
    assert team.compiled_names == [admitted[0][0]]
    assert any(event.content and any(part.text and 'TEMPORARY_RESULT' in part.text for part in event.content.parts or []) for event in events)
    assert any(chunk['execution_trace']['producer_role'] == pb.EXECUTION_ROLE_TEMPORARY_WORKER for chunk in chunks)
    assert build_delegate_dispatcher(team, request, {**context, 'temporary_workers_enabled': False}, [],
        root_scope=scope, temporary=True) is None
    with pytest.raises(ValueError, match='depth-zero ROOT'):
        build_delegate_dispatcher(team, request, context, [], root_scope=ExecutionScopeV1(
            role=ExecutionRole.TEMPORARY_WORKER, execution_id='child', depth=1), temporary=True)


def test_enabled_temporary_tool_does_not_force_a_worker_for_simple_answers():
    scope = ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id='1' * 24)
    team, request, _ = _build(_FakeTeam({}))
    tool = build_delegate_dispatcher(team, request, {'root_agent_id': 'root-1',
        'temporary_workers_enabled': True}, [], root_scope=scope, temporary=True)
    root = LlmAgent(name='root_agent', model=_Scripted('root', [_text('DIRECT_OK')]), tools=[tool])
    events, _ = _drive(root, 'temporary-direct', 'simple question')
    assert team.compiled_names == []
    assert any(event.content and any(part.text == 'DIRECT_OK' for part in event.content.parts or []) for event in events)


def test_lazy_bridge_revalidates_before_native_workflow_cache_and_persists_result(monkeypatch):
    from src.root_runtime import delegate_resolver
    from src.root_runtime.dispatcher import child_execution_id
    calls, settled = [], []
    team, request, _ = _build(_FakeTeam({"a1": [_text("worker result")]}))
    context = {**_ROOT_CONTEXT, "delegate_definition_mode": "lazy"}

    async def resolve(scope, call_id, branch, agent_id, task, expected, refs):
        calls.append((call_id, branch))
        return {"executionId": child_execution_id(scope.execution_id, branch),
                "candidate": _Candidate(agent_id, "Worker")}

    async def settle(scope, child_id, status, text=None, evidence=None):
        settled.append((child_id, status, text))
        return {"status": status}

    monkeypatch.setattr(delegate_resolver, "resolve_delegate_definition", resolve)
    monkeypatch.setattr(delegate_resolver, "settle_delegate", settle)
    # Keep the same native call ID across two public tool invocations. SDK
    # node replay may reuse output, but the bridge must still authorize twice.
    part = _fc("delegate_to_agent", {"agent_id": "a1", "task": "bounded"})
    scope = ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id="1" * 24)
    tool = build_delegate_dispatcher(team, request, context, [], root_scope=scope)
    root = LlmAgent(name="root_agent", model=_Scripted("root", [part, part, _text("done")]), tools=[tool])
    events, _ = _drive(root, "lazy-call", "go")
    assert len(calls) == 2
    assert calls[0] == calls[1]
    assert settled and settled[0][1:] == ("completed", "worker result")
    assert any(event.content and any(part.text == "done" for part in event.content.parts or []) for event in events)


def test_completion_persistence_failure_is_not_reported_as_success(monkeypatch):
    from src.root_runtime import delegate_resolver

    team, request, _ = _build(_FakeTeam({"a1": [_text("worker result")]}))
    statuses = []
    scope = ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id="1" * 24)

    async def resolve(scope, call_id, branch, agent_id, task, expected, refs):
        return {"executionId": child_execution_id(scope.execution_id, branch),
                "candidate": _Candidate(agent_id, "Worker")}

    async def settle(scope, child_id, status, text=None, evidence=None):
        statuses.append(status)
        if status == "completed":
            raise RuntimeError("injected lost completion acknowledgement")
        return {"status": status}

    monkeypatch.setattr(delegate_resolver, "resolve_delegate_definition", resolve)
    monkeypatch.setattr(delegate_resolver, "settle_delegate", settle)
    tool = build_delegate_dispatcher(team, request, {**_ROOT_CONTEXT, "delegate_definition_mode": "lazy"},
                                     [], root_scope=scope)
    root = LlmAgent(name="root_agent", model=_Scripted("root", [
        _fc("delegate_to_agent", {"agent_id": "a1", "task": "bounded"}),
        _echo_last_function_response("result: "),
    ]), tools=[tool])
    events, _ = _drive(root, "lost-ack", "go")
    final = [event for event in events if event.is_final_response()][-1].content.parts[0].text
    assert statuses == ["completed", "outcome_unknown"]
    assert "outcome_unknown" in final and "Do not repeat actions" in final


def test_production_bridge_parks_and_resumes_child(monkeypatch):
    from google.adk.agents.context import Context
    from google.adk.apps import App
    from google.adk.apps._configs import ResumabilityConfig
    from google.adk.events.request_input import RequestInput
    from google.adk.workflow import FunctionNode
    from google.adk.workflow.utils._workflow_hitl_utils import (
        create_request_input_response, get_request_input_interrupt_ids,
    )
    from src.grpc_generated import chatbot_pb2 as pb

    branches = []

    async def worker(ctx: Context):
        branches.append(ctx.branch)
        if len(branches) == 1:
            return RequestInput(interrupt_id="ask", message="need input")
        return {"answer": "used"}

    node = FunctionNode(func=worker, name="parking", rerun_on_resume=True)

    async def compile_candidate(*args):
        return node

    monkeypatch.setattr("src.root_runtime.dispatcher._compile_candidate", compile_candidate)
    team, _, tool = _build(_FakeTeam({}))
    team.current_queue = asyncio.Queue()
    root = LlmAgent(name="root_agent", model=_Scripted("root", [
        _fc("delegate_to_agent", {"agent_id": "a1", "task": "T"}), _text("answered"),
    ]), tools=[tool])

    def answered(events):
        return any(event.content and any(part.text == "answered"
                   for part in event.content.parts or []) for event in events)

    async def go():
        sessions = InMemorySessionService()
        runner = Runner(app=App(name=APP, root_agent=root,
            resumability_config=ResumabilityConfig(is_resumable=True)), session_service=sessions)
        await sessions.create_session(app_name=APP, user_id="u", session_id="resume-child")
        first = [event async for event in runner.run_async(user_id="u", session_id="resume-child",
            new_message=types.Content(role="user", parts=[_text("go")]))]
        pending = [input_id for event in first for input_id in get_request_input_interrupt_ids(event)]
        assert pending and not answered(first)
        first_chunks = []
        while not team.current_queue.empty():
            first_chunks.append(team.current_queue.get_nowait()["execution_trace"])
        assert any(trace["lifecycle"] == pb.INVOCATION_LIFECYCLE_STATE_WAITING for trace in first_chunks)
        assert not any(trace["lifecycle"] == pb.INVOCATION_LIFECYCLE_STATE_FAILED for trace in first_chunks)
        second = [event async for event in runner.run_async(user_id="u", session_id="resume-child",
            invocation_id=first[0].invocation_id,
            new_message=types.Content(role="user", parts=[create_request_input_response(pending[0], {"value": "42"})]))]
        assert len(branches) == 2 and branches[0] == branches[1]
        assert answered(second)
        completed = []
        while not team.current_queue.empty():
            completed.append(team.current_queue.get_nowait()["execution_trace"])
        assert any(trace["lifecycle"] == pb.INVOCATION_LIFECYCLE_STATE_COMPLETED for trace in completed)
        assert {trace["execution_id"] for trace in first_chunks + completed} == {first_chunks[0]["execution_id"]}

    asyncio.run(go())


@pytest.mark.parametrize('both_wait,durable', [(False, False), (True, False), (False, True)])
def test_fanout_native_wait_resumes_fresh_runner_without_repeating_completed_item(monkeypatch, tmp_path, both_wait, durable):
    import hashlib
    import time
    from google.adk.agents.context import Context
    from google.adk.apps import App
    from google.adk.apps._configs import ResumabilityConfig
    from google.adk.events.request_input import RequestInput
    from google.adk.workflow import FunctionNode
    from google.adk.sessions import DatabaseSessionService
    from google.adk.workflow.utils._workflow_hitl_utils import create_request_input_response, get_request_input_interrupt_ids
    from src.root_runtime.fanout import build_fanout_dispatcher
    from src.root_runtime import delegate_resolver

    scope = ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id='a' * 24,
        immutable_snapshot_ref='root-snapshot', deadline_epoch_ms=int(time.time() * 1000) + 60000)
    request = _Request([]); request.execution_scope = scope
    team = _FakeTeam({}); team.current_queue = asyncio.Queue()
    manifest_items = {}; terminal = {}; counts = {}; branches = {}; permit_calls = []

    async def manifest_post(_scope, path, payload):
        assert path == 'fanout-manifest'
        manifest_id = hashlib.sha256(f'{scope.execution_id}:{payload["nativeCallBranch"]}'.encode()).hexdigest()[:24]
        items = []
        for item in payload['items']:
            native_id = 'item_' + hashlib.sha256(f'{manifest_id}:{item["key"]}'.encode()).hexdigest()
            branch = f'{payload["nativeCallBranch"]}.{native_id}.delegate_to_agent@{native_id}'
            execution_id = child_execution_id(scope.execution_id, branch)
            value = {**item, 'nativeRunId': native_id, 'nativeCallBranch': branch, 'executionId': execution_id}
            items.append(value); manifest_items[execution_id] = value
        return {**payload, 'manifestId': manifest_id, 'items': items}

    async def resolve(_scope, call_id, branch, agent_id, task, expected, refs):
        execution_id = child_execution_id(scope.execution_id, branch)
        item = manifest_items[execution_id]
        assert call_id == item['nativeRunId'] and task == item['task']
        return {'executionId': execution_id, 'candidate': _Candidate(agent_id, 'Leaf'),
            **({'result': terminal[execution_id]} if execution_id in terminal else {})}

    async def settle(_scope, execution_id, status, text=None, evidence=None):
        if status == 'completed':
            terminal[execution_id] = {'status': status, 'text': text, 'fullText': text}
        return {'status': status}

    async def permit_post(_scope, path, payload):
        permit_calls.append((path, payload['operation'], payload['owner']))
        return {'acquired': True}

    async def compile_candidate(team, request, candidate, child_scope):
        item = manifest_items[child_scope.execution_id]; key = item['key']
        async def worker(ctx: Context):
            counts[key] = counts.get(key, 0) + 1
            branches.setdefault(key, []).append(ctx.branch)
            if (both_wait or key == 'waiting') and counts[key] == 1:
                return RequestInput(interrupt_id=f'item_input_{key}', message='Choose a value')
            return f'result_{key}'
        return FunctionNode(func=worker, name=f'leaf_{key}', rerun_on_resume=True)

    monkeypatch.setattr('src.root_runtime.fanout._post', manifest_post)
    monkeypatch.setattr('src.root_runtime.worker_permits._post', permit_post)
    monkeypatch.setattr(delegate_resolver, 'resolve_delegate_definition', resolve)
    monkeypatch.setattr(delegate_resolver, 'settle_delegate', settle)
    monkeypatch.setattr('src.root_runtime.dispatcher._compile_candidate', compile_candidate)
    context = {**_ROOT_CONTEXT, 'fanout_enabled': True, 'max_fanout_items': 3,
        'max_parallel_workers': 2, 'worker_permit_version': 1, 'delegate_definition_mode': 'lazy'}
    tool = build_fanout_dispatcher(team, request, context, scope)
    model = _Scripted('fanout-root', [_fc('run_fanout', {'worker_type': 'library', 'agent_id': 'a1',
        'items': [{'key': 'completed', 'task': 'First'}, {'key': 'waiting', 'task': 'Second'}]}), _text('fanout_answered')])
    root = LlmAgent(name='fanout_root', model=model, tools=[tool])

    async def go():
        database_url = f"sqlite+aiosqlite:///{(tmp_path / 'fanout-session.db').as_posix()}"
        sessions = DatabaseSessionService(db_url=database_url) if durable else InMemorySessionService()
        await sessions.create_session(app_name=APP, user_id='u', session_id='fanout-resume')
        def fresh_runner():
            return Runner(app=App(name=APP, root_agent=root,
                resumability_config=ResumabilityConfig(is_resumable=True)), session_service=sessions)
        first = [event async for event in fresh_runner().run_async(user_id='u', session_id='fanout-resume',
            new_message=types.Content(role='user', parts=[_text('go')]))]
        pending = [identity for event in first for identity in get_request_input_interrupt_ids(event)]
        assert len(pending) == (2 if both_wait else 1) and counts == {'completed': 1, 'waiting': 1}
        assert len(terminal) == (0 if both_wait else 1)
        if durable:
            await sessions.close()
            sessions = DatabaseSessionService(db_url=database_url)
        second = [event async for event in fresh_runner().run_async(user_id='u', session_id='fanout-resume',
            invocation_id=first[0].invocation_id, new_message=types.Content(role='user',
                parts=[create_request_input_response(identity, {'value': 'blue'}) for identity in pending]))]
        assert counts == {'completed': 2 if both_wait else 1, 'waiting': 2} and len(terminal) == 2
        assert branches['waiting'][0] == branches['waiting'][1]
        assert branches['completed'][0] != branches['waiting'][0]
        assert any(event.content and any(part.text == 'fanout_answered' for part in event.content.parts or []) for event in second)
        assert sum(operation == 'acquire' for _, operation, _ in permit_calls) == (4 if both_wait else 3)
        assert sum(operation == 'release' for _, operation, _ in permit_calls) == (4 if both_wait else 3)
        if durable:
            await sessions.close()

    asyncio.run(go())
