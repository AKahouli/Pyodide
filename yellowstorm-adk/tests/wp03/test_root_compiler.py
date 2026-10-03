"""WP03 compiler facade: explicit resumable App for roots, legacy untouched."""

import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest
from google.adk.apps.app import ResumabilityConfig

from src.root_runtime.compiler import (
    compile_worker,
    make_resumable_root_runner,
    make_role_runner,
)
from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1


class _FakeSessionService:
    pass


from google.adk.agents import LlmAgent

def _fake_agent() -> LlmAgent:
    # App requires a BaseNode; a bare LlmAgent is accepted (WP00 finding).
    return LlmAgent(name="root_agent", model="test-model")


def _root_scope() -> ExecutionScopeV1:
    return ExecutionScopeV1(role=ExecutionRole.ROOT, execution_id="exec_root", conversation_epoch=1)


@pytest.mark.asyncio
async def test_compile_worker_delegates_to_existing_factory():
    sentinel_agent, sentinel_toolkit = object(), object()
    calls = []

    async def factory(agent_config, agent_name, normalized_name, a, b, citation_manager):
        calls.append((agent_config, agent_name, normalized_name))
        return sentinel_agent, sentinel_toolkit

    compiled = await compile_worker(
        {"id": "agent_1"}, "Advisory", "advisory", _root_scope(), factory
    )
    assert compiled.agent is sentinel_agent
    assert compiled.toolkit is sentinel_toolkit
    assert compiled.scope.execution_id == "exec_root"
    assert calls == [({"id": "agent_1"}, "Advisory", "advisory")]

    disposed = []
    compiled.cleanup = lambda: disposed.append(1)
    compiled.dispose()
    assert disposed == [1]
    compiled.dispose()  # idempotent
    assert disposed == [1]


@pytest.mark.asyncio
async def test_compile_worker_raises_when_factory_fails():
    async def factory(*_args, **_kwargs):
        return None, None

    with pytest.raises(RuntimeError):
        await compile_worker({}, "Broken", "broken", _root_scope(), factory)


def test_resumable_root_runner_builds_explicit_resumable_app():
    runner = make_resumable_root_runner(_fake_agent(), _FakeSessionService())
    assert runner.app is not None
    assert runner.app.root_agent is not None
    assert isinstance(runner.app.resumability_config, ResumabilityConfig)
    assert runner.app.resumability_config.is_resumable is True
    # Compaction off by default in tests; app still explicit.
    assert runner.app.events_compaction_config is None


def test_resumable_root_runner_preserves_compaction():
    # Force the compaction config to prove §9.4 "preserve compaction".
    import src.root_runtime.compiler as compiler_mod
    from google.adk.apps.app import EventsCompactionConfig
    from google.adk.apps.llm_event_summarizer import LlmEventSummarizer
    from google.adk.models.base_llm import BaseLlm

    class _MinimalLlm(BaseLlm):
        model: str = "summarizer"

        async def generate_content_async(self, llm_request, stream=False):
            raise NotImplementedError

    ecc = EventsCompactionConfig(
        summarizer=LlmEventSummarizer(llm=_MinimalLlm()),
        compaction_interval=10,
        overlap_size=2,
    )
    with patch.object(compiler_mod, "build_events_compaction_config", lambda: ecc):
        runner = make_resumable_root_runner(_fake_agent(), _FakeSessionService())
    assert runner.app.resumability_config.is_resumable is True
    assert runner.app.events_compaction_config is not None


def test_role_runner_keeps_legacy_path_for_non_root():
    from src.smart_rag.infrastructure.compaction import APP_NAME

    agent = _fake_agent()
    for scope in (None, ExecutionScopeV1(role=ExecutionRole.LIBRARY_WORKER, execution_id="exec_w")):
        legacy_runner = make_role_runner(agent, _FakeSessionService(), scope)
        # Whatever the compaction default in this environment, the legacy path
        # never turns resumability on and keeps the direct agent reference.
        assert legacy_runner.agent is agent
        if legacy_runner.app is not None:
            assert legacy_runner.app.resumability_config is None

    root_runner = make_role_runner(agent, _FakeSessionService(), _root_scope())
    assert root_runner.app is not None
    assert root_runner.app.name == APP_NAME
    assert root_runner.app.resumability_config.is_resumable is True
