"""ROOT controls for authorized conversation jobs across foreground turns."""
import re

from google.adk.tools import FunctionTool
from yellowmind_observability import get_logger

from src.root_runtime.background_dispatcher import build_background_status_tool
from src.root_runtime.contracts import ExecutionRole
from src.root_runtime.delegate_resolver import _post
from src.root_runtime.leaf_tools import register_tool_execution_kind

logger = get_logger(__name__)
STATUSES = frozenset(('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'outcome_unknown'))


def build_background_control_tools(root_context, scope):
    if root_context.get('background_enabled') is not True:
        return []
    if scope is None or scope.role is not ExecutionRole.ROOT or scope.depth != 0:
        raise ValueError('Only a depth-zero ROOT can control background work')

    async def control(name, path, payload, validate):
        try:
            result = await _post(scope, path, payload)
            if not validate(result):
                raise ValueError('Invalid background control acknowledgement')
            logger.info('tool.call.completed', tool_name=name, operation='background_control', run_id=scope.execution_id)
            return result
        except Exception as error:
            logger.error('tool.call.failed', tool_name=name, operation='background_control',
                run_id=scope.execution_id, error=error)
            return {'status': 'outcome_unknown', 'safe_error': 'The task control could not be confirmed. Check its status before retrying.'}

    def identity(value):
        return isinstance(value, str) and re.fullmatch(r'[0-9a-f]{24}', value) is not None

    def invalid(name, message):
        logger.warning('tool.call.failed', tool_name=name, operation='validate_reference', run_id=scope.execution_id)
        return {'status': 'failed', 'safe_error': message}

    async def list_background_tasks():
        """List up to 20 authorized recent tasks in this conversation, including earlier turns."""
        result = await control('list_background_tasks', 'background-tasks', {}, lambda value:
            isinstance(value, dict) and isinstance(value.get('jobs'), list) and len(value['jobs']) <= 20
            and all(isinstance(job, dict) and identity(job.get('executionId')) and job.get('status') in STATUSES
                and isinstance(job.get('task'), str) and len(job['task']) <= 240 for job in value['jobs']))
        if 'jobs' not in result:
            return result
        return {'jobs': [{'execution_id': job['executionId'], 'status': job['status'], 'task': job['task']}
            for job in result['jobs']]}

    async def get_background_task_result(execution_id: str, offset: int = 0):
        """Read committed completed output in bounded pages; never infer completion from progress."""
        if not identity(execution_id) or type(offset) is not int or not 0 <= offset <= 262144:
            return invalid('get_background_task_result', 'Invalid task result reference or offset.')
        result = await control('get_background_task_result', f'background-tasks/{execution_id}/result', {'offset': offset}, lambda value:
            isinstance(value, dict) and value.get('executionId') == execution_id and isinstance(value.get('text'), str)
            and len(value['text']) <= 8000 and (value.get('nextOffset') is None
                or type(value['nextOffset']) is int and offset < value['nextOffset'] <= 262144))
        if 'text' not in result:
            return result
        return {'execution_id': execution_id, 'text': result['text'], 'next_offset': result.get('nextOffset')}

    async def cancel_background_task(execution_id: str):
        """Cancel only a task explicitly named by the user, leaving other work and chat intact.

        Task instructions are immutable. To change them, cancel and separately submit
        revised work; reconcile uncertain earlier external effects before repeating them.
        """
        if not identity(execution_id):
            return invalid('cancel_background_task', 'Invalid task reference.')
        result = await control('cancel_background_task', f'background-tasks/{execution_id}/cancel', {}, lambda value:
            isinstance(value, dict) and value.get('executionId') == execution_id and value.get('status') in STATUSES
            and type(value.get('cancellationRequested')) is bool)
        if 'executionId' not in result:
            return result
        return {'execution_id': execution_id, 'status': result['status'],
            'cancellation_requested': result['cancellationRequested'],
            'note': 'Already started external effects may still require reconciliation.'}

    tools = [build_background_status_tool(root_context, scope)]
    for func in (list_background_tasks, get_background_task_result, cancel_background_task):
        register_tool_execution_kind(func, 'background-control')
        tools.append(FunctionTool(func=func))
    return tools
