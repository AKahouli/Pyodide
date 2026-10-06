"""The search text of one record, built the same way every time.

A record's text (its card) names its concept, its label, its key values and its
allowed fields, in the specification's order, under readable field names with
their business synonyms. Values are bounded; nothing else (ids, provenance,
other records) is included, so a neighbour's change never changes this text.

A field too long for the card (or left out of it) is also split into
overlapping passages, each searched on its own under a short header naming the
concept, the record and the field, so words deep in a long text (an e-mail
body, a contract clause) still find their record.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from typing import Any

from .settings import IndexSettings, PassagePlan, SearchSettings

# v2: cards unchanged, long fields also indexed as passages (a new index generation).
SERIALIZER_VERSION = "gs-doc-v2"
FIELD_POLICY_VERSION = "allowed-fields-v1"
# The sizes below are the defaults of ``IndexSettings`` / ``SearchSettings`` (settings.py),
# which an administrator can change; they are kept here for readers and tests.
MAX_VALUE_CHARS = 300
MAX_TEXT_CHARS = 2000
MAX_QUERY_TERMS = 16
# Passages: ~1000 characters (~170 words), cut at a paragraph, then a sentence, then a
# word between MIN and MAX; consecutive passages share ~15% so a sentence on a cut is
# whole in one of them. Capped so one huge field cannot flood the index.
PASSAGE_TARGET_CHARS = 1000
PASSAGE_MIN_CHARS = 700
PASSAGE_MAX_CHARS = 1200
PASSAGE_OVERLAP_CHARS = 150
MAX_PASSAGES_PER_FIELD = 20
MAX_PASSAGES_PER_RECORD = 50

# Words too common to say what a request is about (French and English, accent-folded): matching
# them OR-joined made any record holding "de" or "the" a word match. Generic, not per model;
# "it" is kept (IT, the business word, is more common in requests than the pronoun).
STOP_WORDS = frozenset("""
a ai aie ait as au aux avec c ca ce ceci cela celle celles celui ces cet cette ceux chez ci comme
d dans de des du donc dont elle elles en entre est et etaient etait ete etre eu eux il ils j je l
la le les leur leurs lui m ma mais me meme mes moi mon n ne ni nos notre nous on ont or ou par
pas peu plus pour qu quand que quel quelle quelles quels qui s sa sans se ses si son sont sous
sur ta te tes toi ton tous tout toute toutes tu un une unes uns vers vos votre vous y
about above after again against all am an and any are aren as at be because been before being
below between both but by can could did do does doing down during each few for from further had
has have having he her here hers herself him himself his how i if in into is isn its itself
just me more most my myself no nor not now of off on once only other our ours ourselves out over
own same she should so some such than that the their theirs them themselves then there these they
this those through to too under until up very was we were what when where which while who whom why
will with would you your yours yourself yourselves
""".split())


def fold(value: Any) -> str:
    """Lowercase, accent-free, single-spaced: how keys, labels and queries compare."""
    text = value if isinstance(value, str) else ("" if value is None else str(value))
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", text).strip()


def query_terms(query: str, settings: SearchSettings | None = None) -> list[str]:
    """Distinct words of a query, safe to join into a tsquery. Common words (``STOP_WORDS`` and
    the administrator's extra ones) are left out, unless the query holds nothing else."""
    settings = settings or SearchSettings()
    terms: list[str] = []
    for term in re.findall(r"[a-z0-9]+", fold(query)):
        if len(term) > 1 and term not in terms:
            terms.append(term)
    if settings.stop_words:
        ignored = STOP_WORDS | {word for extra in settings.extra_stop_words
                                for word in re.findall(r"[a-z0-9]+", fold(extra))}
        terms = [term for term in terms if term not in ignored] or terms
    return terms[:settings.max_query_terms]


def humanize(name: str) -> str:
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", name)
    spaced = re.sub(r"[_\-.]+", " ", spaced).strip()
    return spaced[:1].upper() + spaced[1:] if spaced else name


def _text(value: Any) -> str | None:
    if value is None or isinstance(value, (dict, list)):
        return None
    text = re.sub(r"\s+", " ", value if isinstance(value, str) else str(value)).strip()
    return text or None


def source_workspaces(provenance: dict[str, Any] | None) -> list[str]:
    """Workspaces the record was read from; manual and corrected records have none."""
    workspaces = set()
    for source in (provenance or {}).get("sources") or []:
        workspace = ((source or {}).get("assetRef") or {}).get("workspaceId")
        if isinstance(workspace, str) and workspace:
            workspaces.add(workspace)
    return sorted(workspaces)


_PARAGRAPH = re.compile(r"\n[ \t\r\f\v]*\n")
_LINE = re.compile(r"\n")
_SENTENCE_END = re.compile(r"[.!?;:…](?=\s)")
_SPACE = re.compile(r"\s")


def _closest(positions: list[int], target: int) -> int | None:
    return min(positions, key=lambda position: (abs(position - target), position)) if positions else None


def _cut(value: str, low: int, high: int, target: int) -> int:
    """Where to end a passage in ``value[low:high]``: the paragraph, line, sentence or word
    boundary closest to ``target``, in that order of preference."""
    for pattern, after in ((_PARAGRAPH, False), (_LINE, False), (_SENTENCE_END, True), (_SPACE, False)):
        found = _closest([match.end() if after else match.start()
                          for match in pattern.finditer(value, low, high)], target)
        if found is not None and found > low:
            return found
    return high


def _restart(value: str, low: int, end: int) -> int:
    """Where the next passage starts: the first sentence, else word, starting in ``[low, end)``."""
    for match in _SENTENCE_END.finditer(value, low, end):
        start = match.end()
        while start < end and value[start].isspace():
            start += 1
        if start < end:
            return start
    for index in range(max(low, 1), end):
        if value[index - 1].isspace() and not value[index].isspace():
            return index
    return end


def split_passages(value: str, *, limit: int | None = None,
                   plan: PassagePlan | None = None) -> tuple[list[tuple[int, int]], bool]:
    """Overlapping ``(start, end)`` spans of ``value`` (offsets in the value as stored), and
    whether the value goes on past the last span because of ``limit`` (default: the plan's
    passages per field)."""
    plan = plan or PassagePlan()
    limit = plan.max_per_field if limit is None else limit
    length = len(value.rstrip())
    start = len(value) - len(value.lstrip())
    spans: list[tuple[int, int]] = []
    while start < length and len(spans) < limit:
        if length - start <= plan.max_chars:
            end = length
        else:
            end = _cut(value, start + plan.min_chars, start + plan.max_chars, start + plan.target_chars)
        while end > start and value[end - 1].isspace():
            end -= 1
        spans.append((start, end))
        if end >= length:
            return spans, False
        following = _restart(value, max(start + 1, end - plan.overlap_chars), end)
        while following < length and value[following].isspace():
            following += 1
        start = following
    return spans, start < length


def _field_name(field: str, field_aliases: dict[str, Any]) -> str:
    name = humanize(field)
    synonyms = [s for s in (_text(a) for a in field_aliases.get(field) or []) if s]
    if synonyms:
        name += f" ({', '.join(synonyms)})"
    return name


def _hash(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def build_document(entity: dict[str, Any], concept: dict[str, Any] | None,
                   settings: IndexSettings | None = None) -> dict[str, Any]:
    """Search document of one stored record (``list_revision_entities`` shape), with the
    passages of its long fields (longer than the threshold, or left off the card)."""
    settings = settings or IndexSettings()
    concept = concept or {}
    concept_key = str(concept.get("key") or "")
    value_cap = settings.card_value_chars
    label = _text(entity.get("label")) or ""
    identity = entity.get("identity") or {}
    attributes = entity.get("attributes") or {}
    key_components = list(concept.get("keyComponents") or [])
    field_aliases = concept.get("fieldAliases") or {}
    concept_label = _text(concept.get("label")) or str(entity.get("conceptId") or "")
    type_line = concept_label
    aliases = [alias for alias in (_text(a) for a in concept.get("aliases") or []) if alias]
    if aliases:
        type_line += f" ({', '.join(aliases)})"
    lines = [f"Type: {type_line}"]
    if label:
        lines.append(f"Name: {label}")
    shortened: list[str] = []
    for component in key_components:
        value = _text(identity.get(component))
        if value and value != fold(label):
            lines.append(f"{humanize(component)}: {value[:value_cap]}")
    described = 0
    fields = [field for field in (concept.get("allowedFields") or list(attributes))
              if field not in key_components]
    omitted: list[str] = []
    long_fields: list[str] = []
    for field in fields:
        value = _text(attributes.get(field))
        if value is None:
            continue
        if len(value) > settings.for_field(concept_key, field).threshold:
            long_fields.append(field)
        if len(value) > value_cap:
            value = value[:value_cap].rstrip() + "…"
            shortened.append(field)
        line = f"{_field_name(field, field_aliases)}: {value}"
        if sum(len(item) + 1 for item in lines) + len(line) > settings.card_text_chars:
            omitted.append(field)
            continue
        lines.append(line)
        described += 1
    search_text = "\n".join(lines)
    passages, passage_fields, truncated = _passages(
        attributes, [field for field in fields if field in long_fields or field in omitted],
        field_aliases, concept_label, label, settings, concept_key)
    diagnostics: dict[str, Any] = {}
    if shortened:
        diagnostics["shortenedFields"] = shortened
    if omitted:
        diagnostics["omittedFields"] = omitted
    if passage_fields:
        diagnostics["passageFields"] = passage_fields
    if truncated:
        diagnostics["truncatedPassageFields"] = truncated
    return {
        "entityId": entity["entityId"],
        "conceptId": str(entity.get("conceptId") or ""),
        "label": label,
        "labelKey": fold(label),
        "sourceWorkspaces": source_workspaces(entity.get("provenance")),
        "searchText": search_text,
        # Folded so accents never decide a word match; 'simple' keeps every word.
        "lexicalText": fold(search_text),
        "contentHash": _hash(search_text),
        # Only a name and keys: findable by key or words, not worth a vector.
        "exactOnly": described == 0,
        "diagnostics": diagnostics,
        "passages": passages,
    }


def _passages(attributes: dict[str, Any], fields: list[str], field_aliases: dict[str, Any],
              concept_label: str, label: str, settings: IndexSettings,
              concept_key: str) -> tuple[list[dict[str, Any]], dict[str, int], list[str]]:
    """Passages of the long fields and of those the card left out, in field order, at most
    ``max_passages_per_record``; the fields not covered to their end are returned apart. A
    field whose settings turn passages off is not split (its card value stays as cut)."""
    passages: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    truncated: list[str] = []
    for field in fields:
        raw = attributes.get(field)
        if raw is None or isinstance(raw, (dict, list)):
            continue
        plan = settings.for_field(concept_key, field)
        if not plan.enabled:
            continue
        value = raw if isinstance(raw, str) else str(raw)
        room = min(plan.max_per_field, settings.max_passages_per_record - len(passages))
        spans, cut_short = split_passages(value, limit=room, plan=plan) if room > 0 else ([], True)
        if cut_short:
            truncated.append(field)
        name = _field_name(field, field_aliases)
        header = "\n".join([f"Type: {concept_label}", *([f"Name: {label}"] if label else []),
                            f"Field: {name}"])
        for start, end in spans:
            body = re.sub(r"\s+", " ", value[start:end]).strip()
            text = f"{header}\n{body}" if settings.passage_header else body
            passages.append({"ordinal": len(passages), "fieldKey": field, "fieldLabel": humanize(field),
                             "start": start, "end": end, "text": body, "searchText": text,
                             # Words of the passage only: the header words are already on the card.
                             "lexicalText": fold(body), "contentHash": _hash(text)})
            counts[field] = counts.get(field, 0) + 1
    return passages, counts, truncated
