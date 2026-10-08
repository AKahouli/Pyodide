from dataclasses import replace

import pytest
from google.adk.agents import LlmAgent
from google.adk.tools import FunctionTool
from google.genai import types

from src.root_runtime.background_sessions import FencedBackgroundSessionService
from src.root_runtime.background_recovery import classify_native_history
from src.root_runtime.compiler import make_role_runner
from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1
from tests.wp00.test_adk211_root_runtime_compat import _ScriptedLlm
from tests.wp07.test_background_sessions import guarded_native


def scope_for(grant, parent):
    return ExecutionScopeV1(role=ExecutionRole.LIBRARY_WORKER, execution_id=grant.execution_id,
        parent_execution_id=parent, depth=1, expected_fence=str(grant.fence), native_session_id=grant.session_id)


@pytest.mark.asyncio
async def test_actual_resumable_native_app_persists_top_worker_completion_checkpoint(guarded_native):
    service, _session, grant, engine = guarded_native
    control = await service.control_state()
    agent = LlmAgent(name='worker', model=_ScriptedLlm('completed', [types.Part(text='durable actual output')]))
    runner = make_role_runner(agent, service, scope_for(grant, control['parent_execution_id']))
    events = [event async for event in runner.run_async(user_id=grant.actor_id, session_id=grant.session_id,
        new_message=types.Content(role='user', parts=[types.Part(text='bounded initial input')]))]
    assert any(event.actions.end_of_agent for event in events)
    fresh = FencedBackgroundSessionService(replace(grant, resume_intent='attach'), db_engine=engine)
    restored = await fresh.get_session(app_name=grant.app_name, user_id=grant.actor_id, session_id=grant.session_id)
    control = await fresh.control_state()
    outcome = classify_native_history(restored, control['native_invocation_id'], control['initial_input_event_id'], 'worker')
    assert outcome.status == 'completed' and outcome.text == 'durable actual output', [
        (event.author, event.node_info.path, event.actions.end_of_agent, event.actions.agent_state,
            event.partial, getattr(event.content, 'role', None)) for event in restored.events]
    assert len(agent.model.requests) == 1


@pytest.mark.asyncio
async def test_actual_native_confirmation_parks_without_executing_effect(guarded_native):
    import json
    from sqlalchemy import text
    service, _session, grant, engine = guarded_native
    control = await service.control_state()
    calls = []

    async def write_file(name: str):
        calls.append(name)
        return {'saved': name}

    model = _ScriptedLlm('confirmation', [types.Part(function_call=types.FunctionCall(
        id='write-call', name='write_file', args={'name': 'bounded.txt'})), types.Part(text='finished')])
    agent = LlmAgent(name='worker', model=model, tools=[FunctionTool(func=write_file, require_confirmation=True)])
    runner = make_role_runner(agent, service, scope_for(grant, control['parent_execution_id']))
    events = [event async for event in runner.run_async(user_id=grant.actor_id, session_id=grant.session_id,
        new_message=types.Content(role='user', parts=[types.Part(text='bounded initial input')]))]
    assert events and not calls
    fresh = FencedBackgroundSessionService(replace(grant, resume_intent='attach'), db_engine=engine)
    restored = await fresh.get_session(app_name=grant.app_name, user_id=grant.actor_id, session_id=grant.session_id)
    control = await fresh.control_state()
    outcome = classify_native_history(restored, control['native_invocation_id'], control['initial_input_event_id'], 'worker')
    assert outcome.status == 'waiting' and outcome.pending[0][1] == 'adk_request_confirmation'
    input_id, function_name = outcome.pending[0]
    digest = 'f' * 64
    response = {'confirmed': True}
    async with engine.begin() as connection:
        await connection.execute(text('''UPDATE conversation.root_background_jobs SET input_response_digest=:digest,
            pending_input_responses=CAST(:responses AS jsonb) WHERE execution_id=:id'''),
            {'id': grant.execution_id, 'digest': digest, 'responses': json.dumps([{'input_id': input_id,
                'function_name': function_name, 'input_version': 1, 'response': response}])})
    resumed = FencedBackgroundSessionService(replace(grant, resume_intent='resume', input_response_digest=digest), db_engine=engine)
    resumed_scope = replace(scope_for(grant, control['parent_execution_id']), resume_intent='resume',
        native_invocation_id=control['native_invocation_id'])
    resumed_agent = LlmAgent(name='worker', model=_ScriptedLlm('resumed', [types.Part(text='confirmed finished')]),
        tools=[FunctionTool(func=write_file, require_confirmation=True)])
    resumed_runner = make_role_runner(resumed_agent, resumed, resumed_scope)
    _events = [event async for event in resumed_runner.run_async(user_id=grant.actor_id, session_id=grant.session_id,
        invocation_id=control['native_invocation_id'], new_message=types.Content(role='user', parts=[
            types.Part(function_response=types.FunctionResponse(id=input_id, name=function_name, response=response))]))]
    restored = await resumed.get_session(app_name=grant.app_name, user_id=grant.actor_id, session_id=grant.session_id)
    outcome = classify_native_history(restored, control['native_invocation_id'], control['initial_input_event_id'], 'worker')
    assert calls == ['bounded.txt'] and outcome.status == 'completed' and outcome.text == 'confirmed finished'
    assert sum(event.id == control['initial_input_event_id'] for event in restored.events) == 1
