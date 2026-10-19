"""Run destructive P0 fixtures only on an explicitly disposable local database.

CI provisions its own PostgreSQL service. Local callers must provision an
isolated instance first; this script never reads .env or a production DSN.
JUnit and non-secret source/database evidence are emitted even on failure.
This gate does not certify the separate M1-M10 staging matrix.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlparse
import xml.etree.ElementTree as ET

import asyncpg
import pytest

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
SUITES = [
    "test_worker_identity.py", "test_task_lease_guard.py", "test_p0_baseline_races.py",
    "test_postgres_jobs_integration.py", "test_my_jobs_live.py", "test_dispatcher.py",
    "test_population_task.py", "test_graph_search_stall.py", "test_graph_search_resume.py",
    "test_graph_search_build.py", "test_graph_search_fencing.py", "test_cutover_serialization.py",
    "test_population_commands.py", "test_graph_search_incremental.py",
    "test_p0_gate.py",
    "test_error_details.py", "test_runtime_error_status.py", "test_attribute_extraction_client.py",
]


def source_evidence() -> dict:
    digest = hashlib.sha256()
    files = [ROOT / "requirements.txt", REPO / ".github/workflows/semantic-runtime-p0.yml"]
    for folder in ("app", "tests", "scripts", "migrations"):
        files.extend(path for path in (ROOT / folder).rglob("*")
                     if path.suffix in (".py", ".sql") and "__pycache__" not in path.parts)
    for path in sorted(files):
        digest.update(str(path.relative_to(REPO)).replace("\\", "/").encode())
        digest.update(b"\0" + path.read_bytes() + b"\0")
    return {
        "gitCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
        "sourceSha256": digest.hexdigest(),
        "worktreeDirty": bool(subprocess.check_output(
            ["git", "status", "--porcelain", "--", str(ROOT), ".github/workflows/semantic-runtime-p0.yml"],
            cwd=REPO, text=True).strip()),
    }


async def prerequisites() -> dict:
    if sys.version_info < (3, 11):
        raise ValueError("Python 3.11+ required")
    if os.environ.get("SEMANTIC_P0_DISPOSABLE") != "1":
        raise ValueError("SEMANTIC_P0_DISPOSABLE=1 required for destructive fixtures")
    names = ("SEMANTIC_RUNTIME_TEST_DATABASE_URL", "SEMANTIC_RUNTIME_GUARD_TEST_DATABASE_URL")
    dsns = [os.environ.get(name, "") for name in names]
    if not all(dsns):
        raise ValueError("Both explicit P0 test database DSNs are required")
    targets = [urlparse(dsn) for dsn in dsns]
    for target in targets:
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/semantic_p0_test":
            raise ValueError("Only disposable loopback semantic_p0_test is allowed")
    if any((target.hostname, target.port, target.path) !=
           (targets[0].hostname, targets[0].port, targets[0].path) for target in targets[1:]):
        raise ValueError("The guard must verify the same database as the repository")
    connection = await asyncpg.connect(dsns[0], timeout=5, command_timeout=10)
    try:
        if await connection.fetchval("SELECT current_database()") != "semantic_p0_test":
            raise ValueError("Database identity mismatch")
        await connection.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto; "
                                 "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm")
        extensions = dict(await connection.fetch("SELECT extname,extversion FROM pg_extension"))
        if tuple(map(int, extensions["vector"].split(".")[:2])) < (0, 7):
            raise ValueError("pgvector >= 0.7 required")
        return {"database": "semantic_p0_test", "postgresVersion": await connection.fetchval("SHOW server_version"),
                "extensions": extensions, "isolatedOptIn": True}
    finally:
        await connection.close()


def bind_test_environment(dsn: str) -> None:
    """Only called after validating the disposable target, before collection.

    Some worker tests use the runtime URL rather than the test URL. Neither
    ambient deployment configuration nor a local .env may redirect them.
    """
    for name in ("SEMANTIC_RUNTIME_DATABASE_URL", "SEMANTIC_RUNTIME_TEST_DATABASE_URL",
                 "SEMANTIC_RUNTIME_GUARD_TEST_DATABASE_URL", "SEMANTIC_F2_TEST_DSN",
                 "SEMANTIC_F3_ISOLATED_DATABASE_URL"):
        os.environ[name] = dsn
    os.environ["PYTHON_DOTENV_DISABLED"] = "1"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report-dir", type=Path, default=REPO / "qa-artifacts/semantic-runtime-p0")
    args = parser.parse_args()
    args.report_dir.mkdir(parents=True, exist_ok=True)
    junit = args.report_dir / "junit.xml"
    junit.unlink(missing_ok=True)
    evidence = {**source_evidence(), "status": "FAIL", "stagingMatrix": "NOT RUN", "seed": 20260314}
    try:
        evidence.update(asyncio.run(prerequisites()))
    except Exception as exc:
        # Never emit exception bodies from drivers: they may include a DSN.
        reason = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
        evidence["prerequisiteFailure"] = reason
        (args.report_dir / "evidence.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
        sys.stderr.write("P0 prerequisite failed: " + reason + "\n")
        return 1
    dsn = os.environ["SEMANTIC_RUNTIME_TEST_DATABASE_URL"]
    bind_test_environment(dsn)
    command = ["-q", "-ra", "-o", "pythonpath=.", f"--junitxml={junit}"]
    command += [str(ROOT / "tests" / name) for name in SUITES]
    evidence["pytestArguments"] = command
    # No xdist: these historical fixtures reset schemas and must run serially.
    result = int(pytest.main(command))
    if junit.exists():
        cases = ET.parse(junit).getroot().findall(".//testcase")
        evidence["tests"] = len(cases)
        for tag in ("skipped", "failure", "error"):
            evidence[tag] = sum(case.find(tag) is not None for case in cases)
        if not cases or any(evidence[tag] for tag in ("skipped", "failure", "error")):
            result = result or 1
    else:
        result = result or 1
        evidence["reportMissing"] = True
    evidence["status"] = "PASS" if result == 0 else "FAIL"
    evidence["pytestExitCode"] = result
    (args.report_dir / "evidence.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    return result


if __name__ == "__main__":
    raise SystemExit(main())
