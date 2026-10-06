"""Finite foreground fan-out using trusted reservations and native child runs."""
from __future__ import annotations

import asyncio
import hashlib
from typing import Any

from google.adk.tools import FunctionTool
from google.adk.tools.tool_context import ToolContext
from google.adk.workflow import FunctionNode, START, Workflow

from src.logger.logging import get_logger
from src.root_runtime.contracts import ExecutionRole
from src.root_runtime.delegate_resolver import _post, settle_delegate
from src.root_runtime.dispatcher import build_worker_dispatcher, child_execution_id

logger = get_logger('root_runtime.fanout')


async def run_supervised_items(items, execute, parallel: int, abort_signal=None):
    """Join every started sibling before returning or propagating native WAIT."""
    semaphore = asyncio.Semaphore(parallel)
    results = [None] * len(items)
    interrupts = []

    async def run_one(index, item):
        async with semaphore:
            try:
                if abort_signal is not None and abort_signal.is_set():
                    raise asyncio.CancelledError('Fan-out cancelled before item start')
                results[index] = await execute(item)
            except BaseException as error:
                # Native NodeInterruptedError is BaseException. Keep the exact
                # signal; the caller must never synthesize a successful result.
                interrupts.append(error)

    tasks = [asyncio.create_task(run_one(index, item)) for index, item in enumerate(items)]
    try:
        await asyncio.gather(*tasks)
    except BaseException:
        for task in tasks:
            task.cancel()
        for task in tasks:
            try:
                await task
            except asyncio.CancelledError:
                continue
        raise
    if interrupts:
        cancellation = next((error for error in interrupts if isinstance(error, asyncio.CancelledError)), None)
        raise cancellation or interrupts[0]
    return results


def fanout_result(manifest, results):
    per_item = max(1, 8000 // len(manifest['items']))
    ordered = []
    for item, result in zip(manifest['items'], results):
        result = {**result, 'key': item['key']}
        text = result.get('text')
        if isinstance(text, str) and len(text) > per_item:
            result['text'] = text[:per_item]
            result['summary_truncated'] = True
        ordered.append(result)
    counts = {status: sum(item['status'] == status for item in ordered)
              for status in ('completed', 'failed', 'outcome_unknown', 'cancelled', 'waiting')}
    return {'manifest_id': manifest['manifestId'], 'requested': len(ordered), 'counts': counts,
        'status': 'completed' if counts['completed'] == len(ordered) else 'partial', 'items': ordered}


def validate_manifest(scope, branch, call_id, manifest, maximum):
    expected_id = hashlib.sha256(f'{scope.execution_id}:{branch}'.encode()).hexdigest()[:24]
    items = manifest.get('items')
    if (manifest.get('manifestId') != expected_id or manifest.get('nativeCallBranch') != branch
        or manifest.get('nativeCallId') != call_id or manifest.get('version') != 1
        or manifest.get('mode') != 'foreground' or not isinstance(items, list)
        or not 1 <= len(items) <= maximum):
        raise ValueError('Invalid trusted fan-out manifest')
    target = manifest.get('target', {})
    if target.get('kind') not in ('library', 'temporary'):
        raise ValueError('Invalid trusted fan-out target')
    tool = 'delegate_to_agent' if target['kind'] == 'library' else 'spawn_temporary_worker'
    seen = set()
    for item in items:
        key = item.get('key')
        if not isinstance(key, str) or key in seen:
            raise ValueError('Invalid trusted fan-out item identity')
        seen.add(key)
        native_id = 'item_' + hashlib.sha256(f'{expected_id}:{key}'.encode()).hexdigest()
        item_branch = f'{branch}.{native_id}.{tool}@{native_id}'
        if (item.get('nativeRunId') != native_id or item.get('nativeCallBranch') != item_branch
            or item.get('executionId') != child_execution_id(scope.execution_id, item_branch)):
            raise ValueError('Fan-out item scope mismatch')
    return manifest


def build_fanout_workflow(team: Any, request: Any, root_context: dict, scope: Any, owned_adapter=None, bound_manifest=None):
    """Native manifest progress and child runs are shared by invocation hosts."""
    async def run_manifest(ctx, manifest=None):
        if bound_manifest is not None:
            manifest = bound_manifest
        temporary = manifest['target']['kind'] == 'temporary'
        dispatcher = build_worker_dispatcher(team, request, root_context, [], scope, temporary, owned_adapter)
        if dispatcher is None:
            raise ValueError('Fan-out target dispatcher unavailable')
        execute_selected = dispatcher[1]
        agent_id = root_context['root_agent_id'] if temporary else manifest['target']['agentId']

        async def execute(item):
            try:
                return await execute_selected(ctx, item['nativeRunId'], item['nativeCallBranch'], agent_id,
                    item['task'], item.get('expectedOutput', ''), item.get('contextRefs', []))
            except Exception:
                logger.exception('Foreground fan-out item could not finish')
                try:
                    if owned_adapter is not None:
                        await owned_adapter.settle(item['executionId'], 'failed')
                    else:
                        await settle_delegate(scope, item['executionId'], 'failed')
                    status = 'failed'
                except Exception:
                    logger.exception('Could not persist failed fan-out item')
                    status = 'outcome_unknown'
                return {'execution_id': item['executionId'], 'status': status,
                    'safe_error': 'The worker outcome could not be confirmed.'}

        results = await run_supervised_items(manifest['items'], execute,
            root_context['max_parallel_workers'], getattr(request, 'abort_signal', None))
        return fanout_result(manifest, results)

    return Workflow(name='background_fanout' if owned_adapter is not None else 'foreground_fanout', edges=[(START, FunctionNode(func=run_manifest,
        name='fanout_driver', parameter_binding='node_input', rerun_on_resume=True))])


def build_fanout_dispatcher(team: Any, request: Any, root_context: dict, scope: Any):
    if root_context.get('fanout_enabled') is not True:
        return None
    if scope is None or scope.role is not ExecutionRole.ROOT or scope.depth != 0:
        raise ValueError('Only a depth-zero ROOT can expose fan-out')
    if root_context.get('worker_permit_version') != 1:
        raise ValueError('Fan-out requires shared worker slots')
    parallel = root_context.get('max_parallel_workers')
    maximum = root_context.get('max_fanout_items')
    if (not isinstance(parallel, int) or not 1 <= parallel <= 8
        or not isinstance(maximum, int) or not 1 <= maximum <= 50):
        raise ValueError('Invalid frozen fan-out limits')
    workflow = build_fanout_workflow(team, request, root_context, scope)

    async def run_fanout(items: list[dict], worker_type: str, tool_context: ToolContext, agent_id: str = '', mode: str = 'foreground') -> dict:
        """Run a finite list of independent tasks in foreground. Each item needs
        a unique key and task; optional expectedOutput and contextRefs narrow
        inputs. worker_type is library (with approved agent_id) or temporary.
        mode is foreground by default; background requires explicit runtime
        permission and returns a durable job reference. Simple answers need no fan-out.
        """
        call_id = tool_context.function_call_id
        if not call_id:
            raise ValueError('Fan-out requires a native call identity')
        if worker_type not in ('library', 'temporary') or worker_type == 'temporary' and agent_id:
            raise ValueError('Invalid fan-out target')
        branch = f'{tool_context.branch}.run_fanout@{call_id}' if tool_context.branch else f'run_fanout@{call_id}'
        target = {'kind': worker_type, **({'agentId': agent_id} if worker_type == 'library' else {})}
        if mode not in ('foreground', 'background') or mode == 'background' and root_context.get('background_fanout_enabled') is not True:
            raise ValueError('Fan-out execution mode is unavailable')
        if mode == 'background':
            execution_id = hashlib.sha256(f'{scope.execution_id}:{branch}:background_fanout'.encode()).hexdigest()[:24]
            try:
                acknowledged = await _post(scope, 'background-fanout', {'version': 1, 'mode': mode, 'nativeCallId': call_id,
                    'nativeCallBranch': branch, 'target': target, 'items': items})
                if acknowledged.get('executionId') != execution_id or acknowledged.get('resultRef') != execution_id or acknowledged.get('status') not in (
                    'queued', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'outcome_unknown'):
                    raise ValueError('Invalid durable fan-out acknowledgement')
                return {'status': acknowledged['status'], 'execution_id': execution_id, 'result_ref': execution_id}
            except Exception:
                return {'status': 'outcome_unknown', 'execution_id': execution_id, 'result_ref': execution_id,
                    'safe_error': 'Submission could not be confirmed. Inspect this job before submitting another fan-out.'}
        manifest = await _post(scope, 'fanout-manifest', {'version': 1, 'mode': 'foreground', 'nativeCallId': call_id,
            'nativeCallBranch': branch, 'target': target, 'items': items})
        validate_manifest(scope, branch, call_id, manifest, maximum)
        return await tool_context.run_node(workflow, node_input={'manifest': manifest},
            run_id=f"manifest_{manifest['manifestId']}", override_branch=branch,
            use_sub_branch=False, raise_on_wait=True)

    return FunctionTool(func=run_fanout)
