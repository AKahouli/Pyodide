"""ROOT-only durable submission; no worker or model is built by this tool."""
from typing import Literal
import re

from google.adk.tools import FunctionTool, ToolContext

from src.root_runtime.contracts import ExecutionRole
from src.root_runtime.delegate_resolver import _post
from src.root_runtime.leaf_tools import register_tool_execution_kind
from src.root_runtime.dispatcher import child_execution_id

BACKGROUND_INSTRUCTION = """
<root_background>
start_background_task submits one authorized specialist or restricted temporary
worker to durable background execution. Use only when background work is useful
to the user's request. Its queued/running acknowledgement is not completed work;
report the job reference honestly and retrieve committed results before synthesis.
Background workers cannot delegate, spawn, fan out or create nested background work.
</root_background>
"""


def build_background_dispatcher(root_context, root_scope):
    if root_context.get('background_enabled') is not True:
        return None
    if root_scope is None or root_scope.role is not ExecutionRole.ROOT or root_scope.depth != 0:
        raise ValueError('Only a depth-zero ROOT can submit background work')
    catalog = {entry.get('agent_id') for entry in root_context.get('catalog', [])}

    async def start_background_task(task: str, worker_kind: Literal['specialist', 'temporary'],
            tool_context: ToolContext, agent_id: str = '', expected_output: str = '', context_refs: list[str] = None):
        """Submit one bounded background task and return its durable job reference.

        specialist requires an authorized agent_id; temporary derives the ROOT's
        restricted profile and requires an empty agent_id. No profile is created.
        """
        call_id = tool_context.function_call_id
        if not call_id or worker_kind not in ('specialist', 'temporary') or worker_kind == 'specialist' and agent_id not in catalog or worker_kind == 'temporary' and (
            agent_id or root_context.get('temporary_workers_enabled') is not True):
            return {'status': 'failed', 'safe_error': 'Background worker is not authorized.'}
        operation = 'spawn_temporary_worker' if worker_kind == 'temporary' else 'delegate_to_agent'
        prefix = f'{tool_context.branch}.' if tool_context.branch else ''
        branch = f'{prefix}start_background_task@{call_id}.{operation}@{call_id}'
        execution_id = child_execution_id(root_scope.execution_id, branch)
        try:
            result = await _post(root_scope, 'background-task', {'workerKind': worker_kind,
                'nativeCallId': call_id, 'nativeCallBranch': branch, 'task': task,
                'expectedOutput': expected_output, 'contextRefs': context_refs or [],
                **({'agentId': agent_id} if worker_kind == 'specialist' else {})})
            if result.get('executionId') != execution_id or result.get('resultRef') != execution_id or result.get('status') not in (
                'queued', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'outcome_unknown'):
                raise ValueError('Invalid durable background acknowledgement')
            return {'status': result['status'], 'execution_id': result['executionId'], 'result_ref': result['resultRef']}
        except Exception:
            return {'status': 'outcome_unknown', 'execution_id': execution_id, 'result_ref': execution_id,
                'safe_error': 'Submission could not be confirmed. Inspect this job before submitting another task.'}

    register_tool_execution_kind(start_background_task, 'background')
    return FunctionTool(func=start_background_task)


def build_background_status_tool(root_context, root_scope):
    if root_context.get('background_enabled') is not True:
        return None
    if root_scope is None or root_scope.role is not ExecutionRole.ROOT or root_scope.depth != 0:
        raise ValueError('Only a depth-zero ROOT can inspect background work')

    async def get_background_task_status(execution_id: str):
        """Inspect the current owned job before retrying an uncertain submission."""
        if not re.fullmatch(r'[0-9a-f]{24}', execution_id):
            return {'status': 'outcome_unknown', 'safe_error': 'Invalid background job reference.'}
        try:
            result = await _post(root_scope, f'background-tasks/{execution_id}/status', {})
            if result.get('executionId') != execution_id or result.get('resultRef') != execution_id or result.get('status') not in (
                'queued', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'outcome_unknown'):
                raise ValueError('Invalid background job status')
            return {'status': result['status'], 'execution_id': execution_id, 'result_ref': execution_id}
        except Exception:
            return {'status': 'outcome_unknown', 'execution_id': execution_id,
                'safe_error': 'Current job status could not be verified; do not assume submission failed.'}

    register_tool_execution_kind(get_background_task_status, 'background-control')
    return FunctionTool(func=get_background_task_status)
