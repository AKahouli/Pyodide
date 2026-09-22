"""P4.6: persist semantic-owned index observations in the runtime database.

Separate from the read-only index adapter: observations are runtime-owned rows,
not a native vectorstore revision, and never written to ``logicalsearch``.
"""

from __future__ import annotations

import json
from typing import Any

_UPSERT = """
INSERT INTO semantic_datasource.index_observations
  (workspace_id, asset_id, asset_version_id, document_pk, verification, fingerprint, readiness)
VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
ON CONFLICT (asset_version_id, document_pk) DO UPDATE
SET verification = EXCLUDED.verification, fingerprint = EXCLUDED.fingerprint,
    readiness = EXCLUDED.readiness, observed_at = now()
RETURNING id::text
"""


async def record_index_observation(pool: Any, observation: dict[str, Any]) -> str:
    """Idempotent upsert keyed by asset version and resolved document."""
    row = await pool.fetchrow(
        _UPSERT,
        observation["workspaceId"],
        observation["assetId"],
        observation["assetVersionId"],
        observation.get("documentPk"),
        observation["verification"],
        observation.get("fingerprint"),
        json.dumps(observation.get("readiness", {}), sort_keys=True),
    )
    return row["id"]
