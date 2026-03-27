import logging
import os

from logging import Filter, LogRecord
from elasticsearch import Elasticsearch
from pydantic import parse_obj_as

from src.config.settings import get_settings
from src.logger.elastic_search import elastic_search_logging
from src.logger.setup_logging import setup_logging

class CorrelationIdFilter(Filter):
    def filter(self, record: LogRecord) -> bool:
        from src.middleware.correlation import get_correlation_id, get_user
        record.correlationId = get_correlation_id()
        record.user = get_user()
        record.component="API-metachatbot"
        return True

def configure_logging():
    """
        Configures logging for the application.

        This function sets up a logging configuration with the following features:
        - Adds a stream handler to output logs to the console.
        - Applies a custom filter to ensure that all log records include a correlation ID.
        - Sets the log level to INFO.
        - Defines a log format that includes the log level, timestamp, logger name, line number,
          correlation ID, and the log message.

        Example of a log entry:
            INFO:     2024-08-02 10:25:24,263 api.main:54 [d218756bb3e44f0090f8699f0bedc4e5] Log message

        Returns:
            None
        """


    cid_filter = CorrelationIdFilter()
    console_handler = logging.StreamHandler()
    console_handler.addFilter(cid_filter)
    logging.basicConfig(
        handlers=[console_handler],
        level=logging.INFO,
        format='%(levelname)s: \t  %(asctime)s %(name)s:%(lineno)d [%(correlation_id)s] [%(user)s] %(message)s')



def get_logger(name: str, setup_logger: bool = False) -> logging.Logger:
    """
    Get a logger with the given name.

    Args:
        name (str): The name of the logger.
        setup_logger (bool, optional): Whether to setup the logger. Defaults to False.

    Returns:
        logging.Logger: The logger with the given name.
    """
    app_settings = get_settings()
    if setup_logger:
        LOG_JSON_FORMAT = parse_obj_as(bool, os.getenv("LOG_JSON_FORMAT", False))
        COLOR_LOGS = parse_obj_as(bool, os.getenv("COLOR_LOGS", True))
        LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
        setup_logging(json_logs=LOG_JSON_FORMAT, log_level=LOG_LEVEL, color_logs=COLOR_LOGS)
    logger = logging.getLogger(name)
    return logger
