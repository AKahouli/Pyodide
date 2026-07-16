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

    def is_terminal(self) -> bool:
        return self in (Status.COMPLETED, Status.FAILED)


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
    agent: Optional[str] = None            # which executor sub-agent handled it
    result: Optional[str] = None
    error: Optional[str] = None
    blocked_reason: Optional[str] = None

    def is_done(self) -> bool:
        return self.status.is_terminal()


class Plan(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    title: str = ""
    goal: str = ""
    answer: Optional[str] = None
    status: Status = Status.PENDING
    steps: List[Step] = Field(default_factory=list)

    def step(self, step_id: str) -> Optional[Step]:
        return next((s for s in self.steps if s.id == step_id), None)
