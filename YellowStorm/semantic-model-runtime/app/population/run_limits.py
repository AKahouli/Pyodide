"""How much one population run may read and keep, as an admin set it.

The back end sends the limits in the run command; anything missing, invalid or out of
range falls back to the built-in value. The ceilings protect the worker's memory whatever
an admin enters.
"""

from __future__ import annotations

from typing import Any

DEFAULT_RUN_LIMITS = {
    "maxRunSources": 5000,
    "maxRecordsPerSource": 5000,
    "maxRecordsPerRun": 10000,
    "maxValuesPerRun": 50000,
    # Records of one source read with AI in a run, and the most AI calls a run makes at once.
    "maxAiRowsPerSource": 500,
    "maxAiParallelCalls": 8,
    # E-mail archives: e-mails per archive, archive size, and the parser's memory and time for one read.
    "maxArchiveEmails": 50000,
    "maxArchiveMb": 1024,
    "parserMemoryMb": 512,
    "archiveTimeoutSeconds": 900,
}
RUN_LIMIT_RANGES = {
    "maxRunSources": (1, 50000),
    "maxRecordsPerSource": (100, 500000),
    "maxRecordsPerRun": (100, 500000),
    "maxValuesPerRun": (1000, 5000000),
    "maxAiRowsPerSource": (0, 200000),
    "maxAiParallelCalls": (1, 32),
    "maxArchiveEmails": (100, 200000),
    "maxArchiveMb": (10, 51200),
    "parserMemoryMb": (256, 16384),
    "archiveTimeoutSeconds": (60, 7200),
}


def run_limits(payload: Any) -> dict[str, int]:
    """The limits of the run whose payload this is."""
    given = payload.get("limits") if isinstance(payload, dict) else None
    limits = dict(DEFAULT_RUN_LIMITS)
    # The environment's AI row cap stays the default when an admin set none.
    from .cell_fields import max_ai_rows
    limits["maxAiRowsPerSource"] = max_ai_rows()
    if isinstance(given, dict):
        for key, (low, high) in RUN_LIMIT_RANGES.items():
            value = given.get(key)
            if isinstance(value, int) and not isinstance(value, bool) and low <= value <= high:
                limits[key] = value
    return limits


def ai_pacing(limits: dict[str, int], settings: dict[str, Any] | None) -> dict[str, int]:
    """How many records a reader may send to the AI, and how many calls at once (the mapping's
    choice, never above the admin's ceiling)."""
    wanted = (settings or {}).get("parallelCalls") or 4
    return {"aiRows": limits["maxAiRowsPerSource"],
            "concurrency": max(1, min(int(wanted), limits["maxAiParallelCalls"]))}
