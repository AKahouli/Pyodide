import hashlib
import asyncio
import secrets
from pathlib import Path
from dataclasses import replace

import pytest
from dotenv import dotenv_values
from google.adk.events import Event
from google.adk.events.event_actions import EventActions
from google.adk.sessions import DatabaseSessionService
from google.genai import types
from sqlalchemy import delete, event, text
from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import create_async_engine

from src.root_runtime.background_sessions import (BackgroundOwnershipError, BackgroundResumeRequired,
    BackgroundWriteGrant, FencedBackgroundSessionService, _BackgroundSqlSession)


def test_noncolocated_sqlite_is_rejected_before_native_schema_creation(tmp_path):
    grant = BackgroundWriteGrant('a' * 24, 'b' * 24, 'c' * 24, 0, 'owner', 1, 'background_' + 'a' * 24, 'd' * 64)
    path = tmp_path / 'forbidden.db'
    with pytest.raises(ValueError, match='colocate'):
        FencedBackgroundSessionService(grant, db_url=f'sqlite+aiosqlite:///{path.as_posix()}')
    assert not path.exists()


@pytest.fixture
async def guarded_native():
    backend = Path(__file__).resolve().parents[3] / 'YellowStorm' / 'back'
    config = dotenv_values(backend / '.env')
    database = config.get('POSTGRES_TEST_DB')
    if not database or database == config.get('POSTGRES_DB'):
        pytest.skip('Explicit isolated PostgreSQL test database required')
    engine = create_async_engine(URL.create('postgresql+asyncpg', username=config.get('POSTGRES_USER'),
        password=config.get('POSTGRES_PASSWORD'), host=config.get('POSTGRES_HOST'),
        port=int(config.get('POSTGRES_PORT', '5432')), database=database))
    conversation_id, parent_id, child_id, actor = [secrets.token_hex(12) for _ in range(4)]
    grant = BackgroundWriteGrant(child_id, conversation_id, actor, 0, 'owner', 1, f'background_{child_id}', 'a' * 64,
        native_owner='fixture-native')
    service = None
    try:
        async with engine.begin() as connection:
            assert (await connection.execute(text('select current_database()'))).scalar_one() == database
            # This migration has no function bodies/embedded semicolons.
            for statement in (backend / 'drizzle/0044_root_background_jobs.sql').read_text().split(';'):
                if statement.strip():
                    await connection.execute(text(statement))
            await connection.execute(text('INSERT INTO conversation.conversations(id,created_by) VALUES(:id,:actor)'),
                {'id': conversation_id, 'actor': actor})
            for execution_id, role, depth in [(parent_id, 'root', 0), (child_id, 'library_worker', 1)]:
                await connection.execute(text('''INSERT INTO conversation.root_executions
                    (id,conversation_id,parent_execution_id,role,depth,status,result_payload)
                    VALUES(:id,:conversation,:parent,:role,:depth,'running',jsonb_build_object('nativeState',jsonb_build_object('actorId',CAST(:actor AS text))))'''),
                    {'id': execution_id, 'conversation': conversation_id, 'parent': None if depth == 0 else parent_id,
                        'role': role, 'depth': depth, 'actor': actor})
            await connection.execute(text('''INSERT INTO conversation.root_background_jobs
                (execution_id,parent_execution_id,conversation_id,actor_id,conversation_epoch,request_digest,status,owner,fence,
                 attempts,max_attempts,lease_until,deadline,native_session_id)
                VALUES(:id,:parent,:conversation,:actor,0,:digest,'running','owner',1,1,3,
                    clock_timestamp()+interval '120 seconds',clock_timestamp()+interval '120 seconds',:session)'''),
                {'id': child_id, 'parent': parent_id, 'conversation': conversation_id, 'actor': actor,
                    'digest': grant.request_digest, 'session': grant.session_id})
        from src.root_runtime.background_sessions import claim_native_owner
        await claim_native_owner(engine, grant)
        service = FencedBackgroundSessionService(grant, db_engine=engine)
        session = await service.create_session(app_name=grant.app_name, user_id=actor, session_id=grant.session_id)
        yield service, session, grant, engine
    finally:
        if service is not None:
            base = DatabaseSessionService(db_engine=engine)
            await base.delete_session(app_name=grant.app_name, user_id=actor, session_id=grant.session_id)
            schema = base._get_schema_classes()
            async with engine.begin() as connection:
                await connection.execute(delete(schema.StorageUserState).where(schema.StorageUserState.app_name == grant.app_name))
                await connection.execute(delete(schema.StorageAppState).where(schema.StorageAppState.app_name == grant.app_name))
        async with engine.begin() as connection:
            await connection.execute(text('DELETE FROM conversation.conversations WHERE id=:id'), {'id': conversation_id})
        await engine.dispose()


def initial_event():
    return Event(author='user', invocation_id='native-invocation',
        content=types.Content(role='user', parts=[types.Part(text='original bounded input')]))


@pytest.mark.asyncio
async def test_durable_approval_response_commits_once_with_native_event(guarded_native):
    service, session, grant, engine = guarded_native
    await service.append_event(session, initial_event())
    digest = 'f' * 64
    approved = {'input_id': 'input', 'function_name': 'adk_request_confirmation', 'input_version': 1,
        'response': {'confirmed': True}}
    import json
    async with engine.begin() as connection:
        await connection.execute(text('''UPDATE conversation.root_background_jobs SET pending_input_responses=CAST(:responses AS jsonb),
            input_response_digest=:digest WHERE execution_id=:id'''),
            {'id': grant.execution_id, 'digest': digest, 'responses': json.dumps([approved])})
    resumed = FencedBackgroundSessionService(replace(grant, resume_intent='resume', input_response_digest=digest), db_engine=engine)
    response = Event(author='user', invocation_id='native-invocation', content=types.Content(role='user', parts=[
        types.Part(function_response=types.FunctionResponse(id='input', name='adk_request_confirmation', response={'confirmed': False}))]))
    with pytest.raises(BackgroundOwnershipError, match='durably authorized'):
        await resumed.append_event(session, response)
    response.content.parts[0].function_response.response = {'confirmed': True}
    await resumed.append_event(session, response)
    with pytest.raises(BackgroundResumeRequired, match='response already committed'):
        await resumed.append_event(session, response)
    async with engine.begin() as connection:
        job = (await connection.execute(text('''SELECT pending_input_responses,input_response_event_id,native_invocation_id
            FROM conversation.root_background_jobs WHERE execution_id=:id'''), {'id': grant.execution_id})).mappings().one()
        assert job['pending_input_responses'] is None and job['input_response_event_id']
        assert job['native_invocation_id'] == 'native-invocation'
    restored = await resumed.get_session(app_name=grant.app_name, user_id=grant.actor_id, session_id=grant.session_id)
    assert len(restored.events) == 2


@pytest.mark.asyncio
async def test_same_backend_fence_allows_only_one_native_process(guarded_native):
    from src.root_runtime.background_sessions import claim_native_owner
    service, session, grant, engine = guarded_native
    async with engine.begin() as connection:
        await connection.execute(text('''UPDATE conversation.root_background_jobs SET native_owner=NULL,native_owner_fence=NULL
            WHERE execution_id=:id'''), {'id': grant.execution_id})
    unclaimed = FencedBackgroundSessionService(replace(grant, native_owner=None), db_engine=engine)
    with pytest.raises(BackgroundOwnershipError, match='native process'):
        await unclaimed.append_event(session, initial_event())
    first = replace(grant, native_owner='process-one')
    second = replace(grant, native_owner='process-two')
    results = await asyncio.gather(claim_native_owner(engine, first), claim_native_owner(engine, second),
        return_exceptions=True)
    assert sum(result is True for result in results) == 1
    assert sum(isinstance(result, BackgroundResumeRequired) for result in results) == 1
    winner = first if results[0] is True else second
    assert await claim_native_owner(engine, winner) is False
    # Even an existing session object cannot publish after process ownership
    # changes, despite retaining the valid backend owner and fence.
    with pytest.raises(BackgroundOwnershipError, match='native process'):
        await service.append_event(session, initial_event())
    guarded = FencedBackgroundSessionService(winner, db_engine=engine)
    await guarded.append_event(session, initial_event())
    async with engine.begin() as connection:
        row = (await connection.execute(text('''SELECT native_owner,native_owner_fence,native_invocation_id
            FROM conversation.root_background_jobs WHERE execution_id=:id'''),
            {'id': grant.execution_id})).mappings().one()
        assert row['native_owner'] == winner.native_owner
        assert row['native_owner_fence'] == grant.fence
        assert row['native_invocation_id'] == 'native-invocation'


@pytest.mark.asyncio
async def test_native_confirmation_precedes_action_intent_and_approval_executes_once(guarded_native):
    from types import SimpleNamespace
    from unittest.mock import Mock
    from google.adk.agents import LlmAgent
    from google.adk.tools import FunctionTool
    from google.adk.tools.tool_confirmation import ToolConfirmation
    from google.adk.sessions.state import State
    from src.root_runtime.background_actions import install_background_action_guard
    from src.root_runtime.leaf_tools import install_leaf_tool_gate, is_leaf_tool, register_tool_execution_kind
    service, _session, grant, engine = guarded_native
    calls = []

    async def upload(name: str):
        calls.append(name)
        return {'documentId': 'saved-file'}

    tool = FunctionTool(register_tool_execution_kind(upload, 'leaf'), require_confirmation=True)
    agent = LlmAgent(name='worker', model='test-model', tools=[tool])
    install_leaf_tool_gate(agent)
    install_background_action_guard(agent, service)
    assert is_leaf_tool(tool)
    context = SimpleNamespace(function_call_id='call', state=State({}, {}),
        tool_confirmation=None, actions=EventActions(), request_confirmation=Mock())
    pending = await tool.run_async(args={'name': 'file'}, tool_context=context)
    assert 'requires confirmation' in pending['error'] and calls == []
    context.request_confirmation.assert_called_once()
    async with engine.begin() as connection:
        count = (await connection.execute(text('SELECT count(*) FROM conversation.root_background_actions WHERE execution_id=:id'),
            {'id': grant.execution_id})).scalar_one()
    assert count == 0
    context.tool_confirmation = ToolConfirmation(confirmed=True)
    assert await tool.run_async(args={'name': 'file'}, tool_context=context) == {'documentId': 'saved-file'}
    assert await tool.run_async(args={'name': 'file'}, tool_context=context) == {'documentId': 'saved-file'}
    assert calls == ['file']


@pytest.mark.asyncio
async def test_action_receipt_recovers_output_and_evidence_without_repeating_external_write(guarded_native):
    from src.root_runtime.background_actions import BackgroundActionLedger, BackgroundActionUnknown
    from google.adk.sessions.state import State
    service, _session, _grant, _engine = guarded_native
    ledger = BackgroundActionLedger(service)
    calls = []
    state = State({}, {})

    async def upload():
        calls.append('uploaded')
        key = '_root_evidence:' + hashlib.sha256(f'{_grant.execution_id}:native-call'.encode()).hexdigest()
        state[key] = [{'executionId': _grant.execution_id, 'nativeIdentity': 'native-call', 'kind': 'artifact', 'identity': 'saved-file'}]
        return {'documentId': 'saved-file'}

    assert await ledger.execute('save_file', 'native-call', {'name': 'file'}, upload, state) == {'documentId': 'saved-file'}
    restored_state = State({}, {})
    assert await ledger.execute('save_file', 'native-call', {'name': 'file'}, upload, restored_state) == {'documentId': 'saved-file'}
    assert calls == ['uploaded'] and restored_state.to_dict() == state.to_dict()
    with pytest.raises(BackgroundActionUnknown, match='conflicts'):
        await ledger.execute('save_file', 'native-call', {'name': 'other'}, upload)


@pytest.mark.asyncio
async def test_owner_loss_after_external_write_leaves_unresolved_intent_and_successor_cannot_repeat(guarded_native):
    from src.root_runtime.background_sessions import claim_native_owner
    from src.root_runtime.background_actions import BackgroundActionLedger, BackgroundActionUnknown
    service, _session, grant, engine = guarded_native
    calls = []

    async def upload_then_lose_owner():
        calls.append('uploaded')
        async with engine.begin() as connection:
            await connection.execute(text("UPDATE conversation.root_background_jobs SET owner='successor',fence=fence+1 WHERE execution_id=:id"),
                {'id': grant.execution_id})
        return {'documentId': 'uploaded-file'}

    with pytest.raises(BackgroundActionUnknown, match='could not be confirmed'):
        await BackgroundActionLedger(service).execute('save_file', 'call', {}, upload_then_lose_owner)
    successor_grant = replace(grant, owner='successor', fence=grant.fence + 1, native_owner='successor-native')
    async with engine.begin() as connection:
        await connection.execute(text('UPDATE conversation.root_background_jobs SET native_owner=NULL,native_owner_fence=NULL WHERE execution_id=:id'),
            {'id': grant.execution_id})
    await claim_native_owner(engine, successor_grant)
    successor = FencedBackgroundSessionService(successor_grant, db_engine=engine)
    with pytest.raises(BackgroundActionUnknown, match='reconciliation'):
        await BackgroundActionLedger(successor).execute('save_file', 'call', {}, upload_then_lose_owner)
    assert calls == ['uploaded']
    async with engine.begin() as connection:
        action = (await connection.execute(text('SELECT status,receipt FROM conversation.root_background_actions WHERE execution_id=:id'),
            {'id': grant.execution_id})).mappings().one()
    assert action['status'] == 'started' and action['receipt'] is None


@pytest.mark.asyncio
async def test_unconfirmed_external_action_blocks_replay_and_stale_owner_cannot_start_tools(guarded_native):
    from src.root_runtime.background_actions import BackgroundActionLedger, BackgroundActionUnknown
    service, _session, grant, engine = guarded_native
    ledger = BackgroundActionLedger(service)
    calls = []

    async def lost_receipt():
        calls.append('written')
        raise OSError('connection lost after external commit')

    with pytest.raises(BackgroundActionUnknown, match='could not be confirmed'):
        await ledger.execute('send', 'call', {}, lost_receipt)
    with pytest.raises(BackgroundActionUnknown, match='reconciliation'):
        await ledger.execute('send', 'call', {}, lost_receipt)
    assert calls == ['written']
    async with engine.begin() as connection:
        await connection.execute(text("UPDATE conversation.root_background_jobs SET owner='successor',fence=fence+1 WHERE execution_id=:id"),
            {'id': grant.execution_id})
    with pytest.raises(BackgroundOwnershipError):
        await ledger.execute('send', 'new-call', {}, lost_receipt)
    assert calls == ['written']


@pytest.mark.asyncio
async def test_background_runner_uses_isolated_resumable_app_and_exact_owned_scope(guarded_native):
    from google.adk.agents import LlmAgent
    from src.root_runtime.compiler import make_role_runner
    from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1
    service, _session, grant, _engine = guarded_native
    scope = ExecutionScopeV1(role=ExecutionRole.LIBRARY_WORKER, execution_id=grant.execution_id,
        parent_execution_id='b' * 24, depth=1, conversation_epoch=grant.epoch,
        expected_fence=str(grant.fence), native_session_id=grant.session_id, resume_intent='start')
    scope = ExecutionScopeV1.from_proto(scope.to_proto())
    agent = LlmAgent(name='worker', model='test-model')
    runner = make_role_runner(agent, service, scope)
    assert runner.app.name == grant.app_name and runner.session_service is service
    assert runner.app.resumability_config.is_resumable
    with pytest.raises(ValueError, match='owned native authority'):
        make_role_runner(agent, service, replace(scope, expected_fence=str(grant.fence + 1)))
    service.grant = replace(grant, native_owner=None)
    with pytest.raises(ValueError, match='owned native authority'):
        make_role_runner(agent, service, scope)
    service.grant = replace(grant, resume_intent='attach')
    with pytest.raises(BackgroundResumeRequired, match='reconciliation'):
        make_role_runner(agent, service, replace(scope, resume_intent='attach'))


@pytest.mark.asyncio
async def test_unconfirmed_dispatch_can_inspect_history_but_cannot_start_or_append(guarded_native):
    _service, session, grant, engine = guarded_native
    service = FencedBackgroundSessionService(replace(grant, resume_intent='attach'), db_engine=engine)
    restored = await service.get_session(app_name=grant.app_name, user_id=grant.actor_id, session_id=grant.session_id)
    assert restored is not None and restored.events == []
    with pytest.raises(BackgroundResumeRequired, match='read-only reconciliation'):
        await service.create_session(app_name=grant.app_name, user_id=grant.actor_id, session_id=grant.session_id)
    with pytest.raises(BackgroundResumeRequired, match='read-only reconciliation'):
        await service.append_event(session, initial_event())
    assert session.events == []


@pytest.mark.asyncio
async def test_initial_native_input_and_correlation_commit_together_and_never_repeat(guarded_native):
    service, session, grant, engine = guarded_native
    result = await service.append_event(session, initial_event())
    assert result.id == hashlib.sha256(f'{grant.execution_id}:initial'.encode()).hexdigest()[:32]
    async with engine.connect() as connection:
        job = (await connection.execute(text('SELECT * FROM conversation.root_background_jobs WHERE execution_id=:id'),
            {'id': grant.execution_id})).mappings().one()
    assert job['native_invocation_id'] == 'native-invocation'
    assert job['initial_input_event_id'] == result.id and job['initial_input_digest']
    with pytest.raises(BackgroundResumeRequired):
        await service.append_event(session, initial_event())
    restored = await service.get_session(app_name=grant.app_name, user_id=grant.actor_id, session_id=grant.session_id)
    assert len(restored.events) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('change', ['owner', 'stop', 'binding', 'archive', 'parent_actor', 'parent_epoch', 'cancel_intent'])
async def test_stale_owner_and_stop_deny_native_append_without_mutating_cached_state(guarded_native, change):
    service, session, grant, engine = guarded_native
    async with engine.begin() as connection:
        if change == 'owner':
            await connection.execute(text("UPDATE conversation.root_background_jobs SET owner='successor',fence=fence+1 WHERE execution_id=:id"),
                {'id': grant.execution_id})
        elif change == 'stop':
            await connection.execute(text('UPDATE conversation.conversations SET root_work_epoch=root_work_epoch+1 WHERE id=:id'),
                {'id': grant.conversation_id})
        elif change == 'binding':
            await connection.execute(text('UPDATE conversation.conversations SET root_agent_id=:root WHERE id=:id'),
                {'id': grant.conversation_id, 'root': secrets.token_hex(12)})
        elif change == 'parent_actor':
            await connection.execute(text('''UPDATE conversation.root_executions SET result_payload=jsonb_build_object(
                'nativeState',jsonb_build_object('actorId','other')) WHERE id=(SELECT parent_execution_id
                FROM conversation.root_background_jobs WHERE execution_id=:id)'''), {'id': grant.execution_id})
        elif change == 'parent_epoch':
            await connection.execute(text('''UPDATE conversation.root_executions SET conversation_epoch=conversation_epoch+1
                WHERE id=(SELECT parent_execution_id FROM conversation.root_background_jobs WHERE execution_id=:id)'''),
                {'id': grant.execution_id})
        elif change == 'cancel_intent':
            await connection.execute(text('''UPDATE conversation.root_executions SET status='cancellation_requested'
                WHERE id=(SELECT parent_execution_id FROM conversation.root_background_jobs WHERE execution_id=:id)'''),
                {'id': grant.execution_id})
        else:
            await connection.execute(text('UPDATE conversation.conversations SET is_archived=true WHERE id=:id'),
                {'id': grant.conversation_id})
    with pytest.raises(BackgroundOwnershipError):
        await service.append_event(session, initial_event())
    assert session.state == {} and session.events == []
    base = DatabaseSessionService(db_engine=engine)
    restored = await base.get_session(app_name=grant.app_name, user_id=grant.actor_id, session_id=grant.session_id)
    assert restored.events == []


@pytest.mark.asyncio
@pytest.mark.parametrize('status', ['completed', 'failed', 'cancelled', 'outcome_unknown'])
async def test_foreground_outcome_without_scope_stop_does_not_revoke_native_job(guarded_native, status):
    service, session, grant, engine = guarded_native
    async with engine.begin() as connection:
        await connection.execute(text('''UPDATE conversation.root_executions SET status=:status
            WHERE id=(SELECT parent_execution_id FROM conversation.root_background_jobs WHERE execution_id=:id)'''),
            {'id': grant.execution_id, 'status': status})
    await service.append_event(session, initial_event())
    assert len(session.events) == 1


@pytest.mark.asyncio
async def test_lease_expiry_at_commit_rolls_back_native_state_event_and_correlation(guarded_native):
    service, session, grant, engine = guarded_native
    def expire_at_commit(sql_session):
        sql_session.execute(text("UPDATE conversation.root_background_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE execution_id=:id"),
            {'id': grant.execution_id})
    event.listen(_BackgroundSqlSession, 'before_commit', expire_at_commit, insert=True)
    try:
        value = initial_event(); value.actions = EventActions(state_delta={'unsafe_write': 'must rollback'})
        with pytest.raises(BackgroundOwnershipError):
            await service.append_event(session, value)
    finally:
        event.remove(_BackgroundSqlSession, 'before_commit', expire_at_commit)
    assert session.state == {} and session.events == []
    restored = await service.get_session(app_name=grant.app_name, user_id=grant.actor_id, session_id=grant.session_id)
    assert restored.state == {} and restored.events == []
    async with engine.connect() as connection:
        row = (await connection.execute(text('SELECT native_invocation_id,initial_input_event_id FROM conversation.root_background_jobs WHERE execution_id=:id'),
            {'id': grant.execution_id})).mappings().one()
    assert row['native_invocation_id'] is None and row['initial_input_event_id'] is None


@pytest.mark.asyncio
@pytest.mark.parametrize('change', ['owner', 'stop'])
async def test_takeover_or_stop_waits_for_native_commit_then_rejects_late_writer(guarded_native, change):
    service, session, grant, engine = guarded_native
    key = int(grant.execution_id[:12], 16)
    reached_commit = asyncio.Event()
    def block_commit(sql_session):
        reached_commit.set()
        sql_session.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': key})
    async def transfer():
        async with engine.begin() as connection:
            await connection.execute(text('SELECT root_work_epoch FROM conversation.conversations WHERE id=:id FOR UPDATE'),
                {'id': grant.conversation_id})
            if change == 'owner':
                await connection.execute(text("UPDATE conversation.root_background_jobs SET owner='successor',fence=fence+1 WHERE execution_id=:id"),
                    {'id': grant.execution_id})
            else:
                await connection.execute(text('UPDATE conversation.conversations SET root_work_epoch=root_work_epoch+1 WHERE id=:id'),
                    {'id': grant.conversation_id})
                await connection.execute(text("UPDATE conversation.root_background_jobs SET status='cancelled',owner=NULL,fence=fence+1 WHERE execution_id=:id"),
                    {'id': grant.execution_id})
    async with engine.connect() as blocker:
        await blocker.execute(text('SELECT pg_advisory_lock(:key)'), {'key': key})
        event.listen(_BackgroundSqlSession, 'before_commit', block_commit, insert=True)
        append_task = asyncio.create_task(service.append_event(session, initial_event()))
        transfer_task = None
        try:
            await asyncio.wait_for(reached_commit.wait(), timeout=10)
            transfer_task = asyncio.create_task(transfer())
            await asyncio.sleep(0.05)
            assert not append_task.done() and not transfer_task.done()
        finally:
            await blocker.execute(text('SELECT pg_advisory_unlock(:key)'), {'key': key})
            try:
                await asyncio.wait_for(append_task, timeout=10)
                if transfer_task is not None:
                    await asyncio.wait_for(transfer_task, timeout=10)
            finally:
                event.remove(_BackgroundSqlSession, 'before_commit', block_commit)
    late = Event(author='worker', invocation_id='native-invocation',
        content=types.Content(role='model', parts=[types.Part(text='late output')]),
        actions=EventActions(state_delta={'late': 'must not persist'}))
    with pytest.raises(BackgroundOwnershipError):
        await service.append_event(session, late)
    base = DatabaseSessionService(db_engine=engine)
    restored = await base.get_session(app_name=grant.app_name, user_id=grant.actor_id, session_id=grant.session_id)
    assert len(restored.events) == 1 and 'late' not in restored.state
