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
from typing import Callable, Optional

from google.adk.workflow import JoinNode, RetryConfig, START, Workflow
from google.adk.workflow import BaseNode

from . import scheduler
from .plan import Plan, Step

# A factory the caller supplies: build the executable node for a step, given the
# graph-safe node name to use. In production it wraps an LlmAgent; tests pass a
# FunctionNode factory so the wiring is verifiable without an LLM.
NodeFactory = Callable[[Step, str], BaseNode]


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
            join = JoinNode(name=f"join_{node_name(step.id)}")
            for dep in deps:
                edges.append((nodes[dep], join))
            edges.append((join, target))

    # ADK requires a single terminal output. A plan can end in several parallel
    # leaves (steps nothing depends on), so join them into one sink.
    depended = {d for step in plan.steps for d in step.depends_on}
    terminals = [step for step in plan.steps if step.id not in depended]
    if len(terminals) > 1:
        sink = JoinNode(name="plan_done")
        for step in terminals:
            edges.append((nodes[step.id], sink))

    kwargs = {}
    if max_concurrency is not None:
        kwargs["max_concurrency"] = max_concurrency
    if retry_config is not None:
        kwargs["retry_config"] = retry_config
    return Workflow(name=name, edges=edges, **kwargs)
