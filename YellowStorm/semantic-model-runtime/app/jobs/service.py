from __future__ import annotations

import hashlib
import json
from typing import Protocol

from app.population.run_limits import SAVE_LIMIT_KEYS, identity_limits

from .models import Admission, JobCommand


def _identity_command(dump: dict) -> dict:
    """The command without the limits that only decide how a run is saved: changing them
    must not make the same run, under the same idempotency key, a different payload."""
    payload = dump.get("payload")
    limits = payload.get("limits") if isinstance(payload, dict) else None
    if not isinstance(limits, dict) or not any(key in limits for key in SAVE_LIMIT_KEYS):
        return dump
    kept = identity_limits(limits)
    return {**dump, "payload": {**{k: v for k, v in payload.items() if k != "limits"},
                                **({"limits": kept} if kept else {})}}


class JobRepository(Protocol):
    async def admit(
        self,
        *,
        job_type: str,
        command: JobCommand,
        idempotency_key: str,
        command_hash: str,
        task_name: str,
        queue_name: str,
    ) -> Admission: ...

    async def get_job(self, job_id: str, actor_user_id: str) -> dict | None: ...

    async def list_events(
        self, job_id: str, actor_user_id: str, after: int, limit: int
    ) -> list[dict]: ...


class JobService:
    def __init__(self, repository: JobRepository):
        self.repository = repository

    async def admit(
        self,
        *,
        job_type: str,
        command: JobCommand,
        idempotency_key: str,
        task_name: str,
        queue_name: str,
    ) -> Admission:
        canonical = {
            "jobType": job_type,
            "command": _identity_command(command.model_dump(by_alias=True, mode="json")),
        }
        encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()
        command_hash = f"sha256:{hashlib.sha256(encoded).hexdigest()}"
        return await self.repository.admit(
            job_type=job_type,
            command=command,
            idempotency_key=idempotency_key,
            command_hash=command_hash,
            task_name=task_name,
            queue_name=queue_name,
        )
