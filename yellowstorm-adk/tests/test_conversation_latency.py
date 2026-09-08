"""Tests for the conversation latency instrumentation."""

import asyncio
import time
import types
from typing import AsyncGenerator
from unittest.mock import MagicMock

import pytest

from src.grpc_generated import chatbot_pb2
from src.grpc_server import chatbot_servicer
from src.grpc_server.chatbot_servicer import ChatbotServicer
from src.smart_rag.infrastructure.monitoring.conversation_latency import (
    ConversationLatencyTrace,
    current_conversation_latency_trace,
    get_current_conversation_latency_trace,
    reset_conversation_latency_trace,
    start_conversation_latency_trace,
)
from src.smart_rag.infrastructure.monitoring.instrumented_lite_llm import InstrumentedLiteLlm


def _make_trace() -> ConversationLatencyTrace:
    return ConversationLatencyTrace(
        request_id="req-1",
        assistant_message_id="msg-1",
        backend_received_epoch_ms=1000.0,
    )


class TestConversationLatencyTrace:
    def test_first_model_call_claim_is_first_write_wins(self):
        trace = _make_trace()
        assert trace.claim_first_model_call() is True
        assert trace.claim_first_model_call() is False

    def test_marks_are_first_write_wins(self):
        trace = _make_trace()
        trace.claim_first_model_call()
        trace.mark_llm_request_start()
        first_start = trace.llm_request_start_perf_ns
        time.sleep(0.001)
        trace.mark_llm_request_start()
        assert trace.llm_request_start_perf_ns == first_start

        trace.mark_llm_first_delta()
        first_delta = trace.llm_first_delta_perf_ns
        time.sleep(0.001)
        trace.mark_llm_first_delta()
        assert trace.llm_first_delta_perf_ns == first_delta

    def test_monotonic_durations_are_computed(self):
        trace = _make_trace()
        trace.claim_first_model_call()
        trace.mark_llm_request_start()
        trace.mark_llm_first_delta()
        trace.mark_adk_first_delta_forwarded()
        assert trace.adk_pre_provider_ms() >= 0
        assert trace.provider_ttft_ms() >= 0
        assert trace.adk_forwarding_ms() >= 0

    def test_durations_absent_before_marks(self):
        trace = _make_trace()
        assert trace.provider_ttft_ms() is None
        assert trace.adk_forwarding_ms() is None

    def test_proto_envelope_carries_ids_and_durations(self):
        trace = _make_trace()
        trace.claim_first_model_call()
        trace.mark_llm_request_start()
        trace.mark_llm_first_delta()
        trace.mark_adk_first_delta_forwarded()
        trace_pb = trace.build_latency_trace_proto(chatbot_pb2)
        assert trace_pb is not None
        assert trace_pb.schema_version == 1
        assert trace_pb.request_id == "req-1"
        assert trace_pb.assistant_message_id == "msg-1"
        assert trace_pb.provider_ttft_ms >= 0
        assert trace_pb.adk_pre_provider_ms >= 0
        assert trace_pb.adk_forwarding_ms >= 0

    def test_proto_envelope_absent_without_first_delta(self):
        assert _make_trace().build_latency_trace_proto(chatbot_pb2) is None


class TestPreProviderBreakdown:
    def _trace_with_milestones(self, offsets_ms) -> ConversationLatencyTrace:
        """Build a trace with synthetic milestone offsets from request received."""
        trace = _make_trace()
        base_ns = 1_000_000_000
        trace.adk_request_received_perf_ns = base_ns
        pp = trace.pre_provider
        (
            pp.request_payload_ready_perf_ns,
            pp.request_log_done_perf_ns,
            pp.internal_request_ready_perf_ns,
            pp.session_lock_wait_start_perf_ns,
            pp.session_lock_acquired_perf_ns,
            pp.orchestration_ready_perf_ns,
            pp.first_model_agent_ready_perf_ns,
            pp.runner_invoked_perf_ns,
            trace.llm_request_start_perf_ns,
        ) = [base_ns + int(ms * 1_000_000) for ms in offsets_ms]
        return trace

    def test_markers_are_first_write_wins(self):
        trace = _make_trace()
        trace.mark_request_payload_ready()
        first = trace.pre_provider.request_payload_ready_perf_ns
        time.sleep(0.001)
        trace.mark_request_payload_ready()
        assert trace.pre_provider.request_payload_ready_perf_ns == first

    def test_complete_chain_children_and_parent(self):
        trace = self._trace_with_milestones([10, 110, 130, 135, 140, 170, 500, 700, 1000])
        breakdown = trace.build_pre_provider_breakdown()
        assert breakdown == {
            "protobuf_to_dict_ms": 10.0,
            "request_logging_ms": 100.0,
            "request_conversion_ms": 20.0,
            "workflow_dispatch_ms": 5.0,
            "session_lock_wait_ms": 5.0,
            "orchestration_setup_ms": 30.0,
            "agent_tool_preparation_ms": 330.0,
            "session_runner_setup_ms": 200.0,
            "adk_runtime_pre_model_ms": 300.0,
        }
        assert abs(sum(breakdown.values()) - trace.adk_pre_provider_ms()) < 1
        # Parent stays independently derived (t9 - t0), never the sum.
        assert trace.adk_pre_provider_ms() == 1000.0

    def test_proto_carries_nested_breakdown(self):
        trace = self._trace_with_milestones([10, 110, 130, 135, 140, 170, 500, 700, 1000])
        trace.mark_llm_first_delta()
        trace_pb = trace.build_latency_trace_proto(chatbot_pb2)
        assert trace_pb.HasField("adk_pre_provider_breakdown")
        assert trace_pb.adk_pre_provider_breakdown.request_logging_ms == 100.0
        assert trace_pb.adk_pre_provider_breakdown.adk_runtime_pre_model_ms == 300.0

    def test_partial_chain_omits_missing_children(self):
        trace = _make_trace()
        trace.adk_request_received_perf_ns = 1_000_000_000
        trace.pre_provider.request_payload_ready_perf_ns = 1_000_000_000
        trace.pre_provider.request_log_done_perf_ns = 1_050_000_000
        # Later milestones missing → only the covered stage appears.
        breakdown = trace.build_pre_provider_breakdown()
        assert breakdown == {"protobuf_to_dict_ms": 0.0, "request_logging_ms": 50.0}

    def test_no_breakdown_fields_before_model_start(self):
        trace = _make_trace()
        trace.claim_first_model_call()
        # Servicer never stamps a trace before milestones are set.
        assert trace.build_pre_provider_breakdown() == {}

    def test_out_of_order_marker_is_omitted(self):
        trace = _make_trace()
        base_ns = 1_000_000_000
        trace.adk_request_received_perf_ns = base_ns
        # request_log_done set but payload_ready missing → first stage omitted;
        # request_conversion also omitted (needs log_done → internal pair intact).
        trace.pre_provider.request_log_done_perf_ns = base_ns + 50_000_000
        trace.pre_provider.internal_request_ready_perf_ns = base_ns + 60_000_000
        breakdown = trace.build_pre_provider_breakdown()
        assert breakdown == {"request_conversion_ms": 10.0}


class TestSessionRunnerSetupBreakdown:
    @staticmethod
    def _pinned_trace() -> ConversationLatencyTrace:
        trace = _make_trace()
        base_ns = 1_000_000_000
        trace.adk_request_received_perf_ns = base_ns
        return trace

    def test_markers_are_first_write_wins(self):
        trace = _make_trace()
        trace.mark_session_service_init_start()
        first = trace.session_runner_setup.session_service_init_start_perf_ns
        time.sleep(0.001)
        trace.mark_session_service_init_start()
        assert trace.session_runner_setup.session_service_init_start_perf_ns == first

    def test_complete_intervals(self):
        trace = self._pinned_trace()
        srs = trace.session_runner_setup
        base_ns = trace.adk_request_received_perf_ns
        (srs.session_service_init_start_perf_ns,
         srs.session_service_init_end_perf_ns,
         srs.session_lookup_start_perf_ns,
         srs.session_lookup_end_perf_ns,
         srs.session_create_seed_start_perf_ns,
         srs.session_create_seed_end_perf_ns,
         srs.runner_construction_start_perf_ns,
         srs.runner_construction_end_perf_ns,
         trace.pre_provider.runner_invoked_perf_ns) = [
            base_ns + int(ms * 1_000_000) for ms in (100, 150, 200, 320, 400, 430, 500, 540, 700)
        ]
        breakdown = trace.build_session_runner_setup_breakdown()
        assert breakdown == {
            "session_service_init_ms": 50.0,
            "session_lookup_ms": 120.0,
            "session_create_seed_ms": 30.0,
            "runner_construction_ms": 40.0,
            "runner_handoff_ms": 160.0,
        }

    def test_existing_session_omits_create_seed(self):
        trace = self._pinned_trace()
        srs = trace.session_runner_setup
        base_ns = trace.adk_request_received_perf_ns
        srs.session_service_init_start_perf_ns = base_ns
        srs.session_service_init_end_perf_ns = base_ns + 5_000_000
        srs.session_lookup_start_perf_ns = base_ns + 10_000_000
        srs.session_lookup_end_perf_ns = base_ns + 130_000_000
        srs.runner_construction_start_perf_ns = base_ns + 200_000_000
        srs.runner_construction_end_perf_ns = base_ns + 240_000_000
        trace.pre_provider.runner_invoked_perf_ns = base_ns + 245_000_000
        assert trace.build_session_runner_setup_breakdown() == {
            "session_service_init_ms": 5.0,
            "session_lookup_ms": 120.0,
            "runner_construction_ms": 40.0,
            "runner_handoff_ms": 5.0,
        }

    def test_handoff_requires_runner_invoked(self):
        trace = self._pinned_trace()
        srs = trace.session_runner_setup
        base_ns = trace.adk_request_received_perf_ns
        srs.session_service_init_start_perf_ns = base_ns
        srs.session_service_init_end_perf_ns = base_ns + 5_000_000
        # runner_invoked never stamped → handoff omitted.
        assert trace.build_session_runner_setup_breakdown() == {"session_service_init_ms": 5.0}

    def test_implausible_interval_is_omitted(self):
        trace = self._pinned_trace()
        srs = trace.session_runner_setup
        base_ns = trace.adk_request_received_perf_ns
        # End before start → negative duration → omitted.
        srs.session_lookup_start_perf_ns = base_ns + 20_000_000
        srs.session_lookup_end_perf_ns = base_ns + 10_000_000
        assert trace.build_session_runner_setup_breakdown() == {}

    def test_proto_carries_nested_session_breakdown(self):
        trace = self._pinned_trace()
        srs = trace.session_runner_setup
        base_ns = trace.adk_request_received_perf_ns
        srs.session_service_init_start_perf_ns = base_ns
        srs.session_service_init_end_perf_ns = base_ns + 5_000_000
        srs.session_lookup_start_perf_ns = base_ns + 10_000_000
        srs.session_lookup_end_perf_ns = base_ns + 130_000_000
        trace.mark_llm_first_delta()
        trace_pb = trace.build_latency_trace_proto(chatbot_pb2)
        assert trace_pb.adk_pre_provider_breakdown.session_runner_setup_breakdown.session_lookup_ms == 120.0
        assert trace_pb.adk_pre_provider_breakdown.session_runner_setup_breakdown.session_service_init_ms == 5.0

    def test_proto_omits_nested_message_without_session_stages(self):
        trace = _make_trace()
        trace.mark_llm_first_delta()
        trace_pb = trace.build_latency_trace_proto(chatbot_pb2)
        assert not trace_pb.adk_pre_provider_breakdown.HasField("session_runner_setup_breakdown")


class TestContextVarLifecycle:
    def test_set_and_reset(self):
        token = start_conversation_latency_trace("rq", "am", 5.0)
        try:
            assert get_current_conversation_latency_trace().request_id == "rq"
        finally:
            reset_conversation_latency_trace(token)
        assert get_current_conversation_latency_trace() is None

    def test_child_task_inherits_trace(self):
        token = start_conversation_latency_trace("rq", "am", 5.0)

        async def child():
            trace = get_current_conversation_latency_trace()
            trace.mark_llm_request_start()
            return trace.request_id

        async def main():
            return await asyncio.create_task(child())

        try:
            assert asyncio.run(main()) == "rq"
            assert get_current_conversation_latency_trace().request_id == "rq"
        finally:
            reset_conversation_latency_trace(token)


class _FakeSuperLiteLlm:
    """Patched LiteLlm.generate_content_async recording call order."""

    calls = 0

    @classmethod
    async def stream_two(cls, *_args, **_kwargs) -> AsyncGenerator[str, None]:
        cls.calls += 1
        yield "response-1"
        yield "response-2"

    @classmethod
    async def stream_fail(cls, *_args, **_kwargs) -> AsyncGenerator[str, None]:
        cls.calls += 1
        raise RuntimeError("provider exploded")
        yield "never"  # pragma: no cover - makes this an async generator


class TestInstrumentedLiteLlm:
    def test_wraps_lite_llm(self):
        assert issubclass(InstrumentedLiteLlm, __import__(
            "google.adk.models.lite_llm", fromlist=["LiteLlm"]
        ).LiteLlm)

    @pytest.mark.asyncio
    async def test_stamps_request_start_and_first_delta_on_primary_call(self, monkeypatch):
        monkeypatch.setattr(
            "google.adk.models.lite_llm.LiteLlm.generate_content_async",
            _FakeSuperLiteLlm.stream_two,
        )
        llm = InstrumentedLiteLlm(model="test-model")
        trace = _make_trace()
        token = current_conversation_latency_trace.set(trace)
        try:
            responses = [r async for r in llm.generate_content_async(llm_request=object(), stream=True)]
        finally:
            current_conversation_latency_trace.reset(token)
        assert responses == ["response-1", "response-2"]
        assert trace.llm_request_start_perf_ns is not None
        assert trace.llm_first_delta_perf_ns is not None
        assert trace.llm_first_delta_perf_ns >= trace.llm_request_start_perf_ns
        assert trace.first_model_call_claimed is True

    @pytest.mark.asyncio
    async def test_second_call_does_not_overwrite_first_timestamps(self, monkeypatch):
        monkeypatch.setattr(
            "google.adk.models.lite_llm.LiteLlm.generate_content_async",
            _FakeSuperLiteLlm.stream_two,
        )
        llm = InstrumentedLiteLlm(model="test-model")
        trace = _make_trace()
        token = current_conversation_latency_trace.set(trace)
        try:
            _ = [r async for r in llm.generate_content_async(llm_request=object(), stream=True)]
            first_start = trace.llm_request_start_perf_ns
            first_delta = trace.llm_first_delta_perf_ns
            time.sleep(0.001)
            _ = [r async for r in llm.generate_content_async(llm_request=object(), stream=True)]
        finally:
            current_conversation_latency_trace.reset(token)
        assert trace.llm_request_start_perf_ns == first_start
        assert trace.llm_first_delta_perf_ns == first_delta

    @pytest.mark.asyncio
    async def test_transparent_without_trace(self, monkeypatch):
        monkeypatch.setattr(
            "google.adk.models.lite_llm.LiteLlm.generate_content_async",
            _FakeSuperLiteLlm.stream_two,
        )
        llm = InstrumentedLiteLlm(model="test-model")
        responses = [r async for r in llm.generate_content_async(llm_request=object(), stream=True)]
        assert responses == ["response-1", "response-2"]
        assert get_current_conversation_latency_trace() is None

    @pytest.mark.asyncio
    async def test_exception_before_first_delta_leaves_marker_unset(self, monkeypatch):
        monkeypatch.setattr(
            "google.adk.models.lite_llm.LiteLlm.generate_content_async",
            _FakeSuperLiteLlm.stream_fail,
        )
        llm = InstrumentedLiteLlm(model="test-model")
        trace = _make_trace()
        token = current_conversation_latency_trace.set(trace)
        try:
            with pytest.raises(RuntimeError):
                _ = [r async for r in llm.generate_content_async(llm_request=object(), stream=True)]
        finally:
            current_conversation_latency_trace.reset(token)
        assert trace.llm_request_start_perf_ns is not None
        assert trace.llm_first_delta_perf_ns is None


class TestServicerLatencyStamping:
    def _servicer(self) -> ChatbotServicer:
        return ChatbotServicer(MagicMock())

    def test_no_trace_leaves_chunk_untouched(self):
        servicer = self._servicer()
        chunk = chatbot_pb2.StreamChunk()
        servicer._stamp_first_forwarded_latency(chunk)
        assert not chunk.HasField("latency_trace")

    def test_pre_model_trace_does_not_stamp(self):
        servicer = self._servicer()
        trace = _make_trace()  # no llm first delta yet (initial activity chunk)
        token = current_conversation_latency_trace.set(trace)
        try:
            chunk = chatbot_pb2.StreamChunk()
            servicer._stamp_first_forwarded_latency(chunk)
            assert not chunk.HasField("latency_trace")
        finally:
            current_conversation_latency_trace.reset(token)

    def test_first_post_model_chunk_stamped_once(self):
        servicer = self._servicer()
        trace = _make_trace()
        trace.claim_first_model_call()
        trace.mark_llm_request_start()
        trace.mark_llm_first_delta()
        token = current_conversation_latency_trace.set(trace)
        try:
            first = chatbot_pb2.StreamChunk()
            servicer._stamp_first_forwarded_latency(first)
            second = chatbot_pb2.StreamChunk()
            servicer._stamp_first_forwarded_latency(second)
        finally:
            current_conversation_latency_trace.reset(token)
        assert first.HasField("latency_trace")
        assert first.latency_trace.request_id == "req-1"
        assert first.latency_trace.assistant_message_id == "msg-1"
        assert first.latency_trace.provider_ttft_ms >= 0
        assert trace.adk_first_delta_forwarded_perf_ns is not None
        assert not second.HasField("latency_trace")

    def test_begin_trace_captures_request_received(self):
        servicer = self._servicer()
        request = types.SimpleNamespace(
            latency_trace_context=chatbot_pb2.LatencyTraceContext(
                request_id="rq-1",
                assistant_message_id="am-1",
                backend_received_epoch_ms=1234.5,
            ),
        )
        token = servicer._begin_conversation_latency_trace(request)
        try:
            trace = get_current_conversation_latency_trace()
            assert trace is not None
            assert trace.request_id == "rq-1"
            assert trace.assistant_message_id == "am-1"
            assert trace.backend_received_epoch_ms == 1234.5
            assert trace.adk_request_received_epoch_ms > 0
        finally:
            if token is not None:
                reset_conversation_latency_trace(token)
        assert get_current_conversation_latency_trace() is None

    def test_begin_trace_without_context_is_none(self):
        servicer = self._servicer()
        request = types.SimpleNamespace()
        assert servicer._begin_conversation_latency_trace(request) is None

    def test_begin_trace_ignores_empty_context(self):
        servicer = self._servicer()
        request = types.SimpleNamespace(
            latency_trace_context=chatbot_pb2.LatencyTraceContext(),
        )
        assert servicer._begin_conversation_latency_trace(request) is None
