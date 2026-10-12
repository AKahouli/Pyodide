from unittest.mock import AsyncMock, MagicMock

import pytest
from src.root_runtime import conversation_reply_controls as controls
from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1
from src.root_runtime.leaf_tools import is_leaf_tool

TARGET = 'a' * 24
CONTEXT = {'ongoing_requests': [{'assistant_message_ids': [TARGET]}]}


def make_tool():
    return controls.build_conversation_reply_control(CONTEXT,
        ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id='b' * 24))


def test_control_is_not_a_leaf_tool_or_available_to_workers():
    assert not is_leaf_tool(make_tool())
    for scope in (None, ExecutionScopeV1(role=ExecutionRole.TEMPORARY_WORKER, depth=1)):
        assert controls.build_conversation_reply_control(CONTEXT, scope) is None
    assert controls.build_conversation_reply_control({}, ExecutionScopeV1(role=ExecutionRole.ROOT)) is None


@pytest.mark.asyncio
async def test_bound_target_and_honest_acknowledgement(monkeypatch):
    post = AsyncMock(return_value={'messageId': TARGET, 'status': 'cancellation_requested'})
    logger = MagicMock()
    monkeypatch.setattr(controls, '_post', post)
    monkeypatch.setattr(controls, 'logger', logger)
    assert await make_tool().func(TARGET) == {'assistant_message_id': TARGET, 'status': 'cancellation_requested'}
    assert post.call_args.args[1:] == (f'conversation-replies/{TARGET}/cancel', {})
    logger.info.assert_called_once_with('tool.call.completed', tool_name='cancel_conversation_reply', operation='cancel_reply', run_id='b' * 24)


@pytest.mark.asyncio
async def test_invalid_and_unknown_outcomes_never_claim_stopped(monkeypatch):
    post = AsyncMock()
    monkeypatch.setattr(controls, '_post', post)
    monkeypatch.setattr(controls, 'logger', MagicMock())
    assert (await make_tool().func('c' * 24))['status'] == 'failed'
    post.assert_not_awaited()
    post.return_value = {'messageId': 'c' * 24, 'status': 'cancellation_requested'}
    assert (await make_tool().func(TARGET))['status'] == 'outcome_unknown'
    post.side_effect = RuntimeError('unavailable')
    assert (await make_tool().func(TARGET))['status'] == 'outcome_unknown'
    assert controls.logger.error.call_args.args == ('tool.call.failed',)
