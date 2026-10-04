"""Compiler facade for root-delegation roles (WP03, plan §9.3/§9.4).

Wraps the existing factories instead of replacing them:

- ``compile_worker`` accepts a verified scope and delegates agent construction
  to the caller-supplied factory callable (today: the delegation factory's
  creation path). It never reads mutable team queues or root-global connector
  state to decide a child's identity.
- ``make_resumable_root_runner`` builds the explicit ``App`` enrolled root
  roles run on: resumability on, compaction preserved, the standard plugin set
  retained — whether or not the request enabled compaction. Legacy roles keep
  the exact ``make_chat_runner`` behavior.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Callable, Optional, Tuple

from google.adk.apps import App
from google.adk.apps.app import ResumabilityConfig
from google.adk.runners import Runner

from src.smart_rag.infrastructure.compaction import (
    APP_NAME,
    build_events_compaction_config,
)
from src.smart_rag.infrastructure.processing.plugin import CleanSessionPlugin
from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1

logger = logging.getLogger(__name__)


def attach_root_input_control(agent, scope, version: int = 0) -> None:
    """Versioned native invocation control, not a delegated resource grant."""
    if scope is None or scope.role is not ExecutionRole.ROOT:
        return
    if version not in (0, 1):
        raise ValueError("Unsupported ROOT native input control profile")
    if version == 0:
        return
    if scope.depth != 0:
        raise ValueError("Unsupported ROOT native input control profile")
    from google.adk.agents import LlmAgent
    from google.adk.tools import request_input

    if not isinstance(agent, LlmAgent):
        raise ValueError("ROOT native input control requires an LlmAgent")
    if any(tool is request_input for tool in agent.tools):
        return
    if any((getattr(tool, 'name', None) or getattr(tool, '__name__', None)) == request_input.name for tool in agent.tools):
        raise ValueError("ROOT native input control tool name conflicts")
    from src.guardrails.tool_registry import tool_policy
    request_input.metadata = tool_policy(request_input.name)
    agent.tools = [*agent.tools, request_input]


@dataclass
class CompiledWorker:
    agent: Any
    toolkit: Any
    scope: ExecutionScopeV1
    cleanup: Optional[Callable[[], None]] = None

    def dispose(self) -> None:
        if self.cleanup is not None:
            self.cleanup()
            self.cleanup = None


async def compile_worker(
    agent_config: dict,
    agent_name: str,
    normalized_name: str,
    scope: ExecutionScopeV1,
    factory: Callable[..., Any],
    citation_manager: Any = None,
) -> CompiledWorker:
    """Compile one selected specialist through the existing factory path.

    ``factory`` is the current agent-creation callable (delegation factory's
    ``_create_agent_with_error_handling``); it stays the single source of tool
    wiring so native and root_constrained modes cannot drift from the direct
    path. Capability scoping (§6.4) narrows the compiled agent's tools after
    creation in WP04 — the facade is the seam where it attaches.
    """
    if scope.role not in {ExecutionRole.LIBRARY_WORKER, ExecutionRole.TEMPORARY_WORKER} or scope.depth != 1 or not scope.parent_execution_id:
        raise ValueError("Worker compilation requires a depth-one leaf execution scope")
    agent, toolkit = await factory(
        agent_config, agent_name, normalized_name, "", False, citation_manager
    )
    if agent is None:
        raise RuntimeError(f"Failed to compile worker agent: {agent_name}")
    from src.root_runtime.leaf_tools import install_leaf_tool_gate
    install_leaf_tool_gate(agent)
    from src.root_runtime.evidence_capture import install_evidence_capture
    install_evidence_capture(agent, scope)
    return CompiledWorker(agent=agent, toolkit=toolkit, scope=scope)


def make_resumable_root_runner(agent, session_service, scope=None, app_name=APP_NAME) -> Runner:
    """Runner for enrolled root roles: explicit App, resumability on,
    compaction preserved, standard plugins retained (plan §9.4)."""
    ecc = build_events_compaction_config()
    with_lifecycle = {"events_compaction_config": ecc} if ecc is not None else {}
    app = App(
        name=app_name,
        root_agent=agent,
        plugins=[CleanSessionPlugin(preserve_invocation_id=(
            scope.native_invocation_id if scope is not None and scope.resume_intent == "resume" else None
        ))],
        resumability_config=ResumabilityConfig(is_resumable=True),
        **with_lifecycle,
    )
    if ecc is not None:
        logger.info(
            "[root_runtime] resumable root app: compaction interval=%s overlap=%s",
            ecc.compaction_interval,
            ecc.overlap_size,
        )
    else:
        logger.info("[root_runtime] resumable root app: compaction disabled")
    return Runner(app=app, session_service=session_service)


def make_role_runner(
    agent, session_service, scope: Optional[ExecutionScopeV1]
) -> Runner:
    """Role-aware runner selection: enrolled roots get the resumable explicit
    App; every other role keeps today's make_chat_runner behavior unchanged."""
    from src.root_runtime.background_sessions import FencedBackgroundSessionService, BackgroundResumeRequired, validate_background_request
    if isinstance(session_service, FencedBackgroundSessionService):
        grant = session_service.grant
        validate_background_request(session_service, scope, grant.actor_id, grant.session_id)
        if scope.resume_intent == 'attach':
            raise BackgroundResumeRequired('Unconfirmed dispatch requires reconciliation before Runner construction')
        return make_resumable_root_runner(agent, session_service, scope, app_name=grant.app_name)
    if scope is not None and scope.role is ExecutionRole.ROOT:
        return make_resumable_root_runner(agent, session_service, scope)
    from src.smart_rag.infrastructure.compaction import make_chat_runner

    return make_chat_runner(agent, session_service)
