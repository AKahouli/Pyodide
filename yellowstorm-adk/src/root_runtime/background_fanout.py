"""Owned adapters for the same native finite fan-out Workflow."""
from types import SimpleNamespace
from dataclasses import replace
import json
import re

from google.protobuf import json_format

from src.grpc_generated import chatbot_pb2
from src.root_runtime.background_items import validate_item
from src.root_runtime.contracts import ExecutionScopeV1
from src.root_runtime.delegate_resolver import _post, _resolved_worker


def classify_fanout_history(session, invocation_id, initial_event_id):
    from src.root_runtime.background_recovery import BackgroundRecovery, classify_native_history
    base = classify_native_history(session, invocation_id, initial_event_id, 'background_fanout')
    if base.status != 'resume':
        return base
    ended = False
    output = None
    for event in session.events:
        path = getattr(event.node_info, 'path', '') or event.author
        if event.invocation_id != invocation_id or event.author != 'background_fanout':
            continue
        if re.fullmatch(r'background_fanout@[1-9][0-9]*/fanout_driver@[1-9][0-9]*', path) and isinstance(event.output, dict):
            output = event.output
        elif re.fullmatch(r'background_fanout(?:@[1-9][0-9]*)?', path):
            if event.actions.end_of_agent:
                ended = True
            elif event.actions.agent_state is not None:
                ended = False
    if ended and output is not None:
        return BackgroundRecovery('completed', text=json.dumps(output, separators=(',', ':'), ensure_ascii=False))
    return base


async def run_owned_fanout(service, request, manifest, queue, abort):
    from google.adk.apps import App
    from google.adk.apps.app import ResumabilityConfig
    from google.adk.runners import Runner
    from google.genai import types
    from src.root_runtime.contracts import ExecutionRole, InvocationLifecycleState
    from src.root_runtime.fanout import build_fanout_workflow
    from src.root_runtime.invocation import NativeInvocationProjection, native_run_options
    from src.smart_rag.engines.multi_agent.agentic_workflows.team_configuration import initialize_dependencies, create_team, create_team_config
    from src.smart_rag.infrastructure.session.citation_manager import get_citation_manager
    scope = request.execution_scope
    root_scope = replace(scope, role=ExecutionRole.ROOT, execution_id=scope.parent_execution_id, parent_execution_id=None)
    adapter = OwnedFanoutAdapter(service, manifest)
    request.abort_signal = abort
    team = create_team(create_team_config(request), initialize_dependencies())
    team.current_queue = queue
    team.citation_manager = await get_citation_manager(service.grant.session_id)
    team.delegation_factory.citation_manager = team.citation_manager
    workflow = build_fanout_workflow(team, request, request.root_context, root_scope, adapter, manifest)
    runner = Runner(app=App(name=service.grant.app_name, root_agent=workflow,
        resumability_config=ResumabilityConfig(is_resumable=True)), session_service=service)
    if await service.get_session(app_name=service.grant.app_name, user_id=service.grant.actor_id, session_id=service.grant.session_id) is None:
        await service.create_session(app_name=service.grant.app_name, user_id=service.grant.actor_id, session_id=service.grant.session_id)
    projection = NativeInvocationProjection(scope, service.grant.session_id, request.root_context['root_agent_id'])
    options = native_run_options(scope, types.Content(role='user', parts=[types.Part(text=request.message)]), request.native_input_responses)
    async for event in runner.run_async(user_id=service.grant.actor_id, session_id=service.grant.session_id, abort_signal=abort, **options):
        await projection.observe(event, queue)
    session = await service.get_session(app_name=service.grant.app_name, user_id=service.grant.actor_id, session_id=service.grant.session_id)
    control = await service.control_state()
    recovery = classify_fanout_history(session, control['native_invocation_id'], control['initial_input_event_id'])
    if recovery.status == 'completed':
        await projection.emit(queue, InvocationLifecycleState.COMPLETED)
        return recovery.text
    if recovery.status == 'waiting':
        await projection.emit(queue, InvocationLifecycleState.WAITING)
        return None
    raise ValueError('Native coordinator did not commit a terminal workflow checkpoint')


class OwnedFanoutAdapter:
    def __init__(self, service, manifest):
        self.service = service
        self.items = {item['executionId']: item for item in manifest['items']}
        self.scope = SimpleNamespace(execution_id=service.grant.execution_id)

    def authority(self):
        grant = self.service.grant
        return {'owner': grant.owner, 'fence': grant.fence, 'nativeOwner': grant.native_owner,
            'requestDigest': grant.request_digest}

    def path(self, execution_id, operation):
        if execution_id not in self.items:
            raise ValueError('Worker is outside the owned manifest')
        return f'background-items/{execution_id}/{operation}'

    async def resolve(self, execution_id):
        result = await _post(self.scope, self.path(execution_id, 'definition'), self.authority())
        if result.get('kind') != 'worker' or result.get('executionId') != execution_id:
            raise ValueError('Invalid owned worker definition')
        result = _resolved_worker(result)
        result['scope'] = ExecutionScopeV1.from_proto(json_format.ParseDict(result['executionScope'], chatbot_pb2.ExecutionScope()))
        await validate_item(self.service, result['scope'])
        return result

    async def validate(self, scope):
        current = await self.resolve(scope.execution_id)
        if current['scope'] != scope:
            raise ValueError('Owned producer scope changed before native execution')

    async def permit(self, execution_id, owner, operation):
        return await _post(self.scope, self.path(execution_id, 'permit'),
            {**self.authority(), 'permitOwner': owner, 'operation': operation})

    async def settle(self, execution_id, status, text=None, evidence=None):
        if text is not None and len(text.encode()) > 262144:
            raise ValueError('Child output exceeds the durable result limit')
        return await _post(self.scope, self.path(execution_id, 'lifecycle'), {**self.authority(), 'status': status,
            **({'text': text[:8000], 'fullText': text} if text is not None else {}),
            **({'evidence': [{key: item[key] for key in ('nativeIdentity', 'outputOrdinal', 'kind', 'payload')}
                for item in evidence]} if evidence else {})})
