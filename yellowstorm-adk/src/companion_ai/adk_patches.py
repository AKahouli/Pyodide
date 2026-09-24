"""Startup ADK robustness patches (applied in main.py, next to the LLM patches).

Not gate logic — these raise ADK defaults that are too low for real MCP tool
latency. Kept out of the gate feature so the gate itself stays a pure ADK-native
implementation (see companion_ai/graph.py, nodes.py).
"""
import logging
import os

logger = logging.getLogger(__name__)


def apply_replay_barrier_timeout_patch(timeout_sec: float | None = None) -> None:
    """Raise ADK's workflow replay-sequence-barrier timeout.

    ADK constructs `ReplaySequenceBarrier(sequence)` with a hardcoded 15s
    default. On an approve-resume the re-drive re-executes the gated tool; a real
    send over the outlook/teams MCP (`sse` transport → Graph) takes >15s, and the
    barrier replaying a PARALLEL sibling step times out mid-send → the turn dies
    with "Replay divergence detected: Timed out waiting for sequence key …". 15s
    is simply too low for real tool latency, so bump it. Idempotent; controlled
    by ORCHESTRATOR_REPLAY_BARRIER_TIMEOUT (seconds, default 120).
    """
    timeout_sec = timeout_sec if timeout_sec is not None else float(
        os.environ.get("ORCHESTRATOR_REPLAY_BARRIER_TIMEOUT", "120"))
    from google.adk.workflow.utils import _replay_sequence_barrier as mod
    barrier = mod.ReplaySequenceBarrier
    if getattr(barrier, "_worky_timeout_patched", False):
        return
    original_init = barrier.__init__

    def __init__(self, sequence, timeout_sec_arg=None):  # ADK calls it with just `sequence`
        original_init(self, sequence,
                      timeout_sec if timeout_sec_arg is None else timeout_sec_arg)

    barrier.__init__ = __init__
    barrier._worky_timeout_patched = True
    logger.info("✅ ADK replay-barrier timeout raised to %.0fs (was 15s)", timeout_sec)


def apply_replay_barrier_resilience_patch() -> None:
    """Degrade an UNREACHABLE replay-barrier key to a warning instead of a crash.

    Root cause of "Replay divergence detected: Timed out waiting for sequence
    key '…'": ADK's barrier makes recovered (already-completed) nodes fast-forward
    in recorded chronological order. worky rebuilds the plan graph every turn and
    a create_task/delegate step that first ran nested is promoted to a TOP-LEVEL
    node on the rebuild, so its recorded position no longer matches — a
    predecessor key never advances and the barrier deadlocks, then times out and
    kills the whole turn. Raising the timeout (the other patch) only delays it;
    with spawned steps the key is genuinely unreachable, so it always fires.

    Safe to degrade: `ReplaySequenceBarrier.wait(key)` is called ONLY when a node
    is being fast-forwarded as a replayed NO-OP (see _workflow.py, the
    recovered_executions / not should_run branch — it returns a mock context).
    It never gates real execution, so proceeding on timeout re-surfaces the
    node's already-recorded output slightly out of order — no model call, no tool
    call, no re-sent email. worky reads results from the read model / step.result,
    not ADK output ordering, so ordering doesn't matter here.

    Idempotent. Disable with ORCHESTRATOR_REPLAY_BARRIER_FAST_FORWARD=0 to get
    ADK's original hard-fail back (e.g. to surface a genuine divergence in a repro).
    """
    if os.environ.get("ORCHESTRATOR_REPLAY_BARRIER_FAST_FORWARD", "1").strip().lower() in (
            "0", "false", "off", "no"):
        return
    import asyncio
    from google.adk.workflow.utils import _replay_sequence_barrier as mod
    barrier = mod.ReplaySequenceBarrier
    if getattr(barrier, "_worky_resilience_patched", False):
        return

    async def wait(self, key):
        if key in self.events:
            # Once ANY key times out, the sequence is permanently stalled for this
            # turn: check_and_advance only ever sets sequence[current_index+1], and
            # the stuck expected key won't be produced (graph reshaped), so
            # current_index can never move again. Every remaining wait() is thus
            # guaranteed to time out too — skip the wait instead of re-paying it
            # (~100s over a big plan collapses to one timeout).
            if getattr(self, "_worky_diverged", False):
                return
            try:
                await asyncio.wait_for(self.events[key].wait(), timeout=self.timeout_sec)
            except asyncio.TimeoutError:
                # Unreachable key (plan grew: spawned step promoted to top-level).
                # Proceed — the node only fast-forwards recorded output; it does
                # NOT re-execute. Crashing the turn is strictly worse.
                self._worky_diverged = True
                logger.warning(
                    "replay barrier: key %r never unblocked in %.0fs — proceeding "
                    "(fast-forward out of order; spawned-step graph reshape). "
                    "Sequence stalled; subsequent unreachable keys skip instantly.",
                    key, self.timeout_sec)

    barrier.wait = wait
    barrier._worky_resilience_patched = True
    logger.info("✅ ADK replay-barrier resilience patch applied (unreachable key → warn, not crash)")
