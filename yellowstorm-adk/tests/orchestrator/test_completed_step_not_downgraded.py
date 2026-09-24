"""A re-drive of an already-completed step that self-reports failure must NOT
downgrade it: the work (e.g. a created GitHub ticket) already happened.
Covers OrchestratorService._keep_completed_on_rerun_failure."""
import asyncio
from types import SimpleNamespace
from src.companion_ai.plan import Status
from src.companion_ai.service import OrchestratorService


def _fake_service():
    calls = []
    class _RM:
        def set_step_status(self, session_id, step_id, status, **kw):
            calls.append((step_id, status, kw.get("result")))
            return ("set_step_status", step_id, status)
    async def _project(coro):  # in real code _project awaits the RM coroutine
        return coro
    svc = SimpleNamespace(_rm=_RM(), _project=_project, calls=calls)
    return svc


def _run(svc, step):
    # call the unbound method with our fake self
    return asyncio.run(
        OrchestratorService._keep_completed_on_rerun_failure(svc, "sess1", step))


def test_completed_step_protected():
    svc = _fake_service()
    step = SimpleNamespace(id="ticket-sophie", status=Status.FAILED,
                           result="Ticket #347 créé", error="boom",
                           _completed_once=True)
    protected = _run(svc, step)
    assert protected is True
    assert step.status is Status.COMPLETED          # downgrade reverted
    assert step.error is None
    assert step.result == "Ticket #347 créé"        # real result kept
    assert svc.calls == [("ticket-sophie", "completed", "Ticket #347 créé")]


def test_never_completed_not_protected():
    svc = _fake_service()
    step = SimpleNamespace(id="s1", status=Status.FAILED, result="boom",
                           error="boom")  # no _completed_once
    protected = _run(svc, step)
    assert protected is False
    assert step.status is Status.FAILED             # genuine failure stands
    assert svc.calls == []


if __name__ == "__main__":
    test_completed_step_protected()
    test_never_completed_not_protected()
    print("ok")
