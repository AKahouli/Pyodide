"""Rules that say where a document field's value is and what it looks like.

A rule names the labels the value follows, where it sits relative to them, an optional pattern the
value must match, and how it is cleaned up. Without rules a field is read as before: its label at
the start of a line (``Label: value``) or in a table row.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

import regex

LOCATIONS = ("auto", "same_line", "next_line", "table", "heading", "anywhere")
TRANSFORMS = ("none", "upper", "lower", "date_iso")
OCCURRENCES = ("unique", "first")
MAX_LABELS = 10
MAX_LABEL_CHARS = 200
MAX_PATTERN_CHARS = 200
MAX_VALUE_CHARS = 500
# A person's pattern runs on document text: it gets a short time per match, never a hang.
PATTERN_TIMEOUT_SECONDS = 0.05
MAX_SCAN_CHARS = 20000

# How long a document may be, and how much of it is sent to the AI, unless an admin or the mapping says otherwise.
DEFAULT_AI_SETTINGS = {"maxBlocks": 400, "maxCharacters": 60000,
                       "longDocumentCharacters": 30000, "blocksPerField": 8}
AI_SETTING_BOUNDS = {"maxBlocks": (10, 500), "maxCharacters": (2000, 400000),
                     "longDocumentCharacters": (1000, 2000000), "blocksPerField": (1, 50)}


class RuleError(ValueError):
    """A rule that cannot be used as given."""


def normalize_rules(raw: Any) -> dict[str, Any] | None:
    """The rules of one field in one shape, or ``RuleError`` when they cannot be used."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise RuleError("rules must be an object")
    labels = raw.get("labels") or []
    if (not isinstance(labels, list) or len(labels) > MAX_LABELS
            or any(not isinstance(label, str) or len(label) > MAX_LABEL_CHARS for label in labels)):
        raise RuleError("labels must be at most 10 short texts")
    labels = [label.strip() for label in labels if label.strip()]
    location = raw.get("location") or "auto"
    if location not in LOCATIONS:
        raise RuleError("unknown location")
    pattern = raw.get("pattern") or None
    if pattern is not None:
        if not isinstance(pattern, str) or len(pattern) > MAX_PATTERN_CHARS:
            raise RuleError("pattern is too long")
        compile_pattern(pattern)
    if location == "anywhere" and pattern is None:
        raise RuleError("reading anywhere needs a pattern")
    transform = raw.get("transform") or "none"
    if transform not in TRANSFORMS:
        raise RuleError("unknown transform")
    occurrence = raw.get("occurrence") or "unique"
    if occurrence not in OCCURRENCES:
        raise RuleError("unknown occurrence")
    first_page_only = raw.get("firstPageOnly", False)
    if not isinstance(first_page_only, bool):
        raise RuleError("firstPageOnly must be true or false")
    return {"labels": labels, "location": location, "pattern": pattern, "transform": transform,
            "occurrence": occurrence, "firstPageOnly": first_page_only}


def normalize_ai_settings(raw: Any) -> dict[str, int]:
    """AI reading limits with every missing one set to its default; ``RuleError`` when out of bounds."""
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise RuleError("aiSettings must be an object")
    settings = dict(DEFAULT_AI_SETTINGS)
    for key, (low, high) in AI_SETTING_BOUNDS.items():
        value = raw.get(key)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
            raise RuleError(f"{key} must be a whole number from {low} to {high}")
        settings[key] = value
    return settings


def compile_pattern(pattern: str) -> Any:
    try:
        return regex.compile(pattern, flags=regex.IGNORECASE)
    except regex.error as exc:
        raise RuleError(f"pattern is not valid: {exc}") from exc


def match_pattern(compiled: Any, text: str) -> str | None:
    """The first match (its first group when it has one); None when absent or too slow to find."""
    try:
        found = compiled.search(text[:MAX_SCAN_CHARS], timeout=PATTERN_TIMEOUT_SECONDS)
    except TimeoutError:
        return None
    if not found:
        return None
    value = found.group(1) if found.groups() and found.group(1) is not None else found.group(0)
    return value.strip() or None


def all_matches(compiled: Any, text: str) -> list[str]:
    try:
        found = list(compiled.finditer(text[:MAX_SCAN_CHARS], timeout=PATTERN_TIMEOUT_SECONDS))
    except TimeoutError:
        return []
    values = []
    for item in found[:50]:
        value = item.group(1) if item.groups() and item.group(1) is not None else item.group(0)
        if value and value.strip():
            values.append(value.strip())
    return values


_MONTHS = {name: index for index, names in enumerate((
    ("january", "janvier", "jan"), ("february", "fevrier", "février", "feb", "fev", "fév"),
    ("march", "mars", "mar"), ("april", "avril", "apr", "avr"), ("may", "mai"),
    ("june", "juin", "jun"), ("july", "juillet", "jul", "juil"), ("august", "aout", "août", "aug"),
    ("september", "septembre", "sep", "sept"), ("october", "octobre", "oct"),
    ("november", "novembre", "nov"), ("december", "decembre", "décembre", "dec", "déc")), start=1)
    for name in names}


def to_iso_date(value: str) -> str | None:
    """2026-03-01 from the usual ways of writing a date; None when it is not one."""
    text = " ".join(value.replace(",", " ").split()).strip().rstrip(".")
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            pass
    words = text.lower().replace("1er", "1").split()
    if len(words) == 3:
        day_first = words[0].isdigit() and words[1] in _MONTHS and words[2].isdigit()
        month_first = words[0] in _MONTHS and words[1].isdigit() and words[2].isdigit()
        try:
            if day_first:
                return datetime(int(words[2]), _MONTHS[words[1]], int(words[0])).date().isoformat()
            if month_first:
                return datetime(int(words[2]), _MONTHS[words[0]], int(words[1])).date().isoformat()
        except ValueError:
            return None
    return None


def clean(value: str, rules: dict[str, Any] | None) -> str | None:
    """The value as the rules want it: matching the pattern, then transformed."""
    value = value.strip()[:MAX_VALUE_CHARS]
    if not rules:
        return value or None
    if rules.get("pattern") and rules["location"] != "anywhere":
        value = match_pattern(compile_pattern(rules["pattern"]), value) or ""
    if not value:
        return None
    transform = rules.get("transform")
    if transform == "upper":
        return value.upper()
    if transform == "lower":
        return value.lower()
    if transform == "date_iso":
        return to_iso_date(value) or value
    return value


def _label_regex(label: str) -> re.Pattern[str]:
    return re.compile(rf"(?<!\w){re.escape(label)}(?!\w)", flags=re.IGNORECASE)


_LEAD = re.compile(r"^\s*(?:[:\-–—=]|\bis\b|\best\b|\bare\b)?\s*[:\-–—]?\s*", flags=re.IGNORECASE)


def same_line_values(content: str, label: str) -> list[str]:
    """Text after the label on its line, up to the end of the sentence: ``The subject is: X.`` gives X."""
    values = []
    finder = _label_regex(label)
    for line in content.splitlines():
        for found in finder.finditer(line):
            rest = _LEAD.sub("", line[found.end():], count=1)
            rest = re.split(r"(?<=[^\s.])\.(?:\s|$)", rest, maxsplit=1)[0].strip()
            if rest:
                values.append(rest)
    return values


def next_line_values(content: str, label: str) -> list[str]:
    """The line after a line that holds only the label (``Title`` then ``Service schedule``)."""
    lines = [line.strip() for line in content.splitlines()]
    finder = re.compile(rf"^\s*{re.escape(label)}\s*[:\-–—]?\s*$", flags=re.IGNORECASE)
    values = []
    for index, line in enumerate(lines):
        if finder.match(line):
            following = next((item for item in lines[index + 1:] if item), None)
            if following:
                values.append(following)
    return values


def label_found(content: str, labels: list[str]) -> bool:
    return any(_label_regex(label).search(content) for label in labels)
