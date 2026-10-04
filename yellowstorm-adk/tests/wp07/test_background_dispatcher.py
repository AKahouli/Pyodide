from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.root_runtime.background_dispatcher import build_background_dispatcher, build_background_status_tool
from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1
from src.root_runtime.leaf_tools import is_leaf_tool
from src.root_runtime.dispatcher import child_execution_id


def context():
    return {'background_enabled': True, 'temporary_workers_enabled': True,
        'catalog': [{'agent_id': 'worker'}]}


def test_background_tool_is_opt_in_root_only_and_never_leaf_approved():
    root = ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id='root')
    assert build_background_dispatcher({'background_enabled': False}, root) is None
    with pytest.raises(ValueError, match='depth-zero ROOT'):
        build_background_dispatcher(context(), ExecutionScopeV1(role=ExecutionRole.LIBRARY_WORKER, depth=1))
    assert not is_leaf_tool(build_background_dispatcher(context(), root))


@pytest.mark.asyncio
async def test_submission_carries_trusted_branch_and_returns_only_durable_reference(monkeypatch):
    child_id = child_execution_id('root', 'root@1.start_background_task@call.delegate_to_agent@call')
    post = AsyncMock(return_value={'executionId': child_id, 'status': 'queued', 'resultRef': child_id, 'private': 'discard'})
    monkeypatch.setattr('src.root_runtime.background_dispatcher._post', post)
    root = ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id='root')
    tool = build_background_dispatcher(context(), root)
    native = SimpleNamespace(function_call_id='call', branch='root@1')
    result = await tool.func('task', 'specialist', native, agent_id='worker')
    assert result == {'execution_id': child_id, 'status': 'queued', 'result_ref': child_id}
    request = post.call_args.args[2]
    assert request['nativeCallBranch'] == 'root@1.start_background_task@call.delegate_to_agent@call'
    assert request['agentId'] == 'worker'
    assert (await tool.func('task', 'specialist', native, agent_id='unknown'))['status'] == 'failed'
    assert (await tool.func('task', 'temporary', native, agent_id='worker'))['status'] == 'failed'
    assert post.await_count == 1
    await tool.func('task', 'temporary', native)
    assert 'agentId' not in post.call_args.args[2]
    post.side_effect = OSError('lost acknowledgement')
    result = await tool.func('task', 'specialist', native, agent_id='worker')
    assert result['status'] == 'outcome_unknown' and result['execution_id'] == child_id


@pytest.mark.asyncio
async def test_status_control_is_root_only_and_rejects_mismatched_or_unverifiable_references(monkeypatch):
    root = ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id='root')
    assert build_background_status_tool({'background_enabled': False}, root) is None
    with pytest.raises(ValueError, match='depth-zero ROOT'):
        build_background_status_tool(context(), ExecutionScopeV1(role=ExecutionRole.LIBRARY_WORKER, depth=1))
    tool = build_background_status_tool(context(), root)
    assert not is_leaf_tool(tool)
    execution_id = 'a' * 24
    post = AsyncMock(return_value={'executionId': execution_id, 'resultRef': execution_id,
        'status': 'waiting', 'private': 'discard'})
    monkeypatch.setattr('src.root_runtime.background_dispatcher._post', post)
    assert await tool.func(execution_id) == {'execution_id': execution_id,
        'result_ref': execution_id, 'status': 'waiting'}
    post.assert_awaited_once_with(root, f'background-tasks/{execution_id}/status', {})
    assert (await tool.func('../other'))['status'] == 'outcome_unknown'
    assert post.await_count == 1
    post.return_value = {'executionId': 'b' * 24, 'resultRef': execution_id, 'status': 'completed'}
    assert (await tool.func(execution_id))['status'] == 'outcome_unknown'
    post.side_effect = OSError('private transport detail')
    result = await tool.func(execution_id)
    assert result['status'] == 'outcome_unknown' and result['execution_id'] == execution_id
    assert 'private' not in str(result)
