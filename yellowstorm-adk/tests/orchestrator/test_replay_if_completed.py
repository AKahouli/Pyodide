"""A completed step re-entering on resume must short-circuit to its stored
result (no model call), not re-execute. Covers nodes._replay_if_completed."""
import asyncio
from types import SimpleNamespace
from src.companion_ai.plan import Status
from src.companion_ai.adk import nodes


def _run(status, result):
    cb = nodes._replay_if_completed(SimpleNamespace(status=status, result=result))
    return asyncio.run(cb(None, None))


def test_completed_short_circuits_with_stored_text():
    r = _run(Status.COMPLETED, "Ticket #347 créé")
    assert r is not None                                   # skips the model call
    assert r.content.role == "model"
    assert r.content.parts[0].text == "Ticket #347 créé"  # emits the recorded result


def test_non_completed_runs_for_real():
    for st in (Status.RUNNING, Status.PENDING, Status.FAILED, Status.BLOCKED):
        assert _run(st, "x") is None                       # None => real model call


def test_completed_but_empty_result_runs():
    # never emit an empty terminal event; let it run rather than store nothing
    assert _run(Status.COMPLETED, "") is None
    assert _run(Status.COMPLETED, "   ") is None


if __name__ == "__main__":
    test_completed_short_circuits_with_stored_text()
    test_non_completed_runs_for_real()
    test_completed_but_empty_result_runs()
    print("ok")
