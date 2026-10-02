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
}
RUN_LIMIT_RANGES = {
    "maxRunSources": (1, 50000),
    "maxRecordsPerSource": (100, 200000),
    "maxRecordsPerRun": (100, 200000),
    "maxValuesPerRun": (1000, 2000000),
}


def run_limits(payload: Any) -> dict[str, int]:
    """The limits of the run whose payload this is."""
    given = payload.get("limits") if isinstance(payload, dict) else None
    limits = dict(DEFAULT_RUN_LIMITS)
    if isinstance(given, dict):
        for key, (low, high) in RUN_LIMIT_RANGES.items():
            value = given.get(key)
            if isinstance(value, int) and not isinstance(value, bool) and low <= value <= high:
                limits[key] = value
    return limits
