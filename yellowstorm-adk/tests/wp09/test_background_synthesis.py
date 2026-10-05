import asyncio
import json
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from google.adk.agents import LlmAgent
from sqlalchemy import text

from src.root_runtime.background_synthesis import enforce_synthesis_only, run_owned_synthesis
from src.root_runtime.background_recovery import classify_native_history
from src.root_runtime.background_sessions import BackgroundOwnershipError, FencedBackgroundSessionService
from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1
from tests.wp07.test_background_sessions import guarded_native
from tests.wp04.test_delegate_dispatcher import _Scripted, _text, _fc


def test_synthesis_compilation_removes_effect_tools_and_rejects_delegated_agents():
    def effect():
        raise AssertionError('Effect must never run')
    agent = LlmAgent(name='synthesis', model='fixture', tools=[effect])
    enforce_synthesis_only(agent)
    assert agent.tools == []
    with pytest.raises(ValueError, match='delegated'):
        enforce_synthesis_only(LlmAgent(name='parent', model='fixture', sub_agents=[agent]))


@pytest.fixture
async def owned_synthesis(guarded_native):
    service, session, grant, engine = guarded_native
    control = await service.control_state()
    root_id = control['parent_execution_id']
    manifest_digest = 'd' * 64
    message_id = 'e' * 24
    async with engine.begin() as connection:
        root_state = {'actorId': grant.actor_id, 'schedulingSeal': {'digest': manifest_digest,
            'followupExecutionId': grant.execution_id}}
        child_state = {'actorId': grant.actor_id, 'followup': {'manifestDigest': manifest_digest,
            'publicationMessageId': message_id}}
        for execution_id, state in [(root_id, root_state), (grant.execution_id, child_state)]:
            await connection.execute(text('UPDATE conversation.root_executions SET result_payload=CAST(:payload AS jsonb) WHERE id=:id'),
                {'id': execution_id, 'payload': json.dumps({'nativeState': state})})
        await connection.execute(text("UPDATE conversation.root_executions SET role='followup',depth=0 WHERE id=:id"),
            {'id': grant.execution_id})
        await connection.execute(text('''INSERT INTO conversation.conversation_executions
            (id,conversation_id,user_id,message_id,status,expires_at) VALUES(:id,:conversation,:actor,:message,
            'running',clock_timestamp()+interval '120 seconds')'''),
            {'id': grant.execution_id, 'conversation': grant.conversation_id, 'actor': grant.actor_id, 'message': message_id})
    scope = ExecutionScopeV1(role=ExecutionRole.FOLLOWUP, execution_id=grant.execution_id,
        parent_execution_id=root_id, depth=0, expected_fence=str(grant.fence), native_session_id=grant.session_id)
    yield service, scope


@pytest.mark.asyncio
async def test_actual_adk_synthesis_checkpoint_recovers_without_another_model_call(owned_synthesis, monkeypatch):
    service, scope = owned_synthesis
    producer_id = 'b' * 24
    model = _Scripted('synthesis', [_fc('get_synthesis_result', {'execution_id': producer_id, 'offset': 0}),
        _text('Truthful partial synthesis [1]')])
    reads = []
    async def post(scope, path, payload):
        assert scope.execution_id == service.grant.execution_id
        assert path == f'background-synthesis-results/{producer_id}'
        assert payload['nativeOwner'] == service.grant.native_owner
        reads.append(payload['offset'])
        return {'executionId': producer_id, 'status': 'completed', 'text': 'Original result',
            'nextOffset': None, 'evidence': [{'evidenceId': 'original-evidence-id', 'displayReference': '1'}]}
    monkeypatch.setattr('src.root_runtime.delegate_resolver._post', post)
    agent = LlmAgent(name='synthesis', model=model)
    factory = AsyncMock(return_value=(agent, None))
    team = SimpleNamespace(agent_helper=SimpleNamespace(normalize_agent_name=lambda name: name),
        agent_repository=SimpleNamespace(add_agent=lambda data: None),
        delegation_factory=SimpleNamespace(_create_agent_with_error_handling=factory))
    configuration = 'src.smart_rag.engines.multi_agent.agentic_workflows.team_configuration'
    monkeypatch.setattr(configuration + '.initialize_dependencies', lambda: None)
    monkeypatch.setattr(configuration + '.create_team_config', lambda request: None)
    monkeypatch.setattr(configuration + '.create_team', lambda config, deps: team)
    monkeypatch.setattr('src.smart_rag.agents.core.document_helpers.DocumentHelpers.agent_to_dict',
        lambda candidate: {'name': 'synthesis', 'prompt': 'Pinned profile', 'tools': ['forbidden']})
    monkeypatch.setattr('src.smart_rag.infrastructure.session.citation_manager.get_citation_manager', AsyncMock(return_value=None))
    request = SimpleNamespace(execution_scope=scope, agents=[SimpleNamespace(id=service.grant.actor_id)],
        message='Immutable terminal results with original evidence IDs', native_input_responses=None)
    output = await run_owned_synthesis(service, request, asyncio.Queue(), asyncio.Event())
    assert output == 'Truthful partial synthesis [1]'
    assert len(model.requests) == 2 and reads == [0]
    assert factory.call_args.args[0]['tools'] == []
    assert [tool.name for tool in agent.tools] == ['get_synthesis_result']
    fresh = FencedBackgroundSessionService(replace(service.grant, resume_intent='resume'), db_engine=service.db_engine)
    control = await fresh.control_state()
    session = await fresh.get_session(app_name=fresh.grant.app_name, user_id=fresh.grant.actor_id, session_id=fresh.grant.session_id)
    recovered = classify_native_history(session, control['native_invocation_id'], control['initial_input_event_id'], 'synthesis')
    assert recovered.status == 'completed' and recovered.text == output
    assert len(model.requests) == 2 and reads == [0]


@pytest.mark.asyncio
async def test_synthesis_native_writes_fail_closed_after_writer_revocation(owned_synthesis):
    service, _scope = owned_synthesis
    async with service.db_engine.begin() as connection:
        await connection.execute(text("UPDATE conversation.conversation_executions SET status='cancelled' WHERE id=:id"),
            {'id': service.grant.execution_id})
    with pytest.raises(BackgroundOwnershipError, match='Synthesis writer'):
        await service.validate_owner()
