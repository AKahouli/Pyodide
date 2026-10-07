"""Manifest producer authority under one fenced native coordinator invocation."""
import hashlib
import json

from sqlalchemy import text

from src.root_runtime.background_sessions import BackgroundOwnershipError, _guard
from src.root_runtime.contracts import ExecutionRole


def guard_item(connection, service, scope, require_active=False):
    grant = service.grant
    job = _guard(connection, (grant, {}))
    parent = connection.execute(text('SELECT root_agent_id,work_group_id,result_payload FROM conversation.root_executions WHERE id=:id'),
        {'id': job['parent_execution_id']}).mappings().one()
    coordinator = connection.execute(text('SELECT role,depth,result_payload FROM conversation.root_executions WHERE id=:id'),
        {'id': grant.execution_id}).mappings().one()
    worker = connection.execute(text('SELECT * FROM conversation.root_executions WHERE id=:id'),
        {'id': scope.execution_id}).mappings().one_or_none()
    root = parent['result_payload']['nativeState']
    control = coordinator['result_payload']['nativeState']
    binding = control.get('backgroundFanout', {})
    manifest = next((entry for entry in root.get('fanoutManifests', [])
        if entry.get('manifestId') == binding.get('manifestId') and entry.get('digest') == grant.request_digest), None)
    item = next((entry for entry in (manifest or {}).get('items', []) if entry.get('executionId') == scope.execution_id), None)
    if (not manifest or manifest.get('mode') != 'background' or not item or not worker
        or coordinator['role'] != 'fanout_driver' or coordinator['depth'] != 0
        or binding.get('digest') != grant.request_digest):
        raise BackgroundOwnershipError('Background producer is outside its owned manifest')
    proposal = {key: manifest[key] for key in ('version', 'mode', 'nativeCallId', 'nativeCallBranch', 'target')}
    proposal['items'] = [{**{key: entry[key] for key in ('key', 'task')},
        **({'expectedOutput': entry['expectedOutput']} if 'expectedOutput' in entry else {}),
        'contextRefs': entry.get('contextRefs', [])} for entry in manifest['items']]
    digest = lambda value: hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
        ensure_ascii=False, allow_nan=False).encode()).hexdigest()
    manifest_id = hashlib.sha256(f"{job['parent_execution_id']}:{manifest['nativeCallBranch']}".encode()).hexdigest()[:24]
    native_id = 'item_' + hashlib.sha256(f"{manifest_id}:{item['key']}".encode()).hexdigest()
    temporary = manifest['target']['kind'] == 'temporary'
    branch = f"{manifest['nativeCallBranch']}.{native_id}.{'spawn_temporary_worker' if temporary else 'delegate_to_agent'}@{native_id}"
    expected_id = hashlib.sha256(f"{job['parent_execution_id']}:{branch}".encode()).hexdigest()[:24]
    role = ExecutionRole.TEMPORARY_WORKER if temporary else ExecutionRole.LIBRARY_WORKER
    request = {'task': item['task'], 'expectedOutput': item.get('expectedOutput', ''), 'contextRefs': item.get('contextRefs', []),
        **({'nativeCallId': native_id, 'nativeCallBranch': branch} if temporary else {'agentId': manifest['target']['agentId']})}
    state = (worker['result_payload'] or {}).get('nativeState', {})
    persisted = state.get('scope', {})
    marker = state.get('backgroundFanoutItem', {})
    snapshot = root['scope'].get('immutableSnapshotRef') if temporary else next((entry.get('snapshot_digest')
        for entry in root.get('rootContext', {}).get('catalog', [])
        if entry.get('agent_id') == manifest['target'].get('agentId')), None)
    if (require_active and worker['status'] not in ('running', 'waiting')
        or digest(proposal) != grant.request_digest or manifest['manifestId'] != manifest_id
        or item.get('nativeRunId') != native_id or item.get('nativeCallBranch') != branch or item.get('executionId') != expected_id
        or item.get('requestDigest') != digest(request) or worker['role'] != role.value or worker['depth'] != 1
        or worker['parent_execution_id'] != job['parent_execution_id'] or worker['conversation_id'] != grant.conversation_id
        or worker['root_agent_id'] != parent['root_agent_id'] or worker['work_group_id'] != parent['work_group_id']
        or worker['conversation_epoch'] != grant.epoch or state.get('actorId') != grant.actor_id
        or state.get('sessionId') != grant.session_id or marker != {'coordinatorExecutionId': grant.execution_id,
            'manifestId': manifest_id, 'digest': grant.request_digest}
        or state.get('rootContext', {}).get('delegate_request_digest') != digest(request)
        or state.get('rootContext', {}).get('selected_agent_id') != (scope.execution_id if temporary else manifest['target']['agentId'])
        or state.get('admittedRequest') != {**request, 'nativeCallId': native_id, 'nativeCallBranch': branch}
        or persisted.get('executionId') != expected_id or persisted.get('parentExecutionId') != job['parent_execution_id']
        or persisted.get('role') != role.value or persisted.get('depth') != 1 or persisted.get('immutableSnapshotRef') != snapshot
        or persisted.get('conversationEpoch') != grant.epoch or persisted.get('nativeSessionId') != grant.session_id
        or not snapshot or scope.execution_id != expected_id or scope.parent_execution_id != job['parent_execution_id']
        or scope.role is not role or scope.depth != 1 or scope.conversation_epoch != grant.epoch
        or scope.immutable_snapshot_ref != snapshot or scope.expected_fence != str(grant.fence)
        or scope.native_session_id != grant.session_id or scope.native_invocation_id not in (None, job['native_invocation_id'])):
        raise BackgroundOwnershipError('Background producer binding changed')
    return job


async def validate_item(service, scope):
    async with service.db_engine.begin() as connection:
        await connection.run_sync(lambda sync: guard_item(sync, service, scope))
