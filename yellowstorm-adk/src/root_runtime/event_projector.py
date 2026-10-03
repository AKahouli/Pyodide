"""Producer-aware event projection (WP03, plan §9.3).

Stamps stream chunks with the emitting execution's lineage so the backend can
map each event to its producer branch/call. Only root/follow-up text becomes
the public answer; child tool activity is published with its own producer
identity. The existing citation/artifact/component processors stay authoritative
— this adapter adds lineage, it does not re-render content.
"""
from __future__ import annotations

import itertools
from typing import Any, Dict, Optional

from src.root_runtime.contracts import ExecutionEventV1, ExecutionScopeV1, InvocationLifecycleState


class ProducerEventProjector:
    """Stamps producer lineage onto outgoing queue chunks for one execution."""

    def __init__(self, scope: Optional[ExecutionScopeV1], producer_agent_id: Optional[str] = None) -> None:
        self._scope = scope
        self._producer_agent_id = producer_agent_id
        self._sequence = itertools.count(1)

    @property
    def active(self) -> bool:
        return self._scope is not None and self._scope.is_set

    def event(self, lifecycle: InvocationLifecycleState, source_event_id: Optional[str] = None) -> Optional[ExecutionEventV1]:
        if not self.active:
            return None
        assert self._scope is not None
        return ExecutionEventV1(
            execution_id=self._scope.execution_id,
            producer_role=self._scope.role,
            lifecycle=lifecycle,
            work_group_id=self._scope.work_group_id,
            parent_execution_id=self._scope.parent_execution_id,
            producer_agent_id=self._producer_agent_id,
            source_event_id=source_event_id,
        )

    def stamp(self, chunk: Dict[str, Any], lifecycle: InvocationLifecycleState = InvocationLifecycleState.UNSPECIFIED) -> Dict[str, Any]:
        """Return the chunk with ``execution_trace`` attached (copy-on-write).

        Legacy requests (no scope) pass through untouched so every existing
        stream stays byte-identical.
        """
        event = self.event(lifecycle)
        if event is None:
            return chunk
        stamped = dict(chunk)
        trace = event.to_wire_dict()
        trace["sequence"] = next(self._sequence)
        stamped["execution_trace"] = trace
        return stamped
