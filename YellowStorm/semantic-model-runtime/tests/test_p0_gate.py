"""Safety checks for the destructive integration runner, without connecting."""
import os
from pathlib import Path
import runpy

import pytest

from scripts import run_p0_gate as gate


def test_live_job_collection_cannot_use_ambient_deployment_configuration(monkeypatch):
    import dotenv

    monkeypatch.setenv("SEMANTIC_RUNTIME_DATABASE_URL", "postgresql://forbidden.invalid/shared")
    # bind_test_environment normally runs in its own short-lived CLI process.
    # Track its writes so this unit test restores the enclosing gate's env.
    for name in ("SEMANTIC_RUNTIME_DATABASE_URL", "SEMANTIC_RUNTIME_TEST_DATABASE_URL",
                 "SEMANTIC_RUNTIME_GUARD_TEST_DATABASE_URL", "SEMANTIC_F2_TEST_DSN",
                 "SEMANTIC_F3_ISOLATED_DATABASE_URL", "PYTHON_DOTENV_DISABLED"):
        monkeypatch.setenv(name, os.environ.get(name, ""))

    def forbidden_dotenv(*args, **kwargs):
        pytest.fail("integration collection attempted to load deployment .env")

    monkeypatch.setattr(dotenv, "load_dotenv", forbidden_dotenv)
    dsn = "postgresql://test-only@127.0.0.1:1/semantic_p0_test"
    gate.bind_test_environment(dsn)
    collected = runpy.run_path(str(Path(__file__).with_name("test_my_jobs_live.py")))
    assert collected["DSN"] == dsn
    assert os.environ["SEMANTIC_RUNTIME_DATABASE_URL"] == dsn


@pytest.mark.asyncio
@pytest.mark.parametrize("target", ["", "postgresql://shared.invalid/semantic_p0_test",
                                  "postgresql://127.0.0.1/production"])
async def test_missing_or_nonisolated_prerequisites_fail_before_any_connection(monkeypatch, target):
    async def forbidden_connect(*args, **kwargs):
        pytest.fail("invalid integration target reached asyncpg.connect")

    monkeypatch.setattr(gate.asyncpg, "connect", forbidden_connect)
    monkeypatch.setenv("SEMANTIC_P0_DISPOSABLE", "1")
    monkeypatch.setenv("SEMANTIC_RUNTIME_TEST_DATABASE_URL", target)
    monkeypatch.setenv("SEMANTIC_RUNTIME_GUARD_TEST_DATABASE_URL", target)
    with pytest.raises(ValueError):
        await gate.prerequisites()
