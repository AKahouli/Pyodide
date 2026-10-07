import hashlib
import json
import asyncio
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from google.adk.apps import App
from google.adk.apps.app import ResumabilityConfig
from google.adk.runners import Runner
from google.adk.workflow import FunctionNode, START, Workflow
from google.genai import types
from sqlalchemy import text

from src.root_runtime.background_actions import BackgroundActionLedger, BackgroundActionUnknown
from src.root_runtime.background_items import validate_item
from src.root_runtime.background_sessions import FencedBackgroundSessionService, BackgroundOwnershipError
from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1
from tests.wp07.test_background_sessions import guarded_native


@pytest.fixture
async def owned_items(guarded_native):
    original, session, grant, engine = guarded_native
    hash_value = lambda value: hashlib.sha256(value.encode()).hexdigest()
    canonical = lambda value: json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    control = await original.control_state()
    root_id = control['parent_execution_id']
    proposal = {'version': 1, 'mode': 'background', 'nativeCallId': 'fanout', 'nativeCallBranch': 'run_fanout@fanout',
        'target': {'kind': 'library', 'agentId': grant.actor_id}, 'items': [
            {'key': key, 'task': 'Bounded ' + key, 'contextRefs': []} for key in ('first', 'second')]}
    manifest_id = hash_value(f"{root_id}:{proposal['nativeCallBranch']}")[:24]
    digest = hash_value(canonical(proposal))
    grant = replace(grant, request_digest=digest)
    service = FencedBackgroundSessionService(grant, db_engine=engine)
    scopes = []
    manifest = {**proposal, 'manifestId': manifest_id, 'digest': digest, 'items': []}
    for item in proposal['items']:
        native_id = 'item_' + hash_value(f"{manifest_id}:{item['key']}")
        branch = f"{proposal['nativeCallBranch']}.{native_id}.delegate_to_agent@{native_id}"
        execution_id = hash_value(f'{root_id}:{branch}')[:24]
        request = {'task': item['task'], 'expectedOutput': '', 'contextRefs': [], 'agentId': grant.actor_id}
        manifest['items'].append({**item, 'nativeRunId': native_id, 'nativeCallBranch': branch,
            'executionId': execution_id, 'requestDigest': hash_value(canonical(request))})
        scopes.append(ExecutionScopeV1(role=ExecutionRole.LIBRARY_WORKER, execution_id=execution_id,
            parent_execution_id=root_id, depth=1, expected_fence=str(grant.fence), immutable_snapshot_ref='worker-snapshot',
            native_session_id=grant.session_id))
    async with engine.begin() as connection:
        await connection.execute(text('UPDATE conversation.root_background_jobs SET request_digest=:digest WHERE execution_id=:id'),
            {'digest': digest, 'id': grant.execution_id})
        root_state = {'actorId': grant.actor_id, 'scope': {'immutableSnapshotRef': 'root-snapshot'},
            'rootContext': {'catalog': [{'agent_id': grant.actor_id, 'snapshot_digest': 'worker-snapshot'}]}, 'fanoutManifests': [manifest]}
        await connection.execute(text('UPDATE conversation.root_executions SET result_payload=CAST(:payload AS jsonb) WHERE id=:id'),
            {'id': root_id, 'payload': canonical({'nativeState': root_state})})
        await connection.execute(text("UPDATE conversation.root_executions SET role='fanout_driver',depth=0,result_payload=CAST(:payload AS jsonb) WHERE id=:id"),
            {'id': grant.execution_id, 'payload': canonical({'nativeState': {'actorId': grant.actor_id,
                'backgroundFanout': {'manifestId': manifest_id, 'digest': digest}}})})
        for item, scope in zip(manifest['items'], scopes):
            state = {'actorId': grant.actor_id, 'sessionId': grant.session_id,
                'backgroundFanoutItem': {'coordinatorExecutionId': grant.execution_id, 'manifestId': manifest_id, 'digest': digest},
                'scope': {'executionId': scope.execution_id, 'parentExecutionId': root_id, 'role': scope.role.value,
                    'depth': 1, 'immutableSnapshotRef': scope.immutable_snapshot_ref,
                    'conversationEpoch': grant.epoch, 'nativeSessionId': grant.session_id},
                'rootContext': {'delegate_request_digest': item['requestDigest'], 'selected_agent_id': grant.actor_id},
                'admittedRequest': {'task': item['task'], 'expectedOutput': '', 'contextRefs': [], 'agentId': grant.actor_id,
                    'nativeCallId': item['nativeRunId'], 'nativeCallBranch': item['nativeCallBranch']}}
            await connection.execute(text("""INSERT INTO conversation.root_executions
                (id,conversation_id,parent_execution_id,role,depth,status,result_payload)
                VALUES(:id,:conversation,:parent,'library_worker',1,'running',CAST(:payload AS jsonb))"""),
                {'id': scope.execution_id, 'conversation': grant.conversation_id, 'parent': root_id, 'payload': canonical({'nativeState': state})})
    yield service, session, scopes, manifest


@pytest.mark.asyncio
async def test_owned_item_actions_isolate_same_native_call_and_restore_only_producer_evidence(owned_items):
    service, _session, scopes, _manifest = owned_items
    effects = []
    for scope in scopes:
        await validate_item(service, scope)
        ledger = BackgroundActionLedger(service, scope)
        key = '_root_evidence:' + hashlib.sha256(f'{scope.execution_id}:same-call'.encode()).hexdigest()
        state = {key: [{'executionId': scope.execution_id, 'nativeIdentity': 'same-call', 'kind': 'artifact'}],
            '_root_evidence:sibling': [{'executionId': 'other', 'kind': 'artifact'}]}
        async def effect():
            effects.append(scope.execution_id)
            return {'producer': scope.execution_id}
        assert await ledger.execute('save', 'same-call', {}, effect, state) == {'producer': scope.execution_id}
        restored = {}
        assert await ledger.execute('save', 'same-call', {}, effect, restored) == {'producer': scope.execution_id}
        assert set(restored) == {key}
    assert effects == [scope.execution_id for scope in scopes]
    with pytest.raises(BackgroundOwnershipError):
        await validate_item(service, replace(scopes[0], expected_fence='999'))
    with pytest.raises(BackgroundOwnershipError):
        await validate_item(service, replace(scopes[0], immutable_snapshot_ref='sibling'))


@pytest.mark.asyncio
async def test_real_node_root_checkpoint_has_native_output_and_replay_does_not_repeat(owned_items):
    service, session, _scopes, manifest = owned_items
    calls = []
    async def complete(ctx, manifest=None):
        calls.append('executed')
        return {'manifest_id': 'manifest', 'status': 'completed'}
    workflow = Workflow(name='background_fanout', edges=[(START, FunctionNode(func=complete,
        name='fanout_driver', parameter_binding='node_input'))])
    app = App(name=service.grant.app_name, root_agent=workflow, resumability_config=ResumabilityConfig(is_resumable=True))
    runner = Runner(app=app, session_service=service)
    events = [event async for event in runner.run_async(user_id=service.grant.actor_id, session_id=service.grant.session_id,
        new_message=types.Content(role='user', parts=[types.Part(text='Run the stored manifest')]))]
    control = await service.control_state()
    from src.root_runtime.background_fanout import classify_fanout_history
    persisted = await service.get_session(app_name=service.grant.app_name, user_id=service.grant.actor_id, session_id=service.grant.session_id)
    recovery = classify_fanout_history(persisted, control['native_invocation_id'], control['initial_input_event_id'])
    assert recovery.status == 'completed' and json.loads(recovery.text)['status'] == 'completed'
    fresh = Runner(app=app, session_service=FencedBackgroundSessionService(replace(service.grant, resume_intent='resume'), db_engine=service.db_engine))
    replay = [event async for event in fresh.run_async(user_id=service.grant.actor_id, session_id=service.grant.session_id,
        invocation_id=control['native_invocation_id'], new_message=None)]
    assert calls == ['executed']


@pytest.mark.asyncio
@pytest.mark.parametrize('wait', [False, True])
async def test_shared_owned_fanout_runs_original_items_and_reauthorizes_terminal_replay(owned_items, monkeypatch, wait):
    from google.adk.agents import LlmAgent
    from google.protobuf import json_format
    from src.root_runtime.background_fanout import OwnedFanoutAdapter, classify_fanout_history
    from src.root_runtime.fanout import build_fanout_workflow
    from tests.wp04.test_delegate_dispatcher import _Scripted, _text
    from google.adk.agents.context import Context
    from google.adk.events.request_input import RequestInput
    from google.adk.workflow.utils._workflow_hitl_utils import create_request_input_response, get_request_input_interrupt_ids
    service, _session, scopes, manifest = owned_items
    calls, resolved_ids, settled = [], [], {}
    async def post(_scope, path, payload):
        _, execution_id, operation = path.split('/')
        assert execution_id in {scope.execution_id for scope in scopes}
        assert payload['requestDigest'] == service.grant.request_digest
        scope = next(scope for scope in scopes if scope.execution_id == execution_id)
        if operation == 'definition':
            resolved_ids.append(execution_id)
            return {'kind': 'worker', 'executionId': execution_id,
                'definition': {'id': service.grant.actor_id, 'name': 'worker', 'description': 'bounded',
                    'prompt': 'bounded', 'chatbot': {'model': 'test-model'}},
                'executionScope': json_format.MessageToDict(scope.to_proto(), preserving_proto_field_name=True),
                **({'result': settled[execution_id]} if settled.get(execution_id, {}).get('status') == 'completed' else {})}
        if operation == 'permit': return {'acquired': True}
        assert operation == 'lifecycle'
        settled[execution_id] = {'status': payload['status'], 'text': payload.get('text'), 'fullText': payload.get('fullText')}
        return settled[execution_id]
    attempts = []
    async def parking(ctx: Context):
        attempts.append('first')
        if len(attempts) == 1:
            return RequestInput(interrupt_id='ask', message='Need input')
        return 'Owned item output'
    async def compile_selected(_team, _request, _candidate, scope, authorize=None):
        calls.append(scope.execution_id)
        if wait and scope.execution_id == scopes[0].execution_id:
            return FunctionNode(func=parking, name='parking', rerun_on_resume=True)
        return LlmAgent(name='worker', model=_Scripted(scope.execution_id, [_text('Owned item output')]))
    monkeypatch.setattr('src.root_runtime.background_fanout._post', post)
    monkeypatch.setattr('src.root_runtime.dispatcher._compile_candidate', compile_selected)
    root = ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id=scopes[0].parent_execution_id,
        immutable_snapshot_ref='root-snapshot', expected_fence=str(service.grant.fence),
        native_session_id=service.grant.session_id, deadline_epoch_ms=int(__import__('time').time() * 1000) + 30000)
    root_context = {'root_agent_id': service.grant.actor_id, 'max_depth': 1, 'max_parallel_workers': 2,
        'worker_permit_version': 1, 'delegate_definition_mode': 'lazy',
        'catalog': [{'agent_id': service.grant.actor_id, 'snapshot_digest': 'worker-snapshot'}]}
    request = SimpleNamespace(session_id=service.grant.session_id, session_service=service, abort_signal=asyncio.Event())
    def runner():
        adapter = OwnedFanoutAdapter(service, manifest)
        workflow = build_fanout_workflow(SimpleNamespace(current_queue=None), request, root_context, root, adapter, manifest)
        return Runner(app=App(name=service.grant.app_name, root_agent=workflow,
            resumability_config=ResumabilityConfig(is_resumable=True)), session_service=service)
    _events = [event async for event in runner().run_async(user_id=service.grant.actor_id, session_id=service.grant.session_id,
        new_message=types.Content(role='user', parts=[types.Part(text='Run stored items')]))]
    control = await service.control_state()
    persisted = await service.get_session(app_name=service.grant.app_name, user_id=service.grant.actor_id, session_id=service.grant.session_id)
    recovered = classify_fanout_history(persisted, control['native_invocation_id'], control['initial_input_event_id'])
    if wait:
        assert recovered.status == 'waiting'
        assert settled[scopes[1].execution_id]['status'] == 'completed'
        pending = [input_id for event in _events for input_id in get_request_input_interrupt_ids(event)]
        response = create_request_input_response(pending[0], {'value': 'approved'})
        digest = 'e' * 64
        async with service.db_engine.begin() as connection:
            await connection.execute(text('UPDATE conversation.root_background_jobs SET pending_input_responses=CAST(:responses AS jsonb),input_response_digest=:digest WHERE execution_id=:id'),
                {'id': service.grant.execution_id, 'digest': digest, 'responses': json.dumps([{'input_id': response.function_response.id,
                    'function_name': response.function_response.name, 'response': response.function_response.response}])})
        service = FencedBackgroundSessionService(replace(service.grant, resume_intent='resume', input_response_digest=digest), db_engine=service.db_engine)
        _resumed = [event async for event in runner().run_async(user_id=service.grant.actor_id, session_id=service.grant.session_id,
            invocation_id=control['native_invocation_id'], new_message=types.Content(role='user', parts=[response]))]
        persisted = await service.get_session(app_name=service.grant.app_name, user_id=service.grant.actor_id, session_id=service.grant.session_id)
        recovered = classify_fanout_history(persisted, control['native_invocation_id'], control['initial_input_event_id'])
    assert recovered.status == 'completed'
    coverage = json.loads(recovered.text)
    assert coverage['requested'] == 2 and coverage['counts']['completed'] == 2
    assert [item['execution_id'] for item in coverage['items']] == [scope.execution_id for scope in scopes]
    assert calls[:2] == [scope.execution_id for scope in scopes]
    assert calls.count(scopes[1].execution_id) == 1
    service = FencedBackgroundSessionService(replace(service.grant, resume_intent='resume'), db_engine=service.db_engine)
    _replay = [event async for event in runner().run_async(user_id=service.grant.actor_id, session_id=service.grant.session_id,
        invocation_id=control['native_invocation_id'], new_message=None)]
    assert len(calls) == (3 if wait else 2)
    # A completed root Workflow is cached by ADK. The owned result path must
    # independently authorize stored producers before publishing recovery.
    adapter = OwnedFanoutAdapter(service, manifest)
    for scope in scopes:
        assert (await adapter.resolve(scope.execution_id))['result']['status'] == 'completed'
