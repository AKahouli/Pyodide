"""Plan/Step domain model — framework-neutral (no ADK, no DB).

`depends_on` is the whole story for parallelism: steps whose dependencies are all
completed can run concurrently; a step waits only for the steps it names.
"""
from __future__ import annotations

import uuid
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class Status(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    BLOCKED = "blocked"      # suspended: awaiting user input or a long-running task
    COMPLETED = "completed"
    FAILED = "failed"
    # "canceled" (one L) is the spelling the client's board contract uses
    # (front .../worky/status.ts OrchStepStatus) — a "cancelled" step matches no
    # Kanban lane and silently vanishes from the UI. _missing_ below still parses
    # legacy "cancelled" rows written before this was aligned.
    CANCELLED = "canceled"  # terminated by a user StopSession / converse cancel — not an error

    @classmethod
    def _missing_(cls, value):
        if value == "cancelled":  # legacy read-model rows (pre-spelling-fix)
            return cls.CANCELLED
        return None

    def is_terminal(self) -> bool:
        return self in (Status.COMPLETED, Status.FAILED, Status.CANCELLED)


class Step(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    title: str = ""
    description: str = ""
    # "execute" (an agent does the work) or "ask" (block and ask the user).
    kind: str = "execute"
    question: Optional[str] = None      # for kind == "ask"
    status: Status = Status.PENDING
    # Ids of steps that must be COMPLETED before this one may start. Empty = ready.
    depends_on: List[str] = Field(default_factory=list)
    # Assigned by the scheduler: 0-based parallel wave. Steps in the same wave
    # have no dependency between them and may run concurrently.
    wave: int = 0
    result: Optional[str] = None
    error: Optional[str] = None
    blocked_reason: Optional[str] = None
    # The interrupt id this step is parked on (mail:/ask:), set when it blocks.
    # Load-bearing on a rebuild: a still-parked ask/await node must re-park under
    # this EXACT id, not a fresh node-path-derived one — the node path shifts as
    # the plan grows mid-session (create_task adds steps), and a shifted id would
    # orphan the bound mail wait and leave the step stuck 'running'. See
    # nodes.factory's blocked-await branch.
    interrupt_id: Optional[str] = None
    # True only for a human-agent persona (human_agents.py); a plain step's
    # assignee/assignee_name are also populated (with the executor's own
    # id/name — see plan_turn), so this is the actual gate for persona
    # behavior, not assignee.
    is_persona: bool = False
    assignee: Optional[str] = None
    assignee_name: Optional[str] = None
    assignee_role: Optional[str] = None
    # True only for a step created by delegate_to_human_agent (service.py),
    # never by the planner. Such a step's ORIGINAL execution happens inside a
    # throwaway nested Workflow (see _delegate_tool_for), at a node path ADK's
    # own session replay can't match once resume_turn rebuilds it as a plain
    # top-level node — so ADK can't tell it already ran and would silently
    # re-call the LLM. nodes.py short-circuits it with the stored result
    # instead once it's done, so this flag is the signal for that.
    is_dynamic_delegate: bool = False

    def is_done(self) -> bool:
        return self.status.is_terminal()


class Plan(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    title: str = ""
    goal: str = ""
    answer: Optional[str] = None
    status: Status = Status.PENDING
    steps: List[Step] = Field(default_factory=list)
    # The client's default executor for this turn, set once at plan_turn.
    # A step born later (create_task) reads it here — every non-persona step
    # in the plan could, in principle, be turned into a persona by the
    # planner, leaving no plain sibling to copy an executor name from.
    executor_id: Optional[str] = None
    executor_name: Optional[str] = None
    # Amend operations on EXISTING steps ({"op","step_id","description"}),
    # populated only by the converse planner and consumed by converse_turn.
    # Never projected or persisted — the plan proper is just `steps`.
    ops: List[dict] = Field(default_factory=list)

    def step(self, step_id: str) -> Optional[Step]:
        return next((s for s in self.steps if s.id == step_id), None)
