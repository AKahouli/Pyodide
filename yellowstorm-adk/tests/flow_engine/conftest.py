"""Pytest configuration for flow_engine tests.

Several flow_engine modules call ``get_settings()`` at import time. Locally a
``.env`` file supplies the required values, but in CI there is no ``.env`` (it is
gitignored), so pydantic ``Settings`` validation fails during test collection.

To make collection deterministic, seed ``os.environ`` from ``MockSettings``
*before* any flow_engine module is imported. This conftest is loaded by pytest
ahead of test-module collection, so the env vars are in place in time.
"""

import asyncio
import os
import sys

from tests.common_schema import MockSettings

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# Populate os.environ from MockSettings so import-time get_settings() succeeds.
_mock_settings = MockSettings()
_mock_fields = getattr(MockSettings, "model_fields", None) or getattr(
    MockSettings, "__fields__", {}
)
for _field_name in _mock_fields:
    _value = getattr(_mock_settings, _field_name)
    if _value is None or isinstance(_value, (list, dict)):
        # Skip unset and complex types; required Settings fields are all scalars.
        continue
    # Do not clobber values explicitly provided by the environment / a real .env.
    os.environ.setdefault(_field_name, str(_value))
