from __future__ import annotations

import hashlib
import json
from typing import Protocol

from .models import Admission, JobCommand


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
            "command": command.model_dump(by_alias=True, mode="json"),
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
