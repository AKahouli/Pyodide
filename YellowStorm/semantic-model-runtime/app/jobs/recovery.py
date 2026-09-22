"""Durable retry/recovery policy for semantic_jobs (P2.6).

One place owns the retry limits so the dispatcher recovery loop and the
datasource worker cannot drift apart. Broker delivery is only a hint: a
rejected Celery delivery loses nothing because the outbox row is reset and
republished by the recovery loop.
"""

from __future__ import annotations

DEFAULT_MAX_ATTEMPTS = 3
DEFAULT_RETRY_SECONDS = 30
# A published dispatch that has not been claimed within this grace is treated
# as a lost delivery, not as queue latency. Recovery republishes it; it never
# marks the task failed, so a healthy-but-backlogged queue cannot fail a task
# no worker has attempted.
DEFAULT_GRACE_SECONDS = 60
MAX_ATTEMPTS_CEILING = 100
MAX_RETRY_SECONDS_CEILING = 3600
MAX_GRACE_SECONDS_CEILING = 3600
# Upper bound on the republish backoff, so a persistently undeliverable
# dispatch retries at a slow steady rate instead of churning.
MAX_BACKOFF_SECONDS = 600


def _bounded(raw: str | None, default: int, ceiling: int) -> int:
    try:
        value = int(raw) if raw is not None and str(raw).strip() else default
    except (TypeError, ValueError):
        return default
    return value if 1 <= value <= ceiling else default


def max_attempts_from_env(raw: str | None) -> int:
    return _bounded(raw, DEFAULT_MAX_ATTEMPTS, MAX_ATTEMPTS_CEILING)


def retry_seconds_from_env(raw: str | None) -> int:
    return _bounded(raw, DEFAULT_RETRY_SECONDS, MAX_RETRY_SECONDS_CEILING)


def grace_seconds_from_env(raw: str | None) -> int:
    return _bounded(raw, DEFAULT_GRACE_SECONDS, MAX_GRACE_SECONDS_CEILING)


def backoff_seconds(retry_seconds: int, dispatch_count: int) -> int:
    """Linear, capped republish backoff for a lost delivery."""
    attempts = max(1, dispatch_count)
    return min(retry_seconds * attempts, MAX_BACKOFF_SECONDS)


def classify_expired(attempt_count: int, max_attempts: int) -> str:
    """Give up or retry a task whose worker claimed it and then lost the lease.

    Only real claim attempts reach this rule, so queue latency cannot exhaust a
    task that no worker has attempted. Mirrors the SQL predicate
    ``attempt_count > max_attempts``.
    """
    return "exhaust" if attempt_count > max_attempts else "requeue"
