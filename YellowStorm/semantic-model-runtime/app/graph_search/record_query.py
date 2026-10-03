"""Filter, count and group the records of one concept in one pinned data revision.

The caller (an assistant, through NestJS) plans the query; nothing here
interprets language. ``compile_query`` checks every part of the request
against the revision's specification (concepts, allowed fields, relations)
and the model's field definitions sent by NestJS (labels, aliases, types),
and turns it into SQL whose only interpolated parts are constants and
generated column names: field keys, values and ids are bound parameters.
A request that names something the model does not hold comes back as
structured errors, part by part, so the assistant can correct itself.

Values are stored as text; a comparison, a grouping or a sum reads them with
the field's declared type (``typed_value_sql``). A value that cannot be read
is left out of that comparison and counted in ``unparsable``.

Records hidden from the actor (read from a workspace they cannot open) are
excluded in SQL, before counting and paging, so totals are right.
"""

from __future__ import annotations

import calendar
import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any

from .documents import humanize
from .typed_values import fold, fold_sql, is_blank_sql, parse_boolean, parse_number, typed_value_sql

OPS = ("eq", "ne", "contains", "starts_with", "ends_with", "in", "gt", "gte", "lt", "lte", "between",
       "is_empty", "not_empty")
TEXT_OPS = {"contains", "starts_with", "ends_with"}
ORDER_OPS = {"gt", "gte", "lt", "lte", "between"}
NO_VALUE_OPS = {"is_empty", "not_empty"}
AGGREGATE_OPS = ("count", "count_distinct", "sum", "avg", "min", "max")
BUCKETS = ("day", "week", "month", "quarter", "year")
TYPES = ("text", "number", "boolean", "date", "enum")
CASTS = ("text", "number", "boolean", "date")

MAX_FILTERS = 20
MAX_GROUP_BY = 2
MAX_AGGREGATES = 10
MAX_ORDER_BY = 3
MAX_FIELDS = 60
MAX_IN_VALUES = 100
MAX_VALUE_CHARS = 500
MAX_LIMIT = 200
MAX_OFFSET = 100_000
MAX_BUCKETS = 500
VALUE_CHARS = 1500
PAGE_CHARS = 600_000
STATEMENT_TIMEOUT = "10s"
CLIENT_TIMEOUT_SECONDS = 12

NAME_FIELD = "name"

_RELATIVE = re.compile(
    r"^(?:(?P<day>today|yesterday)|(?P<period>this|last)_(?P<unit>week|month|quarter|year)"
    r"|last_(?P<count>\d{1,4})_(?P<units>days?|weeks?|months?|years?))$")
_ISO_DAY = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")
_ISO_MONTH = re.compile(r"^(\d{4})-(\d{1,2})$")
_ISO_YEAR = re.compile(r"^(\d{4})$")
_DMY = re.compile(r"^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$")
_BUCKET_FORMATS = {"day": "YYYY-MM-DD", "week": 'IYYY-"W"IW', "month": "YYYY-MM",
                   "quarter": 'YYYY-"Q"Q', "year": "YYYY"}


@dataclass(frozen=True)
class Field:
    key: str
    label: str
    type: str
    aliases: tuple[str, ...] = ()
    identity: bool = False  # a key component: its value may live in identity_key only
    special: str | None = None  # "name": the record's name (entities.label)

    def public(self) -> dict[str, Any]:
        return {"key": self.key, "label": self.label, "type": self.type}


@dataclass
class Concept:
    concept_id: str
    key: str
    label: str
    fields: list[Field]
    by_name: dict[str, Field]


@dataclass(frozen=True)
class Relation:
    relation_id: str
    key: str
    label: str
    direction: str  # from the queried concept: outgoing (it is the source) or incoming
    other: Concept


@dataclass
class Plan:
    """A checked query: SQL pieces and their parameters, plus what to echo back."""
    concept: Concept
    params: list[Any]
    raw_columns: list[str]
    typed_columns: list[str]
    where: str
    applied: dict[str, Any]
    unparsable: list[tuple[str, int]]  # (field key, column index) read with a type
    group: list[dict[str, Any]] = field(default_factory=list)
    aggregates: list[dict[str, Any]] = field(default_factory=list)
    order: list[str] = field(default_factory=list)
    fields: list[Field] = field(default_factory=list)
    limit: int = 50
    offset: int = 0


class _Errors:
    def __init__(self) -> None:
        self.items: list[dict[str, Any]] = []

    def add(self, part: str, reason: str, message: str, **extra: Any) -> None:
        self.items.append({"code": "invalid_query", "part": part, "reason": reason, "message": message,
                           **{key: value for key, value in extra.items() if value is not None}})


# Model definitions -------------------------------------------------------------------------


def build_concept(compiled_concept: dict[str, Any], catalog_concept: dict[str, Any] | None) -> Concept:
    """The fields a query may name: the revision's allowed fields (and key components), with
    the labels, aliases and types NestJS sent; a field without a definition is plain text."""
    catalog_concept = catalog_concept or {}
    defined = {item.get("key"): item for item in catalog_concept.get("fields") or [] if item.get("key")}
    key_components = list(compiled_concept.get("keyComponents") or [])
    allowed = list(dict.fromkeys(list(compiled_concept.get("allowedFields") or []) + key_components))
    ordered = [key for key in defined if key in allowed] + [key for key in allowed if key not in defined]
    spec_aliases = compiled_concept.get("fieldAliases") or {}
    fields = []
    for key in ordered:
        definition = defined.get(key) or {}
        kind = definition.get("type") if definition.get("type") in TYPES else "text"
        aliases = tuple(dict.fromkeys([*(definition.get("aliases") or []), *(spec_aliases.get(key) or [])]))
        fields.append(Field(key=key, label=definition.get("label") or humanize(key), type=kind,
                            aliases=aliases, identity=key in key_components))
    by_name: dict[str, Field] = {}
    # Keys win over labels, labels over aliases, so a name always means one field.
    for names in ((lambda f: [f.key]), (lambda f: [f.label]), (lambda f: list(f.aliases))):
        for item in fields:
            for name in names(item):
                by_name.setdefault(fold(name), item)
    name_field = Field(key=NAME_FIELD, label="Name", type="text", special="name")
    by_name.setdefault(NAME_FIELD, name_field)
    by_name["_name"] = name_field
    return Concept(concept_id=compiled_concept["conceptId"], key=compiled_concept.get("key", ""),
                   label=catalog_concept.get("label") or compiled_concept.get("label", ""),
                   fields=fields, by_name=by_name)


def _catalog_concept(catalog: dict[str, Any], key: str) -> dict[str, Any] | None:
    return next((item for item in catalog.get("concepts") or [] if item.get("key") == key), None)


def find_concept(compiled: dict[str, Any], catalog: dict[str, Any], name: str) -> Concept | None:
    wanted = fold(name)
    for concept in compiled["concepts"].values():
        entry = _catalog_concept(catalog, concept.get("key", "")) or {}
        names = {fold(concept["conceptId"]), fold(concept.get("key")), fold(concept.get("label")),
                 fold(entry.get("label"))}
        names |= {fold(alias) for alias in [*(concept.get("aliases") or []), *(entry.get("aliases") or [])]}
        if wanted in names:
            return build_concept(concept, entry)
    return None


def concept_names(compiled: dict[str, Any], catalog: dict[str, Any]) -> list[str]:
    return [(_catalog_concept(catalog, c.get("key", "")) or {}).get("label") or c.get("label") or c.get("key", "")
            for c in compiled["concepts"].values()]


def find_relation(compiled: dict[str, Any], catalog: dict[str, Any], concept: Concept, name: str) -> Relation | None:
    """A relation of the concept named by id, key, label or inverse label, read from the
    concept's side: its label goes from source to target, its inverse label back."""
    wanted = fold(name)
    labels = {item.get("key"): item for item in catalog.get("relations") or [] if item.get("key")}
    for relation in compiled["relations"].values():
        source, target = relation["sourceConceptId"], relation["targetConceptId"]
        if concept.concept_id not in (source, target):
            continue
        entry = labels.get(relation.get("key")) or {}
        forward = wanted in {fold(relation["relationId"]), fold(relation.get("key")), fold(entry.get("label"))}
        backward = bool(entry.get("inverseLabel")) and wanted == fold(entry.get("inverseLabel"))
        if not (forward or backward):
            continue
        if source == target:
            direction = "incoming" if backward and not forward else "outgoing"
        else:
            direction = "outgoing" if concept.concept_id == source else "incoming"
        other_id = target if direction == "outgoing" else source
        other = compiled["concepts"].get(other_id)
        if other is None:
            return None
        return Relation(relation_id=relation["relationId"], key=relation.get("key", ""),
                        label=entry.get("label") or relation.get("key", ""), direction=direction,
                        other=build_concept(other, _catalog_concept(catalog, other.get("key", ""))))
    return None


# Dates -------------------------------------------------------------------------------------


def _add_months(day: date, months: int) -> date:
    index = day.month - 1 + months
    year, month = day.year + index // 12, index % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def _period_start(day: date, unit: str) -> date:
    if unit == "week":
        return day - timedelta(days=day.weekday())
    if unit == "month":
        return day.replace(day=1)
    if unit == "quarter":
        return date(day.year, 3 * ((day.month - 1) // 3) + 1, 1)
    return date(day.year, 1, 1)


def _next_period(start: date, unit: str, count: int = 1) -> date:
    if unit == "week":
        return start + timedelta(weeks=count)
    if unit == "month":
        return _add_months(start, count)
    if unit == "quarter":
        return _add_months(start, 3 * count)
    return _add_months(start, 12 * count)


def _midnight(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=timezone.utc)


def resolve_date(value: Any, now: datetime) -> tuple[datetime, datetime, str] | None:
    """A date given in a query as a half-open UTC range [start, end): a day, a month or a
    year covers all of it, an instant is itself. Relative tokens are read against ``now``:
    today, yesterday, this_/last_ week|month|quarter|year (calendar periods, weeks from
    Monday), last_N_days|weeks|months|years (N units up to and including today)."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    token = re.sub(r"[\s-]+", "_", fold(text))
    today = now.astimezone(timezone.utc).date()
    match = _RELATIVE.match(token)
    if match:
        if match["day"]:
            day = today if match["day"] == "today" else today - timedelta(days=1)
            start, end = day, day + timedelta(days=1)
        elif match["period"]:
            unit = match["unit"]
            current = _period_start(today, unit)
            start = current if match["period"] == "this" else _next_period(current, unit, -1)
            end = _next_period(start, unit)
        else:
            count, unit = int(match["count"]), match["units"].rstrip("s")
            if not 1 <= count <= 1000:
                return None
            end = today + timedelta(days=1)
            start = (today - timedelta(days=count - 1) if unit == "day"
                     else today - timedelta(weeks=count) + timedelta(days=1) if unit == "week"
                     else _add_months(today, -count * (12 if unit == "year" else 1)) + timedelta(days=1))
        return _midnight(start), _midnight(end), token
    try:
        for pattern, unit in ((_ISO_DAY, "day"), (_DMY, "dmy"), (_ISO_MONTH, "month"), (_ISO_YEAR, "year")):
            found = pattern.match(text)
            if not found:
                continue
            if unit == "day":
                start = date(int(found[1]), int(found[2]), int(found[3]))
                return _midnight(start), _midnight(start + timedelta(days=1)), start.isoformat()
            if unit == "dmy":
                start = date(int(found[3]), int(found[2]), int(found[1]))
                return _midnight(start), _midnight(start + timedelta(days=1)), start.isoformat()
            if unit == "month":
                start = date(int(found[1]), int(found[2]), 1)
                return _midnight(start), _midnight(_add_months(start, 1)), start.isoformat()[:7]
            start = date(int(found[1]), 1, 1)
            return _midnight(start), _midnight(_add_months(start, 12)), str(start.year)
        instant = datetime.fromisoformat(text.replace("z", "Z"))
    except ValueError:
        return None
    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=timezone.utc)
    return instant, instant + timedelta(microseconds=1), instant.astimezone(timezone.utc).isoformat()


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


# Compilation -------------------------------------------------------------------------------


class _Builder:
    """Parameters ($1.. $4 are fixed: model, revision, concept, allowed workspaces) and the
    typed columns of the concept's own fields."""

    def __init__(self, model_id: str, revision_id: str, concept: Concept, allowed: list[str] | None) -> None:
        self.params: list[Any] = [model_id, revision_id, concept.concept_id, allowed]
        self.columns: dict[tuple[str, str], int] = {}
        self.raw: list[str] = []
        self.typed: list[str] = []

    def bind(self, value: Any) -> str:
        self.params.append(value)
        return f"${len(self.params)}"

    def raw_sql(self, item: Field, alias: str) -> str:
        if item.special == "name":
            return f"{alias}.label"
        key = self.bind(item.key)
        if item.identity:
            return f"COALESCE({alias}.attributes ->> {key}::text, ({alias}.identity_key::jsonb) ->> {key}::text)"
        return f"({alias}.attributes ->> {key}::text)"

    def column(self, item: Field, kind: str) -> int:
        """Index i of columns r{i} (raw text) and t{i} (read as ``kind``) for a field of the concept."""
        slot = (item.key if item.special is None else f"\0{item.special}", kind)
        if slot not in self.columns:
            index = len(self.raw)
            self.columns[slot] = index
            self.raw.append(f"{self.raw_sql(item, 'e')} AS r{index}")
            self.typed.append(f"{typed_value_sql(kind, f'r{index}')} AS t{index}")
        return self.columns[slot]


def _kind(item: Field, cast: str | None) -> str:
    if cast:
        return cast
    return "text" if item.type in ("text", "enum") else item.type


def _scalar(value: Any) -> bool:
    return isinstance(value, (str, int, float, bool)) and not (isinstance(value, str) and len(value) > MAX_VALUE_CHARS)


def _condition(builder: _Builder, errors: _Errors, part: str, op: str, kind: str, raw: str, typed: str,
               value: Any, now: datetime, echo: dict[str, Any]) -> str | None:
    """SQL for one comparison on a value whose text is ``raw`` and typed reading is ``typed``."""
    if op == "is_empty":
        return is_blank_sql(raw)
    if op == "not_empty":
        return f"NOT {is_blank_sql(raw)}"
    if op in TEXT_OPS:
        if not isinstance(value, str) or not value.strip() or len(value) > MAX_VALUE_CHARS:
            errors.add(f"{part}.value", "invalid_value", f"{op} needs a non-empty text value")
            return None
        folded = fold(value)
        echo["value"] = value
        text = typed if kind == "text" else fold_sql(raw)
        bound = builder.bind(folded)
        if op == "contains":
            return f"strpos({text}, {bound}::text) > 0"
        if op == "starts_with":
            return f"starts_with({text}, {bound}::text)"
        return f"right({text}, char_length({bound}::text)) = {bound}::text"
    if op in ORDER_OPS and kind in ("text", "boolean"):
        errors.add(f"{part}.op", "unsupported_op",
                   f"{op} compares numbers or dates, and this field is {kind}: use eq, in or contains, or "
                   "add \"as\": \"date\" or \"number\" if its values are dates or numbers")
        return None
    if op == "in":
        if not isinstance(value, list) or not 1 <= len(value) <= MAX_IN_VALUES or not all(map(_scalar, value)):
            errors.add(f"{part}.value", "invalid_value", f"in needs a list of 1 to {MAX_IN_VALUES} values")
            return None
        if kind == "date":
            errors.add(f"{part}.op", "unsupported_op", "in is not available on dates: use between, or eq for one day")
            return None
        values = [_typed(kind, item) for item in value]
        if any(item is None for item in values):
            errors.add(f"{part}.value", "invalid_value", f"every value of in must be a {kind}")
            return None
        echo["value"] = value
        array = {"text": "text[]", "number": "numeric[]", "boolean": "boolean[]"}[kind]
        return f"{typed} = ANY({builder.bind(values)}::{array})"
    if kind == "date":
        if op == "between" and isinstance(value, list):
            if len(value) != 2:
                errors.add(f"{part}.value", "invalid_value", "between needs [from, to] or one relative period")
                return None
            low, high = resolve_date(value[0], now), resolve_date(value[1], now)
            if low is None or high is None:
                errors.add(f"{part}.value", "invalid_date",
                           "between needs two dates (YYYY-MM-DD, YYYY-MM, YYYY or a relative period)")
                return None
            start, end = low[0], high[1]
        else:
            resolved = resolve_date(value, now)
            if resolved is None:
                errors.add(f"{part}.value", "invalid_date",
                           "Use an ISO date (YYYY-MM-DD, YYYY-MM, YYYY, or a date and time) or a relative period: "
                           "today, yesterday, this_week|month|quarter|year, last_week|month|quarter|year, "
                           "last_N_days|weeks|months|years")
                return None
            start, end = resolved[0], resolved[1]
        if end <= start:
            errors.add(f"{part}.value", "invalid_range", "the range ends before it starts")
            return None
        echo["value"] = value
        echo["range"] = {"from": _iso(start), "to": _iso(end), "toExclusive": True}
        # Bind only what the comparison uses: an unused parameter is an error in Postgres.
        if op in ("gt", "lte"):
            return f"{typed} {'>=' if op == 'gt' else '<'} {builder.bind(end)}::timestamptz"
        if op in ("gte", "lt"):
            return f"{typed} {'>=' if op == 'gte' else '<'} {builder.bind(start)}::timestamptz"
        inside = (f"({typed} >= {builder.bind(start)}::timestamptz AND "
                  f"{typed} < {builder.bind(end)}::timestamptz)")
        return inside if op in ("eq", "between") else f"({is_blank_sql(raw)} OR NOT {inside})"
    if op == "between":
        if not isinstance(value, list) or len(value) != 2:
            errors.add(f"{part}.value", "invalid_value", "between needs [from, to]")
            return None
        low_value, high_value = _typed(kind, value[0]), _typed(kind, value[1])
        if low_value is None or high_value is None:
            errors.add(f"{part}.value", "invalid_value", f"between needs two {kind}s")
            return None
        echo["value"] = value
        return f"{typed} BETWEEN {builder.bind(low_value)}::numeric AND {builder.bind(high_value)}::numeric"
    if not _scalar(value) or isinstance(value, list):
        errors.add(f"{part}.value", "invalid_value", f"{op} needs one value")
        return None
    typed_value = _typed(kind, value)
    if typed_value is None:
        errors.add(f"{part}.value", "invalid_value", f"{value!r} is not a {kind}")
        return None
    echo["value"] = value
    cast = {"text": "text", "number": "numeric", "boolean": "boolean"}[kind]
    bound = f"{builder.bind(typed_value)}::{cast}"
    if op == "eq":
        return f"{typed} = {bound}"
    if op == "ne":
        # An empty value differs from any value; a value that cannot be read is left out.
        return f"({is_blank_sql(raw)} OR {typed} <> {bound})"
    return f"{typed} {dict(gt='>', gte='>=', lt='<', lte='<=')[op]} {bound}"


def _typed(kind: str, value: Any) -> Any:
    if kind == "number":
        return parse_number(value)
    if kind == "boolean":
        return parse_boolean(value)
    if isinstance(value, bool) or not _scalar(value):
        return None
    return fold(str(value))


def _visible(alias: str, allowed: str = "$4") -> str:
    """Every workspace the record was read from is readable (manual records have none)."""
    sources = (f"CASE WHEN jsonb_typeof({alias}.provenance -> 'sources') = 'array' "
               f"THEN {alias}.provenance -> 'sources' ELSE '[]'::jsonb END")
    return (f"({allowed}::text[] IS NULL OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements({sources}) AS src(item) "
            "WHERE COALESCE(src.item -> 'assetRef' ->> 'workspaceId', '') <> '' "
            f"AND NOT ((src.item -> 'assetRef' ->> 'workspaceId') = ANY({allowed}::text[]))))")


def _resolve_field(compiled: dict[str, Any], catalog: dict[str, Any], concept: Concept, name: Any
                   ) -> tuple[Field | None, Relation | None]:
    """A field of the concept, or ``<relation>.<field>``: a field of the records linked to it."""
    if not isinstance(name, str) or not name.strip():
        return None, None
    item = concept.by_name.get(fold(name))
    if item is not None:
        return item, None
    for index, char in enumerate(name):
        if char != ".":
            continue
        relation = find_relation(compiled, catalog, concept, name[:index])
        if relation is not None:
            linked = relation.other.by_name.get(fold(name[index + 1:]))
            if linked is not None:
                return linked, relation
    return None, None


def _field_suggestions(concept: Concept) -> list[str]:
    return [item.label for item in concept.fields][:40]


def _compile_filter(builder: _Builder, errors: _Errors, compiled: dict[str, Any], catalog: dict[str, Any],
                    concept: Concept, index: int, spec: dict[str, Any], now: datetime,
                    unparsable: dict[str, int]) -> tuple[str | None, dict[str, Any]]:
    part = f"filters[{index}]"
    op = spec.get("op")
    name = spec.get("field")
    echo: dict[str, Any] = {"field": name, "op": op}
    if op not in OPS:
        errors.add(f"{part}.op", "unknown_op", f"op must be one of: {', '.join(OPS)}", value=op)
        return None, echo
    cast = spec.get("as")
    if cast is not None and cast not in CASTS:
        errors.add(f"{part}.as", "unknown_type", f"as must be one of: {', '.join(CASTS)}", value=cast)
        return None, echo
    item, relation = _resolve_field(compiled, catalog, concept, name)
    if item is None:
        whole = find_relation(compiled, catalog, concept, name) if isinstance(name, str) else None
        if whole is not None and op in NO_VALUE_OPS:
            # "relation" not_empty / is_empty: has (or has no) linked record through it.
            echo.update(relation=whole.key, direction=whole.direction, field=None)
            exists = _related_exists(builder, whole, None)
            return (exists if op == "not_empty" else f"NOT {exists}"), echo
        errors.add(f"{part}.field", "unknown_field",
                   f"{concept.label} has no field {name!r}; for a linked record's field write "
                   "<relation>.<field>", value=name, available=_field_suggestions(concept))
        return None, echo
    kind = _kind(item, cast)
    echo.update(field=item.key, fieldLabel=item.label, type=kind)
    if relation is not None:
        echo.update(relation=relation.key, relationLabel=relation.label, direction=relation.direction,
                    linkedConcept=relation.other.label)
        alias = "o"
        raw = builder.raw_sql(item, alias)
        condition = _condition(builder, errors, part, op, kind, raw, typed_value_sql(kind, raw), spec.get("value"),
                               now, echo)
        return (_related_exists(builder, relation, condition) if condition else None), echo
    column = builder.column(item, kind)
    if kind != "text" and op not in NO_VALUE_OPS:
        unparsable[item.key] = column
    condition = _condition(builder, errors, part, op, kind, f"r{column}", f"t{column}", spec.get("value"), now, echo)
    return condition, echo


def _related_exists(builder: _Builder, relation: Relation, condition: str | None) -> str:
    own, other = ("source_entity_id", "target_entity_id") if relation.direction == "outgoing" \
        else ("target_entity_id", "source_entity_id")
    rel, concept = builder.bind(relation.relation_id), builder.bind(relation.other.concept_id)
    return ("EXISTS (SELECT 1 FROM semantic_population.relationships rel "
            "JOIN semantic_population.entities o ON o.data_revision_id = rel.data_revision_id "
            f"AND o.id = rel.{other} "
            f"WHERE rel.data_revision_id = $2 AND rel.relation_id = {rel}::text AND rel.state = 'accepted' "
            f"AND rel.{own} = typed.id AND o.concept_id = {concept}::text AND {_visible('o')}"
            + (f" AND {condition}" if condition else "") + ")")


def _local_field(errors: _Errors, concept: Concept, part: str, name: Any, compiled: dict[str, Any],
                 catalog: dict[str, Any]) -> Field | None:
    item, relation = _resolve_field(compiled, catalog, concept, name)
    if relation is not None:
        errors.add(part, "unsupported_field", "Grouping, totals and sorting use the concept's own fields; "
                   "a linked record's field is only available in filters", value=name)
        return None
    if item is None:
        errors.add(part, "unknown_field", f"{concept.label} has no field {name!r}", value=name,
                   available=_field_suggestions(concept))
    return item


def compile_query(compiled: dict[str, Any], catalog: dict[str, Any], request: dict[str, Any], *,
                  model_id: str, revision_id: str, allowed_workspaces: list[str] | None,
                  now: datetime) -> tuple[Plan | None, list[dict[str, Any]], dict[str, Any]]:
    """(plan, errors, applied query). With errors there is no plan; an unknown concept gives a
    single ``unknown_concept`` error."""
    errors = _Errors()
    applied: dict[str, Any] = {"concept": request.get("concept"), "timezone": "UTC", "now": _iso(now)}
    concept = find_concept(compiled, catalog, str(request.get("concept") or ""))
    if concept is None:
        errors.add("concept", "unknown_concept", f"The model has no concept {request.get('concept')!r}",
                   value=request.get("concept"), available=concept_names(compiled, catalog))
        return None, errors.items, applied
    applied["concept"] = {"key": concept.key, "label": concept.label}
    builder = _Builder(model_id, revision_id, concept, allowed_workspaces)
    unparsable: dict[str, int] = {}

    filters = request.get("filters") or []
    match = request.get("match") or "all"
    if match not in ("all", "any"):
        errors.add("match", "invalid_value", "match must be all or any", value=match)
    if len(filters) > MAX_FILTERS:
        errors.add("filters", "too_many", f"At most {MAX_FILTERS} filters")
        filters = filters[:MAX_FILTERS]
    conditions, echoed = [], []
    for index, spec in enumerate(filters):
        condition, echo = _compile_filter(builder, errors, compiled, catalog, concept, index, spec, now, unparsable)
        echoed.append(echo)
        if condition:
            conditions.append(f"({condition})")
    applied.update(filters=echoed, match=match)
    where = (" AND " if match == "all" else " OR ").join(conditions) if conditions else "true"

    group_specs = request.get("groupBy") or []
    if len(group_specs) > MAX_GROUP_BY:
        errors.add("groupBy", "too_many", f"Group by at most {MAX_GROUP_BY} fields")
        group_specs = group_specs[:MAX_GROUP_BY]
    groups: list[dict[str, Any]] = []
    for index, spec in enumerate(group_specs):
        part = f"groupBy[{index}]"
        spec = {"field": spec} if isinstance(spec, str) else spec
        cast, bucket = spec.get("as"), spec.get("bucket")
        if cast is not None and cast not in CASTS:
            errors.add(f"{part}.as", "unknown_type", f"as must be one of: {', '.join(CASTS)}", value=cast)
            continue
        item = _local_field(errors, concept, f"{part}.field", spec.get("field"), compiled, catalog)
        if item is None:
            continue
        kind = _kind(item, cast)
        if bucket is not None and (bucket not in BUCKETS or kind != "date"):
            errors.add(f"{part}.bucket", "invalid_bucket",
                       f"bucket ({', '.join(BUCKETS)}) applies to date fields only" if bucket in BUCKETS
                       else f"bucket must be one of: {', '.join(BUCKETS)}", value=bucket)
            continue
        if kind == "date":
            bucket = bucket or "day"
        column = builder.column(item, kind)
        if kind != "text":
            unparsable[item.key] = column
        name = f"{item.key}:{bucket}" if bucket else item.key
        if kind == "date":
            key_sql = f"to_char(t{column}, '{_BUCKET_FORMATS[bucket]}')"
            label_sql = key_sql
        elif kind == "text":
            # Grouped accent- and case-blind, shown as written most often.
            key_sql, label_sql = f"t{column}", f"mode() WITHIN GROUP (ORDER BY btrim(r{column}))"
        else:
            key_sql = label_sql = f"t{column}"
        groups.append({"name": name, "field": item.key, "label": item.label, "type": kind, "bucket": bucket,
                       "key": key_sql, "display": label_sql})
    applied["groupBy"] = [{"name": g["name"], "field": g["field"], "label": g["label"], "type": g["type"],
                           **({"bucket": g["bucket"]} if g["bucket"] else {})} for g in groups]

    aggregate_specs = request.get("aggregates") or ([{"op": "count"}] if group_specs else [])
    if len(aggregate_specs) > MAX_AGGREGATES:
        errors.add("aggregates", "too_many", f"At most {MAX_AGGREGATES} aggregates")
        aggregate_specs = aggregate_specs[:MAX_AGGREGATES]
    aggregates: list[dict[str, Any]] = []
    for index, spec in enumerate(aggregate_specs):
        part = f"aggregates[{index}]"
        op = spec.get("op")
        if op not in AGGREGATE_OPS:
            errors.add(f"{part}.op", "unknown_op", f"op must be one of: {', '.join(AGGREGATE_OPS)}", value=op)
            continue
        if op == "count":
            if spec.get("field"):
                errors.add(f"{part}.field", "invalid_value",
                           "count counts records; use count_distinct to count the different values of a field")
                continue
            aggregates.append({"name": "count", "op": "count", "sql": "count(*)", "type": "number"})
            continue
        cast = spec.get("as")
        if cast is not None and cast not in CASTS:
            errors.add(f"{part}.as", "unknown_type", f"as must be one of: {', '.join(CASTS)}", value=cast)
            continue
        if not spec.get("field"):
            errors.add(f"{part}.field", "missing_field", f"{op} needs a field")
            continue
        item = _local_field(errors, concept, f"{part}.field", spec.get("field"), compiled, catalog)
        if item is None:
            continue
        kind = _kind(item, cast)
        if op in ("sum", "avg") and kind != "number":
            errors.add(f"{part}.op", "unsupported_op", f"{op} needs a number field; {item.label} is {kind} "
                       "(add \"as\": \"number\" if its values are numbers)")
            continue
        column = builder.column(item, kind)
        if kind != "text":
            unparsable[item.key] = column
        if op in ("min", "max") and kind == "text":
            sql, result_type = f"{op}(btrim(r{column}))", "text"
        elif op == "count_distinct":
            sql, result_type = f"count(DISTINCT t{column})", "number"
        else:
            sql, result_type = f"{op}(t{column})", "number" if op in ("sum", "avg") else kind
        name = f"{op}_{item.key}"
        if any(existing["name"] == name for existing in aggregates):
            continue
        aggregates.append({"name": name, "op": op, "field": item.key, "label": item.label, "sql": sql,
                           "type": result_type})
    applied["aggregates"] = [{key: value for key, value in a.items() if key in ("name", "op", "field", "label")}
                             for a in aggregates]

    order_specs = request.get("orderBy") or []
    if len(order_specs) > MAX_ORDER_BY:
        errors.add("orderBy", "too_many", f"Sort by at most {MAX_ORDER_BY} keys")
        order_specs = order_specs[:MAX_ORDER_BY]
    order: list[str] = []
    applied_order = []
    for index, spec in enumerate(order_specs):
        part = f"orderBy[{index}]"
        spec = {"field": spec} if isinstance(spec, str) else spec
        direction = (spec.get("direction") or "asc").lower()
        if direction not in ("asc", "desc"):
            errors.add(f"{part}.direction", "invalid_value", "direction must be asc or desc", value=direction)
            continue
        target = spec.get("field")
        if groups:
            alias = next((a for a in aggregates if target in (a["name"], f"{a['op']}:{a.get('field')}")
                          or (a["op"] == target and sum(1 for b in aggregates if b["op"] == target) == 1)), None)
            if alias is not None:
                order.append(f"a{aggregates.index(alias)} {direction.upper()} NULLS LAST")
                applied_order.append({"by": alias["name"], "direction": direction})
                continue
            item, _ = _resolve_field(compiled, catalog, concept, target)
            group = next((g for g in groups if item is not None and g["field"] == item.key), None)
            if group is None:
                errors.add(f"{part}.field", "unknown_order",
                           "With groupBy, sort by a grouped field or an aggregate name: "
                           + ", ".join([g["name"] for g in groups] + [a["name"] for a in aggregates]), value=target)
                continue
            order.append(f"g{groups.index(group)} {direction.upper()} NULLS LAST")
            applied_order.append({"by": group["name"], "direction": direction})
            continue
        item = _local_field(errors, concept, f"{part}.field", target, compiled, catalog)
        if item is None:
            continue
        kind = _kind(item, spec.get("as") if spec.get("as") in CASTS else None)
        column = builder.column(item, kind)
        order.append(f"t{column} {direction.upper()} NULLS LAST")
        applied_order.append({"by": item.key, "direction": direction})
    if groups and not order:
        if groups[0]["type"] == "date":
            order = [f"g{i} ASC NULLS LAST" for i in range(len(groups))]
            applied_order = [{"by": g["name"], "direction": "asc"} for g in groups]
        elif aggregates:
            order = ["a0 DESC NULLS LAST"] + [f"g{i} ASC NULLS LAST" for i in range(len(groups))]
            applied_order = [{"by": aggregates[0]["name"], "direction": "desc"}]
    if not groups:
        if not order:
            name_column = builder.column(concept.by_name["_name"], "text")
            order = [f"t{name_column} ASC NULLS LAST"]
            applied_order = [{"by": NAME_FIELD, "direction": "asc"}]
        order.append("id ASC")
    elif not order:
        order = [f"g{i} ASC NULLS LAST" for i in range(len(groups))]
    applied["orderBy"] = applied_order

    field_specs = request.get("fields")
    returned: list[Field] = []
    if field_specs:
        if len(field_specs) > MAX_FIELDS:
            errors.add("fields", "too_many", f"At most {MAX_FIELDS} fields")
        for index, name in enumerate(field_specs[:MAX_FIELDS]):
            item = _local_field(errors, concept, f"fields[{index}]", name, compiled, catalog)
            if item is not None and item.special is None and item not in returned:
                returned.append(item)
    else:
        returned = list(concept.fields)
    limit = request.get("limit", 50)
    offset = request.get("offset", 0)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 0 <= limit <= MAX_LIMIT:
        errors.add("limit", "invalid_value", f"limit must be a whole number from 0 to {MAX_LIMIT}", value=limit)
        limit = 50
    if isinstance(offset, bool) or not isinstance(offset, int) or not 0 <= offset <= MAX_OFFSET:
        errors.add("offset", "invalid_value", f"offset must be a whole number from 0 to {MAX_OFFSET}", value=offset)
        offset = 0
    applied.update(limit=limit, offset=offset)
    if not groups and limit and not errors.items:
        applied["fields"] = [{"key": item.key, "label": item.label} for item in returned]

    if errors.items:
        return None, errors.items, applied
    plan = Plan(concept=concept, params=builder.params, raw_columns=builder.raw, typed_columns=builder.typed,
                where=where, applied=applied, unparsable=sorted(unparsable.items()), group=groups,
                aggregates=aggregates, order=order, fields=returned, limit=limit, offset=offset)
    return plan, [], applied


# SQL ---------------------------------------------------------------------------------------


def base_sql(plan: Plan) -> str:
    raw = "".join(f", {column}" for column in plan.raw_columns)
    typed = "".join(f", {column}" for column in plan.typed_columns)
    return ("WITH scoped AS (SELECT e.id, e.label, e.identity_key, e.attributes" + raw +
            " FROM semantic_population.entities e"
            " WHERE e.model_id = $1 AND e.data_revision_id = $2 AND e.concept_id = $3::text AND " + _visible("e") +
            "), typed AS (SELECT scoped.*" + typed + " FROM scoped)"
            ", matched AS MATERIALIZED (SELECT typed.* FROM typed WHERE " + plan.where + ")")


def stats_sql(plan: Plan) -> str:
    unparsable = "".join(f", count(*) FILTER (WHERE NOT {is_blank_sql(f'r{column}')} AND t{column} IS NULL) "
                         f"AS u{position}" for position, (_, column) in enumerate(plan.unparsable))
    aggregates = "" if plan.group else "".join(
        f", (SELECT {aggregate['sql']} FROM matched) AS a{index}" for index, aggregate in enumerate(plan.aggregates))
    return (base_sql(plan) + " SELECT (SELECT count(*) FROM matched) AS total, count(*) AS scoped,"
            " (SELECT count(*) FROM semantic_population.entities x WHERE x.model_id = $1"
            " AND x.data_revision_id = $2 AND x.concept_id = $3::text) AS stored" + unparsable + aggregates +
            " FROM typed")


def records_sql(plan: Plan) -> str:
    limit = len(plan.params) + 1
    return (base_sql(plan) + " SELECT id, label, identity_key, attributes FROM matched ORDER BY "
            + ", ".join(plan.order) + f" LIMIT ${limit} OFFSET ${limit + 1}")


def groups_sql(plan: Plan) -> str:
    limit = len(plan.params) + 1
    keys = ", ".join(f"{group['key']} AS g{index}, {group['display']} AS d{index}"
                     for index, group in enumerate(plan.group))
    aggregates = "".join(f", {aggregate['sql']} AS a{index}" for index, aggregate in enumerate(plan.aggregates))
    group_by = ", ".join(f"g{index}" for index in range(len(plan.group)))
    return (base_sql(plan) + f" SELECT {keys}{aggregates} FROM matched GROUP BY {group_by} ORDER BY "
            + ", ".join(plan.order) + f" LIMIT ${limit}")


# Execution ---------------------------------------------------------------------------------


def _json_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() and abs(value) < 2 ** 53 else float(value)
    if isinstance(value, datetime):
        return _iso(value)
    return value


def _record(row: Any, plan: Plan, budget: list[int]) -> dict[str, Any]:
    attributes = row["attributes"]
    attributes = json.loads(attributes) if isinstance(attributes, str) else dict(attributes or {})
    identity = row["identity_key"]
    try:
        identity = json.loads(identity) if isinstance(identity, str) else dict(identity or {})
    except ValueError:
        identity = {}
    values: dict[str, Any] = {}
    cut: list[str] = []
    for item in plan.fields:
        value = attributes.get(item.key, identity.get(item.key) if item.identity else None)
        if value is None or value == "":
            continue
        if isinstance(value, str) and len(value) > VALUE_CHARS:
            value = value[:VALUE_CHARS].rstrip() + "…"
            cut.append(item.key)
        budget[0] -= len(value) if isinstance(value, str) else len(json.dumps(value, default=str))
        values[item.key] = value
    record = {"entityId": row["id"], "name": row["label"] or "", "keyFields": identity, "values": values}
    if cut:
        record["truncated"] = True
        record["truncatedFields"] = cut
    return record


async def run_query(pool: Any, plan: Plan) -> dict[str, Any]:
    async with pool.acquire() as connection:
        async with connection.transaction(readonly=True):
            await connection.execute(f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'")
            await connection.execute("SET LOCAL TimeZone = 'UTC'")
            stats = await connection.fetchrow(stats_sql(plan), *plan.params, timeout=CLIENT_TIMEOUT_SECONDS)
            rows = []
            if plan.group:
                rows = await connection.fetch(groups_sql(plan), *plan.params, MAX_BUCKETS + 1,
                                              timeout=CLIENT_TIMEOUT_SECONDS)
            elif plan.limit:
                rows = await connection.fetch(records_sql(plan), *plan.params, plan.limit, plan.offset,
                                              timeout=CLIENT_TIMEOUT_SECONDS)
    total = int(stats["total"])
    result: dict[str, Any] = {
        "status": "ok", "concept": {"conceptId": plan.concept.concept_id, "key": plan.concept.key,
                                    "label": plan.concept.label},
        "total": total, "hiddenRecords": int(stats["stored"]) - int(stats["scoped"]),
        "unparsable": {key: int(stats[f"u{position}"]) for position, (key, _) in enumerate(plan.unparsable)
                       if int(stats[f"u{position}"])},
        "appliedQuery": plan.applied,
    }
    if plan.group:
        buckets = []
        for row in rows[:MAX_BUCKETS]:
            bucket = {group["name"]: _json_value(row[f"d{index}"]) for index, group in enumerate(plan.group)}
            bucket.update({aggregate["name"]: _json_value(row[f"a{index}"])
                           for index, aggregate in enumerate(plan.aggregates)})
            buckets.append(bucket)
        result.update(buckets=buckets, bucketsTruncated=len(rows) > MAX_BUCKETS)
        return result
    if plan.aggregates:
        result["aggregates"] = {aggregate["name"]: _json_value(stats[f"a{index}"])
                                for index, aggregate in enumerate(plan.aggregates)}
    budget = [PAGE_CHARS]
    records = []
    for row in rows:
        if budget[0] <= 0:
            break
        records.append(_record(row, plan, budget))
    next_offset = plan.offset + len(records)
    result.update(records=records, returned=len(records), offset=plan.offset,
                  nextOffset=next_offset if next_offset < total and plan.limit else None,
                  pageCutShort=len(records) < len(rows))
    return result


async def overview(pool: Any, *, model_id: str, revision_id: str, allowed_workspaces: list[str] | None
                   ) -> dict[str, dict[str, int]]:
    """Records per concept in the revision: stored, and visible to the actor."""
    async with pool.acquire() as connection:
        async with connection.transaction(readonly=True):
            await connection.execute(f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'")
            rows = await connection.fetch(
                "SELECT e.concept_id, count(*) AS stored, count(*) FILTER (WHERE " + _visible("e", "$3") + ") AS visible"
                " FROM semantic_population.entities e WHERE e.model_id = $1 AND e.data_revision_id = $2"
                " GROUP BY e.concept_id", model_id, revision_id, allowed_workspaces, timeout=CLIENT_TIMEOUT_SECONDS)
    return {row["concept_id"]: {"stored": int(row["stored"]), "visible": int(row["visible"])} for row in rows}
