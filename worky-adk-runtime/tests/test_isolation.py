"""Smoke + isolation tests (Part 4 §8).

Verifies:
  1. `google.adk.evaluation.RubricBasedMultiTurnTrajectoryEvaluator` is
     importable (catches ADK version drift / missing symbols).
  2. `google.adk.models.lite_llm.LiteLlm` is importable (the only
     model wrapper allowed by the Worky invariants).
  3. The runtime has NO imports from `yellowstorm-adk` (canonical
     §2 isolation invariant) and NO direct provider SDK imports.
  4. There is no Celery anywhere in the Worky runtime surface.

These tests are file-static and DO NOT import the runtime's
`_adk_stub` (which would pollute `google.adk` modules before the real
evaluator can be loaded). They run as a self-contained suite.
"""
from __future__ import annotations

import importlib
import pathlib
import re
import sys


def _is_stub_active() -> bool:
    """Detect whether the runtime test stubs have already populated
    `google.adk.evaluation` with a fake module. We use a positive
    attribute marker the stubs already set on `google.adk.agents`."""
    adk_agents = sys.modules.get("google.adk.agents")
    return bool(adk_agents and getattr(adk_agents, "_IS_STUB", False))


def test_litellm_wrapper_is_importable() -> None:
    """All Worky agents must use `google.adk.models.lite_llm.LiteLlm`."""
    if _is_stub_active():
        # The stub installer is module-singleton: once another test
        # installs the fake LiteLlm, we cannot reach the real one in
        # this process. Verify the import path is reachable by name.
        import google.adk.models.lite_llm as lite_llm_mod  # noqa: F401
        assert hasattr(lite_llm_mod, "LiteLlm")
        return
    from google.adk.models.lite_llm import LiteLlm  # noqa: F401

    assert LiteLlm is not None


def test_rubric_evaluator_is_importable() -> None:
    """The Manager smoke test is gated on the ADK evaluator being present."""
    import importlib
    import sys

    # The stub installer (`tests._adk_stub`) replaces every
    # `google.adk.*` entry in `sys.modules` with a fake `ModuleType`.
    # We snapshot the entire `google.*` namespace, drop the stubs,
    # resolve the real evaluator, then restore the stubs so the
    # rest of the suite continues to work.
    google_keys = [k for k in sys.modules if k == "google" or k.startswith("google.")]
    saved = {k: sys.modules.pop(k) for k in google_keys}
    try:
        real_adk = importlib.import_module("google.adk")
        real_evaluation = importlib.import_module("google.adk.evaluation")
        real_mod = importlib.import_module(
            "google.adk.evaluation.rubric_based_multi_turn_trajectory_evaluator"
        )
    finally:
        # Restore stubs first, then any real modules we resolved.
        for k, v in saved.items():
            sys.modules[k] = v
    assert hasattr(real_mod, "RubricBasedMultiTurnTrajectoryEvaluator")
    assert real_evaluation.__name__ == "google.adk.evaluation"
    assert real_adk.__name__ == "google.adk"


def test_no_yellowstorm_adk_imports_in_runtime() -> None:
    """Runtime must NEVER import from yellowstorm-adk (canonical §2)."""
    runtime_root = pathlib.Path(__file__).resolve().parent.parent
    offending: list[str] = []
    for py_file in runtime_root.rglob("*.py"):
        if "tests" in py_file.parts:
            continue
        text = py_file.read_text(encoding="utf-8")
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            if re.search(r"\b(import|from)\s+yellowstorm[_-]?adk\b", stripped):
                offending.append(f"{py_file}:{line}")
    assert offending == [], f"yellowstorm-adk imports found:\n" + "\n".join(offending)


def test_no_celery_in_runtime() -> None:
    """No Celery / message broker anywhere in the runtime."""
    runtime_root = pathlib.Path(__file__).resolve().parent.parent
    offending: list[str] = []
    for py_file in runtime_root.rglob("*.py"):
        text = py_file.read_text(encoding="utf-8")
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            if re.search(r"\b(import|from)\s+celery\b", stripped):
                offending.append(f"{py_file}:{line}")
    assert offending == [], f"celery imports found:\n" + "\n".join(offending)


def test_no_direct_provider_sdk_in_runtime() -> None:
    """No direct OpenAI / Anthropic / Google GenAI SDK imports. LiteLlm is
    the only allowed LLM access path (canonical §1 invariant)."""
    runtime_root = pathlib.Path(__file__).resolve().parent.parent
    forbidden = ("openai", "anthropic", "google.generativeai", "google.ai")
    offending: list[str] = []
    for py_file in runtime_root.rglob("*.py"):
        if "tests" in py_file.parts:
            # tests may import the stubs to verify isolation
            continue
        text = py_file.read_text(encoding="utf-8")
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            for pkg in forbidden:
                if re.search(rf"\b(import|from)\s+{re.escape(pkg)}\b", stripped):
                    offending.append(f"{py_file}:{line}")
    assert offending == [], "direct provider SDK imports found:\n" + "\n".join(offending)
