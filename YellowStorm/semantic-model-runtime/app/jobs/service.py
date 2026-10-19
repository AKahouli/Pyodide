from __future__ import annotations

import hashlib
import json
from typing import Protocol

from app.population.run_limits import NON_IDENTITY_LIMIT_KEYS, identity_limits

from .models import Admission, JobCommand
from .asset_admission import without_asset_authority, admission_candidate


# Search index jobs carry how to build (embedding batch size, parallel calls…) under this payload key.
INDEX_BUILD_PAYLOAD_KEY = "indexBuild"


def _identity_command(dump: dict) -> dict:
    """The command without what only decides how a job is performed (the save and index build
    limits of a run, the build settings of an index job): changing them must not make the same
    job, under the same idempotency key, a different payload."""
    dump = without_asset_authority(dump)
    payload = dump.get("payload")
    if not isinstance(payload, dict):
        return dump
    limits = payload.get("limits")
    has_limits = isinstance(limits, dict) and any(key in limits for key in NON_IDENTITY_LIMIT_KEYS)
    if not has_limits and INDEX_BUILD_PAYLOAD_KEY not in payload:
        return dump
    kept = {k: v for k, v in payload.items() if k not in ("limits", INDEX_BUILD_PAYLOAD_KEY)}
    if has_limits:
        remaining = identity_limits(limits)
        if remaining:
            kept["limits"] = remaining
    elif "limits" in payload:
        kept["limits"] = payload["limits"]
    return {**dump, "payload": kept}


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
        asset_admission_key: str | None = None,
    ) -> Admission:
        admission_candidate(command, asset_admission_key or idempotency_key)
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
