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
