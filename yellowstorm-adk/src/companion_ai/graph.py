"""Plan -> ADK Workflow graph translation (the ADK boundary).

The planner (LLM) produces a Plan with `depends_on`; this turns it into a
`google.adk.workflow.Workflow` whose graph engine runs independent steps
concurrently, dependent steps in order, and joins fan-in — natively, with
`max_concurrency`, per-node retry and timeout.

Correctness note (verified against ADK 2.3.0): a plain node with N incoming
edges is triggered N times. So a step with >=2 dependencies is routed through a
`JoinNode`, which fires exactly once after ALL its predecessors complete.

`scheduler.py` stays pure (no ADK); this module is the only ADK-aware one.
"""
from __future__ import annotations

import re
from typing import Any, AsyncGenerator, Callable, Optional

from google.adk.agents.context import Context
from google.adk.events import Event
from google.adk.workflow import JoinNode, RetryConfig, START, Workflow
from google.adk.workflow import BaseNode

from . import scheduler
from .plan import Plan, Step

# A factory the caller supplies: build the executable node for a step, given the
# graph-safe node name to use. In production it wraps an LlmAgent; tests pass a
# FunctionNode factory so the wiring is verifiable without an LLM.
NodeFactory = Callable[[Step, str], BaseNode]


class _SilentJoinNode(JoinNode):
    """A JoinNode that fires once after all predecessors but emits NO output.

    Why this exists (the plan_done sink, see to_workflow): ADK's replay
    barrier pins every node that emits a *terminal event* to a fixed
    chronological slot in the session's recorded history, and
    `is_terminal_event()` counts anything with a non-None `output`. Stock
    JoinNode always yields `Event(output=node_input)`, so the sink got
    pinned to whatever position it happened to fire at on an early turn.

    That is fatal here specifically because to_workflow is rebuilt every
    turn from the CURRENT plan.steps, and create_task /
    delegate_to_human_agent grow the plan mid-session: a step that fans out
    into two children (one dead-ending, one continuing into a further wave)
    pushes the sink structurally LATER, while history still insists it
    already completed EARLIER. The barrier then waits forever for an
    ordering that can no longer happen -- RuntimeError("Replay divergence
    detected: Timed out waiting for sequence key ... to be unblocked.").

    Emitting no output takes the sink out of the barrier entirely, so its
    position is free to float as the plan grows. Nothing reads its output:
    ADK's own _finalize treats zero terminal outputs as fine, and
    service.py computes the final answer from step results directly.
    """

    async def _run_impl(self, *, ctx: Context, node_input: Any) -> AsyncGenerator[Any, None]:
        yield Event(branch=ctx._invocation_context.branch)


def node_name(step_id: str) -> str:
    """Graph-safe node name: ADK requires a valid Python identifier (no hyphens,
    can't start with a digit — step ids are uuid hex and may)."""
    safe = re.sub(r"\W", "_", step_id)
    if not safe or safe[0].isdigit():
        safe = "n_" + safe
    return safe


def to_workflow(
    plan: Plan,
    node_factory: NodeFactory,
    *,
    name: str = "plan",
    max_concurrency: Optional[int] = None,
    retry_config: Optional[RetryConfig] = None,
) -> Workflow:
    """Build a runnable Workflow from a plan. Raises ValueError on an invalid DAG
    (cycle / unknown / self / duplicate dependency) before any graph is built."""
    scheduler.validate(plan)

    nodes = {step.id: node_factory(step, node_name(step.id)) for step in plan.steps}

    edges = []
    for step in plan.steps:
        target = nodes[step.id]
        deps = list(dict.fromkeys(step.depends_on))  # dedupe, preserve order
        if not deps:
            edges.append((START, target))
        elif len(deps) == 1:
            edges.append((nodes[deps[0]], target))
        else:
            # Fan-in: AND-join so the step runs exactly once, after all deps.
            # _SilentJoinNode, not a stock JoinNode, for the SAME reason the sink
            # is (see its docstring): a stock JoinNode yields Event(output=...),
            # which is a terminal event pinned to a fixed slot in ADK's replay
            # barrier. As the plan GROWS mid-session (create_task / delegate /
            # converse add), this fan-in join's structural position shifts, but
            # history still expects its sequence key at the old slot — so a later
            # resume times out ("Replay divergence detected: … sequence key
            # 'join_<id>@1' …", seen live). Emitting no output takes the join out
            # of the barrier so its position can float. Nothing reads its output:
            # the downstream step triggers on the join's COMPLETION, and worky
            # executors get their task from description injection, not node input.
            join = _SilentJoinNode(name=f"join_{node_name(step.id)}")
            for dep in deps:
                edges.append((nodes[dep], join))
            edges.append((join, target))

    # ADK requires a single terminal output. A plan can end in several parallel
    # leaves (steps nothing depends on), so join them into one sink.
    #
    # Unconditional (even for a single terminal) so the graph's shape stays
    # stable as the plan grows mid-session, and _SilentJoinNode rather than a
    # stock JoinNode so the sink never enters ADK's replay barrier at all —
    # see _SilentJoinNode's docstring for why both matter. Its output isn't
    # consumed anywhere (service.py recomputes terminals itself).
    depended = {d for step in plan.steps for d in step.depends_on}
    terminals = [step for step in plan.steps if step.id not in depended]
    if terminals:
        sink = _SilentJoinNode(name="plan_done")
        for step in terminals:
            edges.append((nodes[step.id], sink))

    kwargs = {}
    if max_concurrency is not None:
        kwargs["max_concurrency"] = max_concurrency
    if retry_config is not None:
        kwargs["retry_config"] = retry_config
    return Workflow(name=name, edges=edges, **kwargs)
