"""Durable intent/receipt guard for background leaf tools.

All tools are conservatively treated as potentially writing. An uncertain
attempt stops native execution; it must never become an automatic retry.
"""
from __future__ import annotations

import hashlib
import json
from types import MethodType
from contextvars import ContextVar
from functools import wraps

from google.adk.tools import FunctionTool
from google.adk.sessions.state import State
from sqlalchemy import text

from src.root_runtime.background_sessions import FencedBackgroundSessionService, _guard
from src.root_runtime.leaf_tools import is_leaf_tool


class BackgroundActionUnknown(BaseException):
    """Control signal: reconcile the external action before resuming."""


_action_context = ContextVar('background_action_context', default=None)


class BackgroundActionLedger:
    def __init__(self, service: FencedBackgroundSessionService):
        self.service = service

    async def execute(self, tool_name, call_id, args, invoke, native_state=None):
        if not isinstance(call_id, str) or not call_id or len(call_id) > 128:
            raise ValueError('Background action requires bounded native call identity')
        payload = json.dumps(args, sort_keys=True, separators=(',', ':'), allow_nan=False)
        digest = hashlib.sha256(payload.encode()).hexdigest()
        grant = self.service.grant
        async with self.service.db_engine.begin() as connection:
            await connection.run_sync(lambda sync: _guard(sync, (grant, {})))
            row = (await connection.execute(text('''SELECT * FROM conversation.root_background_actions
                WHERE execution_id=:execution AND native_call_id=:call FOR UPDATE'''),
                {'execution': grant.execution_id, 'call': call_id})).mappings().one_or_none()
            if row is not None:
                if row['tool_name'] != tool_name or row['args_digest'] != digest:
                    raise BackgroundActionUnknown('Native action identity conflicts with its durable intent')
                if row['status'] == 'succeeded':
                    receipt = row['receipt']
                    if not isinstance(receipt, dict) or receipt.get('version') != 1:
                        raise BackgroundActionUnknown('Action receipt format requires reconciliation')
                    if native_state is not None:
                        for key, value in receipt.get('evidenceState', {}).items():
                            native_state[key] = value
                    return receipt['result']
                raise BackgroundActionUnknown('External action outcome requires reconciliation')
            await connection.execute(text('''INSERT INTO conversation.root_background_actions
                (execution_id,native_call_id,tool_name,args_digest,status,owner,fence)
                VALUES(:execution,:call,:tool,:digest,'started',:owner,:fence)'''),
                {'execution': grant.execution_id, 'call': call_id, 'tool': tool_name,
                    'digest': digest, 'owner': grant.owner, 'fence': grant.fence})
            await connection.run_sync(lambda sync: _guard(sync, (grant, {})))
        try:
            result = await invoke()
            state_snapshot = native_state.to_dict() if isinstance(native_state, State) else native_state or {}
            evidence_state = {key: value for key, value in state_snapshot.items() if key.startswith('_root_evidence:')}
            receipt = json.dumps({'version': 1, 'result': result, 'evidenceState': evidence_state},
                separators=(',', ':'), allow_nan=False)
            if len(receipt.encode()) > 262144:
                raise ValueError('Background action receipt exceeds durable limit')
            async with self.service.db_engine.begin() as connection:
                await connection.run_sync(lambda sync: _guard(sync, (grant, {})))
                changed = await connection.execute(text('''UPDATE conversation.root_background_actions
                    SET status='succeeded',receipt=CAST(:receipt AS jsonb),updated_at=clock_timestamp()
                    WHERE execution_id=:execution AND native_call_id=:call AND status='started'
                      AND owner=:owner AND fence=:fence'''),
                    {'execution': grant.execution_id, 'call': call_id, 'receipt': receipt,
                        'owner': grant.owner, 'fence': grant.fence})
                if changed.rowcount != 1:
                    raise BackgroundActionUnknown('Action receipt owner changed')
                await connection.run_sync(lambda sync: _guard(sync, (grant, {})))
            return result
        except BaseException as error:
            # A lost receipt or tool exception can follow a successful external
            # write. The committed intent remains unresolved and blocks replay.
            if isinstance(error, BackgroundActionUnknown):
                raise
            raise BackgroundActionUnknown('External action outcome could not be confirmed') from error


def install_background_action_guard(agent, service):
    if not getattr(agent, '_root_leaf_gate_installed', False):
        raise ValueError('Background action guard requires mandatory leaf compilation')
    ledger = BackgroundActionLedger(service)
    for tool in agent.tools:
        if not is_leaf_tool(tool):
            # The mandatory leaf callback rejects these before execution.
            continue
        if not isinstance(tool, FunctionTool):
            raise ValueError('Background action guard requires a qualified callable effect boundary')
        if getattr(tool, '_background_action_execution', None) is not None:
            raise ValueError('Background tool already has an action owner')
        original = tool.run_async
        original_func = tool.func
        original_invoke = tool._invoke_callable

        def callable_adapter(owned_tool, original_callable, invoke_callable):
            @wraps(original_callable)
            async def invoke(**kwargs):
                binding = _action_context.get()
                if binding is None or binding[0] is not owned_tool:
                    raise ValueError('Background callable lost its native action context')
                _, context, native_args = binding
                # The pinned SDK reaches func only after validation and native
                # confirmation. Reuse its sync/async invocation behavior.
                return await ledger.execute(owned_tool.name, context.function_call_id, native_args,
                    lambda: invoke_callable(original_callable, kwargs), context.state)
            return invoke

        tool.func = callable_adapter(tool, original_func, original_invoke)

        def adapter(original_run, owned_tool):
            async def run(_self, *, args, tool_context):
                token = _action_context.set((owned_tool, tool_context, args))
                try:
                    return await original_run(args=args, tool_context=tool_context)
                finally:
                    _action_context.reset(token)
            return run

        tool.run_async = MethodType(adapter(original, tool), tool)
        tool._background_action_execution = service.grant.execution_id
