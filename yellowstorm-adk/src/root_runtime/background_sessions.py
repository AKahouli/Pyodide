"""Background-only ADK writes fenced in the colocated control transaction.

Uses SQLAlchemy's public session factory/events; foreground storage is unchanged.
No background supervisor uses this until the colocated runtime is qualified.
"""
from __future__ import annotations

import hashlib
import json
import re
from contextvars import ContextVar
from copy import deepcopy
from dataclasses import dataclass

from google.adk.sessions import DatabaseSessionService
from sqlalchemy import event, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session as SqlSession


class BackgroundOwnershipError(PermissionError):
    pass


class BackgroundResumeRequired(BackgroundOwnershipError):
    pass


def native_app_name(session_service):
    return session_service.grant.app_name if isinstance(session_service, FencedBackgroundSessionService) else 'manager_app'


def validate_background_request(service, scope, user_id, session_id):
    from src.root_runtime.contracts import ExecutionRole
    if not isinstance(service, FencedBackgroundSessionService):
        raise ValueError('Background storage requires fenced native authority')
    grant = service.grant
    control = scope is not None and scope.role in (ExecutionRole.FANOUT_DRIVER, ExecutionRole.FOLLOWUP) and scope.depth == 0
    leaf = scope is not None and scope.role in (ExecutionRole.LIBRARY_WORKER, ExecutionRole.TEMPORARY_WORKER) and scope.depth == 1
    if (not grant.native_owner or user_id != grant.actor_id or session_id != grant.session_id
        or not (control or leaf) or not scope.parent_execution_id or scope.execution_id != grant.execution_id
        or scope.conversation_epoch != grant.epoch or scope.expected_fence != str(grant.fence)
        or scope.native_session_id != grant.session_id or scope.resume_intent != grant.resume_intent):
        raise ValueError('Background request does not match owned native authority')


@dataclass(frozen=True)
class BackgroundWriteGrant:
    execution_id: str
    conversation_id: str
    actor_id: str
    epoch: int
    owner: str
    fence: int
    session_id: str
    request_digest: str
    resume_intent: str = 'start'
    native_owner: str | None = None
    input_response_digest: str | None = None

    def __post_init__(self):
        if (any(not re.fullmatch(r'[0-9a-f]{24}', value) for value in
                (self.execution_id, self.conversation_id, self.actor_id))
            or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', self.owner)
            or type(self.fence) is not int or self.fence < 1 or type(self.epoch) is not int or self.epoch < 0
            or self.session_id != f'background_{self.execution_id}'
            or not re.fullmatch(r'[0-9a-f]{64}', self.request_digest)
            or self.resume_intent not in ('start', 'resume', 'attach')):
            raise ValueError('Invalid trusted background write grant')
        if self.native_owner is not None and not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', self.native_owner):
            raise ValueError('Invalid native background owner')
        if self.input_response_digest is not None and not re.fullmatch(r'[0-9a-f]{64}', self.input_response_digest):
            raise ValueError('Invalid native response intent')

    @property
    def app_name(self):
        return f'root_background_{self.execution_id}'


_binding = ContextVar('background_native_write', default=None)


class _BackgroundSqlSession(SqlSession):
    pass


def _guard(connection, binding, correlate=False, require_native_owner=True):
    if binding is None or connection.dialect.name != 'postgresql':
        raise BackgroundOwnershipError('Background native writes require colocated PostgreSQL authority')
    grant, metadata = binding
    conversation = connection.execute(text('SELECT * FROM conversation.conversations WHERE id=:id FOR UPDATE'),
        {'id': grant.conversation_id}).mappings().one_or_none()
    job = connection.execute(text('''SELECT *, lease_until > clock_timestamp() AND deadline > clock_timestamp() AS live
        FROM conversation.root_background_jobs WHERE execution_id=:id FOR UPDATE'''),
        {'id': grant.execution_id}).mappings().one_or_none()
    if (conversation is None or conversation['root_work_epoch'] != grant.epoch or conversation['created_by'] != grant.actor_id
        or conversation['is_archived'] or conversation['is_group'] or job is None or not job['live'] or job['status'] != 'running'
        or job['owner'] != grant.owner or job['fence'] != grant.fence or job['conversation_epoch'] != grant.epoch
        or job['conversation_id'] != grant.conversation_id or job['actor_id'] != grant.actor_id
        or job['native_session_id'] != grant.session_id or job['request_digest'] != grant.request_digest):
        raise BackgroundOwnershipError('Background owner, lease, epoch or native binding changed')
    if require_native_owner and (grant.native_owner is None or job['native_owner'] != grant.native_owner
        or job['native_owner'] is not None and job['native_owner_fence'] != grant.fence):
        raise BackgroundOwnershipError('Background native process ownership changed')
    parent = connection.execute(text('SELECT root_agent_id,role,depth,status,conversation_id,conversation_epoch,result_payload FROM conversation.root_executions WHERE id=:id'),
        {'id': job['parent_execution_id']}).mappings().one_or_none()
    if (parent is None or parent['role'] != 'root' or parent['depth'] != 0
        or parent['root_agent_id'] != conversation['root_agent_id'] or parent['conversation_id'] != grant.conversation_id
        or parent['conversation_epoch'] != grant.epoch or parent['status'] == 'cancellation_requested'
        or ((parent['result_payload'] or {}).get('nativeState') or {}).get('actorId') != grant.actor_id):
        raise BackgroundOwnershipError('Background ROOT binding changed')
    execution = connection.execute(text('SELECT role,result_payload FROM conversation.root_executions WHERE id=:id'),
        {'id': grant.execution_id}).mappings().one_or_none()
    if execution and execution['role'] == 'followup':
        followup = ((execution['result_payload'] or {}).get('nativeState') or {}).get('followup') or {}
        seal = ((parent['result_payload'] or {}).get('nativeState') or {}).get('schedulingSeal') or {}
        writer = connection.execute(text('''SELECT 1 FROM conversation.conversation_executions
            WHERE id=:id AND conversation_id=:conversation AND message_id=:message AND status='running'
                AND expires_at > clock_timestamp() FOR UPDATE'''),
            {'id': grant.execution_id, 'conversation': grant.conversation_id,
                'message': followup.get('publicationMessageId')}).one_or_none()
        if (not writer or not followup.get('manifestDigest') or followup['manifestDigest'] != seal.get('digest')
            or seal.get('followupExecutionId') != grant.execution_id):
            raise BackgroundOwnershipError('Synthesis writer or sealed manifest authority changed')
    invocation_id = metadata.get('invocation_id')
    if invocation_id and job['native_invocation_id'] not in (None, invocation_id):
        raise BackgroundOwnershipError('Background native invocation mapping conflicts')
    if not correlate:
        return job
    response_event_id = metadata.get('response_event_id')
    if response_event_id:
        if not grant.input_response_digest or job['input_response_digest'] != grant.input_response_digest:
            raise BackgroundOwnershipError('Background native response intent changed')
        if job['input_response_event_id'] == response_event_id:
            raise BackgroundResumeRequired('Background input response already committed; reconcile native history')
        expected = [{key: response[key] for key in ('input_id', 'function_name', 'response')}
            for response in job['pending_input_responses'] or []]
        if not expected or expected != metadata.get('function_responses'):
            raise BackgroundOwnershipError('Native input response was not durably authorized')
        connection.execute(text('''UPDATE conversation.root_background_jobs SET input_response_event_id=:event_id,
            pending_input_responses=NULL,updated_at=clock_timestamp() WHERE execution_id=:id'''),
            {'id': grant.execution_id, 'event_id': response_event_id})
    if metadata.get('initial_event_id') and job['initial_input_event_id'] is not None:
        raise BackgroundResumeRequired('Initial background input already committed; reconcile existing invocation')
    if invocation_id:
        connection.execute(text('''UPDATE conversation.root_background_jobs
            SET native_invocation_id=COALESCE(native_invocation_id,:invocation),
                initial_input_event_id=COALESCE(initial_input_event_id,:event_id),
                initial_input_digest=COALESCE(initial_input_digest,:digest),
                started_at=COALESCE(started_at,clock_timestamp()),updated_at=clock_timestamp()
            WHERE execution_id=:id'''), {'id': grant.execution_id, 'invocation': invocation_id,
                'event_id': metadata.get('initial_event_id'), 'digest': metadata.get('initial_digest')})


async def claim_native_owner(engine, grant: BackgroundWriteGrant):
    """Claim one native process before constructing a Runner or session service.

    A different process on the same backend fence must reconcile rather than
    execute. Backend takeover clears this claim while advancing the fence.
    """
    if grant.native_owner is None:
        raise ValueError('Native bootstrap requires a process owner')
    async with engine.begin() as connection:
        def claim(sync):
            job = _guard(sync, (grant, {}), require_native_owner=False)
            if job['native_owner'] is not None:
                if job['native_owner'] != grant.native_owner or job['native_owner_fence'] != grant.fence:
                    raise BackgroundResumeRequired('Another native process owns this dispatch; reconcile')
                return False
            sync.execute(text('''UPDATE conversation.root_background_jobs
                SET native_owner=:native_owner,native_owner_fence=:fence,updated_at=clock_timestamp()
                WHERE execution_id=:id'''), {'native_owner': grant.native_owner,
                    'fence': grant.fence, 'id': grant.execution_id})
            _guard(sync, (grant, {}))
            return True
        return await connection.run_sync(claim)


@event.listens_for(_BackgroundSqlSession, 'after_begin')
def _after_begin(session, transaction, connection):
    binding = _binding.get()
    if transaction.nested:
        # ADK creates app/user state inside savepoints. Authority locks were
        # acquired by the outer transaction and survive savepoint rollback.
        if (session.info.get('background_write_binding') != binding
            or session.info.get('background_control_connection') is not connection):
            raise BackgroundOwnershipError('Native savepoint escaped its guarded transaction')
        return
    _guard(connection, binding, correlate=True)
    session.info['background_write_binding'] = binding
    session.info['background_control_connection'] = connection


@event.listens_for(_BackgroundSqlSession, 'before_commit')
def _before_commit(session):
    binding = _binding.get()
    if session.in_nested_transaction():
        if session.info.get('background_write_binding') != binding:
            raise BackgroundOwnershipError('Native savepoint authority changed')
        return
    connection = session.connection()
    if session.info.get('background_write_binding') != binding:
        raise BackgroundOwnershipError('Native transaction authority changed before commit')
    _guard(connection, binding)


class FencedBackgroundSessionService(DatabaseSessionService):
    def __init__(self, grant: BackgroundWriteGrant, **kwargs):
        engine = kwargs.get('db_engine')
        url = kwargs.get('db_url')
        if ((engine is not None and engine.dialect.name != 'postgresql')
            or (url is not None and make_url(url).get_backend_name() != 'postgresql')):
            raise ValueError('Background session storage must colocate with PostgreSQL root controls')
        super().__init__(**kwargs)
        if self.db_engine.dialect.name != 'postgresql':
            raise ValueError('Background session storage must colocate with PostgreSQL root controls')
        self.grant = grant
        self.database_session_factory.configure(sync_session_class=_BackgroundSqlSession)

    def _validate_binding(self, app_name, user_id, session_id):
        if (app_name, user_id, session_id) != (self.grant.app_name, self.grant.actor_id, self.grant.session_id):
            raise BackgroundOwnershipError('Native session does not belong to this background execution')

    async def _check_colocation(self):
        # Check controls before ADK can prepare any native schema in a wrongly
        # configured database. Writes still recheck in their own transaction.
        async with self.db_engine.begin() as connection:
            await connection.run_sync(lambda sync: _guard(sync, (self.grant, {})))

    async def validate_owner(self):
        await self._check_colocation()

    async def control_state(self):
        async with self.db_engine.begin() as connection:
            return dict(await connection.run_sync(lambda sync: _guard(sync, (self.grant, {}))))

    async def get_session(self, *, app_name, user_id, session_id, config=None):
        self._validate_binding(app_name, user_id, session_id)
        await self._check_colocation()
        # A fresh service also prepares native metadata through its public
        # factory. Keep that transaction under the same trusted grant.
        token = _binding.set((self.grant, {}))
        try:
            return await super().get_session(app_name=app_name, user_id=user_id, session_id=session_id, config=config)
        finally:
            _binding.reset(token)

    async def delete_session(self, **kwargs):
        raise BackgroundOwnershipError('Background native history is retained for reconciliation')

    async def create_session(self, *, app_name, user_id, state=None, session_id=None, **kwargs):
        self._validate_binding(app_name, user_id, session_id)
        if self.grant.resume_intent == 'attach':
            raise BackgroundResumeRequired('Unconfirmed dispatch requires read-only reconciliation')
        await self._check_colocation()
        token = _binding.set((self.grant, {}))
        try:
            return await super().create_session(app_name=app_name, user_id=user_id, state=state,
                session_id=session_id, **kwargs)
        finally:
            _binding.reset(token)

    async def append_event(self, session, event):
        self._validate_binding(session.app_name, session.user_id, session.id)
        if self.grant.resume_intent == 'attach':
            raise BackgroundResumeRequired('Unconfirmed dispatch requires read-only reconciliation')
        event_copy = event.model_copy(deep=True)
        metadata = {'invocation_id': event_copy.invocation_id}
        initial = (self.grant.resume_intent == 'start' and event_copy.author == 'user'
            and event_copy.content is not None and any(part.text for part in event_copy.content.parts or []))
        if initial:
            event_copy.id = hashlib.sha256(f'{self.grant.execution_id}:initial'.encode()).hexdigest()[:32]
            metadata['initial_event_id'] = event_copy.id
            metadata['initial_digest'] = hashlib.sha256(json.dumps(event_copy.content.model_dump(mode='json', exclude_none=True),
                sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        responses = [part.function_response for part in getattr(event_copy.content, 'parts', None) or []
            if part.function_response] if event_copy.author == 'user' else []
        if responses:
            if self.grant.resume_intent != 'resume' or not self.grant.input_response_digest:
                raise BackgroundOwnershipError('Native response requires a durable resume intent')
            event_copy.id = hashlib.sha256(f'{self.grant.execution_id}:response:{self.grant.input_response_digest}'.encode()).hexdigest()[:32]
            metadata['response_event_id'] = event_copy.id
            metadata['function_responses'] = [{'input_id': response.id, 'function_name': response.name,
                'response': response.response} for response in responses]
        before = (deepcopy(session.state), list(session.events), session.last_update_time,
            getattr(session, '_storage_update_marker', None))
        token = _binding.set((self.grant, metadata))
        try:
            return await super().append_event(session, event_copy)
        except BaseException:
            session.state, session.events, session.last_update_time, session._storage_update_marker = before
            raise
        finally:
            _binding.reset(token)
