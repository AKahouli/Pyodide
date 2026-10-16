"""The search text of one record, built the same way every time.

A record's text (its card) names its concept, its label, its key values and its
allowed fields, in the specification's order, under readable field names with
their business synonyms. Values are bounded; a list or a JSON object is written
out as its items. It ends with the names of the records linked to it, grouped
by their concept ("Correspondant: Alice Martin"), so an e-mail is found through
its sender's name or its attachment's: only the linked records read from no
other workspace than the record itself, so a name never shows where it is hidden.
Nothing else (ids, provenance) is included.

A field too long for the card (or left out of it) is also split into
overlapping passages, each searched on its own under a short header naming the
concept, the record and the field, so words deep in a long text (an e-mail
body, a contract clause) still find their record.

Words are matched as written and by their French and English stems
("contrats" finds "contrat"). Every sign splits words the same way in the text
and in a request, and a request word made of several parts (an e-mail address,
a reference like INV-2024-001) must find those parts in a row.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from typing import Any

from .settings import IndexSettings, PassagePlan, SearchSettings

# v2: cards unchanged, long fields also indexed as passages (a new index generation).
# v3: lists and JSON values written out, linked records' names on the card, words split on
# every sign and stemmed.
SERIALIZER_VERSION = "gs-doc-v3"
# Text search configurations whose words are indexed together: as written, and stemmed.
LEXICAL_CONFIGS = ("simple", "french", "english")
# A list or object value: at most this many items, this deep.
MAX_LIST_ITEMS = 50
MAX_VALUE_DEPTH = 3
# Linked records' names on a card: per concept, each name's length, and in all.
MAX_LINKED_NAMES = 10
LINKED_NAME_CHARS = 80
LINKED_TEXT_CHARS = 600
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


_WORD = re.compile(r"[^\W_]+")


def words(text: Any) -> list[str]:
    """The words of a text as search compares them: folded, split on every sign."""
    return _WORD.findall(fold(text))


def lexical_text(text: Any) -> str:
    """The text that is word-indexed: its words, separated by single spaces. An e-mail address
    or a reference is then indexed as its parts in a row, the way a request is split."""
    return " ".join(words(text))


def _ignored(settings: SearchSettings) -> frozenset[str]:
    if not settings.stop_words:
        return frozenset()
    return STOP_WORDS | {word for extra in settings.extra_stop_words for word in words(extra)}


def query_terms(query: str, settings: SearchSettings | None = None) -> list[str]:
    """Distinct words of a query, safe to join into a tsquery. Common words (``STOP_WORDS`` and
    the administrator's extra ones) are left out, unless the query holds nothing else."""
    settings = settings or SearchSettings()
    terms: list[str] = []
    for term in words(query):
        if len(term) > 1 and term not in terms:
            terms.append(term)
    ignored = _ignored(settings)
    terms = [term for term in terms if term not in ignored] or terms
    return terms[:settings.max_query_terms]


def lexical_query(query: str, settings: SearchSettings | None = None) -> str | None:
    """The request as a tsquery text (OR of its parts), or None when it holds no word.

    A part is a word, or the words of one written token joined by signs (``alice.martin@acme.com``,
    ``INV-2024-001``) that must follow each other. Common words are left out of single-word parts,
    unless nothing else is left."""
    settings = settings or SearchSettings()
    ignored = _ignored(settings)
    parts: list[str] = []
    plain: list[str] = []
    for token in fold(query).split():
        pieces = words(token)
        if len(pieces) > 1:
            phrase = " <-> ".join(pieces)
            if phrase not in parts:
                parts.append(phrase)
        elif pieces and len(pieces[0]) > 1 and pieces[0] not in parts:
            (plain if pieces[0] in ignored else parts).append(pieces[0])
    kept = (parts or plain)[:settings.max_query_terms]
    return " | ".join(f"({part})" if " " in part else part for part in kept) or None


def _is_reference(token: str) -> bool:
    return len(words(token)) > 1 and (any(char.isdigit() for char in token) or "@" in token)


def reference_phrases(query: str) -> list[str]:
    """The written references of a request: a token made of several parts that holds a digit or an
    ``@`` (``AV-2026-0135``, ``INV-2024-001``, ``alice@acme.com``), folded, as the record names carry them.
    A name that contains one is the record asked for, whatever else the request says."""
    phrases: list[str] = []
    for token in fold(query).split():
        if _is_reference(token):
            phrase = "".join(char for char in token if char.isalnum() or char in "-_.@/:").strip("-_.@/:")
            if phrase and phrase not in phrases:
                phrases.append(phrase)
    return phrases


def reference_query(phrases: list[str]) -> str | None:
    """The tsquery of written references alone (``reference_phrases``): each one as words that must follow each other."""
    return " | ".join("(" + " <-> ".join(words(phrase)) + ")" for phrase in phrases) or None


def humanize(name: str) -> str:
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", name)
    spaced = re.sub(r"[_\-.]+", " ", spaced).strip()
    return spaced[:1].upper() + spaced[1:] if spaced else name


def _structured(value: Any) -> Any:
    """A list or object, also when stored as JSON text; anything else as it is."""
    if isinstance(value, str) and value[:1] in "[{" and value.rstrip()[-1:] in "]}":
        try:
            parsed = json.loads(value)
        except ValueError:
            return value
        return parsed if isinstance(parsed, (dict, list)) else value
    return value


def _written(value: Any, depth: int = 0) -> str | None:
    """A value as words: a list as its items, an object as "Name: value" pairs."""
    value = _structured(value)
    if value is None or depth > MAX_VALUE_DEPTH:
        return None
    if isinstance(value, list):
        items = [text for item in value[:MAX_LIST_ITEMS] if (text := _written(item, depth + 1))]
        return ", ".join(items) or None
    if isinstance(value, dict):
        items = [f"{humanize(str(key))}: {text}" for key, item in list(value.items())[:MAX_LIST_ITEMS]
                 if (text := _written(item, depth + 1))]
        return "; ".join(items) or None
    return value if isinstance(value, str) else str(value)


def _text(value: Any) -> str | None:
    written = _written(value)
    text = re.sub(r"\s+", " ", written).strip() if written else ""
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


def _linked_lines(links: list[dict[str, Any]]) -> list[str]:
    """``Linked <concept>: <name>, <name>`` lines, one per linked concept in order of first
    appearance, bounded per concept, per name and in all."""
    names: dict[str, list[str]] = {}
    extra: dict[str, int] = {}
    for link in links:
        concept, name = _text(link.get("concept")), _text(link.get("name"))
        if concept and isinstance(link.get("more"), int) and link["more"] > 0:
            # Linked records left out before they were read: counted, not named.
            names.setdefault(concept, [])
            extra[concept] = extra.get(concept, 0) + link["more"]
            continue
        if not concept or not name:
            continue
        name = name[:LINKED_NAME_CHARS].rstrip() + ("…" if len(name) > LINKED_NAME_CHARS else "")
        kept = names.setdefault(concept, [])
        if name in kept:
            continue
        if len(kept) < MAX_LINKED_NAMES:
            kept.append(name)
        else:
            extra[concept] = extra.get(concept, 0) + 1
    lines: list[str] = []
    room = LINKED_TEXT_CHARS
    for concept, kept in names.items():
        if not kept:
            continue
        line = f"Linked {concept}: {', '.join(kept)}"
        if extra.get(concept):
            line += f" (+{extra[concept]})"
        if len(line) > room:
            break
        lines.append(line)
        room -= len(line) + 1
    return lines


def build_document(entity: dict[str, Any], concept: dict[str, Any] | None,
                   settings: IndexSettings | None = None,
                   links: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Search document of one stored record (``list_revision_entities`` shape), with the
    passages of its long fields (longer than the threshold, or left off the card).
    ``links``: ``{"concept": label, "name": name}`` of the linked records shown on the card."""
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
    linked_lines = _linked_lines(links or [])
    lines += linked_lines
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
    if linked_lines:
        diagnostics["linkedConcepts"] = len(linked_lines)
    return {
        "entityId": entity["entityId"],
        "conceptId": str(entity.get("conceptId") or ""),
        "label": label,
        "labelKey": fold(label),
        "sourceWorkspaces": source_workspaces(entity.get("provenance")),
        "searchText": search_text,
        # Folded so accents never decide a word match, and split on every sign.
        "lexicalText": lexical_text(search_text),
        "contentHash": _hash(search_text),
        # Only a name and keys: findable by key or words, not worth a vector.
        "exactOnly": described == 0 and not linked_lines,
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
        raw = _structured(attributes.get(field))
        value = _written(raw) if isinstance(raw, (dict, list)) else raw
        if value is None:
            continue
        plan = settings.for_field(concept_key, field)
        if not plan.enabled:
            continue
        value = value if isinstance(value, str) else str(value)
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
                             "lexicalText": lexical_text(body), "contentHash": _hash(text)})
            counts[field] = counts.get(field, 0) + 1
    return passages, counts, truncated
