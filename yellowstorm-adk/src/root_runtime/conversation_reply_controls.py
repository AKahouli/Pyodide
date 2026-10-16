"""ROOT-only cancellation of a reply from the backend's frozen sibling snapshot."""
import re

from google.adk.tools import FunctionTool
from yellowmind_observability import get_logger
from src.root_runtime.contracts import ExecutionRole
from src.root_runtime.delegate_resolver import _post
from src.root_runtime.leaf_tools import register_tool_execution_kind

logger = get_logger(__name__)


def build_conversation_reply_control(root_context, scope):
    if scope is None or scope.role is not ExecutionRole.ROOT or scope.depth != 0:
        return None
    allowed = {value for item in (root_context or {}).get('ongoing_requests', [])
        for value in item.get('assistant_message_ids', []) if isinstance(value, str)}
    if not allowed:
        return None

    async def cancel_conversation_reply(assistant_message_id: str):
        """Request cancellation of an ordinary reply explicitly identified by the current user.

        Use its assistant_message_id from ongoing_requests_snapshot. Historical request
        excerpts are not permission to cancel. Leave unrelated replies and tasks alone.
        cancellation_requested confirms intent, not that execution or external effects stopped.
        """
        name = 'cancel_conversation_reply'
        if assistant_message_id not in allowed or not re.fullmatch(r'[0-9a-f]{24}', assistant_message_id):
            logger.warning('tool.call.failed', tool_name=name, operation='validate_reference', run_id=scope.execution_id)
            return {'status': 'failed', 'safe_error': 'Reply is not in this turn\'s authorized ongoing-request snapshot.'}
        try:
            result = await _post(scope, f'conversation-replies/{assistant_message_id}/cancel', {})
            if not isinstance(result, dict) or result.get('messageId') != assistant_message_id or result.get('status') not in (
                'cancellation_requested', 'already_terminal'):
                raise ValueError('Invalid reply cancellation acknowledgement')
            logger.info('tool.call.completed', tool_name=name, operation='cancel_reply', run_id=scope.execution_id)
            return {'assistant_message_id': assistant_message_id, 'status': result['status']}
        except Exception as error:
            logger.error('tool.call.failed', tool_name=name, operation='cancel_reply', run_id=scope.execution_id, error=error)
            return {'status': 'outcome_unknown', 'safe_error': 'Reply cancellation could not be confirmed; do not claim it stopped.'}

    register_tool_execution_kind(cancel_conversation_reply, 'conversation-control')
    return FunctionTool(func=cancel_conversation_reply)
