import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from google.adk.events import Event
from google.adk.events.event_actions import EventActions
from google.genai import types
from google.protobuf import json_format

from src.grpc_generated import chatbot_pb2
from src.grpc_server.chatbot_servicer import ChatbotServicer
from src.grpc_server.background_rpc import BackgroundRpc
from src.root_runtime.background_host import BackgroundInvocationHost, event_proposal
from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1, InvocationLifecycleState
from src.root_runtime.invocation import NativeInvocationProjection
from tests.wp07.test_background_sessions import guarded_native, initial_event


@pytest.mark.asyncio
async def test_disabled_rpc_capability_never_initializes_database_or_host(monkeypatch):
    settings = SimpleNamespace(ROOT_WORK_BACKGROUND_ENABLED=False, ROOT_WORK_DATABASE_URL='postgresql://unused',
        INTERNAL_SERVICE_SECRET='fixture-secret', GRPC_API_KEY='fixture-key')
    monkeypatch.setattr('src.grpc_server.background_rpc.get_settings', lambda: settings)
    rpc = BackgroundRpc(MagicMock(), MagicMock())
    capability = await rpc.capabilities()
    assert capability.background_protocol_version == 1 and not capability.background_ready
    assert rpc.host is None and not capability.control_database_fingerprint
    context = MagicMock()
    context.invocation_metadata.return_value = []
    context.abort = AsyncMock()
    assert [update async for update in rpc.run(chatbot_pb2.RootBackgroundInvocationRequest(), context)] == []
    context.abort.assert_awaited_once()
    assert rpc.host is None


@pytest.mark.asyncio
async def test_ordinary_rpc_converter_rejects_background_scope_before_file_context():
    servicer = ChatbotServicer(MagicMock())
    servicer._build_brain_and_file_context = AsyncMock()
    request = chatbot_pb2.RunSingleAgentRequest(execution_scope=chatbot_pb2.ExecutionScope(
        execution_role=chatbot_pb2.EXECUTION_ROLE_LIBRARY_WORKER, native_session_id='background_execution'))
    with pytest.raises(ValueError, match='dedicated background'):
        await servicer._convert_single_agent_request(request)
    servicer._build_brain_and_file_context.assert_not_awaited()


def test_public_proposals_reuse_shared_proto_conversion_and_usage_identity():
    converter = ChatbotServicer.__new__(ChatbotServicer)._dict_to_stream_chunk
    event = {'action': 'add', 'metadata': {}, 'component': {'id': 'tool', 'type': 'tool_activity',
        'data': {'tool_name': 'save', 'status': 'running', 'params_json': '{"private":"prompt"}'}}}
    proposal = event_proposal(event, converter)
    assert proposal['component']['tool_activity']['tool_name'] == 'save'
    assert event_proposal({'component': {'type': 'text', 'data': {'content': 'private'}}}, converter) is None
    usage = {'usage': {'input_tokens': 12, 'output_tokens': 3},
        'metadata': {'native_event_id': 'event', 'native_invocation_id': 'invocation'}}
    assert event_proposal(usage, converter)['eventId'] == event_proposal(usage, converter)['eventId']
    with pytest.raises(ValueError, match='persisted native event'):
        event_proposal({'usage': {'input_tokens': 12}}, converter)


@pytest.mark.asyncio
async def test_real_owned_host_detaches_observer_and_joins_sink_before_acknowledgement(guarded_native, monkeypatch):
    fixture_service, session, grant, engine = guarded_native
    control = await fixture_service.control_state()
    scope = ExecutionScopeV1(role=ExecutionRole.LIBRARY_WORKER, execution_id=grant.execution_id,
        parent_execution_id=control['parent_execution_id'], depth=1, expected_fence=str(grant.fence),
        native_session_id=grant.session_id)
    resolved = {'definition': {'id': 'worker-id', 'name': 'worker', 'description': 'worker',
        'prompt': 'bounded task', 'chatbot': {'model': 'test-model'}}, 'actorId': grant.actor_id,
        'request': {'task': 'bounded task', 'expectedOutput': '', 'contextRefs': []},
        'executionScope': json_format.MessageToDict(scope.to_proto(), preserving_proto_field_name=True)}
    started, release = asyncio.Event(), asyncio.Event()
    calls, durable = [], []

    async def post(_scope, path, payload):
        assert payload['nativeOwner'] == grant.native_owner
        if path == 'background-definition': return resolved
        if path == 'background-events':
            durable.extend(payload['events'])
            return {'events': [{'eventId': item['eventId'], 'sequence': str(len(durable))} for item in payload['events']]}
        assert path == 'background-lifecycle'
        assert durable[-1]['trace']['lifecycle'] == 'INVOCATION_LIFECYCLE_STATE_COMPLETED'
        assert payload['fullText'] == 'actual output' and payload['status'] == 'completed'
        calls.append('settled')
        return {'status': 'completed'}

    async def workflow(internal, queue):
        calls.append('runner')
        owned_service = internal.session_service
        await owned_service.append_event(session, initial_event())
        projection = NativeInvocationProjection(internal.execution_scope, grant.session_id, 'worker-id', invocation_id='native-invocation')
        await projection.emit(queue, InvocationLifecycleState.STARTED)
        started.set()
        await release.wait()
        await owned_service.append_event(session, Event(author='worker', invocation_id='native-invocation',
            content=types.Content(role='model', parts=[types.Part(text='actual output')])))
        await owned_service.append_event(session, Event(author='worker', invocation_id='native-invocation',
            actions=EventActions(end_of_agent=True)))
        await projection.emit(queue, InvocationLifecycleState.COMPLETED)
        await queue.put(None)
        return 'actual output'

    monkeypatch.setattr('src.root_runtime.background_host._post', post)
    converter = ChatbotServicer.__new__(ChatbotServicer)._dict_to_stream_chunk
    service = SimpleNamespace(process_team_request=AsyncMock(side_effect=workflow))
    host = BackgroundInvocationHost(engine, service, converter)
    host.native_owner = grant.native_owner
    request = chatbot_pb2.RootBackgroundInvocationRequest(protocol_version=1, execution_id=grant.execution_id,
        conversation_id=grant.conversation_id, actor_id=grant.actor_id, conversation_epoch=grant.epoch,
        owner=grant.owner, fence=grant.fence, request_digest=grant.request_digest)
    rpc = BackgroundRpc(service, converter)
    rpc.host = host
    rpc.capabilities = AsyncMock(return_value=chatbot_pb2.RootWorkCapabilitiesResponse(background_ready=True))
    monkeypatch.setattr('src.grpc_server.background_rpc.get_settings', lambda: SimpleNamespace(GRPC_API_KEY='fixture-key'))
    context = MagicMock()
    context.invocation_metadata.return_value = [('x-api-key', 'fixture-key')]
    stream = rpc.run(request, context)
    assert (await anext(stream)).status == 'running'
    await started.wait()
    await stream.aclose()
    handle = await host.start(request)
    assert calls == ['runner'] and not handle.task.done()
    release.set()
    await handle.task
    assert handle.status == 'completed' and calls == ['runner', 'settled']
