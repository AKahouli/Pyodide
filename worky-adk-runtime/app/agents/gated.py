"""Gated execution flow (Part 3, canonical §4.3 + §5.5).

For any task whose `governance/check` returns `approval` or
`hard_block`, the runtime runs a deterministic **Sequential
workflow agent** with three steps:

  1. `prepare` — the agent collects the data needed for the
     gated action but does NOT execute it. (No gated tool bound.)
  2. `request_approval` — the runtime posts a `WorkyInteraction`
     (type=approval) to NestJS and BLOCKS on the real
     `interaction.responded` event.
  3. `execute` — only after the backend returns the tool binding
     does the runtime bind the gated tool and let the agent call
     it. On rejection, the runtime emits a `replan.required`
     frame and the execution router posts a `WorkyTaskResult`
     with status `superseded`.

The Manager LlmAgent has NO direct access to gated tools; the
Sequential workflow agent below is the only path to a gated step.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from .model import build_model

logger = logging.getLogger("worky.gated")


class GatedFlow:
    """Build a deterministic Sequential workflow for a gated task.

    The workflow is a list of three step closures:
      - `prepare(task_binding)` — gather, no execution
      - `request_approval(task_binding)` — raise a WorkyInteraction
        and yield the pending `interactionId`
      - `execute(task_binding, scoped_tools)` — perform the action
        with the bound tools

    The runtime's execution router drives these steps in order.
    """

    def __init__(self, task_binding: dict[str, Any], gated_category: str) -> None:
        self.task_binding = task_binding
        self.gated_category = gated_category
        self._approval_granted: Optional[bool] = None

    def build_workflow(self) -> list[dict[str, Any]]:
        return [
            {
                "step": "prepare",
                "category": self.gated_category,
                "task_id": self.task_binding.get("taskId"),
            },
            {
                "step": "request_approval",
                "category": self.gated_category,
                "task_id": self.task_binding.get("taskId"),
            },
            {
                "step": "execute",
                "category": self.gated_category,
                "task_id": self.task_binding.get("taskId"),
            },
        ]

    def is_approval_required(self) -> bool:
        return self.gated_category in {
            "external_send",
            "customer_facing_release",
            "external_comms",
            "budget_overrun",
            "cancel_human_task",
        }


def build_approval_workflow_agent(workflow: GatedFlow) -> Any:
    """Construct the ADK `SequentialAgent` for a gated task.

    Returns a stub when ADK is unavailable (unit tests).
    """
    try:
        from google.adk.agents import LlmAgent, SequentialAgent
    except Exception:  # pragma: no cover
        return _StubSequentialAgent(workflow)

    prepare_agent = LlmAgent(
        name=f"worky_prepare_{workflow.task_binding.get('taskId')}",
        description="Prepare data for a gated action; no execution.",
        model=build_model(None),
        # The prepare step has NO gated tool bound (canonical §5.4
        # defense in depth).
        tools=[],
    )
    request_agent = LlmAgent(
        name=f"worky_request_approval_{workflow.task_binding.get('taskId')}",
        description="Request owner approval for a gated action.",
        model=build_model(None),
        tools=[],
    )
    execute_agent = LlmAgent(
        name=f"worky_execute_{workflow.task_binding.get('taskId')}",
        description="Execute the gated action — only runs after approval.",
        model=build_model(None),
        # The execute step is built without the gated tool here;
        # the runtime rebinds the tool after the backend returns
        # the approval verdict.
        tools=[],
    )
    return SequentialAgent(
        name=f"worky_gated_{workflow.task_binding.get('taskId')}",
        sub_agents=[prepare_agent, request_agent, execute_agent],
    )


class _StubSequentialAgent:
    """Test double for ADK's `SequentialAgent`."""

    def __init__(self, workflow: GatedFlow) -> None:
        self.workflow = workflow
        self.name = f"worky_gated_{workflow.task_binding.get('taskId')}"
        self.sub_agents: list[Any] = []
