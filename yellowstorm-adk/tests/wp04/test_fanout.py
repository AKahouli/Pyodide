import asyncio
import hashlib
from types import SimpleNamespace

import pytest

from src.root_runtime.fanout import run_supervised_items, validate_manifest, fanout_result, build_fanout_dispatcher


@pytest.mark.asyncio
async def test_reverse_completion_preserves_order_and_local_limit():
    active = 0; maximum = 0; finished = []
    async def execute(item):
        nonlocal active, maximum
        active += 1; maximum = max(maximum, active)
        await asyncio.sleep((4 - item) * 0.01)
        finished.append(item); active -= 1
        return {'status': 'completed', 'item': item}
    result = await run_supervised_items([1, 2, 3], execute, 2)
    assert [item['item'] for item in result] == [1, 2, 3]
    assert maximum == 2
    assert finished[0] == 2


@pytest.mark.asyncio
async def test_native_wait_joins_active_sibling_and_preserves_signal():
    class NativeWait(BaseException):
        pass
    signal = NativeWait(); sibling_finished = False
    async def execute(item):
        nonlocal sibling_finished
        if item == 1:
            raise signal
        await asyncio.sleep(0.01); sibling_finished = True
        return {'status': 'completed'}
    with pytest.raises(NativeWait) as error:
        await run_supervised_items([1, 2], execute, 2)
    assert error.value is signal and sibling_finished


@pytest.mark.asyncio
async def test_stop_prevents_queued_item_start_and_joins_started_work():
    stop = asyncio.Event(); started = []; finished = []
    async def execute(item):
        started.append(item); stop.set()
        await asyncio.sleep(0.01); finished.append(item)
        return {'status': 'completed'}
    with pytest.raises(asyncio.CancelledError):
        await run_supervised_items([1, 2, 3], execute, 1, stop)
    assert started == finished == [1]


@pytest.mark.asyncio
async def test_outer_cancellation_awaits_all_started_cleanup():
    started = asyncio.Event(); cleaned = []
    async def execute(item):
        started.set()
        try:
            await asyncio.sleep(10)
        finally:
            cleaned.append(item)
    task = asyncio.create_task(run_supervised_items([1, 2], execute, 2))
    await started.wait(); task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert sorted(cleaned) == [1, 2]


def test_trusted_manifest_rejects_changed_branch_and_execution_identity():
    parent = 'a' * 24; branch = 'root.run_fanout@call'
    manifest_id = hashlib.sha256(f'{parent}:{branch}'.encode()).hexdigest()[:24]
    native_id = 'item_' + hashlib.sha256(f'{manifest_id}:one'.encode()).hexdigest()
    item_branch = f'{branch}.{native_id}.spawn_temporary_worker@{native_id}'
    manifest = {'manifestId': manifest_id, 'nativeCallId': 'call', 'nativeCallBranch': branch,
        'version': 1, 'mode': 'foreground', 'target': {'kind': 'temporary'}, 'items': [{ 'key': 'one',
        'nativeRunId': native_id, 'nativeCallBranch': item_branch,
        'executionId': hashlib.sha256(f'{parent}:{item_branch}'.encode()).hexdigest()[:24] }]}
    scope = SimpleNamespace(execution_id=parent)
    assert validate_manifest(scope, branch, 'call', manifest, 3) is manifest
    manifest['items'][0]['executionId'] = 'b' * 24
    with pytest.raises(ValueError, match='scope mismatch'):
        validate_manifest(scope, branch, 'call', manifest, 3)


def test_partial_coverage_preserves_order_references_and_marks_summary_limit():
    result = fanout_result({'manifestId': 'manifest', 'items': [{'key': 'one'}, {'key': 'two'}]},
        [{'status': 'completed', 'text': 'x' * 8000, 'result_ref': 'full-result', 'key': 'spoofed'},
         {'status': 'failed', 'safe_error': 'Failed'}])
    assert result['status'] == 'partial' and result['requested'] == 2
    assert result['counts']['completed'] == result['counts']['failed'] == 1
    assert [item['key'] for item in result['items']] == ['one', 'two']
    assert len(result['items'][0]['text']) == 4000
    assert result['items'][0]['summary_truncated'] and result['items'][0]['result_ref'] == 'full-result'


def test_fanout_is_opt_in_root_only_and_requires_shared_permits():
    from src.root_runtime.contracts import ExecutionRole
    assert build_fanout_dispatcher(None, None, {'fanout_enabled': False}, None) is None
    with pytest.raises(ValueError, match='depth-zero'):
        build_fanout_dispatcher(None, None, {'fanout_enabled': True}, SimpleNamespace(role=ExecutionRole.LIBRARY_WORKER, depth=1))
    with pytest.raises(ValueError, match='shared worker'):
        build_fanout_dispatcher(None, None, {'fanout_enabled': True}, SimpleNamespace(role=ExecutionRole.ROOT, depth=0))


def test_fanout_wire_defaults_and_enabled_fields():
    from src.grpc_generated.chatbot_pb2 import RootExecutionContext
    default = RootExecutionContext()
    assert not default.fanout_enabled and default.worker_permit_version == 0
    enabled = RootExecutionContext(worker_permit_version=1, fanout_enabled=True, max_fanout_items=3)
    assert RootExecutionContext.FromString(enabled.SerializeToString()) == enabled


@pytest.mark.asyncio
async def test_background_fanout_returns_only_a_stable_reference_and_uncertain_ack_never_restarts_work(monkeypatch):
    from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1
    from unittest.mock import AsyncMock
    scope = ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id='a' * 24)
    context = SimpleNamespace(function_call_id='call', branch='root', run_node=AsyncMock())
    config = {'fanout_enabled': True, 'worker_permit_version': 1, 'max_parallel_workers': 1,
        'max_fanout_items': 2, 'background_fanout_enabled': True}
    tool = build_fanout_dispatcher(None, None, config, scope)
    identity = hashlib.sha256(f'{scope.execution_id}:root.run_fanout@call:background_fanout'.encode()).hexdigest()[:24]
    post = AsyncMock(return_value={'executionId': identity, 'status': 'queued', 'resultRef': identity})
    monkeypatch.setattr('src.root_runtime.fanout._post', post)
    args = {'items': [{'key': 'one', 'task': 'Bounded'}], 'worker_type': 'temporary', 'tool_context': context, 'mode': 'background'}
    assert await tool.func(**args) == {'status': 'queued', 'execution_id': identity, 'result_ref': identity}
    context.run_node.assert_not_awaited()
    assert post.call_args.args[1] == 'background-fanout'
    post.side_effect = TimeoutError('lost acknowledgement')
    assert (await tool.func(**args))['status'] == 'outcome_unknown'
    context.run_node.assert_not_awaited()
    config['background_fanout_enabled'] = False
    post.reset_mock()
    rejection = await tool.func(**args)
    assert rejection['status'] == 'failed' and rejection['allowed_modes'] == ['foreground']
    assert rejection['error_code'] == 'fanout_mode_unavailable'
    assert 'execution_id' not in rejection and 'result_ref' not in rejection
    post.assert_not_awaited()
    context.run_node.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('background,mode', [(False, 'background'), (False, 'invalid'), (True, 'invalid')])
async def test_unavailable_mode_rejects_before_admission_and_logs_bounded_failure(monkeypatch, background, mode):
    from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1
    from unittest.mock import AsyncMock, Mock
    scope = ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id='a' * 24)
    context = SimpleNamespace(function_call_id='call', branch='root', run_node=AsyncMock())
    config = {'fanout_enabled': True, 'worker_permit_version': 1, 'max_parallel_workers': 1,
        'max_fanout_items': 2, 'background_fanout_enabled': background}
    tool = build_fanout_dispatcher(None, None, config, scope)
    post = AsyncMock(); warning = Mock()
    monkeypatch.setattr('src.root_runtime.fanout._post', post)
    monkeypatch.setattr('src.root_runtime.fanout.outcome_logger.warning', warning)
    result = await tool.func(items=[{'key': 'one', 'task': 'Private task'}], worker_type='temporary',
        tool_context=context, mode=mode)
    assert result['status'] == 'failed' and result['error_code'] == 'fanout_mode_unavailable'
    assert result['allowed_modes'] == (['foreground', 'background'] if background else ['foreground'])
    assert 'execution_id' not in result and 'result_ref' not in result
    post.assert_not_awaited(); context.run_node.assert_not_awaited()
    warning.assert_called_once_with('tool.call.failed', tool_name='run_fanout', operation='validate_mode', run_id=scope.execution_id)
    if not background:
        assert 'only mode="foreground"' in tool.description


@pytest.mark.asyncio
@pytest.mark.parametrize('mode', [None, 'foreground'])
async def test_foreground_mode_works_without_background_permission(monkeypatch, mode):
    from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1
    from unittest.mock import AsyncMock
    scope = ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id='a' * 24)
    branch = 'root.run_fanout@call'
    manifest_id = hashlib.sha256(f'{scope.execution_id}:{branch}'.encode()).hexdigest()[:24]
    native_id = 'item_' + hashlib.sha256(f'{manifest_id}:one'.encode()).hexdigest()
    item_branch = f'{branch}.{native_id}.spawn_temporary_worker@{native_id}'
    manifest = {'manifestId': manifest_id, 'nativeCallId': 'call', 'nativeCallBranch': branch,
        'version': 1, 'mode': 'foreground', 'target': {'kind': 'temporary'}, 'items': [{'key': 'one',
        'nativeRunId': native_id, 'nativeCallBranch': item_branch,
        'executionId': hashlib.sha256(f'{scope.execution_id}:{item_branch}'.encode()).hexdigest()[:24]}]}
    post = AsyncMock(return_value=manifest)
    monkeypatch.setattr('src.root_runtime.fanout._post', post)
    context = SimpleNamespace(function_call_id='call', branch='root', run_node=AsyncMock(return_value={'status': 'completed'}))
    tool = build_fanout_dispatcher(None, None, {'fanout_enabled': True, 'worker_permit_version': 1,
        'max_parallel_workers': 1, 'max_fanout_items': 2, 'background_fanout_enabled': False}, scope)
    args = {} if mode is None else {'mode': mode}
    assert await tool.func(items=[{'key': 'one', 'task': 'Bounded'}], worker_type='temporary', tool_context=context, **args) == {'status': 'completed'}
    assert post.call_args.args[1] == 'fanout-manifest' and post.call_args.args[2]['mode'] == 'foreground'
    assert context.run_node.call_args.kwargs['raise_on_wait'] is True


@pytest.mark.asyncio
@pytest.mark.parametrize('reason', ['Fan-out input reference is not authorized', 'Invalid foreground fan-out proposal',
    'Invalid fan-out target', 'Fan-out finite item or payload limit exceeded', 'Invalid or duplicate fan-out item'])
async def test_confirmed_proposal_rejection_returns_recovery_without_admission(monkeypatch, reason):
    import httpx
    from unittest.mock import AsyncMock, Mock
    from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1
    scope = ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id='a' * 24)
    context = SimpleNamespace(function_call_id='call', branch='root', run_node=AsyncMock())
    request = httpx.Request('POST', 'http://internal/fanout-manifest')
    response = httpx.Response(400, request=request, json={'error': {'message': reason, 'details': 'private response'}})
    post = AsyncMock(side_effect=httpx.HTTPStatusError('rejected', request=request, response=response))
    warning = Mock()
    monkeypatch.setattr('src.root_runtime.fanout._post', post)
    monkeypatch.setattr('src.root_runtime.fanout.outcome_logger.warning', warning)
    tool = build_fanout_dispatcher(None, None, {'fanout_enabled': True, 'worker_permit_version': 1,
        'max_parallel_workers': 1, 'max_fanout_items': 2}, scope)
    result = await tool.func(items=[{'key': 'one', 'task': 'Private task', 'contextRefs': ['conversation-id']}],
        worker_type='temporary', tool_context=context)
    assert result['status'] == 'failed' and result['error_code'] == 'fanout_proposal_rejected'
    assert 'No fan-out work was submitted' in result['safe_error']
    assert 'execution_id' not in result and 'result_ref' not in result
    assert 'private response' not in str(result) and 'Private task' not in str(result)
    if reason == 'Fan-out input reference is not authorized':
        assert 'never conversation or document IDs' in result['safe_error']
    assert post.await_count == 1
    context.run_node.assert_not_awaited()
    warning.assert_called_once_with('tool.call.failed', tool_name='run_fanout', operation='validate_manifest', run_id=scope.execution_id)


@pytest.mark.asyncio
@pytest.mark.parametrize('case', ['unknown400', 'malformed400', 'wrongshape400', 'oversized400', 'conflict', 'timeout'])
async def test_unconfirmed_rejection_never_claims_no_admission(monkeypatch, case):
    import httpx
    from unittest.mock import AsyncMock
    from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1
    request = httpx.Request('POST', 'http://internal/fanout-manifest')
    if case == 'timeout':
        error = httpx.ReadTimeout('uncertain', request=request)
    else:
        body = {'error': {'message': 'Unknown rejection'}} if case == 'unknown400' else {
            'error': {'message': 'Fan-out input reference is not authorized'}}
        response = httpx.Response(409 if case == 'conflict' else 400, request=request,
            **({'content': 'not-json'} if case == 'malformed400' else
               {'json': {'error': []}} if case == 'wrongshape400' else
               {'json': {**body, 'padding': 'x' * 8192}} if case == 'oversized400' else {'json': body}))
        error = httpx.HTTPStatusError('uncertain', request=request, response=response)
    post = AsyncMock(side_effect=error)
    monkeypatch.setattr('src.root_runtime.fanout._post', post)
    scope = ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id='a' * 24)
    context = SimpleNamespace(function_call_id='call', branch='root', run_node=AsyncMock())
    tool = build_fanout_dispatcher(None, None, {'fanout_enabled': True, 'worker_permit_version': 1,
        'max_parallel_workers': 1, 'max_fanout_items': 2}, scope)
    with pytest.raises(type(error)) as captured:
        await tool.func(items=[{'key': 'one', 'task': 'Bounded'}], worker_type='temporary', tool_context=context)
    assert captured.value is error and post.await_count == 1
    context.run_node.assert_not_awaited()
