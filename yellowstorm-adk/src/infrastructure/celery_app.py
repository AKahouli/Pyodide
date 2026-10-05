"""Celery application configuration for api-metachatbot-adk."""

import os

from celery import Celery
from src.config.settings import get_settings
from src.logger.setup_logging import setup_logging

settings = get_settings()

# Celery worker processes never run the API startup path; boot unified logging here
# so task logs flow through the SDK (idempotent per process; env-gated inside).
# Prefork caveat: a forked child inherits a dead writer thread — current pools are
# threads (docker-compose) / solo; re-init via worker_process_init before switching.
setup_logging(log_level=os.getenv("LOG_LEVEL", "INFO"))

# Create Celery app with Redis broker and backend
celery_app = Celery(
    'attribute_extraction',
    broker=f'redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB}',
    backend=f'redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB + 1}',
    include=['src.attribute_extraction.tasks']
)

# Configure Celery settings
celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_default_rate_limit='10/m',
    result_expires=3600,
    # Pool configuration - use threads for concurrent execution
    worker_pool='threads',  # Use threads pool for concurrent execution (Windows compatible)
    worker_disable_rate_limits=True,  # Disable rate limiting for Windows
    task_always_eager=False,  # Don't run tasks locally
    worker_hijack_root_logger=False,  # Don't hijack root logger
    task_routes={
        'attribute-extraction-task': {
            'queue': 'attribute_extraction',
            'routing_key': 'attribute_extraction'
        }
    }
)