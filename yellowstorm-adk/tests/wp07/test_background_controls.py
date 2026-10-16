from unittest.mock import AsyncMock, Mock
from types import SimpleNamespace

import pytest

from src.root_runtime.background_controls import build_background_control_tools
from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1
from src.root_runtime.leaf_tools import is_leaf_tool


def controls():
    scope = ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id='a' * 24)
    return scope, {tool.name: tool for tool in build_background_control_tools({'background_enabled': True}, scope)}


@pytest.mark.asyncio
async def test_native_capability_versions_nonblocking_synthesis_without_enabling_background(monkeypatch):
    from src.grpc_server.background_rpc import BackgroundRpc
    monkeypatch.setattr('src.grpc_server.background_rpc.get_settings', lambda: SimpleNamespace(ROOT_WORK_BACKGROUND_ENABLED=False))
    capabilities = await BackgroundRpc(None, None).capabilities()
    assert capabilities.background_followup_protocol_version == 2
    assert not capabilities.background_ready


def test_controls_are_opt_in_root_only_and_never_available_to_workers():
    scope, tools = controls()
    assert build_background_control_tools({'background_enabled': False}, scope) == []
    assert all(not is_leaf_tool(tool) for tool in tools.values())
    with pytest.raises(ValueError, match='depth-zero ROOT'):
        build_background_control_tools({'background_enabled': True}, ExecutionScopeV1(role=ExecutionRole.TEMPORARY_WORKER, depth=1))


@pytest.mark.asyncio
async def test_list_discovers_earlier_jobs_and_discards_private_metadata(monkeypatch):
    scope, tools = controls()
    job_id = 'b' * 24
    post = AsyncMock(return_value={'jobs': [{'executionId': job_id, 'task': 'Research', 'status': 'running',
        'private': 'do not expose'}]})
    monkeypatch.setattr('src.root_runtime.background_controls._post', post)
    assert await tools['list_background_tasks'].func() == {'jobs': [{'execution_id': job_id, 'task': 'Research', 'status': 'running'}]}
    post.assert_awaited_once_with(scope, 'background-tasks', {})
    post.return_value = {'jobs': [{'executionId': '../other', 'status': 'running', 'task': 'Research'}]}
    assert (await tools['list_background_tasks'].func())['status'] == 'outcome_unknown'


@pytest.mark.asyncio
async def test_result_pages_validate_identity_size_and_offsets(monkeypatch):
    _, tools = controls()
    job_id = 'b' * 24
    post = AsyncMock(return_value={'executionId': job_id, 'text': 'Committed result', 'nextOffset': None, 'private': 'discard'})
    monkeypatch.setattr('src.root_runtime.background_controls._post', post)
    tool = tools['get_background_task_result']
    assert await tool.func(job_id) == {'execution_id': job_id, 'text': 'Committed result', 'next_offset': None}
    assert (await tool.func(job_id, -1))['status'] == 'failed'
    assert (await tool.func(job_id, True))['status'] == 'failed'
    assert post.await_count == 1
    post.return_value = {'executionId': 'c' * 24, 'text': 'wrong result', 'nextOffset': None}
    assert (await tool.func(job_id))['status'] == 'outcome_unknown'


@pytest.mark.asyncio
async def test_cancel_reports_fenced_request_and_logs_unconfirmed_failure_without_leaking_payload(monkeypatch):
    scope, tools = controls()
    job_id = 'b' * 24
    post = AsyncMock(return_value={'executionId': job_id, 'status': 'cancelled', 'cancellationRequested': True})
    logger = Mock()
    monkeypatch.setattr('src.root_runtime.background_controls._post', post)
    monkeypatch.setattr('src.root_runtime.background_controls.logger', logger)
    tool = tools['cancel_background_task']
    result = await tool.func(job_id)
    assert result['cancellation_requested'] and result['status'] == 'cancelled'
    post.assert_awaited_once_with(scope, f'background-tasks/{job_id}/cancel', {})
    assert (await tool.func('../other'))['status'] == 'failed'
    post.side_effect = OSError('private failure')
    result = await tool.func(job_id)
    assert result['status'] == 'outcome_unknown' and 'private' not in str(result)
    assert logger.error.call_args.args[0] == 'tool.call.failed'
    assert logger.error.call_args.kwargs['tool_name'] == 'cancel_background_task'
    assert logger.error.call_args.kwargs['run_id'] == scope.execution_id
    assert logger.info.call_args.args[0] == 'tool.call.completed'
    assert logger.warning.call_args.kwargs['operation'] == 'validate_reference'
