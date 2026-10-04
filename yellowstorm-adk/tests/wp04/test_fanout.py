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
