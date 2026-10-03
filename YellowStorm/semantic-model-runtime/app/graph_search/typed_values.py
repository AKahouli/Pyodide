"""How a stored field value is read as a number, a date or a yes/no.

Population stores every field value as text (``entities.attributes``). A query
that compares or groups by a field reads its text with the field's declared
type, here and only here, so a typed projection table can later reuse exactly
the same rules. Reading never fails: a value that cannot be read gives NULL,
which the caller leaves out of comparisons and counts as unparsable.

What is read (after trimming, lowercasing and removing accents):
- dates: ISO dates and datetimes (``2026-07-27``, ``2026-07-27T09:31:28Z``,
  ``2026/07/27 09:31``), a month or a year alone (``2026-07``, ``2026``: their
  first day), day-first numeric dates (``27/07/2026``, ``27.07.2026``,
  ``27-07-2026``), day-first written dates in French or English with an
  optional weekday, time and zone (``mardi 29 septembre 2026 a 14:07``,
  ``Mon, 27 Jul 2026 09:31:28 +0000`` as in e-mail headers, ``juin 2026``),
  English month-first dates (``July 27, 2026``), and a short label before a
  colon (``Date : 18 juin 2026``). A date without a zone is UTC.
- numbers: spaces and apostrophes inside the number are ignored, a currency
  or unit around it is dropped (``11 200 000 €``, ``8 750 000 EUR hors
  taxes.``, ``12,5 %``); a single comma is a decimal separator (French), as is
  a single dot; repeated commas or dots group thousands; with both, the last
  one is the decimal separator.
- yes/no: true/false, yes/no, oui/non, vrai/faux, 1/0, y/n, o/n.

Everything returned is SQL built from constants around one input
expression; no caller value is ever interpolated.
"""

from __future__ import annotations

import re
import unicodedata
from decimal import Decimal, InvalidOperation

MARKS = r"[̀-ͯ]"

_MONTHS = {
    1: ("january", "jan", "janvier", "janv"),
    2: ("february", "feb", "fevrier", "fev", "fevr"),
    3: ("march", "mar", "mars"),
    4: ("april", "apr", "avril", "avr"),
    5: ("may", "mai"),
    6: ("june", "jun", "juin"),
    7: ("july", "jul", "juillet", "juil"),
    8: ("august", "aug", "aout"),
    9: ("september", "sep", "sept", "septembre"),
    10: ("october", "oct", "octobre"),
    11: ("november", "nov", "novembre"),
    12: ("december", "dec", "decembre"),
}

# Folded text (lowercase, no accents, single spaces) is what every pattern sees.
_ISO = (r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[ t]\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?)?"
        r"\s*(?:z|utc|gmt|[+-]\d{2}(?::?\d{2})?)?$")
_DMY = r"^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:,?\s+(\d{1,2})[:h](\d{2})(?::(\d{2}))?)?$"
# [weekday] [day] month year [[at] hh:mm[:ss]] [zone]
_WRITTEN = (r"^(?:[a-z]+\.?,?\s+)?(?:(\d{1,2})(?:er|st|nd|rd|th)?\s+)?([a-z]+)\.?,?\s+(\d{4})"
            r"(?:,?\s+(?:a\s+|at\s+)?(\d{1,2})[:h](\d{2})(?::(\d{2}))?)?"
            r"(?:\s*(z|gmt|utc|ut|[+-]\d{2}:?\d{2}))?$")
# [weekday] month day, year
_MONTH_FIRST = r"^(?:[a-z]+,?\s+)?([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$"


def _sql_list(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def _month_number(expr: str) -> str:
    cases = " ".join(f"WHEN {expr} IN ({_sql_list(names)}) THEN {number}"
                     for number, names in _MONTHS.items())
    return f"(CASE {cases} END)"


def fold_sql(expr: str) -> str:
    """Lowercase, accent-free, single-spaced text: the SQL twin of ``documents.fold``."""
    return (f"btrim(regexp_replace(lower(regexp_replace(normalize({expr}, NFKD), '{MARKS}', '', 'g')), "
            r"'\s+', ' ', 'g'))")


def is_blank_sql(expr: str) -> str:
    return f"({expr} IS NULL OR btrim({expr}) = '')"


def _date_sql(expr: str) -> str:
    # Folded, without a trailing "(comment)" as in e-mail dates, nor a leading "label :".
    clean = (f"regexp_replace(regexp_replace({fold_sql(expr)}, '\\s*\\([^)]*\\)$', ''), "
             r"'^[a-z'' ]{1,30}:\s*', '')")
    written = ("format('%s-%s-%s %s:%s:%s%s', s.w[3], s.wm, coalesce(s.w[1], '1'), coalesce(s.w[4], '0'), "
               "coalesce(s.w[5], '00'), coalesce(s.w[6], '00'), "
               "CASE WHEN s.w[7] IS NULL OR s.w[7] IN ('z', 'gmt', 'utc', 'ut') THEN '+00' ELSE s.w[7] END)")
    dmy = ("format('%s-%s-%s %s:%s:%s+00', s.d[3], s.d[2], s.d[1], coalesce(s.d[4], '0'), "
           "coalesce(s.d[5], '00'), coalesce(s.d[6], '00'))")
    month_first = "format('%s-%s-%s', s.f[3], s.fm, s.f[2])"
    return (
        "(SELECT CASE"
        f" WHEN s.t ~ '{_ISO}' AND pg_input_is_valid(s.t, 'timestamptz') THEN s.t::timestamptz"
        r" WHEN s.t ~ '^\d{4}-\d{1,2}$' AND pg_input_is_valid(s.t || '-01', 'date')"
        " THEN (s.t || '-01')::timestamptz"
        r" WHEN s.t ~ '^\d{4}$' THEN (s.t || '-01-01')::timestamptz"
        f" WHEN s.d IS NOT NULL AND pg_input_is_valid({dmy}, 'timestamptz') THEN ({dmy})::timestamptz"
        f" WHEN s.w IS NOT NULL AND s.wm IS NOT NULL AND pg_input_is_valid({written}, 'timestamptz')"
        f" THEN ({written})::timestamptz"
        f" WHEN s.f IS NOT NULL AND s.fm IS NOT NULL AND pg_input_is_valid({month_first}, 'date')"
        f" THEN ({month_first})::timestamptz"
        " END"
        " FROM (SELECT r.t, r.d, r.w, r.f,"
        f" {_month_number('r.w[2]')} AS wm, {_month_number('r.f[1]')} AS fm"
        f" FROM (SELECT c.t, regexp_match(c.t, '{_DMY}') AS d, regexp_match(c.t, '{_WRITTEN}') AS w,"
        f" regexp_match(c.t, '{_MONTH_FIRST}') AS f"
        f" FROM (SELECT {clean} AS t) c) r) s)"
    )


def _number_sql(expr: str) -> str:
    # No spaces, no-break spaces or apostrophes; no currency before, no unit or words after.
    squeezed = f"regexp_replace(lower(btrim({expr})), '[\\s\\u00a0\\u202f''\\u2019]', '', 'g')"
    stripped = (f"regexp_replace(regexp_replace({squeezed}, '^(eur|usd|gbp|chf|cad|€|\\$|£)', ''), "
                "'[a-z€$£%][a-z€$£%.]*$', '')")
    commas = "(char_length(a.t) - char_length(replace(a.t, ',', '')))"
    dots = "(char_length(a.t) - char_length(replace(a.t, '.', '')))"
    last_comma = "(char_length(a.t) - strpos(reverse(a.t), ','))"
    last_dot = "(char_length(a.t) - strpos(reverse(a.t), '.'))"
    normalized = (
        f"CASE WHEN {commas} > 0 AND {dots} > 0 THEN"
        f" (CASE WHEN {last_comma} > {last_dot} THEN replace(replace(a.t, '.', ''), ',', '.')"
        " ELSE replace(a.t, ',', '') END)"
        f" WHEN {commas} = 1 THEN replace(a.t, ',', '.')"
        f" WHEN {commas} > 1 THEN replace(a.t, ',', '')"
        f" WHEN {dots} > 1 THEN replace(a.t, '.', '')"
        " ELSE a.t END")
    return (f"(SELECT CASE WHEN b.n ~ '^[+-]?(\\d+(\\.\\d*)?|\\.\\d+)$' THEN b.n::numeric END"
            f" FROM (SELECT {normalized} AS n FROM (SELECT {stripped} AS t) a) b)")


_TRUE = ("true", "yes", "oui", "vrai", "1", "y", "o")
_FALSE = ("false", "no", "non", "faux", "0", "n")


def _boolean_sql(expr: str) -> str:
    folded = fold_sql(expr)
    return (f"(CASE WHEN {folded} IN ({_sql_list(_TRUE)}) THEN true"
            f" WHEN {folded} IN ({_sql_list(_FALSE)}) THEN false END)")


def typed_value_sql(kind: str, expr: str) -> str:
    """The SQL reading the text ``expr`` as ``kind``: a timestamptz (date), a numeric
    (number), a boolean, or folded text (text and enum). NULL when it cannot be read."""
    if kind == "date":
        return _date_sql(expr)
    if kind == "number":
        return _number_sql(expr)
    if kind == "boolean":
        return _boolean_sql(expr)
    return fold_sql(expr)


# Python twins, for the values a query compares with -------------------------------------


def fold(value: object) -> str:
    text = value if isinstance(value, str) else ("" if value is None else str(value))
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", text).strip()


def parse_number(value: object) -> Decimal | None:
    """A number given in a query, read with the same rules as stored values."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        try:
            return Decimal(str(value))
        except InvalidOperation:
            return None
    if not isinstance(value, str):
        return None
    text = re.sub(r"[\s  '’]", "", value.strip().lower())
    text = re.sub(r"^(eur|usd|gbp|chf|cad|€|\$|£)", "", text)
    text = re.sub(r"[a-z€$£%][a-z€$£%.]*$", "", text)
    commas, dots = text.count(","), text.count(".")
    if commas and dots:
        text = (text.replace(".", "").replace(",", ".") if text.rfind(",") > text.rfind(".")
                else text.replace(",", ""))
    elif commas == 1:
        text = text.replace(",", ".")
    elif commas > 1:
        text = text.replace(",", "")
    elif dots > 1:
        text = text.replace(".", "")
    if not re.fullmatch(r"[+-]?(\d+(\.\d*)?|\.\d+)", text):
        return None
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def parse_boolean(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    folded = fold(value)
    if folded in _TRUE:
        return True
    if folded in _FALSE:
        return False
    return None
