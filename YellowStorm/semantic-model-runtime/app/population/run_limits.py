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
    # The "saving" step: rows written per batch, and seconds one batch may take.
    "saveBatchRows": 2000,
    "saveStatementSeconds": 10,
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
    "saveBatchRows": (100, 50000),
    "saveStatementSeconds": (5, 600),
}
# How a run is saved, not what it builds: never part of its fingerprint or its admission hash.
SAVE_LIMIT_KEYS = ("saveBatchRows", "saveStatementSeconds")
# How the search index is built (embedding calls and pages), set by the same admin and carried by a
# run so the index it requests is built with them. Pure performance knobs: like the save limits they
# never enter a fingerprint. Absent: the environment's value, else the built-in one.
INDEX_BUILD_LIMIT_RANGES = {
    "embeddingBatchSize": (1, 256),
    "embeddingParallelCalls": (1, 16),
    "embeddingTimeoutSeconds": (5, 600),
    "indexReadPageRows": (500, 50000),
}
INDEX_BUILD_LIMIT_KEYS = tuple(INDEX_BUILD_LIMIT_RANGES)
NON_IDENTITY_LIMIT_KEYS = SAVE_LIMIT_KEYS + INDEX_BUILD_LIMIT_KEYS


def identity_limits(limits: dict[str, Any] | None) -> dict[str, Any]:
    """The limits that decide what a run builds (the core hashes the same ones)."""
    return {key: value for key, value in (limits or {}).items() if key not in NON_IDENTITY_LIMIT_KEYS}


def index_build_limits(limits: Any) -> dict[str, int]:
    """The valid index build limits among a run's limits (none when the admin set none)."""
    if not isinstance(limits, dict):
        return {}
    picked = {}
    for key, (low, high) in INDEX_BUILD_LIMIT_RANGES.items():
        value = limits.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and low <= value <= high:
            picked[key] = value
    return picked


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


# What a mail archive's connection chooses; read time and memory never above the run's (the admin's) value.
ARCHIVE_LIMIT_KEYS = ("maxArchiveEmails", "maxArchiveMb", "archiveTimeoutSeconds", "parserMemoryMb")
ARCHIVE_CEILING_KEYS = ("archiveTimeoutSeconds", "parserMemoryMb")


def source_limits(limits: dict[str, int], source: Any) -> dict[str, int]:
    """The run's limits with an archive source's own ones over them."""
    given = source.get("archiveLimits") if isinstance(source, dict) else None
    if not isinstance(given, dict):
        return limits
    merged = dict(limits)
    for key in ARCHIVE_LIMIT_KEYS:
        value = given.get(key)
        low, high = RUN_LIMIT_RANGES[key]
        if isinstance(value, int) and not isinstance(value, bool) and low <= value <= high:
            merged[key] = min(value, limits[key]) if key in ARCHIVE_CEILING_KEYS else value
    return merged


def source_record_cap(limits: dict[str, int], entry: Any) -> int:
    """Most records one source gives: its mapping's own choice (``readLimits.maxRecords``), never above the run's."""
    read_limits = entry.get("readLimits") if isinstance(entry, dict) else None
    value = read_limits.get("maxRecords") if isinstance(read_limits, dict) else None
    if isinstance(value, int) and not isinstance(value, bool) and value >= 1:
        return min(value, limits["maxRecordsPerSource"])
    return limits["maxRecordsPerSource"]


def ai_pacing(limits: dict[str, int], settings: dict[str, Any] | None) -> dict[str, int]:
    """How many records a reader may send to the AI, and how many calls at once (the mapping's
    choice, never above the admin's ceiling)."""
    wanted = (settings or {}).get("parallelCalls") or 4
    return {"aiRows": limits["maxAiRowsPerSource"],
            "concurrency": max(1, min(int(wanted), limits["maxAiParallelCalls"]))}
