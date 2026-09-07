"""Wave-scheduler tests — proves parallel vs sequential vs block-and-ask behavior.

Pure logic, no ADK/DB. Runnable standalone (`python tests/orchestrator/test_scheduler.py`)
or under pytest.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import pytest

from src.companion_ai.plan import Plan, Step, Status
from src.companion_ai import scheduler as sch


def _plan(*steps: Step) -> Plan:
    return Plan(title="t", goal="g", steps=list(steps))


def _ids(steps):
    return sorted(s.id for s in steps)


def test_independent_steps_run_in_parallel():
    p = _plan(Step(id="a"), Step(id="b"))
    sch.validate(p)
    sch.assign_waves(p)
    assert p.step("a").wave == 0 and p.step("b").wave == 0
    assert _ids(sch.ready_steps(p)) == ["a", "b"]        # both ready at once → parallel


def test_linear_chain_is_sequential():
    p = _plan(Step(id="a"), Step(id="b", depends_on=["a"]), Step(id="c", depends_on=["b"]))
    sch.validate(p)
    sch.assign_waves(p)
    assert [p.step(x).wave for x in ("a", "b", "c")] == [0, 1, 2]
    assert _ids(sch.ready_steps(p)) == ["a"]             # only a
    p.step("a").status = Status.COMPLETED
    assert _ids(sch.ready_steps(p)) == ["b"]             # then b
    p.step("b").status = Status.COMPLETED
    assert _ids(sch.ready_steps(p)) == ["c"]


def test_diamond_fans_out_then_joins():
    # a → (b, c) → d
    p = _plan(
        Step(id="a"),
        Step(id="b", depends_on=["a"]),
        Step(id="c", depends_on=["a"]),
        Step(id="d", depends_on=["b", "c"]),
    )
    sch.validate(p)
    sch.assign_waves(p)
    assert [p.step(x).wave for x in ("a", "b", "c", "d")] == [0, 1, 1, 2]
    p.step("a").status = Status.COMPLETED
    assert _ids(sch.ready_steps(p)) == ["b", "c"]        # b and c in parallel
    p.step("b").status = Status.COMPLETED
    assert _ids(sch.ready_steps(p)) == ["c"]            # d still waits for c
    p.step("c").status = Status.COMPLETED
    assert _ids(sch.ready_steps(p)) == ["d"]            # join: d now ready


def test_block_and_ask_lets_other_branches_continue():
    # a done; b (indep of the blocked branch) should run; c depends on blocked x
    x = Step(id="x", status=Status.BLOCKED, blocked_reason="awaiting user input")
    p = _plan(
        Step(id="a", status=Status.COMPLETED),
        Step(id="b"),                       # independent → should proceed
        x,
        Step(id="c", depends_on=["x"]),     # dependent on blocked → must wait
    )
    sch.validate(p)
    assert _ids(sch.ready_steps(p)) == ["b"]            # b runs while x is blocked
    assert sch.derive_status(p) is Status.RUNNING       # plan still moving
    # user answers → x resolves → c unblocks
    x.status = Status.COMPLETED
    p.step("b").status = Status.COMPLETED
    assert _ids(sch.ready_steps(p)) == ["c"]


def test_waiting_when_only_blocked_remains():
    p = _plan(
        Step(id="a", status=Status.COMPLETED),
        Step(id="x", status=Status.BLOCKED, blocked_reason="awaiting user input"),
        Step(id="c", depends_on=["x"]),
    )
    assert sch.ready_steps(p) == []
    assert sch.is_waiting(p) is True
    assert sch.derive_status(p) is Status.BLOCKED


def test_failed_dependency_strands_plan():
    p = _plan(Step(id="a", status=Status.FAILED), Step(id="b", depends_on=["a"]))
    assert sch.ready_steps(p) == []
    assert sch.derive_status(p) is Status.FAILED


def test_cycle_is_rejected():
    p = _plan(Step(id="a", depends_on=["b"]), Step(id="b", depends_on=["a"]))
    with pytest.raises(ValueError, match="cycle"):
        sch.validate(p)


def test_unknown_dependency_is_rejected():
    p = _plan(Step(id="a", depends_on=["ghost"]))
    with pytest.raises(ValueError, match="unknown"):
        sch.validate(p)


def test_duplicate_step_ids_are_rejected():
    p = _plan(Step(id="a"), Step(id="a"))
    with pytest.raises(ValueError, match="duplicate step ids"):
        sch.validate(p)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
