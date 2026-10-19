"""Per-process worker identity for durable leases and heartbeats (P0-01).

Every worker instance generates a fresh random boot identity once per OS
process. Lease ownership and the ``worker_heartbeats`` primary key are built
from it, so two instances sharing a host (or a Celery host-name prefix) can
never collide and never evict each other. The Celery hostname is display
and debugging only: it never authorizes anything and never fences a lease.
Whether a lease is dead is decided by its expiry in PostgreSQL alone.
"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class WorkerIdentity:
    """One live worker instance. ``hostname`` is for display only."""

    role: str
    hostname: str
    instance_id: str

    def lease_owner(self) -> str:
        """A fresh, unique owner string for one claimed task or generation."""
        return f"{self.role}-worker:{self.instance_id}:{uuid.uuid4().hex}"

    @property
    def heartbeat_id(self) -> str:
        """The ``worker_heartbeats`` primary key: one row per live instance."""
        return f"{self.role}-worker:{self.instance_id}"


@lru_cache(maxsize=1)
def process_instance_id() -> str:
    """The boot identity of this OS process, stable for its lifetime.

    ``SEMANTIC_WORKER_INSTANCE_ID`` may name the deployment (a container or
    service instance) as a hint; the fresh random suffix is what makes the
    identity unique across restarts. The env var alone is never uniqueness.
    """
    hint = os.environ.get("SEMANTIC_WORKER_INSTANCE_ID", "").strip()
    return f"{hint}:{uuid.uuid4().hex}" if hint else uuid.uuid4().hex


@lru_cache(maxsize=None)
def worker_identity(role: str, hostname: str = "") -> WorkerIdentity:
    """This process's identity for ``role``, generated once and reused."""
    return WorkerIdentity(role=role, hostname=hostname, instance_id=process_instance_id())
