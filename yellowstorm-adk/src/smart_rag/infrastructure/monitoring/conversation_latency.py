"""Request-scoped conversation latency trace.

Captures the ADK-local timing boundaries for the end-to-end latency
instrumentation of the classic Conversation flow:

- ``adk.request_received``: gRPC RPC entry (before request serialization).
- ``llm.request_start``: entry into the first model adapter invocation.
- ``llm.first_delta``: first ``LlmResponse`` yielded by that invocation.
- ``adk.first_delta_forwarded``: first post-model public chunk about to be
  yielded from the gRPC stream.

Same-process durations are computed from a monotonic clock
(``time.perf_counter_ns``); epoch values (``time.time_ns``) only cross
process boundaries. All markers are first-write-wins so concurrent or later
model calls can never overwrite the first-call boundaries. The trace lives in
a ``ContextVar`` so ``asyncio.create_task`` copies it into the worker task and
it never leaks between concurrent requests.
"""

from __future__ import annotations

import time
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:  # pragma: no cover - typing only
    from src.grpc_generated import chatbot_pb2

LATENCY_TRACE_SCHEMA_VERSION = 1

# ADK-local durations are validated against this bound before being trusted
# (mirrors the backend's MAX_PLAUSIBLE_STAGE_MS clock policy).
MAX_PLAUSIBLE_STAGE_MS = 60_000.0


@dataclass
class AdkPreProviderMilestones:
    """First-write-wins monotonic milestones between gRPC entry and the first
    model adapter invocation. All values are ``time.perf_counter_ns`` stamps on
    the same clock as the parent markers."""

    request_payload_ready_perf_ns: Optional[int] = None
    request_log_done_perf_ns: Optional[int] = None
    internal_request_ready_perf_ns: Optional[int] = None
    session_lock_wait_start_perf_ns: Optional[int] = None
    session_lock_acquired_perf_ns: Optional[int] = None
    orchestration_ready_perf_ns: Optional[int] = None
    first_model_agent_ready_perf_ns: Optional[int] = None
    runner_invoked_perf_ns: Optional[int] = None


@dataclass
class SessionRunnerSetupMilestones:
    """First-write-wins monotonic start/end pairs decomposing the
    ``session_runner_setup_ms`` pre-provider child. The runner handoff ends at
    ``runner_invoked`` (immediately before ``run_async``), so it has no end
    stamp of its own. Diagnostic only."""

    session_service_init_start_perf_ns: Optional[int] = None
    session_service_init_end_perf_ns: Optional[int] = None
    session_lookup_start_perf_ns: Optional[int] = None
    session_lookup_end_perf_ns: Optional[int] = None
    # Only stamped when the session had to be created/seeded; omitted when the
    # session already existed rather than fabricating a nonzero duration.
    session_create_seed_start_perf_ns: Optional[int] = None
    session_create_seed_end_perf_ns: Optional[int] = None
    runner_construction_start_perf_ns: Optional[int] = None
    runner_construction_end_perf_ns: Optional[int] = None


@dataclass
class RunnerPreModelDiagnostics:
    """Log-only Runner lifecycle milestones and aggregates between
    ``runner.run_async`` iteration start and the first model adapter entry.

    Never serialized to protobuf or persisted — these exist only long enough
    to build the ``conversation_latency_diag.runner_pre_model`` structured log.
    Milestones are ``time.perf_counter_ns`` stamps, first-write-wins."""

    runner_iteration_start_perf_ns: Optional[int] = None
    before_run_perf_ns: Optional[int] = None
    user_message_callback_start_perf_ns: Optional[int] = None
    user_message_callback_end_perf_ns: Optional[int] = None
    before_agent_perf_ns: Optional[int] = None
    before_model_perf_ns: Optional[int] = None

    clean_session_ms: Optional[float] = None
    image_processing_ms: Optional[float] = None

    # Safe machine name captured in before_model_callback for log correlation.
    agent_name: str = ""

    pre_model_append_event_ms: float = 0.0
    pre_model_append_event_count: int = 0

    yellowmind_pre_runner_session_lookup_count: int = 0
    yellowmind_pre_runner_session_lookup_ms: float = 0.0
    runner_internal_session_lookup_count: int = 0
    runner_internal_session_lookup_ms: float = 0.0


@dataclass
class ConversationLatencyTrace:
    """Mutable, request-scoped timing state. Marker writes are first-write-wins."""

    request_id: str
    assistant_message_id: str
    backend_received_epoch_ms: Optional[float]

    adk_request_received_epoch_ms: float = field(default_factory=lambda: time.time_ns() / 1_000_000)
    adk_request_received_perf_ns: int = field(default_factory=time.perf_counter_ns)

    llm_request_start_epoch_ms: Optional[float] = None
    llm_request_start_perf_ns: Optional[int] = None

    llm_first_delta_epoch_ms: Optional[float] = None
    llm_first_delta_perf_ns: Optional[int] = None

    adk_first_delta_forwarded_epoch_ms: Optional[float] = None
    adk_first_delta_forwarded_perf_ns: Optional[int] = None

    first_model_call_claimed: bool = False

    pre_provider: AdkPreProviderMilestones = field(default_factory=AdkPreProviderMilestones)
    session_runner_setup: SessionRunnerSetupMilestones = field(default_factory=SessionRunnerSetupMilestones)
    diagnostics: RunnerPreModelDiagnostics = field(default_factory=RunnerPreModelDiagnostics)
    session_lookup_sequence: int = 0
    # Diagnostic-only correlation for the runner_pre_model log; empty until a
    # run site notes it. Not part of protobuf/UI metrics.
    session_id: str = ""

    def note_session_id(self, session_id: Optional[str]) -> None:
        if not self.session_id and session_id:
            self.session_id = str(session_id)

    def next_session_lookup_sequence(self) -> int:
        """One-based counter so repeated lookups in one turn are distinguishable."""
        self.session_lookup_sequence += 1
        return self.session_lookup_sequence

    def claim_first_model_call(self) -> bool:
        """Synchronous first-write-wins claim of the turn's primary model call."""
        if self.first_model_call_claimed:
            return False
        self.first_model_call_claimed = True
        return True

    def mark_llm_request_start(self) -> None:
        if self.llm_request_start_perf_ns is None:
            self.llm_request_start_perf_ns = time.perf_counter_ns()
            self.llm_request_start_epoch_ms = time.time_ns() / 1_000_000

    def mark_llm_first_delta(self) -> None:
        if self.llm_first_delta_perf_ns is None:
            self.llm_first_delta_perf_ns = time.perf_counter_ns()
            self.llm_first_delta_epoch_ms = time.time_ns() / 1_000_000

    def mark_adk_first_delta_forwarded(self) -> None:
        if self.adk_first_delta_forwarded_perf_ns is None:
            self.adk_first_delta_forwarded_perf_ns = time.perf_counter_ns()
            self.adk_first_delta_forwarded_epoch_ms = time.time_ns() / 1_000_000

    # Pre-provider diagnostic milestones (diagnostic only; never gate behavior).

    def mark_request_payload_ready(self) -> None:
        if self.pre_provider.request_payload_ready_perf_ns is None:
            self.pre_provider.request_payload_ready_perf_ns = time.perf_counter_ns()

    def mark_request_log_done(self) -> None:
        if self.pre_provider.request_log_done_perf_ns is None:
            self.pre_provider.request_log_done_perf_ns = time.perf_counter_ns()

    def mark_internal_request_ready(self) -> None:
        if self.pre_provider.internal_request_ready_perf_ns is None:
            self.pre_provider.internal_request_ready_perf_ns = time.perf_counter_ns()

    def mark_session_lock_wait_start(self) -> None:
        if self.pre_provider.session_lock_wait_start_perf_ns is None:
            self.pre_provider.session_lock_wait_start_perf_ns = time.perf_counter_ns()

    def mark_session_lock_acquired(self) -> None:
        if self.pre_provider.session_lock_acquired_perf_ns is None:
            self.pre_provider.session_lock_acquired_perf_ns = time.perf_counter_ns()

    def mark_orchestration_ready(self) -> None:
        if self.pre_provider.orchestration_ready_perf_ns is None:
            self.pre_provider.orchestration_ready_perf_ns = time.perf_counter_ns()

    def mark_first_model_agent_ready(self) -> None:
        if self.pre_provider.first_model_agent_ready_perf_ns is None:
            self.pre_provider.first_model_agent_ready_perf_ns = time.perf_counter_ns()

    def mark_runner_invoked(self) -> None:
        if self.pre_provider.runner_invoked_perf_ns is None:
            self.pre_provider.runner_invoked_perf_ns = time.perf_counter_ns()

    # Session/runner diagnostic markers (children of session_runner_setup_ms).

    def _mark_session_stage(self, attr: str) -> None:
        if getattr(self.session_runner_setup, attr) is None:
            setattr(self.session_runner_setup, attr, time.perf_counter_ns())

    def mark_session_service_init_start(self) -> None:
        self._mark_session_stage("session_service_init_start_perf_ns")

    def mark_session_service_init_end(self) -> None:
        self._mark_session_stage("session_service_init_end_perf_ns")

    def mark_session_lookup_start(self) -> None:
        self._mark_session_stage("session_lookup_start_perf_ns")

    def mark_session_lookup_end(self) -> None:
        self._mark_session_stage("session_lookup_end_perf_ns")

    def mark_session_create_seed_start(self) -> None:
        self._mark_session_stage("session_create_seed_start_perf_ns")

    def mark_session_create_seed_end(self) -> None:
        self._mark_session_stage("session_create_seed_end_perf_ns")

    def mark_runner_construction_start(self) -> None:
        self._mark_session_stage("runner_construction_start_perf_ns")

    def mark_runner_construction_end(self) -> None:
        self._mark_session_stage("runner_construction_end_perf_ns")

    # Runner pre-model diagnostic markers (log only; never in protobuf/UI).

    def _mark_diag_stage(self, attr: str) -> None:
        if getattr(self.diagnostics, attr) is None:
            setattr(self.diagnostics, attr, time.perf_counter_ns())

    def mark_runner_iteration_start(self) -> None:
        self._mark_diag_stage("runner_iteration_start_perf_ns")

    def mark_before_run(self) -> None:
        self._mark_diag_stage("before_run_perf_ns")

    def mark_user_message_callback_start(self) -> None:
        self._mark_diag_stage("user_message_callback_start_perf_ns")

    def mark_user_message_callback_end(self) -> None:
        self._mark_diag_stage("user_message_callback_end_perf_ns")

    def mark_before_agent(self) -> None:
        self._mark_diag_stage("before_agent_perf_ns")

    def mark_before_model(self) -> None:
        self._mark_diag_stage("before_model_perf_ns")

    @staticmethod
    def _monotonic_ms(start_ns: Optional[int], end_ns: Optional[int]) -> Optional[float]:
        if start_ns is None or end_ns is None:
            return None
        duration_ms = (end_ns - start_ns) / 1_000_000
        if duration_ms < 0 or duration_ms > MAX_PLAUSIBLE_STAGE_MS:
            return None
        return duration_ms

    def adk_pre_provider_ms(self) -> Optional[float]:
        return self._monotonic_ms(self.adk_request_received_perf_ns, self.llm_request_start_perf_ns)

    def provider_ttft_ms(self) -> Optional[float]:
        return self._monotonic_ms(self.llm_request_start_perf_ns, self.llm_first_delta_perf_ns)

    def adk_forwarding_ms(self) -> Optional[float]:
        return self._monotonic_ms(self.llm_first_delta_perf_ns, self.adk_first_delta_forwarded_perf_ns)

    def build_pre_provider_breakdown(self) -> dict:
        """Derive the nine diagnostic children of ``adk_pre_provider_ms``.

        Each child is independently computed from consecutive monotonic
        milestones; missing or implausible stages are omitted (never zeroed) so
        the parent stays independently derived as ``t9 - t0``.
        """
        pp = self.pre_provider
        t0 = self.adk_request_received_perf_ns
        stages = [
            ("protobuf_to_dict_ms", t0, pp.request_payload_ready_perf_ns),
            ("request_logging_ms", pp.request_payload_ready_perf_ns, pp.request_log_done_perf_ns),
            ("request_conversion_ms", pp.request_log_done_perf_ns, pp.internal_request_ready_perf_ns),
            ("workflow_dispatch_ms", pp.internal_request_ready_perf_ns, pp.session_lock_wait_start_perf_ns),
            ("session_lock_wait_ms", pp.session_lock_wait_start_perf_ns, pp.session_lock_acquired_perf_ns),
            ("orchestration_setup_ms", pp.session_lock_acquired_perf_ns, pp.orchestration_ready_perf_ns),
            ("agent_tool_preparation_ms", pp.orchestration_ready_perf_ns, pp.first_model_agent_ready_perf_ns),
            ("session_runner_setup_ms", pp.first_model_agent_ready_perf_ns, pp.runner_invoked_perf_ns),
            ("adk_runtime_pre_model_ms", pp.runner_invoked_perf_ns, self.llm_request_start_perf_ns),
        ]
        breakdown: dict = {}
        for name, start_ns, end_ns in stages:
            value = self._monotonic_ms(start_ns, end_ns)
            if value is not None:
                breakdown[name] = value
        return breakdown

    def build_session_runner_setup_breakdown(self) -> dict:
        """Derive the five diagnostic children of ``session_runner_setup_ms``.

        Each child is an independently validated monotonic interval; the runner
        handoff ends at ``runner_invoked`` (immediately before ``run_async``).
        Missing or implausible stages are omitted, never zeroed.
        """
        srs = self.session_runner_setup
        stages = [
            ("session_service_init_ms", srs.session_service_init_start_perf_ns, srs.session_service_init_end_perf_ns),
            ("session_lookup_ms", srs.session_lookup_start_perf_ns, srs.session_lookup_end_perf_ns),
            ("session_create_seed_ms", srs.session_create_seed_start_perf_ns, srs.session_create_seed_end_perf_ns),
            ("runner_construction_ms", srs.runner_construction_start_perf_ns, srs.runner_construction_end_perf_ns),
            ("runner_handoff_ms", srs.runner_construction_end_perf_ns, self.pre_provider.runner_invoked_perf_ns),
        ]
        breakdown: dict = {}
        for name, start_ns, end_ns in stages:
            value = self._monotonic_ms(start_ns, end_ns)
            if value is not None:
                breakdown[name] = value
        return breakdown

    def build_latency_trace_proto(self, chatbot_pb2: "chatbot_pb2"):
        """Build the ``chatbot_pb2.LatencyTrace`` envelope for the gRPC chunk.

        Returns None when the first model delta has not happened yet or the
        protobuf module is unavailable — callers then yield the chunk untouched.
        """
        if self.llm_first_delta_perf_ns is None or chatbot_pb2 is None:
            return None
        pre_provider = self.adk_pre_provider_ms()
        ttft = self.provider_ttft_ms()
        forwarding = self.adk_forwarding_ms()
        trace_pb = chatbot_pb2.LatencyTrace(
            schema_version=LATENCY_TRACE_SCHEMA_VERSION,
            request_id=self.request_id or "",
            assistant_message_id=self.assistant_message_id or "",
            adk_request_received_epoch_ms=self.adk_request_received_epoch_ms,
        )
        if self.llm_request_start_epoch_ms is not None:
            trace_pb.llm_request_start_epoch_ms = self.llm_request_start_epoch_ms
        if self.llm_first_delta_epoch_ms is not None:
            trace_pb.llm_first_delta_epoch_ms = self.llm_first_delta_epoch_ms
        if self.adk_first_delta_forwarded_epoch_ms is not None:
            trace_pb.adk_first_delta_forwarded_epoch_ms = self.adk_first_delta_forwarded_epoch_ms
        if pre_provider is not None:
            trace_pb.adk_pre_provider_ms = pre_provider
        if ttft is not None:
            trace_pb.provider_ttft_ms = ttft
        if forwarding is not None:
            trace_pb.adk_forwarding_ms = forwarding
        breakdown = self.build_pre_provider_breakdown()
        if breakdown:
            for name, value in breakdown.items():
                setattr(trace_pb.adk_pre_provider_breakdown, name, value)
        session_breakdown = self.build_session_runner_setup_breakdown()
        if session_breakdown:
            for name, value in session_breakdown.items():
                setattr(trace_pb.adk_pre_provider_breakdown.session_runner_setup_breakdown, name, value)
        return trace_pb


current_conversation_latency_trace: ContextVar[Optional[ConversationLatencyTrace]] = ContextVar(
    "current_conversation_latency_trace",
    default=None,
)


def get_current_conversation_latency_trace() -> Optional[ConversationLatencyTrace]:
    return current_conversation_latency_trace.get()


def start_conversation_latency_trace(
    request_id: str,
    assistant_message_id: str,
    backend_received_epoch_ms: Optional[float],
    *,
    received_epoch_ms: Optional[float] = None,
    received_perf_ns: Optional[int] = None,
) -> Token:
    """Install a request trace and return the ContextVar token for ``finally`` reset.

    Called at RPC entry so ``adk.request_received`` precedes request
    serialization/logging. ``asyncio.create_task`` copies the current context,
    so the worker task sees the trace.
    """
    trace = ConversationLatencyTrace(
        request_id=request_id or "",
        assistant_message_id=assistant_message_id or "",
        backend_received_epoch_ms=backend_received_epoch_ms,
    )
    if received_epoch_ms is not None:
        trace.adk_request_received_epoch_ms = received_epoch_ms
    if received_perf_ns is not None:
        trace.adk_request_received_perf_ns = received_perf_ns
    return current_conversation_latency_trace.set(trace)


def reset_conversation_latency_trace(token: Token) -> None:
    current_conversation_latency_trace.reset(token)
