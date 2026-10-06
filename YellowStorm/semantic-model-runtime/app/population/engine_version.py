"""A version of the code that turns sources into records, so a changed runtime builds again.

Taken from the source files themselves: any change to how records are read, shaped or linked
gives a new version, with nothing to remember to bump. The per-document AI cache keeps its own
explicit version (DOCUMENT_EXTRACTION_VERSION) so a deploy does not re-read every document.
"""

from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

_APP = Path(__file__).resolve().parent.parent
_PACKAGES = ("population", "datasource", "workers")


def _code_hash(packages: tuple[str, ...]) -> str:
    digest = hashlib.sha256()
    for package in packages:
        for path in sorted((_APP / package).rglob("*.py")):
            digest.update(path.relative_to(_APP).as_posix().encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()[:16]


@lru_cache(maxsize=1)
def population_engine_version() -> str:
    return "engine-" + _code_hash(_PACKAGES)


@lru_cache(maxsize=1)
def reader_version() -> str:
    """The file readers alone: a changed reader prepares its tables again."""
    return "reader-" + _code_hash(("datasource",))
