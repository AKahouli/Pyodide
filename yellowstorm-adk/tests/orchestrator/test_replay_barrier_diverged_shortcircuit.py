"""Barrier resilience: after one stalled key, later unreachable keys skip
instantly instead of each re-paying the full timeout."""
import asyncio, time
import os
os.environ.setdefault("ORCHESTRATOR_REPLAY_BARRIER_FAST_FORWARD", "1")


def _fresh_barrier(sequence, timeout):
    # reimport clean each call so the idempotent guard doesn't block re-patching
    from google.adk.workflow.utils import _replay_sequence_barrier as mod
    b = mod.ReplaySequenceBarrier(sequence, timeout_sec=timeout)
    return b


def test_diverged_shortcircuit():
    from src.companion_ai.adk import adk_patches
    adk_patches.apply_replay_barrier_resilience_patch()

    seq = [f"n{i}@1" for i in range(6)]
    TO = 0.3
    b = _fresh_barrier(seq, TO)

    async def run():
        # n0 is pre-set; wait returns at once. n2 is never advanced -> stalls the
        # sequence. n1..n5 are all unreachable (index stuck at 0).
        t0 = time.perf_counter()
        await b.wait("n0@1")            # set -> instant
        first_ms = time.perf_counter()
        await b.wait("n1@1")            # unreachable -> pays one timeout
        after_first = time.perf_counter()
        for k in ("n2@1", "n3@1", "n4@1", "n5@1"):
            await b.wait(k)            # diverged flag set -> instant
        end = time.perf_counter()
        return t0, first_ms, after_first, end

    t0, first_ms, after_first, end = asyncio.run(run())
    assert (first_ms - t0) < TO, "pre-set key must not wait"
    assert (after_first - first_ms) >= TO * 0.8, "first unreachable key should pay the timeout"
    assert (end - after_first) < TO * 0.5, "subsequent keys must skip, not re-pay timeout"
    assert getattr(b, "_worky_diverged", False) is True


def test_in_order_still_advances():
    """A well-formed replay (each key advanced in order) never trips divergence."""
    from src.companion_ai.adk import adk_patches
    adk_patches.apply_replay_barrier_resilience_patch()
    seq = ["a@1", "b@1", "c@1"]
    b = _fresh_barrier(seq, 0.3)

    async def run():
        await b.wait("a@1"); b.check_and_advance("a@1")
        await b.wait("b@1"); b.check_and_advance("b@1")
        await b.wait("c@1"); b.check_and_advance("c@1")

    asyncio.run(run())
    assert getattr(b, "_worky_diverged", False) is False


if __name__ == "__main__":
    test_diverged_shortcircuit()
    test_in_order_still_advances()
    print("ok")
