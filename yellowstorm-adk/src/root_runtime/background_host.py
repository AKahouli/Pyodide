"""Background mono-agent host using the ordinary ADK factories and owned sink."""
from dataclasses import replace
from hashlib import sha256
from types import SimpleNamespace
import json
import uuid

from google.protobuf import json_format

from src.grpc_generated import chatbot_pb2
from src.root_runtime.background_sessions import (BackgroundWriteGrant, FencedBackgroundSessionService,
    claim_native_owner, validate_background_request)
from src.root_runtime.background_recovery import classify_native_history
from src.root_runtime.contracts import ExecutionScopeV1
from src.root_runtime.delegate_resolver import _post, _resolved_worker
from src.root_runtime.evidence_capture import collect_evidence
from src.root_runtime.execution_supervisor import BackgroundInvocationSupervisor
from src.schema.chatbot_schema import RunAgentTeamRequest

PUBLIC_COMPONENTS = frozenset({'code', 'agentActivity', 'plan', 'queue', 'checkpoint', 'chart',
    'toolActivity', 'error', 'sandbox', 'task', 'artifact', 'choice'})


def event_proposal(event, convert_component):
    trace = event.get('execution_trace')
    component = event.get('component', {})
    aliases = {'agent_activity': 'agentActivity', 'tool_activity': 'toolActivity'}
    kind = aliases.get(component.get('type'), component.get('type'))
    if trace and trace.get('native_session_id') and trace.get('lifecycle') not in (0, 'INVOCATION_LIFECYCLE_STATE_UNSPECIFIED'):
        converted = convert_component(event)
        proposal = {'kind': 'lifecycle',
            'trace': json_format.MessageToDict(converted.execution_trace, preserving_proto_field_name=True)}
    elif event.get('usage'):
        metadata = event.get('metadata', {})
        if not metadata.get('native_event_id') or not metadata.get('native_invocation_id'):
            raise ValueError('Background usage requires persisted native event identity')
        usage = event['usage']
        proposal = {'kind': 'usage', 'usage': {'inputTokens': usage.get('input_tokens', 0),
            'outputTokens': usage.get('output_tokens', 0), 'model': usage.get('model', '')}}
        identity = f"{metadata['native_invocation_id']}:{metadata['native_event_id']}:usage"
        return {'eventId': sha256(identity.encode()).hexdigest(), **proposal}
    elif kind in PUBLIC_COMPONENTS:
        converted = convert_component({key: value for key, value in event.items() if key != 'execution_trace'})
        proposal = {'kind': 'component', 'action': converted.action,
            'component': json_format.MessageToDict(converted.component, preserving_proto_field_name=True)}
    else:
        return None
    digest = sha256(json.dumps(proposal, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
    return {'eventId': digest, **proposal}


class BackgroundInvocationHost:
    def __init__(self, engine, agent_team_service, component_converter, *, supervisor=None):
        self.engine = engine
        self.agent_team_service = agent_team_service
        self.supervisor = supervisor or BackgroundInvocationSupervisor()
        self.native_owner = uuid.uuid4().hex
        self.component_converter = component_converter

    async def start(self, request):
        if request.protocol_version != 1:
            raise ValueError('Unsupported background invocation protocol')
        grant = BackgroundWriteGrant(request.execution_id, request.conversation_id, request.actor_id,
            request.conversation_epoch, request.owner, request.fence, f'background_{request.execution_id}',
            request.request_digest, native_owner=self.native_owner)
        await claim_native_owner(self.engine, grant)
        existing = self.supervisor.active.get(grant.execution_id)
        if existing is not None:
            await existing.service.validate_owner()
            if existing.service.grant != grant:
                # Resume intent may have advanced after initial correlation.
                if replace(existing.service.grant, resume_intent='start', input_response_digest=None) != grant:
                    raise ValueError('Local background invocation binding changed')
            return existing
        authority = self._authority(grant)
        resolved = await _post(SimpleNamespace(execution_id=grant.execution_id), 'background-definition', authority)
        control_workflow = resolved.get('kind') == 'fanout_driver'
        synthesis = resolved.get('kind') == 'followup'
        if not control_workflow:
            resolved = _resolved_worker(resolved)
        scope = ExecutionScopeV1.from_proto(json_format.ParseDict(resolved['executionScope'], chatbot_pb2.ExecutionScope()))
        grant = replace(grant, resume_intent=scope.resume_intent, input_response_digest=resolved.get('inputResponseDigest'))
        service = FencedBackgroundSessionService(grant, db_engine=self.engine)
        internal = (RunAgentTeamRequest(user_id=resolved['actorId'], session_id=grant.session_id,
            message='Run the immutable admitted fan-out manifest.', chatbot_name={}, agent_mode='mono', agents=[],
            execution_scope=scope, session_service=service, root_context=resolved['rootContext'],
            native_input_responses=resolved.get('inputResponses')) if control_workflow else self._request(resolved, scope, service))
        validate_background_request(service, scope, internal.user_id, internal.session_id)
        if synthesis:
            from src.root_runtime.contracts import ExecutionRole
            if scope.role is not ExecutionRole.FOLLOWUP or resolved.get('executionId') != grant.execution_id:
                raise ValueError('Synthesis execution binding changed')
            internal.message = resolved['request']['task']
        control = await service.control_state()
        if scope.parent_execution_id != control['parent_execution_id']:
            raise ValueError('Background worker parent binding changed')
        session = await service.get_session(app_name=grant.app_name, user_id=grant.actor_id, session_id=grant.session_id)
        from src.smart_rag.agents.core.helpers import AgentHelper
        if control_workflow:
            if scope.role.value != 'fanout_driver' or resolved.get('executionId') != grant.execution_id:
                raise ValueError('Background coordinator identity changed')
            from src.root_runtime.background_fanout import classify_fanout_history
            recovery = classify_fanout_history(session, control['native_invocation_id'], control['initial_input_event_id'])
        else:
            recovery = classify_native_history(session, control['native_invocation_id'], control['initial_input_event_id'],
                AgentHelper.normalize_agent_name(resolved['candidate'].name))
        if recovery.status == 'waiting' and internal.native_input_responses:
            recovery = replace(recovery, status='resume')
        if recovery.status == 'never_started' and scope.resume_intent != 'start':
            raise ValueError('Never-started background execution cannot resume')
        if control_workflow:
            from src.root_runtime.background_fanout import run_owned_fanout
            return await self._supervise(service, internal, recovery,
                run_workflow=lambda queue, abort: run_owned_fanout(service, internal, resolved['manifest'], queue, abort),
                producer_id=resolved['rootContext']['root_agent_id'])
        if synthesis:
            from src.root_runtime.background_synthesis import run_owned_synthesis
            return await self._supervise(service, internal, recovery,
                run_workflow=lambda queue, abort: run_owned_synthesis(service, internal, queue, abort),
                producer_id=resolved['rootContext']['root_agent_id'])
        return await self._supervise(service, internal, recovery)

    @staticmethod
    def _authority(grant):
        return {'owner': grant.owner, 'fence': grant.fence, 'nativeOwner': grant.native_owner,
            'requestDigest': grant.request_digest}

    @staticmethod
    def _request(resolved, scope, service):
        candidate = resolved['candidate']
        request = resolved['request']
        packet = ['<delegated_task>', f"<task>{request['task']}</task>"]
        if request.get('expectedOutput'):
            packet.append(f"<expected_output>{request['expectedOutput']}</expected_output>")
        packet.extend(f'<context_ref>{ref}</context_ref>' for ref in request.get('contextRefs', []))
        packet.append('</delegated_task>')
        return RunAgentTeamRequest(user_id=resolved['actorId'], session_id=service.grant.session_id,
            message='\n'.join(packet), chatbot_name=candidate.chatbot_name, agent_mode='mono', agents=[candidate],
            execution_scope=scope, session_service=service, brain_ids=candidate.brain_ids,
            workspace_names=candidate.workspace_names, brain_documents=candidate.brain_documents,
            native_input_responses=resolved.get('inputResponses'))

    async def _supervise(self, service, internal, recovery, run_workflow=None, producer_id=None):
        last_trace = None
        grant = service.grant
        authority = self._authority(grant)
        scope = internal.execution_scope

        async def persist(event):
            nonlocal last_trace
            proposal = event_proposal(event, self.component_converter)
            if proposal is None:
                return
            await _post(scope, 'background-events', {**authority, 'events': [proposal]})
            if proposal['kind'] == 'lifecycle':
                last_trace = proposal['trace']

        async def run(queue, abort):
            if recovery.status == 'waiting':
                from src.root_runtime.invocation import NativeInvocationProjection
                from src.root_runtime.contracts import InvocationLifecycleState
                projection = NativeInvocationProjection(scope, grant.session_id, producer_id or internal.agents[0].id)
                await projection.restore_pending(service, grant.actor_id, [])
                await projection.emit(queue, InvocationLifecycleState.WAITING)
            if recovery.status not in ('never_started', 'resume'):
                return recovery.text
            internal.abort_signal = abort
            from src.middleware.correlation import set_user_context, user_ctx
            token = set_user_context(grant.actor_id, 'background-worker')
            try:
                return await run_workflow(queue, abort) if run_workflow is not None else await self.agent_team_service.process_team_request(internal, queue)
            finally:
                user_ctx.reset(token)

        async def settle(result, status):
            if status == 'finished':
                if recovery.status not in ('never_started', 'resume'):
                    status = recovery.status
                elif last_trace and last_trace.get('pending_inputs'):
                    status = 'waiting'
                elif last_trace and last_trace.get('lifecycle') == 'INVOCATION_LIFECYCLE_STATE_COMPLETED':
                    status = 'completed'
                else:
                    status = 'outcome_unknown'
            payload = {**authority, 'status': status}
            if status == 'completed':
                if not isinstance(result, str) or len(result.encode()) > 262144:
                    raise ValueError('Completed background output is not bounded native text')
                session = await service.get_session(app_name=grant.app_name, user_id=grant.actor_id, session_id=grant.session_id)
                evidence = collect_evidence(session.state, grant.execution_id)
                payload.update(text=result[:8000], fullText=result,
                    evidence=[{key: item[key] for key in ('nativeIdentity', 'outputOrdinal', 'kind', 'payload')} for item in evidence])
            acknowledgement = await _post(scope, 'background-lifecycle', payload)
            if acknowledgement.get('status') != status:
                raise ValueError('Background outcome acknowledgement differs from committed state')
            return status

        return await self.supervisor.start_or_attach(service, run, persist, settle)
