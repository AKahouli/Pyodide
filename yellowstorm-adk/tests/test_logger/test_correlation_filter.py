"""Unit tests for CorrelationIdFilter."""

import logging
import os
from unittest.mock import Mock, patch
import pytest

from tests.common_schema import MockSettings

# from src.logger.logging import CorrelationIdFilter


class TestCorrelationIdFilter:
    """Test suite for CorrelationIdFilter class."""

    @pytest.fixture
    def correlation_filter(self):
        from src.logger.logging import CorrelationIdFilter
        """Create a CorrelationIdFilter instance."""
        return CorrelationIdFilter()

    @pytest.fixture
    def log_record(self):
        """Create a basic log record."""
        return logging.LogRecord(
            name="test.logger",
            level=logging.INFO,
            pathname="test.py",
            lineno=10,
            msg="Test message",
            args=(),
            exc_info=None
        )

    def test_filter_adds_basic_fields(self, correlation_filter, log_record):
        """Test that filter adds basic correlation fields."""
        mock_context = {'request_id': 'test-correlation-id'}
        with patch('src.middleware.correlation.get_user', return_value='test-user'):
            with patch('structlog.contextvars.get_contextvars', return_value=mock_context):
                result = correlation_filter.filter(log_record)

                assert result is True  # Filter should always return True
                assert log_record.correlationId == 'test-correlation-id'
                assert log_record.user == 'test-user'
                assert log_record.component == 'API-metachatbot'

    def test_filter_extracts_context_fields(self, correlation_filter, log_record):
        """Test that filter extracts fields from structlog contextvars."""
        mock_context = {
            'request_id': 'req-123',
            'user_id': 'user-456',
            'session_id': 'session-789',
            'http_method': 'POST',
            'http_url': '/api/test',
            'http_status_code': 200,
            'client_ip': os.getenv('MOCK_PRIVATE_IP'),
            'client_port': 12345,
            'duration_ns': 1234567890
        }

        with patch('src.middleware.correlation.get_correlation_id', return_value='test-id'):
            with patch('src.middleware.correlation.get_user', return_value='test-user'):
                with patch('structlog.contextvars.get_contextvars', return_value=mock_context):
                    correlation_filter.filter(log_record)

                    # Verify all context fields were copied
                    assert log_record.request_id == 'req-123'
                    assert log_record.user_id == 'user-456'
                    assert log_record.session_id == 'session-789'
                    assert log_record.http_method == 'POST'
                    assert log_record.http_url == '/api/test'
                    assert log_record.http_status_code == 200
                    assert log_record.client_ip == os.getenv('MOCK_PRIVATE_IP')
                    assert log_record.client_port == 12345
                    assert log_record.duration_ns == 1234567890

    def test_filter_does_not_overwrite_existing_attributes(self, correlation_filter, log_record):
        """Test that filter doesn't overwrite existing record attributes."""
        # Pre-set an attribute on the record
        log_record.request_id = 'existing-request-id'

        mock_context = {
            'request_id': 'new-request-id',
            'user_id': 'user-123'
        }

        with patch('src.middleware.correlation.get_correlation_id', return_value='test-id'):
            with patch('src.middleware.correlation.get_user', return_value='test-user'):
                with patch('structlog.contextvars.get_contextvars', return_value=mock_context):
                    correlation_filter.filter(log_record)

                    # Should keep existing value
                    assert log_record.request_id == 'existing-request-id'
                    # But should add new fields
                    assert log_record.user_id == 'user-123'

    def test_filter_handles_trace_ids_from_context(self, correlation_filter, log_record):
        """Test that filter extracts Datadog trace IDs from context."""
        mock_context = {
            'trace_id': 'trace-123',
            'span_id': 'span-456'
        }

        with patch('src.middleware.correlation.get_correlation_id', return_value='test-id'):
            with patch('src.middleware.correlation.get_user', return_value='test-user'):
                with patch('structlog.contextvars.get_contextvars', return_value=mock_context):
                    correlation_filter.filter(log_record)

                    assert getattr(log_record, 'dd.trace_id') == 'trace-123'
                    assert getattr(log_record, 'dd.span_id') == 'span-456'

    def test_filter_fallback_to_active_tracer(self, correlation_filter, log_record):
        """Test that filter falls back to active tracer when context has no trace IDs."""
        mock_context = {}  # No trace IDs in context

        with patch('src.middleware.correlation.get_correlation_id', return_value='test-id'):
            with patch('src.middleware.correlation.get_user', return_value='test-user'):
                with patch('structlog.contextvars.get_contextvars', return_value=mock_context):
                    with patch.object(type(correlation_filter), '_get_current_trace_id', return_value='999'):
                        with patch.object(type(correlation_filter), '_get_current_span_id', return_value='888'):
                            correlation_filter.filter(log_record)

                            assert getattr(log_record, 'dd.trace_id') == '999'
                            assert getattr(log_record, 'dd.span_id') == '888'

    def test_filter_handles_missing_tracer(self, correlation_filter, log_record):
        """Test that filter handles cases where ddtrace is not available."""
        mock_context = {}  # No trace IDs in context

        with patch('src.middleware.correlation.get_correlation_id', return_value='test-id'):
            with patch('src.middleware.correlation.get_user', return_value='test-user'):
                with patch('structlog.contextvars.get_contextvars', return_value=mock_context):
                    # Simulate ImportError when trying to import ddtrace
                    with patch('src.logger.logging.CorrelationIdFilter._get_current_trace_id', return_value=None):
                        with patch('src.logger.logging.CorrelationIdFilter._get_current_span_id', return_value=None):
                            correlation_filter.filter(log_record)

                            # Should set trace IDs to None when tracer is not available
                            assert getattr(log_record, 'dd.trace_id') is None
                            assert getattr(log_record, 'dd.span_id') is None

    def test_filter_handles_empty_context(self, correlation_filter, log_record):
        """Test that filter handles empty contextvars gracefully."""
        mock_context = {}

        with patch('src.middleware.correlation.get_user', return_value='test-user'):
            with patch('structlog.contextvars.get_contextvars', return_value=mock_context):
                result = correlation_filter.filter(log_record)

                # Should still return True and add basic fields
                assert result is True
                assert log_record.correlationId == 'unknown'  # Falls back to 'unknown' when no request_id in context
                assert log_record.user == 'test-user'
                assert log_record.component == 'API-metachatbot'

    def test_filter_handles_context_error(self, correlation_filter, log_record):
        """Test that filter handles errors when accessing contextvars."""
        with patch('src.middleware.correlation.get_user', return_value='test-user'):
            with patch('structlog.contextvars.get_contextvars', side_effect=Exception("Context error")):
                result = correlation_filter.filter(log_record)

                # Should still return True and add basic fields despite error
                assert result is True
                assert log_record.correlationId == 'unknown'  # Falls back to 'unknown' on exception
                assert log_record.user == 'test-user'
                assert log_record.component == 'API-metachatbot'

    def test_get_current_trace_id_with_active_span(self, correlation_filter):
        """Test _get_current_trace_id with an active span."""
        mock_span = Mock()
        mock_span.trace_id = 123456

        mock_tracer = Mock()
        mock_tracer.current_span.return_value = mock_span
        with patch('ddtrace.tracer', mock_tracer):
            trace_id = correlation_filter._get_current_trace_id()
            assert trace_id == '123456'

    def test_get_current_trace_id_without_span(self, correlation_filter):
        """Test _get_current_trace_id when there's no active span."""
        mock_tracer = Mock()
        mock_tracer.current_span.return_value = None
        with patch('ddtrace.tracer', mock_tracer):
            trace_id = correlation_filter._get_current_trace_id()
            assert trace_id is None

    def test_get_current_span_id_with_active_span(self, correlation_filter):
        """Test _get_current_span_id with an active span."""
        mock_span = Mock()
        mock_span.span_id = 789012

        mock_tracer = Mock()
        mock_tracer.current_span.return_value = mock_span
        with patch('ddtrace.tracer', mock_tracer):
            span_id = correlation_filter._get_current_span_id()
            assert span_id == '789012'

    def test_get_current_span_id_without_span(self, correlation_filter):
        """Test _get_current_span_id when there's no active span."""
        mock_tracer = Mock()
        mock_tracer.current_span.return_value = None
        with patch('ddtrace.tracer', mock_tracer):
            span_id = correlation_filter._get_current_span_id()
            assert span_id is None

    def test_context_fields_list_completeness(self, correlation_filter):
        """Test that _CONTEXT_FIELDS list contains all expected fields."""
        expected_fields = [
            'request_id',
            'user_id',
            'session_id',
            'http_method',
            'http_url',
            'http_status_code',
            'client_ip',
            'client_port',
            'duration_ns',
            'user_mail',
        ]

        assert correlation_filter._CONTEXT_FIELDS == expected_fields
