"""Shared Celery factory. Queues (§6.2) without shared execution state.

Datasource and population remain separate worker processes/containers with
separate queues, credentials and budgets; sharing this module does not share
a process. The broker is whatever SEMANTIC_BROKER_URL points at (amqp:// or
redis://, rediss:// for TLS); the Postgres outbox stays the job source of
truth (plan P2.6), so the broker transport is interchangeable.
"""

from __future__ import annotations

import os

from celery import Celery
from celery.signals import task_postrun, task_prerun, worker_ready, worker_shutdown
from structlog.contextvars import bind_contextvars, unbind_contextvars

from yellowmind_observability import setup_observability

from app.jobs.worker_liveness import start_worker_heartbeat, stop_worker_heartbeat

# Worker processes (and any importer) boot the unified-logging SDK here; setup is
# idempotent per process, so the API process importing this module is unaffected.
# Prefork caveat: a forked child inherits a dead writer thread — current pools are
# solo (scripts/start-*.ps1); re-init via worker_process_init before ever switching.
setup_observability(service_name=os.environ.get("OBS_SERVICE_NAME") or "semantic-model-runtime")

DATASOURCE_QUEUES = ("semantic-model-datasource.preview", "semantic-model-datasource.batch")
POPULATION_QUEUES = ("semantic-model-population.corrections", "semantic-model-population.batch")
# Search indexing has its own worker so a long embedding run never holds up population.
SEARCH_QUEUES = ("semantic-model-search.index",)


def broker_ssl(broker: str) -> dict[str, object] | bool:
    """TLS options for a rediss:// broker.

    Declared explicitly rather than left to kombu: a bare rediss:// URL logs a
    warning and falls back on its own (kombu/connection.py:268), and a
    ?ssl_cert_reqs= query string is ignored outright because kombu's redis
    channel only reads ``from_transport_options``, which has no ssl key.
    amqp:// keeps its own URL-level TLS, so it must stay False.

    ponytail: traffic is encrypted but the server certificate is NOT verified,
    so a MITM on the Redis route would not be detected. Switch to
    ssl.CERT_REQUIRED (works as-is against Azure Cache for Redis, whose
    certificate chains to a public CA) if the broker ever leaves a trusted
    network.
    """
    if not broker.startswith("rediss://"):
        return False
    import ssl

    return {"ssl_cert_reqs": ssl.CERT_NONE}


def make_celery() -> Celery:
    broker = os.environ.get("SEMANTIC_BROKER_URL", "memory://")
    app = Celery("semantic-model-runtime", broker=broker)
    app.conf.update(
        broker_use_ssl=broker_ssl(broker),
        broker_transport_options={
            # Redis only (ignored by amqp). A task still running after this
            # delay gets its message redelivered; the duplicate is fenced by
            # the Postgres lease, but jobs here are deliberately untimed, so
            # keep the window wide and let lease-expiry recovery own redelivery.
            "visibility_timeout": 86400,
            # Redis analogue of broker_heartbeat below: a solo pool cannot
            # touch the socket during a long task, and managed Redis drops
            # idle connections (10 min on Azure), leaving a worker alive but
            # no longer consuming.
            "socket_keepalive": True,
            "retry_on_timeout": True,
        },
        task_acks_late=True,
        # acks_late alone still acks failures by default; without this a failed
        # task is acknowledged and the durable row stays non-terminal forever.
        # Reject instead so the broker redelivers; DB attempt caps in the task
        # bound redelivery so a persistent failure cannot loop forever.
        task_acks_on_failure_or_timeout=False,
        worker_prefetch_multiplier=1,
        # Solo pools cannot send AMQP heartbeats while a task runs: a run longer than the
        # heartbeat window gets its connection closed by the broker, and the worker then
        # stops consuming without exiting. Disabled; TCP keepalive still detects dead peers.
        broker_heartbeat=0,
        task_reject_on_worker_lost=True,
        # Keep the unified-logging root bridge alive: celery's default hijack
        # clears root handlers at worker boot, silencing the SDK (plan P06).
        worker_hijack_root_logger=False,
    )
    return app


celery_app = make_celery()


# Job context envelopes (plan P05): every task execution carries its celery task id
# as `run_id` in the unified-logging envelope context. The SDK bridge merges these
# contextvars at emit time for both structlog and stdlib loggers.
@task_prerun.connect
def _bind_task_context(task=None, **_):
    if task is not None and task.request.id:
        bind_contextvars(run_id=task.request.id)


@task_postrun.connect
def _unbind_task_context(task=None, **_):
    unbind_contextvars("run_id")


# Worker liveness: lets a queued job's read tell "behind other jobs" from "nobody consuming".
@worker_ready.connect
def _start_heartbeat(sender=None, **_):
    if sender is not None:
        start_worker_heartbeat(sender)


@worker_shutdown.connect
def _stop_heartbeat(**_):
    stop_worker_heartbeat()
