"""Unit tests for PostgreSQL logging handler."""

import logging
import os
import time
from unittest.mock import Mock, MagicMock, patch, call
import pytest

from tests.common_schema import MockSettings
from src.logger.postgresql_handler import PostgreSQLHandler, is_postgresql_logging_enabled


class TestPostgreSQLHandler:
    """Test suite for PostgreSQLHandler class."""

    @pytest.fixture
    def mock_settings(self):
        """Mock settings for testing."""
        mock = Mock()
        mock.DATABASE_URL = "postgresql://testuser:testpass@localhost:5432/testdb"
        mock.ENABLE_POSTGRESQL_LOGGING = True
        mock.POSTGRESQL_LOG_BATCH_SIZE = 10
        mock.POSTGRESQL_LOG_FLUSH_INTERVAL = 5.0
        return mock

    @pytest.fixture
    def mock_connection_pool(self):
        """Mock PostgreSQL connection pool."""
        mock_pool = MagicMock()
        mock_conn = MagicMock()
        mock_cursor = MagicMock()

        mock_conn.cursor.return_value = mock_cursor
        mock_pool.getconn.return_value = mock_conn

        return mock_pool, mock_conn, mock_cursor

    def test_parse_database_url(self, mock_settings):
        """Test parsing of PostgreSQL database URL."""
        with patch('src.logger.postgresql_handler.get_settings', return_value=mock_settings):
            with patch('src.logger.postgresql_handler.ConnectionPool'):
                handler = PostgreSQLHandler()

                assert handler.connection_params['host'] == 'localhost'
                assert handler.connection_params['port'] == 5432
                assert handler.connection_params['dbname'] == 'testdb'
                assert handler.connection_params['user'] == 'testuser'
                assert handler.connection_params['password'] == 'testpass'

    def test_parse_database_url_without_port(self, mock_settings):
        """Test parsing of PostgreSQL URL without explicit port."""
        mock_settings.DATABASE_URL = "postgresql://user:pass@localhost/testdb"

        with patch('src.logger.postgresql_handler.get_settings', return_value=mock_settings):
            with patch('src.logger.postgresql_handler.ConnectionPool'):
                handler = PostgreSQLHandler()

                assert handler.connection_params['port'] == 5432  # Default port

    def test_parse_database_url_invalid_format(self, mock_settings):
        """Test handling of invalid database URL format."""
        mock_settings.DATABASE_URL = "invalid://url"

        with patch('src.logger.postgresql_handler.get_settings', return_value=mock_settings):
            with pytest.raises(ValueError, match="Invalid PostgreSQL URL format"):
                PostgreSQLHandler()

    def test_parse_database_url_missing_credentials(self, mock_settings):
        """Test handling of URL without credentials."""
        mock_settings.DATABASE_URL = "postgresql://localhost/testdb"

        with patch('src.logger.postgresql_handler.get_settings', return_value=mock_settings):
            with pytest.raises(ValueError, match="Missing credentials"):
                PostgreSQLHandler()

    def test_handler_initialization(self, mock_settings):
        """Test handler initialization."""
        with patch('src.logger.postgresql_handler.get_settings', return_value=mock_settings):
            with patch('src.logger.postgresql_handler.ConnectionPool') as mock_pool_class:
                mock_pool = MagicMock()
                mock_pool_class.return_value = mock_pool

                # Mock the table creation
                mock_conn = MagicMock()
                mock_cursor = MagicMock()
                mock_conn.cursor.return_value = mock_cursor
                mock_pool.getconn.return_value = mock_conn

                handler = PostgreSQLHandler(
                    batch_size=20,
                    flush_interval=10.0
                )

                assert handler.batch_size == 20
                assert handler.flush_interval == pytest.approx(10.0)
                assert handler.table_name == "application_logs"
                assert handler.connection_pool is not None
                assert handler.worker_thread.is_alive()

    def test_create_table_if_not_exists(self, mock_settings, mock_connection_pool):
        """Test table creation logic."""
        mock_pool, mock_conn, mock_cursor = mock_connection_pool

        with patch('src.logger.postgresql_handler.get_settings', return_value=mock_settings):
            with patch('src.logger.postgresql_handler.ConnectionPool', return_value=mock_pool):
                handler = PostgreSQLHandler()

                # Verify that execute was called with CREATE TABLE query
                assert mock_cursor.execute.called
                execute_call = mock_cursor.execute.call_args[0][0]
                assert "CREATE TABLE IF NOT EXISTS application_logs" in execute_call
                assert mock_conn.commit.called

    def test_emit_adds_to_queue(self, mock_settings):
        """Test that emit() adds log records to the queue."""
        with patch('src.logger.postgresql_handler.get_settings', return_value=mock_settings):
            with patch('src.logger.postgresql_handler.ConnectionPool'):
                handler = PostgreSQLHandler()

                # Create a log record
                record = logging.LogRecord(
                    name="test.logger",
                    level=logging.INFO,
                    pathname="test.py",
                    lineno=10,
                    msg="Test message",
                    args=(),
                    exc_info=None
                )

                # Emit the record
                handler.emit(record)

                # Check if record is in queue
                assert handler.log_queue.qsize() == 1

    def test_emit_filters_debug_logs(self, mock_settings):
        """Test that emit() filters out DEBUG level logs."""
        with patch('src.logger.postgresql_handler.get_settings', return_value=mock_settings):
            with patch('src.logger.postgresql_handler.ConnectionPool'):
                handler = PostgreSQLHandler()

                # Create a DEBUG log record
                debug_record = logging.LogRecord(
                    name="test.logger",
                    level=logging.DEBUG,
                    pathname="test.py",
                    lineno=10,
                    msg="Debug message",
                    args=(),
                    exc_info=None
                )

                # Emit the record
                handler.emit(debug_record)

                # Check that record is NOT in queue (filtered out)
                assert handler.log_queue.qsize() == 0

    def test_emit_filters_warning_logs(self, mock_settings):
        """Test that emit() filters out WARNING level logs."""
        with patch('src.logger.postgresql_handler.get_settings', return_value=mock_settings):
            with patch('src.logger.postgresql_handler.ConnectionPool'):
                handler = PostgreSQLHandler()

                # Create a WARNING log record
                warning_record = logging.LogRecord(
                    name="test.logger",
                    level=logging.WARNING,
                    pathname="test.py",
                    lineno=10,
                    msg="Warning message",
                    args=(),
                    exc_info=None
                )

                # Emit the record
                handler.emit(warning_record)

                # Check that record is NOT in queue (filtered out)
                assert handler.log_queue.qsize() == 0

    def test_emit_accepts_info_error_critical(self, mock_settings):
        """Test that emit() accepts INFO, ERROR, and CRITICAL logs."""
        with patch('src.logger.postgresql_handler.get_settings', return_value=mock_settings):
            with patch('src.logger.postgresql_handler.ConnectionPool'):
                handler = PostgreSQLHandler()

                # Create records for each accepted level
                levels = [
                    (logging.INFO, "Info message"),
                    (logging.ERROR, "Error message"),
                    (logging.CRITICAL, "Critical message")
                ]

                for level, msg in levels:
                    record = logging.LogRecord(
                        name="test.logger",
                        level=level,
                        pathname="test.py",
                        lineno=10,
                        msg=msg,
                        args=(),
                        exc_info=None
                    )
                    handler.emit(record)

                # Check that all 3 records are in queue
                assert handler.log_queue.qsize() == 3

    def test_prepare_log_data(self, mock_settings):
        """Test log data preparation."""
        with patch('src.logger.postgresql_handler.get_settings', return_value=mock_settings):
            with patch('src.logger.postgresql_handler.ConnectionPool'):
                handler = PostgreSQLHandler()

                # Create a log record with custom attributes
                record = logging.LogRecord(
                    name="api.test",
                    level=logging.ERROR,
                    pathname="test.py",
                    lineno=42,
                    msg="Error occurred",
                    args=(),
                    exc_info=None
                )

                # Add custom attributes
                record.correlationId = "test-correlation-id"
                record.user = "test-user"
                record.session_id = "test-session"

                # Prepare log data
                log_data = handler._prepare_log_data(record)

                # Verify the data
                assert log_data['level'] == 'ERROR'
                assert log_data['logger_name'] == 'api.test'
                assert 'Error occurred' in log_data['message']
                assert log_data['correlation_id'] == 'test-correlation-id'
                assert log_data['user_id'] == 'test-user'
                assert log_data['session_id'] == 'test-session'
                assert log_data['service'] == 'API-metachatbot'

    def test_prepare_log_data_with_http_info(self, mock_settings):
        """Test log data preparation with HTTP information from direct attributes."""
        with patch('src.logger.postgresql_handler.get_settings', return_value=mock_settings):
            with patch('src.logger.postgresql_handler.ConnectionPool'):
                handler = PostgreSQLHandler()

                record = logging.LogRecord(
                    name="api.test",
                    level=logging.INFO,
                    pathname="test.py",
                    lineno=10,
                    msg="HTTP request",
                    args=(),
                    exc_info=None
                )

                # Add HTTP info as direct attributes (set by CorrelationIdFilter)
                record.http_method = 'POST'
                record.http_url = '/api/chat'
                record.http_status_code = 200
                record.client_ip = os.getenv('MOCK_LOCALHOST_IP', '127.0.0.1')
                record.client_port = 54321

                log_data = handler._prepare_log_data(record)

                assert log_data['http_method'] == 'POST'
                assert log_data['http_url'] == '/api/chat'
                assert log_data['http_status_code'] == 200
                assert log_data['client_ip'] == os.getenv('MOCK_LOCALHOST_IP', '127.0.0.1')
                assert log_data['client_port'] == 54321

    def test_prepare_log_data_with_duration_ns(self, mock_settings):
        """Test log data preparation with duration_ns field."""
        with patch('src.logger.postgresql_handler.get_settings', return_value=mock_settings):
            with patch('src.logger.postgresql_handler.ConnectionPool'):
                handler = PostgreSQLHandler()

                record = logging.LogRecord(
                    name="api.access",
                    level=logging.INFO,
                    pathname="test.py",
                    lineno=10,
                    msg="Request completed",
                    args=(),
                    exc_info=None
                )

                # Add duration_ns attribute (set by CorrelationIdFilter)
                record.duration_ns = 1234567890

                log_data = handler._prepare_log_data(record)

                assert log_data['duration_ns'] == 1234567890

    def test_prepare_log_data_with_duration_fallback(self, mock_settings):
        """Test log data preparation with duration fallback."""
        with patch('src.logger.postgresql_handler.get_settings', return_value=mock_settings):
            with patch('src.logger.postgresql_handler.ConnectionPool'):
                handler = PostgreSQLHandler()

                record = logging.LogRecord(
                    name="api.access",
                    level=logging.INFO,
                    pathname="test.py",
                    lineno=10,
                    msg="Request completed",
                    args=(),
                    exc_info=None
                )

                # Add duration attribute (raw value without _ns suffix)
                record.duration = 9876543210

                log_data = handler._prepare_log_data(record)

                # Should fallback to 'duration' when 'duration_ns' is not present
                assert log_data['duration_ns'] == 9876543210

    def test_prepare_log_data_with_trace_ids(self, mock_settings):
        """Test log data preparation with Datadog trace IDs."""
        with patch('src.logger.postgresql_handler.get_settings', return_value=mock_settings):
            with patch('src.logger.postgresql_handler.ConnectionPool'):
                handler = PostgreSQLHandler()

                record = logging.LogRecord(
                    name="api.test",
                    level=logging.INFO,
                    pathname="test.py",
                    lineno=10,
                    msg="Traced request",
                    args=(),
                    exc_info=None
                )

                # Add Datadog trace IDs
                setattr(record, 'dd.trace_id', '123456789')
                setattr(record, 'dd.span_id', '987654321')

                log_data = handler._prepare_log_data(record)

                assert log_data['trace_id'] == '123456789'
                assert log_data['span_id'] == '987654321'

    def test_flush_batch(self, mock_settings, mock_connection_pool):
        """Test batch flushing to database."""
        mock_pool, mock_conn, mock_cursor = mock_connection_pool

        with patch('src.logger.postgresql_handler.get_settings', return_value=mock_settings):
            with patch('src.logger.postgresql_handler.ConnectionPool', return_value=mock_pool):
                handler = PostgreSQLHandler()

                # Reset cursor mock to clear table creation calls
                mock_cursor.reset_mock()

                # Create test records
                records = [
                    logging.LogRecord(
                        name="test",
                        level=logging.INFO,
                        pathname="test.py",
                        lineno=i,
                        msg=f"Test message {i}",
                        args=(),
                        exc_info=None
                    )
                    for i in range(5)
                ]

                # Flush batch
                handler._flush_batch(records)

                # Verify executemany was called
                assert mock_cursor.executemany.called
                call_args = mock_cursor.executemany.call_args

                # Check SQL query
                query = call_args[0][0]
                assert "INSERT INTO application_logs" in query

                # Check that we inserted 5 records
                values = call_args[0][1]
                assert len(values) == 5

    def test_connection_pool_error_handling(self, mock_settings):
        """Test handling of connection pool creation errors."""
        with patch('src.logger.postgresql_handler.get_settings', return_value=mock_settings):
            with patch('src.logger.postgresql_handler.ConnectionPool', side_effect=Exception("Connection failed")):
                handler = PostgreSQLHandler()

                # Handler should still be created but pool should be None
                assert handler.connection_pool is None

    def test_close_handler(self, mock_settings, mock_connection_pool):
        """Test handler cleanup on close."""
        mock_pool, mock_conn, mock_cursor = mock_connection_pool

        with patch('src.logger.postgresql_handler.get_settings', return_value=mock_settings):
            with patch('src.logger.postgresql_handler.ConnectionPool', return_value=mock_pool):
                handler = PostgreSQLHandler()

                # Close handler
                handler.close()

                # Verify shutdown event is set
                assert handler.shutdown_event.is_set()

                # Verify pool is closed
                assert mock_pool.closeall.called

    def test_worker_thread_processes_logs(self, mock_settings, mock_connection_pool):
        """Test that worker thread processes logs from queue."""
        mock_pool, mock_conn, mock_cursor = mock_connection_pool

        with patch('src.logger.postgresql_handler.get_settings', return_value=mock_settings):
            with patch('src.logger.postgresql_handler.ConnectionPool', return_value=mock_pool):
                # Use smaller batch size and interval for testing
                handler = PostgreSQLHandler(batch_size=2, flush_interval=0.5)

                # Reset cursor to clear table creation calls
                mock_cursor.reset_mock()

                # Create test records
                for i in range(3):
                    record = logging.LogRecord(
                        name="test",
                        level=logging.INFO,
                        pathname="test.py",
                        lineno=i,
                        msg=f"Message {i}",
                        args=(),
                        exc_info=None
                    )
                    handler.emit(record)

                # Wait for worker to process
                time.sleep(1)

                # Verify that executemany was called (batch was flushed)
                assert mock_cursor.executemany.called


class TestPostgreSQLLoggingEnabled:
    """Test suite for is_postgresql_logging_enabled function."""

    def test_postgresql_logging_enabled_true(self):
        """Test when PostgreSQL logging is enabled."""
        mock_settings = Mock()
        mock_settings.ENABLE_POSTGRESQL_LOGGING = True

        with patch('src.logger.postgresql_handler.get_settings', return_value=mock_settings):
            assert is_postgresql_logging_enabled() is True

    def test_postgresql_logging_enabled_false(self):
        """Test when PostgreSQL logging is disabled."""
        mock_settings = Mock()
        mock_settings.ENABLE_POSTGRESQL_LOGGING = False

        with patch('src.logger.postgresql_handler.get_settings', return_value=mock_settings):
            assert is_postgresql_logging_enabled() is False