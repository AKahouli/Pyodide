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
