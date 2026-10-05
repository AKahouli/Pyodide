"""Shared Celery factory. Queues (§6.2) without shared execution state.

Datasource and population remain separate worker processes/containers with
separate queues, credentials and budgets; sharing this module does not share
a process. The broker is the Phase 0 dedicated RabbitMQ (SEMANTIC_BROKER_URL);
the Postgres outbox stays the job source of truth (plan P2.6).
"""

from __future__ import annotations

import os

from celery import Celery

from yellowmind_observability import setup_observability

# Worker processes (and any importer) boot the unified-logging SDK here; setup is
# idempotent per process, so the API process importing this module is unaffected.
# Prefork caveat: a forked child inherits a dead writer thread — current pools are
# solo (scripts/start-*.ps1); re-init via worker_process_init before ever switching.
setup_observability(service_name=os.environ.get("OBS_SERVICE_NAME") or "semantic-model-runtime")

DATASOURCE_QUEUES = ("semantic-model-datasource.preview", "semantic-model-datasource.batch")
POPULATION_QUEUES = ("semantic-model-population.corrections", "semantic-model-population.batch")
# Search indexing has its own worker so a long embedding run never holds up population.
SEARCH_QUEUES = ("semantic-model-search.index",)


def make_celery() -> Celery:
    broker = os.environ.get("SEMANTIC_BROKER_URL", "memory://")
    app = Celery("semantic-model-runtime", broker=broker)
    app.conf.update(
        task_acks_late=True,
        # acks_late alone still acks failures by default; without this a failed
        # task is acknowledged and the durable row stays non-terminal forever.
        # Reject instead so the broker redelivers; DB attempt caps in the task
        # bound redelivery so a persistent failure cannot loop forever.
        task_acks_on_failure_or_timeout=False,
        worker_prefetch_multiplier=1,
        task_reject_on_worker_lost=True,
        # Keep the unified-logging root bridge alive: celery's default hijack
        # clears root handlers at worker boot, silencing the SDK (plan P06).
        worker_hijack_root_logger=False,
    )
    return app


celery_app = make_celery()
