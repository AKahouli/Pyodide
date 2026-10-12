"""How much of an e-mail archive is read: mail and attachment sizes, nesting, and how far into a file the
reader goes. An admin sets them as run limits; the parser child receives them as environment variables
(``SEMANTIC_EMAIL_<KEY>``), so a limit left out reads as the built-in value.

Pure stdlib: it is imported by the readers, the sandbox and the run limits alike, which must agree on
names, built-in values and ranges.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping

MB = 1024 * 1024


@dataclass(frozen=True)
class LimitSpec:
    env: str
    default: int
    low: int
    high: int


# Run limit -> how it reaches the parser, its built-in value and the range an admin may choose from.
EXTRACTION_LIMITS: dict[str, LimitSpec] = {
    "maxEmlMb": LimitSpec("SEMANTIC_EMAIL_MAX_EML_MB", 100, 1, 1024),
    "maxAttachmentMb": LimitSpec("SEMANTIC_EMAIL_MAX_ATTACHMENT_MB", 50, 1, 500),
    "maxNesting": LimitSpec("SEMANTIC_EMAIL_MAX_NESTING", 3, 0, 5),
    "maxPdfPages": LimitSpec("SEMANTIC_EMAIL_MAX_PDF_PAGES", 300, 1, 2000),
    "maxSheetCells": LimitSpec("SEMANTIC_EMAIL_MAX_SHEET_CELLS", 50_000, 1000, 1_000_000),
    "maxSlides": LimitSpec("SEMANTIC_EMAIL_MAX_SLIDES", 500, 1, 2000),
    "maxAttachmentChars": LimitSpec("SEMANTIC_EMAIL_MAX_ATTACHMENT_CHARS", 100_000, 5000, 500_000),
    "maxBodyChars": LimitSpec("SEMANTIC_EMAIL_MAX_BODY_CHARS", 100_000, 5000, 500_000),
    "maxInflatedMb": LimitSpec("SEMANTIC_EMAIL_MAX_INFLATED_MB", 50, 1, 1024),
}


def _value(environ: Mapping[str, str], key: str) -> int:
    spec = EXTRACTION_LIMITS[key]
    try:
        value = int(environ.get(spec.env, spec.default))
    except (TypeError, ValueError):
        return spec.default
    return value if spec.low <= value <= spec.high else spec.default


@dataclass(frozen=True)
class ExtractionLimits:
    eml_bytes: int = EXTRACTION_LIMITS["maxEmlMb"].default * MB
    attachment_bytes: int = EXTRACTION_LIMITS["maxAttachmentMb"].default * MB
    nesting: int = EXTRACTION_LIMITS["maxNesting"].default
    pdf_pages: int = EXTRACTION_LIMITS["maxPdfPages"].default
    sheet_cells: int = EXTRACTION_LIMITS["maxSheetCells"].default
    slides: int = EXTRACTION_LIMITS["maxSlides"].default
    attachment_chars: int = EXTRACTION_LIMITS["maxAttachmentChars"].default
    body_chars: int = EXTRACTION_LIMITS["maxBodyChars"].default
    # What a zipped office file may hold once decompressed (a small file can inflate to gigabytes).
    inflated_bytes: int = EXTRACTION_LIMITS["maxInflatedMb"].default * MB

    @classmethod
    def from_environment(cls, environ: Mapping[str, str] | None = None) -> "ExtractionLimits":
        """The limits of this process: an environment value in range, else the built-in one."""
        env = os.environ if environ is None else environ
        return cls(eml_bytes=_value(env, "maxEmlMb") * MB, attachment_bytes=_value(env, "maxAttachmentMb") * MB,
                   nesting=_value(env, "maxNesting"), pdf_pages=_value(env, "maxPdfPages"),
                   sheet_cells=_value(env, "maxSheetCells"), slides=_value(env, "maxSlides"),
                   attachment_chars=_value(env, "maxAttachmentChars"), body_chars=_value(env, "maxBodyChars"),
                   inflated_bytes=_value(env, "maxInflatedMb") * MB)


# The built-in values, for callers that name them (the text cuts are quoted in tests and notes).
BODY_CHARS = EXTRACTION_LIMITS["maxBodyChars"].default
CONTENT_CHARS = EXTRACTION_LIMITS["maxAttachmentChars"].default

__all__ = ["EXTRACTION_LIMITS", "ExtractionLimits", "LimitSpec", "MB", "BODY_CHARS", "CONTENT_CHARS"]
