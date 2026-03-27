"""
PostgreSQL Handler for centralized logging with async support.

This module provides a custom logging handler that stores logs in PostgreSQL
with support for filtering by correlation_id, user_id, username, session_id, and service.
"""

import json
import logging
import queue
import threading
import time
from typing import Any, Dict, Optional

import psycopg2
import psycopg2.pool

from src.config.settings import get_settings


class PostgreSQLHandler(logging.Handler):
    """
    Async PostgreSQL logging handler that stores logs in a database table.

    Features:
    - Non-blocking async logging using a background thread
    - Connection pooling for performance
    - Automatic reconnection on database errors
    - Batch inserts for efficiency
    - Extracts correlation_id, user, session_id, service from log records
    """

    def __init__(
        self,
        database_url: Optional[str] = None,
        table_name: str = "application_logs",
        batch_size: int = 10,
        flush_interval: float = 5.0,
        pool_size: int = 5,
        max_overflow: int = 10,
    ):
        """
        Initialize the PostgreSQL handler.

        Args:
            database_url: PostgreSQL connection URL (defaults to DATABASE_URL env var)
            table_name: Name of the logs table
            batch_size: Number of logs to batch before inserting
            flush_interval: Seconds to wait before flushing logs
            pool_size: Number of database connections in the pool
            max_overflow: Maximum overflow connections
        """
        super().__init__()

        app_settings = get_settings()
        self.database_url = database_url or app_settings.DATABASE_URL
        if not self.database_url:
            raise ValueError("DATABASE_URL environment variable is required")

        self.table_name = table_name
        self.batch_size = batch_size
        self.flush_interval = flush_interval

        # Parse connection parameters from URL
        self.connection_params = self._parse_database_url(self.database_url)

        # Initialize connection pool
        try:
            self.connection_pool = psycopg2.pool.ThreadedConnectionPool(
                minconn=1,
                maxconn=pool_size + max_overflow,
                **self.connection_params
            )
        except Exception as e:
            logging.error(f"Failed to create PostgreSQL connection pool: {e}")
            self.connection_pool = None

        # Create table if it doesn't exist
        if self.connection_pool:
            self._create_table_if_not_exists()

        # Queue for async logging
        self.log_queue: queue.Queue = queue.Queue()
        self.shutdown_event = threading.Event()

        # Start background worker thread
        self.worker_thread = threading.Thread(target=self._worker, daemon=True)
        self.worker_thread.start()

    def _parse_database_url(self, url: str) -> Dict[str, Any]:
        """Parse PostgreSQL URL into connection parameters."""
        # postgresql://user:password@host:port/dbname or postgresql+asyncpg://...
        if not (url.startswith("postgresql://") or url.startswith("postgresql+asyncpg://")):
            raise ValueError("Invalid PostgreSQL URL format")

        # Strip leading/trailing whitespace and remove the protocol part
        url = url.strip()
        url = url.replace("postgresql+asyncpg://", "").replace("postgresql://", "")

        # Extract credentials and host
        if "@" in url:
            credentials, host_db = url.split("@", 1)
            user, password = credentials.split(":", 1)
        else:
            raise ValueError("Missing credentials in DATABASE_URL")

        # Extract host, port, and database
        if "/" in host_db:
            host_port, dbname = host_db.split("/", 1)
        else:
            raise ValueError("Missing database name in DATABASE_URL")

        if ":" in host_port:
            host, port = host_port.split(":", 1)
            port = int(port)
        else:
            host = host_port
            port = 5432

        return {
            "host": host,
            "port": port,
            "database": dbname,
            "user": user,
            "password": password,
            # TCP keepalive parameters to prevent connection timeouts
            "keepalives": 1,              # Enable TCP keepalives
            "keepalives_idle": 30,        # Send keepalive after 30s of inactivity
            "keepalives_interval": 10,    # Retry every 10s if no response
            "keepalives_count": 5,        # Give up after 5 failed attempts
            "connect_timeout": 10,        # Timeout for initial connection (10s)
        }

    def _create_table_if_not_exists(self) -> None:
        """Create the logs table if it doesn't exist."""
        conn = None
        try:
            conn = self.connection_pool.getconn()
            cursor = conn.cursor()

            create_table_query = f"""
                CREATE TABLE IF NOT EXISTS {self.table_name} (
                    id SERIAL PRIMARY KEY,
                    timestamp TIMESTAMP NOT NULL,
                    level VARCHAR(20) NOT NULL,
                    logger_name VARCHAR(255),
                    message TEXT,
                    correlation_id VARCHAR(255),
                    user_id VARCHAR(255),
                    username VARCHAR(255),
                    session_id VARCHAR(255),
                    service VARCHAR(100),
                    http_method VARCHAR(10),
                    http_url TEXT,
                    http_status_code INTEGER,
                    duration_ns BIGINT,
                    client_ip VARCHAR(45),
                    client_port INTEGER,
                    trace_id VARCHAR(255),
                    span_id VARCHAR(255),
                    extra_data JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                -- Create indexes for faster queries
                CREATE INDEX IF NOT EXISTS idx_{self.table_name}_timestamp ON {self.table_name}(timestamp);
                CREATE INDEX IF NOT EXISTS idx_{self.table_name}_level ON {self.table_name}(level);
                CREATE INDEX IF NOT EXISTS idx_{self.table_name}_correlation_id ON {self.table_name}(correlation_id);
                CREATE INDEX IF NOT EXISTS idx_{self.table_name}_user_id ON {self.table_name}(user_id);
                CREATE INDEX IF NOT EXISTS idx_{self.table_name}_session_id ON {self.table_name}(session_id);
                CREATE INDEX IF NOT EXISTS idx_{self.table_name}_service ON {self.table_name}(service);
                CREATE INDEX IF NOT EXISTS idx_{self.table_name}_trace_id ON {self.table_name}(trace_id);
            """

            cursor.execute(create_table_query)
            conn.commit()
            cursor.close()
            logging.info(f"Successfully created/verified table '{self.table_name}' in PostgreSQL")

        except Exception as e:
            logging.error(f"Failed to create PostgreSQL logs table: {e}")
            if conn:
                conn.rollback()
        finally:
            if conn and self.connection_pool:
                self.connection_pool.putconn(conn)

    def emit(self, record: logging.LogRecord) -> None:
        """
        Emit a log record to the queue for async processing.
        Only processes INFO, ERROR, and CRITICAL (exception) level logs.

        Args:
            record: Log record to emit
        """
        try:
            # Filter: only accept INFO, ERROR, and CRITICAL (used by logger.exception)
            if record.levelno not in (logging.INFO, logging.ERROR, logging.CRITICAL):
                return

            # Add record to queue (non-blocking)
            self.log_queue.put_nowait(record)
        except queue.Full:
            # If queue is full, drop the log (avoid blocking)
            pass
        except Exception as e:
            self.handleError(record)

    def _worker(self) -> None:
        """Background worker that processes logs from the queue."""
        batch: list[logging.LogRecord] = []
        last_flush_time = time.time()

        while not self.shutdown_event.is_set():
            try:
                # Wait for a log record with timeout
                try:
                    record = self.log_queue.get(timeout=1.0)
                    batch.append(record)
                except queue.Empty:
                    pass

                current_time = time.time()

                # Flush if batch is full or flush interval has passed
                should_flush = (
                    len(batch) >= self.batch_size or
                    (batch and current_time - last_flush_time >= self.flush_interval)
                )

                if should_flush:
                    self._flush_batch(batch)
                    batch.clear()
                    last_flush_time = current_time

            except Exception as e:
                logging.error(f"Error in PostgreSQL handler worker: {e}")

        # Flush remaining logs on shutdown
        if batch:
            self._flush_batch(batch)

    def _flush_batch(self, batch: list[logging.LogRecord]) -> None:
        """
        Flush a batch of log records to PostgreSQL.

        Args:
            batch: List of log records to insert
        """
        if not batch or not self.connection_pool:
            return

        conn = None
        try:
            # Get connection from pool
            conn = self.connection_pool.getconn()
            cursor = conn.cursor()

            # Prepare batch insert
            values = []
            for record in batch:
                log_data = self._prepare_log_data(record)
                values.append(log_data)

            # Build insert query
            insert_query = f"""
                INSERT INTO {self.table_name} (
                    timestamp, level, logger_name, message, correlation_id,
                    user_id, username, session_id, service, http_method, http_url,
                    http_status_code, duration_ns, client_ip, client_port,
                    trace_id, span_id, extra_data
                ) VALUES (
                    %(timestamp)s, %(level)s, %(logger_name)s, %(message)s, %(correlation_id)s,
                    %(user_id)s, %(username)s, %(session_id)s, %(service)s, %(http_method)s,
                    %(http_url)s, %(http_status_code)s, %(duration_ns)s, %(client_ip)s,
                    %(client_port)s, %(trace_id)s, %(span_id)s, %(extra_data)s
                )
            """

            # Execute batch insert
            cursor.executemany(insert_query, values)
            conn.commit()
            cursor.close()

        except psycopg2.OperationalError as e:
            logging.error(f"Database connection error in PostgreSQL handler: {e}")
            # Try to recreate connection pool
            if conn:
                try:
                    self.connection_pool.putconn(conn, close=True)
                    conn = None  # Prevent double putconn in finally block
                except Exception:
                    conn = None  # Prevent double putconn in finally block
        except Exception as e:
            logging.error(f"Error flushing logs to PostgreSQL: {e}")
        finally:
            if conn and self.connection_pool:
                # Return connection to pool
                self.connection_pool.putconn(conn)

    def _prepare_log_data(self, record: logging.LogRecord) -> Dict[str, Any]:
        """
        Extract and prepare log data from LogRecord.

        Args:
            record: Log record to process

        Returns:
            Dictionary of log data ready for database insertion
        """
        # Extract standard fields
        timestamp = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(record.created))
        level = record.levelname
        logger_name = record.name
        # Use getMessage() to get the raw message without formatting
        message = record.getMessage()

        # Extract custom fields from record attributes (set by CorrelationIdFilter)
        correlation_id = getattr(record, 'correlationId', None) or getattr(record, 'request_id', None)
        user = getattr(record, 'user', None)
        user_id = getattr(record, 'user_id', None) or user
        user_mail = getattr(record, 'user_mail', None)
        session_id = getattr(record, 'session_id', None)
        component = getattr(record, 'component', 'API-metachatbot')

        # HTTP-related fields
        http_method = getattr(record, 'http_method', None)
        http_url = getattr(record, 'http_url', None)
        http_status_code = getattr(record, 'http_status_code', None)

        # Network-related fields
        client_ip = getattr(record, 'client_ip', None)
        client_port = getattr(record, 'client_port', None)

        # Performance metrics
        duration_ns = getattr(record, 'duration_ns', None) or getattr(record, 'duration', None)

        # Datadog trace fields
        trace_id = getattr(record, 'dd.trace_id', None)
        span_id = getattr(record, 'dd.span_id', None)

        # Collect extra data as JSON - exclude fields that are already extracted
        extra_data = {}
        excluded_fields = {
            # Standard logging fields
            'name', 'msg', 'args', 'created', 'filename', 'funcName', 'levelname',
            'levelno', 'lineno', 'module', 'msecs', 'message', 'pathname', 'process',
            'processName', 'relativeCreated', 'thread', 'threadName', 'exc_info',
            'exc_text', 'stack_info',
            # Custom fields that are extracted to dedicated columns
            'correlationId', 'request_id', 'user', 'user_id', 'user_mail', 'component',
            'session_id', 'http', 'network', 'duration', 'duration_ns', 'dd.trace_id', 'dd.span_id',
            'http_method', 'http_url', 'http_status_code', 'client_ip', 'client_port',
            'taskName', 'color_message', 'timestamp', 'event'
        }

        for key, value in record.__dict__.items():
            if key not in excluded_fields:
                try:
                    # Only include JSON-serializable values
                    json.dumps(value)
                    extra_data[key] = value
                except (TypeError, ValueError):
                    extra_data[key] = str(value)

        return {
            'timestamp': timestamp,
            'level': level,
            'logger_name': logger_name,
            'message': message,
            'correlation_id': correlation_id,
            'user_id': user_id,
            'username': user_mail,
            'session_id': session_id,
            'service': component,
            'http_method': http_method,
            'http_url': http_url,
            'http_status_code': http_status_code,
            'duration_ns': duration_ns,
            'client_ip': client_ip,
            'client_port': client_port,
            'trace_id': trace_id,
            'span_id': span_id,
            'extra_data': json.dumps(extra_data) if extra_data else None,
        }

    def close(self) -> None:
        """Close the handler and cleanup resources."""
        # Signal worker thread to shutdown
        self.shutdown_event.set()

        # Wait for worker thread to finish
        if self.worker_thread.is_alive():
            self.worker_thread.join(timeout=10.0)

        # Close all connections in pool
        if self.connection_pool:
            try:
                self.connection_pool.closeall()
            except Exception:
                # Pool might already be closed
                pass
            finally:
                self.connection_pool = None

        super().close()


def is_postgresql_logging_enabled() -> bool:
    """
    Check if PostgreSQL logging is enabled via environment variable.

    Returns:
        True if enabled, False otherwise
    """
    app_settings = get_settings()
    return app_settings.ENABLE_POSTGRESQL_LOGGING
