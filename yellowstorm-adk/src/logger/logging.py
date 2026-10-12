import logging
import os

from pydantic import parse_obj_as

from src.config.settings import get_settings

# Delayed import to speed up startup
def get_setup_logging():
    from src.logger.setup_logging import setup_logging
    return setup_logging
from src.logger.setup_logging import setup_logging

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
        get_setup_logging()(json_logs=LOG_JSON_FORMAT, log_level=LOG_LEVEL, color_logs=COLOR_LOGS)
    logger = logging.getLogger(name)
    return logger
