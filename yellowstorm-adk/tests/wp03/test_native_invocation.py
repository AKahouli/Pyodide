"""Trusted continuation never resends original user content."""
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from google.genai import types

from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1, InvocationLifecycleState
from src.root_runtime.invocation import NativeInvocationProjection, native_run_options


def resume_scope():
    return ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id="execution",
                            resume_intent="resume", native_session_id="session",
                            native_invocation_id="invocation")


def test_resume_submits_matching_response_without_original_prompt():
    original = types.Content(role="user", parts=[types.Part(text="original")])
    options = native_run_options(resume_scope(), original, [{
        "input_id": "input", "function_name": "adk_request_input", "response": {"answer": "yes"},
    }])
    assert options["invocation_id"] == "invocation"
    assert options["new_message"].parts[0].function_response.id == "input"
    assert options["new_message"].parts[0].text is None
    assert native_run_options(resume_scope(), original)["new_message"] is None


@pytest.mark.parametrize("responses", [
    [{"input_id": "input", "function_name": "arbitrary_tool"}],
    [{"input_id": "input", "function_name": "adk_request_input"}] * 2,
])
def test_resume_rejects_untrusted_response_identity(responses):
    with pytest.raises(ValueError):
        native_run_options(resume_scope(), None, responses)


@pytest.mark.asyncio
async def test_bootstrap_stop_retains_native_identity():
    queue = asyncio.Queue()
    abort = asyncio.Event()
    abort.set()
    projection = NativeInvocationProjection(resume_scope(), "session", "root")
    assert await projection.finish(queue, abort, False) == InvocationLifecycleState.CANCELLED
    trace = (await queue.get())["execution_trace"]
    assert trace["native_invocation_id"] == "invocation"


@pytest.mark.asyncio
async def test_partial_resume_preserves_other_pending_inputs():
    event = SimpleNamespace(invocation_id="invocation", content=types.Content(parts=[
        types.Part(function_call=types.FunctionCall(id="first", name="adk_request_input")),
        types.Part(function_call=types.FunctionCall(id="second", name="adk_request_confirmation")),
    ]))
    sessions = SimpleNamespace(get_session=AsyncMock(return_value=SimpleNamespace(events=[event])))
    projection = NativeInvocationProjection(resume_scope(), "session", "root")
    await projection.restore_pending(sessions, "user", [{"input_id": "first"}])
    queue = asyncio.Queue()
    assert await projection.finish(queue, None, True) == InvocationLifecycleState.WAITING
    trace = (await queue.get())["execution_trace"]
    assert trace["pending_inputs"] == [{"input_id": "second", "function_name": "adk_request_confirmation", "input_version": 1}]


@pytest.mark.asyncio
async def test_repeated_input_id_uses_distinct_versions_and_restores_them():
    def event(event_id, part):
        return SimpleNamespace(id=event_id, invocation_id="invocation", content=types.Content(parts=[part]))

    call = types.Part(function_call=types.FunctionCall(id="same", name="adk_request_input"))
    response = types.Part(function_response=types.FunctionResponse(id="same", name="adk_request_input", response={"value": "first"}))
    events = [event("first", call), event("response", response), event("second", call)]
    projection = NativeInvocationProjection(resume_scope(), "session", "root")
    queue = asyncio.Queue()
    for item in events:
        await projection.observe(item, queue)
    # A transport replay of the same native event does not invent a new version.
    await projection.observe(events[-1], queue)
    assert projection.input_details["same"]["input_version"] == 2
    restored = NativeInvocationProjection(resume_scope(), "session", "root")
    await restored.restore_pending(SimpleNamespace(get_session=AsyncMock(return_value=SimpleNamespace(events=events))), "user", [])
    assert restored.input_details["same"]["input_version"] == 2
    assert restored.pending == {"same": "adk_request_input"}


@pytest.mark.asyncio
async def test_pending_projection_drops_tool_arguments_and_schema_private_hints():
    projection = NativeInvocationProjection(resume_scope(), "session", "root")
    event = SimpleNamespace(invocation_id="invocation", id="event", content=types.Content(parts=[
        types.Part(function_call=types.FunctionCall(id="confirm", name="adk_request_confirmation", args={
            "originalFunctionCall": {"args": {"token": "private-token"}},
            "toolConfirmation": {"hint": "private-hint", "payload": "private-payload"},
        })),
        types.Part(function_call=types.FunctionCall(id="ask", name="adk_request_input", args={
            "message": "What value?", "payload": {"password": "private-password"},
            "response_schema": {"type": "object", "properties": {"value": {
                "type": "string", "default": "private-default", "description": "private-description",
            }}, "required": ["value"]},
        })),
    ]))
    queue = asyncio.Queue()
    await projection.observe(event, queue)
    traces = [queue.get_nowait()["execution_trace"] for _ in range(queue.qsize())]
    encoded = json.dumps(traces)
    assert "private-" not in encoded and "https://remote" not in encoded
    assert traces[-1]["pending_inputs"][0] == {"input_id": "confirm", "function_name": "adk_request_confirmation", "input_version": 1}
    assert json.loads(traces[-1]["pending_inputs"][1]["response_schema_json"]) == {
        "type": "object", "properties": {"value": {"type": "string"}}, "required": ["value"],
    }


@pytest.mark.parametrize("schema", [
    {"$ref": "https://remote"}, {"type": "string", "pattern": "(a+)+$"},
    {"type": ["string", "null"]}, {"type": "object", "required": None, "properties": {}},
    {"type": "string", "enum": [str(index) + "x" * 990 for index in range(20)]},
])
def test_unprojectable_schema_is_explicitly_blocked_not_downgraded_to_any(schema):
    projection = NativeInvocationProjection(resume_scope(), "session", "root")
    projection.capture_input_details(types.FunctionCall(id="input", name="adk_request_input", args={"response_schema": schema}))
    assert projection.input_details["input"]["response_schema_unsupported"] is True
    assert "response_schema_json" not in projection.input_details["input"]
    assert "response_schema_absent" not in projection.input_details["input"]


def test_pending_descriptor_roundtrips_through_the_generated_wire_contract():
    from src.grpc_generated import chatbot_pb2
    projection = NativeInvocationProjection(resume_scope(), "session", "root")
    projection.capture_input_details(types.FunctionCall(id="input", name="adk_request_input", args={"message": "Value?"}))
    wire = chatbot_pb2.NativePendingInput(input_id="input", function_name="adk_request_input",
        **projection.input_details["input"])
    restored = chatbot_pb2.NativePendingInput.FromString(wire.SerializeToString())
    assert restored.input_version == 1 and restored.response_schema_absent
    assert restored.message == "Value?" and not restored.response_schema_unsupported


@pytest.mark.asyncio
@pytest.mark.parametrize("schema,value", [
    ({"type": "boolean"}, False), ({"type": "number"}, 42),
    ({"type": "array", "items": {"type": "string"}}, ["one"]),
    ({"type": "string"}, "true"), ({"type": "string"}, "123"), ({"type": "string"}, "null"),
    ({"type": "object", "properties": {"value": {"type": "string"}}}, {"value": "answer"}),
    ({"type": "object", "properties": {"result": {"type": "string"}}}, {"result": "answer"}),
])
async def test_pinned_native_scalar_envelope_survives_real_resume(schema, value):
    from google.adk.agents.context import Context
    from google.adk.apps import App
    from google.adk.apps.app import ResumabilityConfig
    from google.adk.events.request_input import RequestInput
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.adk.workflow import FunctionNode

    resumed = []

    async def ask(ctx: Context):
        if "input" not in ctx.resume_inputs:
            return RequestInput(interrupt_id="input", message="Value?", response_schema=schema)
        resumed.append(ctx.resume_inputs["input"])
        return "completed"

    sessions = InMemorySessionService()
    runner = Runner(app=App(name="input_test", root_agent=FunctionNode(func=ask, name="ask", rerun_on_resume=True),
        resumability_config=ResumabilityConfig(is_resumable=True)), session_service=sessions)
    await sessions.create_session(app_name="input_test", user_id="user", session_id="session")
    first = [event async for event in runner.run_async(user_id="user", session_id="session",
        new_message=types.Content(role="user", parts=[types.Part(text="go")]))]
    response = value if isinstance(value, dict) else {"result": json.dumps(value) if isinstance(value, str) else value}
    if isinstance(value, dict) and set(value) == {"result"}:
        response = {"result": value}
    second = [event async for event in runner.run_async(user_id="user", session_id="session",
        invocation_id=first[0].invocation_id, new_message=types.Content(role="user", parts=[
            types.Part(function_response=types.FunctionResponse(id="input", name="adk_request_input", response=response)),
        ]))]
    assert second and resumed == [value]


def test_root_control_profile_survives_grpc_wire():
    from google.protobuf.json_format import MessageToDict, ParseDict
    from src.grpc_generated import chatbot_pb2

    context = ParseDict({"root_agent_id": "root", "delegate_definition_mode": "lazy",
        "native_input_control_version": 1, 'temporary_workers_enabled': True,
        'max_temporary_workers': 4}, chatbot_pb2.RootExecutionContext())
    restored = chatbot_pb2.RootExecutionContext.FromString(context.SerializeToString())
    projected = MessageToDict(restored, preserving_proto_field_name=True)
    assert projected["native_input_control_version"] == 1
    assert projected["delegate_definition_mode"] == "lazy"
    assert projected['temporary_workers_enabled'] is True
    assert projected['max_temporary_workers'] == 4
    assert chatbot_pb2.RootExecutionContext().native_input_control_version == 0
