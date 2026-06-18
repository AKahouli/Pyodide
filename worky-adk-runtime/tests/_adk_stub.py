"""Shared ADK stub installer for the Worky runtime test suite.

The real `google-adk` package isn't available in the unit-test
environment (it's installed only inside the runtime container). To
exercise the Manager agent and the bounded-turn runner without
hitting the network, we install a minimal stub set into `sys.modules`
that:

  - records every `LlmAgent` construction (including its `tools=`
    kwarg so tests can invoke the tool closures directly),
  - provides a no-op `LiteLlm` factory,
  - provides an `InMemorySessionService` that returns a stub session,
  - provides a `Runner` whose `run_async` yields whatever events the
    test passes via `monkeypatch`-style hooks (see
    `make_runner_with_events`).

The stubs are module-singletons: re-importing this module is a no-op.
"""
from __future__ import annotations

import sys
import types
from typing import Any, AsyncIterator, Callable, Iterable

_INSTALLED = False
_CONSTRUCTED_LLM_AGENTS: list[dict[str, Any]] = []
_RUNNER_EVENTS_PROVIDER: Callable[[], Iterable[Any]] | None = None


def install_adk_stubs() -> None:
    global _INSTALLED
    if _INSTALLED:
        return

    agents_mod = types.ModuleType("google.adk.agents")
    agents_mod._IS_STUB = True  # type: ignore[attr-defined]
    tools_mod = types.ModuleType("google.adk.tools")
    tools_mod._IS_STUB = True  # type: ignore[attr-defined]
    models_mod = types.ModuleType("google.adk.models")
    lite_llm_mod = types.ModuleType("google.adk.models.lite_llm")
    runners_mod = types.ModuleType("google.adk.runners")
    sessions_mod = types.ModuleType("google.adk.sessions")
    genai_types = types.ModuleType("google.genai.types")

    class _StubLlmAgent:
        def __init__(self, **kwargs: Any) -> None:
            self.tools = kwargs.get("tools", [])
            _CONSTRUCTED_LLM_AGENTS.append(kwargs)

    class _StubLiteLlm:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

    class _StubSession:
        pass

    class _StubSessionService:
        async def create_session(self, **kwargs: Any) -> _StubSession:
            return _StubSession()

    class _StubRunner:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        async def run_async(self, *args: Any, **kwargs: Any) -> AsyncIterator[Any]:
            provider = _RUNNER_EVENTS_PROVIDER
            if provider is None:
                return
                yield  # pragma: no cover — make this an async generator
            for ev in provider():
                yield ev

    class _StubContent:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

    class _StubPart:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self.text = kwargs.get("text", "")

    agents_mod.LlmAgent = _StubLlmAgent
    tools_mod.request_input = lambda *a, **k: None
    lite_llm_mod.LiteLlm = _StubLiteLlm
    sessions_mod.InMemorySessionService = _StubSessionService
    runners_mod.Runner = _StubRunner
    genai_types.Content = _StubContent
    genai_types.Part = _StubPart

    if "google" not in sys.modules:
        adk_pkg = types.ModuleType("google")
        adk_pkg.__path__ = []
        sys.modules["google"] = adk_pkg
    if "google.adk" not in sys.modules:
        sys.modules["google.adk"] = types.ModuleType("google.adk")
        sys.modules["google.adk"].__path__ = []
    if "google.genai" not in sys.modules:
        sys.modules["google.genai"] = types.ModuleType("google.genai")
        sys.modules["google.genai"].__path__ = []
    sys.modules["google.adk.agents"] = agents_mod
    sys.modules["google.adk.tools"] = tools_mod
    sys.modules["google.adk.models"] = models_mod
    sys.modules["google.adk.models.lite_llm"] = lite_llm_mod
    sys.modules["google.adk.runners"] = runners_mod
    sys.modules["google.adk.sessions"] = sessions_mod
    sys.modules["google.genai.types"] = genai_types

    _INSTALLED = True


def set_runner_events_provider(provider: Callable[[], Iterable[Any]] | None) -> None:
    """Set the function the stub Runner will call to fetch events.

    Used by `tests/test_runner.py` to drive the runner with a fixed
    sequence of events without hitting the real ADK.
    """
    global _RUNNER_EVENTS_PROVIDER
    _RUNNER_EVENTS_PROVIDER = provider


def constructed_llm_agents() -> list[dict[str, Any]]:
    """Inspect every `LlmAgent` construction kwargs recorded so far."""
    return list(_CONSTRUCTED_LLM_AGENTS)


def reset_recordings() -> None:
    """Clear recordings between tests (call from a fixture if needed)."""
    _CONSTRUCTED_LLM_AGENTS.clear()
    set_runner_events_provider(None)


# Install on import.
install_adk_stubs()
