"""Wave scheduler — the deterministic orchestration core.

Turns a plan's `depends_on` graph into parallel waves and answers, at any point
during execution, "which steps can run right now?". No LLM, no I/O — the planner
(LLM) decides *what* the tasks are; this decides *when* they run and *what runs
together*.

Contract used by the orchestrator loop:

    validate(plan)                 # once, after planning — raises on bad graphs
    assign_waves(plan)             # once — fills Step.wave for display/grouping
    while (batch := ready_steps(plan)):
        run batch CONCURRENTLY     # independent steps → parallel
        # steps that BLOCK (ask-user / long task) stay non-terminal; their
        # dependents simply aren't ready yet, while independent branches proceed
    plan.status = derive_status(plan)
"""
from __future__ import annotations

from collections import deque
from typing import Dict, List

from .plan import Plan, Status, Step


def _index(plan: Plan) -> Dict[str, Step]:
    return {s.id: s for s in plan.steps}


def validate(plan: Plan) -> None:
    """Raise ValueError on duplicate ids, unknown/self dependencies, or a cycle.

    Must pass before execution — a cyclic or dangling plan can never complete.
    """
    idx = _index(plan)
    if len(idx) != len(plan.steps):
        raise ValueError("plan has duplicate step ids")

    for s in plan.steps:
        for dep in s.depends_on:
            if dep == s.id:
                raise ValueError(f"step {s.id!r} depends on itself")
            if dep not in idx:
                raise ValueError(f"step {s.id!r} depends on unknown step {dep!r}")

    # Cycle detection via Kahn's algorithm (also validates the DAG is drainable).
    indeg = {s.id: len(set(s.depends_on)) for s in plan.steps}
    dependents: Dict[str, List[str]] = {s.id: [] for s in plan.steps}
    for s in plan.steps:
        for dep in set(s.depends_on):
            dependents[dep].append(s.id)

    q = deque(sid for sid, d in indeg.items() if d == 0)
    seen = 0
    while q:
        sid = q.popleft()
        seen += 1
        for child in dependents[sid]:
            indeg[child] -= 1
            if indeg[child] == 0:
                q.append(child)
    if seen != len(plan.steps):
        raise ValueError("plan has a dependency cycle")


def assign_waves(plan: Plan) -> None:
    """Fill Step.wave = longest dependency depth. Steps sharing a wave are
    mutually independent and may run concurrently. Assumes validate() passed."""
    idx = _index(plan)
    wave: Dict[str, int] = {}

    def depth(sid: str) -> int:
        if sid in wave:
            return wave[sid]
        deps = set(idx[sid].depends_on)
        wave[sid] = 0 if not deps else 1 + max(depth(d) for d in deps)
        return wave[sid]

    for s in plan.steps:
        s.wave = depth(s.id)


def ready_steps(plan: Plan) -> List[Step]:
    """Steps that can start right now: PENDING and every dependency COMPLETED.

    A BLOCKED or RUNNING step is not COMPLETED, so its dependents are held back
    while unrelated branches keep flowing — this is what lets one branch pause to
    ask the user while the rest of the plan proceeds.
    """
    idx = _index(plan)
    out: List[Step] = []
    for s in plan.steps:
        if s.status is not Status.PENDING:
            continue
        if all(idx[d].status is Status.COMPLETED for d in s.depends_on):
            out.append(s)
    return out


def is_waiting(plan: Plan) -> bool:
    """True if the plan can't advance without an external event: a step is BLOCKED
    (or nothing is ready) yet unfinished work remains."""
    if not any(not s.is_done() for s in plan.steps):
        return False
    if ready_steps(plan):
        return False
    if any(s.status is Status.RUNNING for s in plan.steps):
        return False
    return True


def derive_status(plan: Plan) -> Status:
    """Roll step states up to a plan status for the read model."""
    if not plan.steps:
        return Status.PENDING
    if all(s.status is Status.COMPLETED for s in plan.steps):
        return Status.COMPLETED
    if any(s.status is Status.RUNNING for s in plan.steps) or ready_steps(plan):
        return Status.RUNNING
    if any(s.status is Status.BLOCKED for s in plan.steps):
        return Status.BLOCKED
    # Nothing ready/running/blocked but unfinished steps remain → a failed
    # dependency has stranded the rest.
    if any(s.status is Status.FAILED for s in plan.steps):
        return Status.FAILED
    return Status.BLOCKED
