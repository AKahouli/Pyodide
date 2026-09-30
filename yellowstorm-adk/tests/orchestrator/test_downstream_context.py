"""_dep_results_context now also feeds a step the steps that DEPEND on it, as
context-only, so the executor/persona won't runtime-spawn an await that the plan
already contains (that spawn reshapes the graph and breaks replay)."""
from src.companion_ai.adk.service import OrchestratorService
from src.companion_ai.plan import Plan, Step, Status


def _plan():
    return Plan(steps=[
        Step(id="s1", kind="execute", title="Send Teams to Feriel"),
        Step(id="s2", kind="await_reply", title="Await Feriel's reply", depends_on=["s1"]),
        Step(id="s3", kind="execute", title="Apply decision", depends_on=["s2"]),
    ])


def test_send_step_sees_downstream_await_and_the_dont_spawn_note():
    ctx = OrchestratorService._dep_results_context(_plan())
    out = ctx(Step(id="s1", kind="execute", title="Send Teams to Feriel"))
    assert out is not None
    assert "POUR CONTEXTE" in out                     # marked context-only
    assert "Await Feriel's reply" in out              # names the downstream step
    assert "ne crée PAS d'attente" in out             # the don't-spawn instruction


def test_terminal_step_with_no_dependents_gets_nothing():
    ctx = OrchestratorService._dep_results_context(_plan())
    assert ctx(Step(id="s3", kind="execute", title="Apply decision", depends_on=["s2"])) is None


def test_upstream_results_still_injected_and_downstream_appended():
    plan = _plan()
    plan.step("s1").status = Status.COMPLETED
    plan.step("s1").result = "Message envoyé."
    ctx = OrchestratorService._dep_results_context(plan)
    # s2 depends on s1 (completed) and is depended on by s3 → both blocks present
    out = ctx(plan.step("s2"))
    assert "Message envoyé." in out                   # upstream result
    assert "Apply decision" in out                    # downstream awareness


if __name__ == "__main__":
    test_send_step_sees_downstream_await_and_the_dont_spawn_note()
    test_terminal_step_with_no_dependents_gets_nothing()
    test_upstream_results_still_injected_and_downstream_appended()
    print("ok")
