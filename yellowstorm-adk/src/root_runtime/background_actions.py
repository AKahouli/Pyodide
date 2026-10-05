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
    def __init__(self, service: FencedBackgroundSessionService, scope=None, authorize=None):
        self.service = service
        self.scope = scope
        self.authorize = authorize

    def guard(self, connection):
        if self.scope is not None and self.scope.execution_id != self.service.grant.execution_id:
            from src.root_runtime.background_items import guard_item
            return guard_item(connection, self.service, self.scope, require_active=True)
        return _guard(connection, (self.service.grant, {}))

    async def execute(self, tool_name, call_id, args, invoke, native_state=None):
        if not isinstance(call_id, str) or not call_id or len(call_id) > 128:
            raise ValueError('Background action requires bounded native call identity')
        payload = json.dumps(args, sort_keys=True, separators=(',', ':'), allow_nan=False)
        digest = hashlib.sha256(payload.encode()).hexdigest()
        grant = self.service.grant
        producer_id = self.scope.execution_id if self.scope is not None else grant.execution_id
        if self.authorize is not None:
            await self.authorize()
        # Item/native-call identity fits the existing ledger key and cannot collide with sibling calls.
        ledger_call = hashlib.sha256(f'{producer_id}:{call_id}'.encode()).hexdigest() if producer_id != grant.execution_id else call_id
        evidence_key = '_root_evidence:' + hashlib.sha256(f'{producer_id}:{call_id}'.encode()).hexdigest()
        async with self.service.db_engine.begin() as connection:
            await connection.run_sync(self.guard)
            row = (await connection.execute(text('''SELECT * FROM conversation.root_background_actions
                WHERE execution_id=:execution AND native_call_id=:call FOR UPDATE'''),
                {'execution': grant.execution_id, 'call': ledger_call})).mappings().one_or_none()
            if row is not None:
                if row['tool_name'] != tool_name or row['args_digest'] != digest:
                    raise BackgroundActionUnknown('Native action identity conflicts with its durable intent')
                if row['status'] == 'succeeded':
                    receipt = row['receipt']
                    if not isinstance(receipt, dict) or receipt.get('version') != 1:
                        raise BackgroundActionUnknown('Action receipt format requires reconciliation')
                    if native_state is not None:
                        for key, value in receipt.get('evidenceState', {}).items():
                            if key != evidence_key or not isinstance(value, list) or any(
                                not isinstance(item, dict) or item.get('executionId') != producer_id
                                or item.get('nativeIdentity') != call_id for item in value):
                                raise BackgroundActionUnknown('Action receipt producer evidence conflicts')
                            native_state[key] = value
                    return receipt['result']
                raise BackgroundActionUnknown('External action outcome requires reconciliation')
            await connection.execute(text('''INSERT INTO conversation.root_background_actions
                (execution_id,native_call_id,tool_name,args_digest,status,owner,fence)
                VALUES(:execution,:call,:tool,:digest,'started',:owner,:fence)'''),
                {'execution': grant.execution_id, 'call': ledger_call, 'tool': tool_name,
                    'digest': digest, 'owner': grant.owner, 'fence': grant.fence})
            await connection.run_sync(self.guard)
        try:
            result = await invoke()
            if self.authorize is not None:
                await self.authorize()
            state_snapshot = native_state.to_dict() if isinstance(native_state, State) else native_state or {}
            evidence_state = {key: value for key, value in state_snapshot.items() if key == evidence_key
                and isinstance(value, list) and all(isinstance(item, dict) and item.get('executionId') == producer_id
                    and item.get('nativeIdentity') == call_id for item in value)}
            receipt = json.dumps({'version': 1, 'result': result, 'evidenceState': evidence_state},
                separators=(',', ':'), allow_nan=False)
            if len(receipt.encode()) > 262144:
                raise ValueError('Background action receipt exceeds durable limit')
            async with self.service.db_engine.begin() as connection:
                await connection.run_sync(self.guard)
                changed = await connection.execute(text('''UPDATE conversation.root_background_actions
                    SET status='succeeded',receipt=CAST(:receipt AS jsonb),updated_at=clock_timestamp()
                    WHERE execution_id=:execution AND native_call_id=:call AND status='started'
                      AND owner=:owner AND fence=:fence'''),
                    {'execution': grant.execution_id, 'call': ledger_call, 'receipt': receipt,
                        'owner': grant.owner, 'fence': grant.fence})
                if changed.rowcount != 1:
                    raise BackgroundActionUnknown('Action receipt owner changed')
                await connection.run_sync(self.guard)
            return result
        except BaseException as error:
            # A lost receipt or tool exception can follow a successful external
            # write. The committed intent remains unresolved and blocks replay.
            if isinstance(error, BackgroundActionUnknown):
                raise
            raise BackgroundActionUnknown('External action outcome could not be confirmed') from error


def install_background_action_guard(agent, service, scope=None, authorize=None):
    if not getattr(agent, '_root_leaf_gate_installed', False):
        raise ValueError('Background action guard requires mandatory leaf compilation')
    ledger = BackgroundActionLedger(service, scope, authorize)
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
