"""Several records out of one value: the Expand step of a derivation.

A message lists its recipients in one field ("Ann <ann@x.fr>; Bob <bob@y.fr>", a JSON array of
addresses, or of objects such as ``[{"name": "Ann", "email": "ann@x.fr"}]``). Expanding that field makes
one *item* per recipient; every field of the derivation then reads the item (``@item``, or a path of an
object item such as ``@item.email``) as it reads a field of the source record, so recipes, rules and AI
work on items unchanged, and the records of one key still merge into one.

An item record keeps the fields of its source record, so a field may still read the message's date.
"""

from __future__ import annotations

import json
import re
from typing import Any

ITEM = "@item"
ITEM_PREFIX = "@item."
SPLITS = ("auto", "list", "emails", "delimiters", "lines")
DEFAULT_DELIMITERS = (";", ",")
MAX_ITEMS = 200
MAX_ITEMS_LIMIT = 1000
MAX_PATH = 120
# How deep an object item is flattened into ``@item.a.b`` paths.
MAX_DEPTH = 4
MAX_ITEM_TEXT = 20000


class ExpandError(ValueError):
    """An expand setting that cannot run as described."""


def is_item_attribute(name: Any) -> bool:
    return isinstance(name, str) and (name == ITEM or (name.startswith(ITEM_PREFIX) and len(name) > len(ITEM_PREFIX)))


def normalize_expand(raw: Any, allowed_fields: set[str] | list[str]) -> dict[str, Any] | None:
    """The expand setting in the one shape both sides hash, or None when a derivation does not expand."""
    if raw is None:
        return None
    if not isinstance(raw, dict) or raw.get("field") not in allowed_fields:
        raise ExpandError("invalid_expand")
    split = raw.get("split") or "auto"
    if split not in SPLITS:
        raise ExpandError("invalid_expand")
    out: dict[str, Any] = {"field": raw["field"], "split": split}
    if split == "delimiters":
        delimiters = raw.get("delimiters")
        if (not isinstance(delimiters, list) or not 0 < len(delimiters) <= 10
                or not all(isinstance(item, str) and 0 < len(item) <= 5 for item in delimiters)):
            raise ExpandError("invalid_expand")
        out["delimiters"] = list(dict.fromkeys(delimiters))
    path = raw.get("path")
    if path is not None:
        if split not in ("auto", "list") or not isinstance(path, str) or not path.strip() or len(path) > MAX_PATH:
            raise ExpandError("invalid_expand")
        out["path"] = path.strip()
    relation_id = raw.get("relationId")
    if relation_id is not None:
        # Each source record is linked by this relationship to the records its items made.
        if not isinstance(relation_id, str) or not relation_id or len(relation_id) > 200:
            raise ExpandError("invalid_expand")
        out["relationId"] = relation_id
    max_items = raw.get("maxItems")
    if max_items is not None:
        if not isinstance(max_items, int) or isinstance(max_items, bool) or not 0 < max_items <= MAX_ITEMS_LIMIT:
            raise ExpandError("invalid_expand")
        out["maxItems"] = max_items
    return out


def _at_path(value: Any, path: str | None) -> Any:
    """The part of a JSON value a path names ("recipients", "data.to"); ``[*]`` and ``[]`` steps are allowed."""
    if not path:
        return value
    for step in path.replace("[*]", "").replace("[]", "").split("."):
        if not step:
            continue
        if isinstance(value, dict):
            value = value.get(step)
        elif isinstance(value, list) and step.isdigit() and int(step) < len(value):
            value = value[int(step)]
        else:
            return None
    return value


def _parse_json(text: str) -> Any:
    stripped = text.strip()
    if not stripped or stripped[0] not in "[{":
        return None
    try:
        return json.loads(stripped)
    except ValueError:
        return None


# One address of a list: an optional display name (quoted, or plain) then <address>, or a bare address.
_ADDRESS = re.compile(
    r'\s*(?:"(?P<quoted>(?:[^"\\]|\\.)*)"\s*|(?P<plain>[^",;<>]*?)\s*)?<(?P<angle>[^<>@\s]+@[^<>\s]+)>'
    r'|\s*(?P<bare>[^\s"<>,;]+@[^\s"<>,;]+)')


def _addresses(text: str) -> list[str] | None:
    """The addresses of an e-mail address list, kept as written ("Dupont, Jean" <j@x.fr> stays one).

    None when the text is not only addresses (and their separators)."""
    items: list[str] = []
    position = 0
    for match in _ADDRESS.finditer(text):
        between = text[position:match.start()]
        if between.strip(" \t\r\n,;"):
            return None
        position = match.end()
        address = match.group("angle") or match.group("bare")
        name = match.group("quoted") if match.group("quoted") is not None else (match.group("plain") or "")
        name = name.replace('\\"', '"').strip()
        items.append(f"{name} <{address}>" if name else address)
    if text[position:].strip(" \t\r\n,;") or not items:
        return None
    return items


def _split_text(text: str, delimiters: tuple[str, ...] | list[str]) -> list[str]:
    parts = [text]
    for delimiter in delimiters:
        parts = [piece for part in parts for piece in part.split(delimiter)]
    return [part.strip() for part in parts if part.strip()]


def split_value(value: Any, setting: dict[str, Any]) -> list[Any]:
    """The items of one value. A list (in the record, or as JSON text) gives its elements; a text gives
    its addresses, lines or the pieces between delimiters; empty items are dropped."""
    split = setting.get("split") or "auto"
    path = setting.get("path")
    if value is None:
        return []
    items: list[Any] | None = None
    if split in ("auto", "list"):
        data = value if isinstance(value, (list, dict)) else _parse_json(value) if isinstance(value, str) else None
        found = _at_path(data, path) if data is not None else None
        if isinstance(found, list):
            items = found
        elif split == "list":
            # Not a list: one value is one item (an object at the path, or the text itself).
            items = [found] if found is not None else ([value] if not path else [])
    if items is None:
        text = value if isinstance(value, str) else str(value)
        if split == "lines":
            items = _split_text(text, ("\n",))
        elif split == "delimiters":
            items = _split_text(text, setting.get("delimiters") or DEFAULT_DELIMITERS)
        elif split == "emails":
            items = _addresses(text) or _split_text(text, ("\n", ";", ","))
        else:
            items = _addresses(text) or (_split_text(text, ("\n",)) if "\n" in text.strip()
                                         else _split_text(text, DEFAULT_DELIMITERS))
    kept: list[Any] = []
    for item in items:
        if item is None or (isinstance(item, str) and not item.strip()):
            continue
        kept.append(item.strip() if isinstance(item, str) else item)
    return kept


def _item_text(item: Any) -> str:
    if isinstance(item, str):
        return item[:MAX_ITEM_TEXT]
    if isinstance(item, (int, float, bool)):
        return str(item)
    return json.dumps(item, ensure_ascii=False, sort_keys=True)[:MAX_ITEM_TEXT]


def item_attributes(item: Any) -> dict[str, Any]:
    """``@item`` (the item as text) and, for an object, one ``@item.path`` per value inside it."""
    attributes: dict[str, Any] = {ITEM: _item_text(item)}

    def walk(value: Any, prefix: str, depth: int) -> None:
        for key, inner in value.items():
            name = f"{prefix}{key}"
            if isinstance(inner, dict) and depth < MAX_DEPTH:
                walk(inner, f"{name}.", depth + 1)
            elif inner is not None:
                attributes[name] = inner if isinstance(inner, (str, int, float, bool)) else _item_text(inner)

    if isinstance(item, dict):
        walk(item, ITEM_PREFIX, 1)
    return attributes


def expand_entities(entities: list[dict], setting: dict[str, Any] | None) -> tuple[list[dict], list[dict]]:
    """One item record per item of the expanded field of each source record, and the gaps.

    An item record has the id ``<source id>#<n>``, the source record's fields plus the item's, and names
    its source record in ``parentEntityId`` so evidence still points at the source record's field.
    """
    if not setting:
        return entities, []
    from .derived import _source_value

    limit = setting.get("maxItems") or MAX_ITEMS
    out: list[dict] = []
    gaps: list[dict] = []
    for entity in sorted(entities, key=lambda item: item["entityId"]):
        items = split_value(_source_value(entity, setting["field"]), setting)
        if len(items) > limit:
            gaps.append({"kind": "expand_cap", "rowNumber": None, "field": setting["field"],
                         "detail": f"{entity.get('label') or entity['entityId']} lists {len(items)} items; the first {limit} are read",
                         "values": {"record": entity.get("label") or entity["entityId"], "count": len(items), "limit": limit}})
            items = items[:limit]
        for index, item in enumerate(items, start=1):
            out.append({**entity, "entityId": f"{entity['entityId']}#{index}", "parentEntityId": entity["entityId"],
                        "itemIndex": index,
                        "attributes": {**(entity.get("attributes") or {}), **item_attributes(item)}})
    return out, gaps


def item_paths(entities: list[dict], setting: dict[str, Any], limit: int = 50) -> list[str]:
    """The ``@item…`` fields the items of these records offer, most common first (for a field picker)."""
    from .derived import _source_value

    counts: dict[str, int] = {}
    for entity in entities[:200]:
        for item in split_value(_source_value(entity, setting["field"]), setting)[:20]:
            for name in item_attributes(item):
                counts[name] = counts.get(name, 0) + 1
    return [name for name, _count in sorted(counts.items(), key=lambda pair: (pair[0] != ITEM, -pair[1], pair[0]))][:limit]
