"""Rules that say where a document field's value is and what it looks like.

A rule names the labels the value follows, where it sits relative to them, an optional pattern the
value must match, and how it is cleaned up. Without rules a field is read as before: its label at
the start of a line (``Label: value``) or in a table row.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from typing import Any

import regex

LOCATIONS = ("auto", "same_line", "next_line", "table", "heading", "anywhere",
             "after_label", "before_label", "pages")
# Locations whose value is a passage (whole paragraphs or pages), not a short value.
PASSAGE_LOCATIONS = ("after_label", "before_label", "pages")
TRANSFORMS = ("none", "trim", "no_spaces", "upper", "lower", "date_iso")
OCCURRENCES = ("unique", "first")
MAX_LABELS = 10
MAX_LABEL_CHARS = 200
MAX_PATTERN_CHARS = 200
MAX_VALUE_CHARS = 500
MAX_PASSAGE_CHARS = 20000
MAX_PAGE = 2000
MAX_PAGE_SPAN = 50
TAKE_UNITS = ("characters", "words", "lines")
MAX_TAKE = 20000
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
    rules = {"labels": labels, "location": location, "pattern": pattern, "transform": transform,
             "occurrence": occurrence, "firstPageOnly": first_page_only}
    if location in ("after_label", "before_label"):
        # Where the passage stops (after a label) or starts (before one); the section edge without any.
        boundary = raw.get("boundaryLabels") or []
        if (not isinstance(boundary, list) or len(boundary) > MAX_LABELS
                or any(not isinstance(label, str) or len(label) > MAX_LABEL_CHARS for label in boundary)):
            raise RuleError("boundaryLabels must be at most 10 short texts")
        rules["boundaryLabels"] = [label.strip() for label in boundary if label.strip()]
    take = raw.get("take")
    if take is not None:
        count = take.get("count") if isinstance(take, dict) else None
        if (not isinstance(take, dict) or take.get("from", "start") not in ("start", "end")
                or take.get("unit", "characters") not in TAKE_UNITS
                or not isinstance(count, int) or isinstance(count, bool) or not 1 <= count <= MAX_TAKE):
            raise RuleError(f"take keeps 1 to {MAX_TAKE} characters, words or lines from the start or the end")
        rules["take"] = {"from": take.get("from", "start"), "count": count, "unit": take.get("unit", "characters")}
    if location == "pages":
        pages = raw.get("pages")
        start = pages.get("from") if isinstance(pages, dict) else None
        end = pages.get("to", start) if isinstance(pages, dict) else None
        end = start if end is None else end
        if (not isinstance(start, int) or not isinstance(end, int) or isinstance(start, bool)
                or isinstance(end, bool) or not 1 <= start <= end <= MAX_PAGE or end - start >= MAX_PAGE_SPAN):
            raise RuleError(f"pages must run from page 1 or later, at most {MAX_PAGE_SPAN} pages")
        rules["pages"] = {"from": start, "to": end}
        rules["firstPageOnly"] = False
    return rules


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
    ("january", "janvier", "jan", "janv"), ("february", "fevrier", "février", "feb", "fev", "fév", "fevr", "févr"),
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


_ISO_PREFIX = re.compile(r"^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:[T ][\d:.]+Z?)?$")
_PERIOD_SPLIT = re.compile(r"\s+(?:-|–|—|à|au|to|until|jusqu'(?:à|au|en))\s+|\s*[–—]\s*|(?<=\d)-(?=[^\d\s])|(?<=[a-zé.])-(?=[a-zé])",
                           flags=re.IGNORECASE)
_DATE_LEAD = re.compile(r"^(?:depuis|since|from|de|du|dès|des|en|in|le|on)\s+", flags=re.IGNORECASE)
_WEEKDAYS = {"lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche", "monday", "tuesday",
             "wednesday", "thursday", "friday", "saturday", "sunday"}


def to_iso_date_or_period(value: str) -> str | None:
    """ISO as precise as the text: 2026-09-29, 2026-06 or 2026; a period gives its start.

    "Avril 2019 - Déc. 2022" gives 2019-04, "Depuis juin 2025" 2025-06, "mardi, 29 septembre 2026
    à 14:07" 2026-09-29. None when it is not a date (e.g. "mi-juin", which needs a year).
    """
    text = " ".join(value.replace(",", " ").split()).strip().strip("()[]")
    iso = _ISO_PREFIX.match(text)
    if iso:
        return "-".join(part for part in iso.groups() if part)
    start = _PERIOD_SPLIT.split(text, maxsplit=1)[0].strip()
    start = _DATE_LEAD.sub("", start)
    start = re.sub(r"\s+(?:à|a|at)\s+\d{1,2}[:h]\d{2}.*$|\s+\d{1,2}:\d{2}.*$", "", start, flags=re.IGNORECASE)
    words = [word.rstrip(".").lower() for word in start.split() if word.rstrip(".").lower() not in _WEEKDAYS]
    if not words:
        return None
    day = to_iso_date(" ".join(words))
    if day:
        return day
    if len(words) == 2 and words[0] in _MONTHS and re.fullmatch(r"\d{4}", words[1]):
        return f"{words[1]}-{_MONTHS[words[0]]:02d}"
    if len(words) == 1 and re.fullmatch(r"(?:19|20)\d{2}", words[0]):
        return words[0]
    return None


# What "trim" removes at both ends: spaces (also non-breaking and zero-width), bullets and the
# separators left over from a label (":", "-", ";"...). Full stops, quotes and brackets stay.
_TRIMMED = " \t\r\n\u00a0\u200b\ufeff:;,-\u2013\u2014_*=>\u2022\u00b7\u25aa\u25ba\u25cf\u2023\u2043"


# Every space, including non-breaking and zero-width ones.
_SPACES = re.compile(r"[\s\u200b\ufeff]+")


def without_spaces(value: str) -> str:
    """The value with no space at all: ``25 / 09 / 2017`` gives ``25/09/2017``."""
    return _SPACES.sub("", value)


def trim(value: str) -> str:
    """The value without spaces, bullets or label separators at either end (left and right trim)."""
    # Private-use characters are the bullets of PDF symbol fonts (shown as \uf0dc and the like).
    def trimmed(char: str) -> bool:
        return char in _TRIMMED or unicodedata.category(char) == "Co"

    start, end = 0, len(value)
    while start < end and trimmed(value[start]):
        start += 1
    while end > start and trimmed(value[end - 1]):
        end -= 1
    return value[start:end]


_WORD = re.compile(r"\S+")


def take_part(text: str, take: dict[str, Any]) -> str:
    """The first or last characters, words or lines of the text, like LEFT(text, n) or RIGHT(text, n).
    Words and lines keep the spacing between them as written."""
    count, from_end = take["count"], take["from"] == "end"
    if take["unit"] == "characters":
        return text[-count:] if from_end else text[:count]
    if take["unit"] == "words":
        words = list(_WORD.finditer(text))
        if len(words) <= count:
            return text
        return text[words[-count].start():] if from_end else text[:words[count - 1].end()]
    lines = text.splitlines(keepends=True)
    return "".join(lines[-count:] if from_end else lines[:count])


def shaped_input(value: str, rules: dict[str, Any] | None) -> str:
    """The text a rule's location found, as the shaping steps see it (trimmed and bounded)."""
    passage = bool(rules) and rules["location"] in PASSAGE_LOCATIONS
    return value.strip()[:MAX_PASSAGE_CHARS if passage else MAX_VALUE_CHARS]


def clean(value: str, rules: dict[str, Any] | None) -> str | None:
    """The value as the rules want it: cut to its kept part, matching the pattern, then transformed."""
    value = shaped_input(value, rules)
    if not rules:
        return value or None
    if rules.get("take"):
        value = take_part(value, rules["take"]).strip()
    if rules.get("pattern") and rules["location"] != "anywhere":
        value = match_pattern(compile_pattern(rules["pattern"]), value) or ""
    transform = rules.get("transform")
    if transform == "trim":
        value = trim(value)
    if transform == "no_spaces":
        value = without_spaces(value)
    if not value:
        return None
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


def fold(text: str) -> str:
    """Text compared without case, accents or extra spaces: ``1.1. DÉFINITION`` reads ``1.1. definition``."""
    decomposed = unicodedata.normalize("NFKD", text)
    return " ".join("".join(char for char in decomposed if not unicodedata.combining(char)).lower().split())


# "1.1. ", "1.2 ", "IV. ", "a) ": a numbering always ends in a dot, a bracket or a space.
_NUMBERING = re.compile(r"^\s*(?:(?:(?:\d+|[ivxlc]+|[a-z])[.)])+\d*\s*|\d+(?:\.\d+)*\s+)", flags=re.IGNORECASE)


def heading_text(title: str) -> str:
    """A heading without its numbering: ``1.2.1. Pertinence`` gives ``Pertinence``."""
    stripped = _NUMBERING.sub("", title, count=1).strip()
    return stripped or title.strip()


def heading_matches(title: str, labels: list[str]) -> bool:
    """A section title that is one of the labels, numbering, case and accents aside."""
    folded = fold(heading_text(title)).rstrip(" :")
    return any(folded == fold(label).rstrip(" :") for label in labels)


def folded_label_regex(label: str) -> re.Pattern[str]:
    """The label found in folded text (see ``fold``), as a whole word."""
    return re.compile(rf"(?<!\w){re.escape(fold(label))}(?!\w)")
