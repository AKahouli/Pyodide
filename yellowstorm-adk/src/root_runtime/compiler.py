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
    agent, toolkit = await factory(
        agent_config, agent_name, normalized_name, "", False, citation_manager
    )
    if agent is None:
        raise RuntimeError(f"Failed to compile worker agent: {agent_name}")
    return CompiledWorker(agent=agent, toolkit=toolkit, scope=scope)


def make_resumable_root_runner(agent, session_service) -> Runner:
    """Runner for enrolled root roles: explicit App, resumability on,
    compaction preserved, standard plugins retained (plan §9.4)."""
    ecc = build_events_compaction_config()
    with_lifecycle = {"events_compaction_config": ecc} if ecc is not None else {}
    app = App(
        name=APP_NAME,
        root_agent=agent,
        plugins=[CleanSessionPlugin()],
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
    if scope is not None and scope.role is ExecutionRole.ROOT:
        return make_resumable_root_runner(agent, session_service)
    from src.smart_rag.infrastructure.compaction import make_chat_runner

    return make_chat_runner(agent, session_service)
