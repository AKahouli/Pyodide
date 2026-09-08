import math
import re
from typing import Any, Literal, Optional

from google.adk.tools.tool_context import ToolContext
from pydantic import BaseModel, Field, ValidationError, model_validator


ChartKind = Literal["line", "bar", "area", "pie", "scatter", "composed"]
ChartLayout = Literal["horizontal", "vertical"]


class ChartSeriesSpec(BaseModel):
    dataKey: str
    label: Optional[str] = None
    color: Optional[str] = None
    kind: Optional[ChartKind] = None


class RenderChartInput(BaseModel):
    kind: ChartKind
    title: Optional[str] = None
    data: list[dict[str, Any]] = Field(default_factory=list)
    xAxisKey: str
    yAxisKey: Optional[str] = None
    nameKey: Optional[str] = None
    zAxisKey: Optional[str] = None
    series: list[ChartSeriesSpec] = Field(default_factory=list)
    stacked: bool = False
    layout: ChartLayout = "horizontal"
    innerRadius: int = 0
    showLegend: bool = True
    showGrid: bool = True
    config: dict[str, dict[str, str]] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_chart_content(self) -> "RenderChartInput":
        if not self.data:
            raise ValueError("render_chart requires a non-empty data array")

        if self.kind == "pie":
            self.nameKey = self.nameKey or self.xAxisKey
            inferred_key = self.yAxisKey or _infer_default_series_key(self.data, self.nameKey)
            if not self.series and inferred_key:
                self.series = [ChartSeriesSpec(dataKey=inferred_key, label=_format_label(inferred_key))]
            if not self.nameKey:
                raise ValueError("pie charts require nameKey or xAxisKey")
            if not self.series:
                raise ValueError("pie charts require a numeric value series")

        if self.kind != "scatter" and not self.series:
            inferred_key = self.yAxisKey or _infer_default_series_key(self.data, self.xAxisKey)
            if inferred_key:
                self.series = [
                    ChartSeriesSpec(
                        dataKey=inferred_key,
                        label=_format_label(inferred_key),
                    )
                ]
            else:
                raise ValueError("render_chart requires at least one series entry")

        if self.kind == "scatter":
            self.yAxisKey = self.yAxisKey or _infer_default_series_key(self.data, self.xAxisKey)
            if not self.yAxisKey:
                raise ValueError("scatter charts require yAxisKey or a second numeric field")
            if not self.zAxisKey:
                self.zAxisKey = _infer_default_series_key(self.data, self.xAxisKey, exclude={self.yAxisKey})

        if self.kind == "composed":
            normalized_series = []
            for idx, series_item in enumerate(self.series):
                normalized_series.append(
                    ChartSeriesSpec(
                        dataKey=series_item.dataKey,
                        label=series_item.label or _format_label(series_item.dataKey),
                        color=series_item.color,
                        kind=series_item.kind or ("bar" if idx == 0 else "line"),
                    )
                )
            self.series = normalized_series

        numeric_keys = (
            [key for key in (self.xAxisKey, self.yAxisKey, self.zAxisKey) if key]
            if self.kind == "scatter"
            else [series.dataKey for series in self.series]
        )
        for row_index, row in enumerate(self.data):
            for key in numeric_keys:
                if not key or key not in row:
                    raise ValueError(
                        f"data[{row_index}].{key or 'value'} is required and must be numeric"
                    )
                try:
                    row[key] = _coerce_chart_number(row[key])
                except ValueError as exc:
                    raise ValueError(f"data[{row_index}].{key}: {exc}") from exc

        return self


_CHART_PALETTE_TOKENS = (
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
)

_NUMBER_WRAPPER_RE = re.compile(
    r"^\s*[€$£]?\s*(?P<number>[+-]?[\d\s\u00a0\u202f.,']+)\s*(?:%|[€$£])?\s*$"
)
_GROUPED_SPACE_RE = re.compile(
    r"^[+-]?\d{1,3}(?:[\s\u00a0\u202f']\d{3})+(?:[.,]\d+)?$"
)
_GROUPED_US_RE = re.compile(r"^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$")
_GROUPED_EU_RE = re.compile(r"^[+-]?\d{1,3}(?:\.\d{3})+(?:,\d+)?$")
_PLAIN_NUMBER_RE = re.compile(r"^[+-]?\d+(?:[.,]\d+)?$")


def _coerce_chart_number(value: Any) -> int | float:
    if isinstance(value, bool):
        raise ValueError("boolean values are not numeric chart values")

    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            raise ValueError("value must be finite")
        return value

    if not isinstance(value, str):
        raise ValueError("value must be a number or an unambiguous numeric string")

    match = _NUMBER_WRAPPER_RE.fullmatch(value)
    if not match:
        raise ValueError("value must be a number or an unambiguous numeric string")

    number = match.group("number").strip()
    separator_count = number.count(",") + number.count(".")
    if separator_count == 1 and re.search(r"[.,]\d{3}$", number):
        raise ValueError("numeric string has an ambiguous decimal or thousands separator")

    if _GROUPED_SPACE_RE.fullmatch(number):
        normalized = re.sub(r"[\s\u00a0\u202f']", "", number).replace(",", ".")
    elif _GROUPED_US_RE.fullmatch(number) and (number.count(",") > 1 or "." in number):
        normalized = number.replace(",", "")
    elif _GROUPED_EU_RE.fullmatch(number) and (number.count(".") > 1 or "," in number):
        normalized = number.replace(".", "").replace(",", ".")
    elif _PLAIN_NUMBER_RE.fullmatch(number):
        normalized = number.replace(",", ".")
    else:
        raise ValueError("numeric string uses an unsupported or ambiguous format")

    parsed = float(normalized)
    if not math.isfinite(parsed):
        raise ValueError("value must be finite")
    return int(parsed) if parsed.is_integer() else parsed


def _build_chart_config(payload: RenderChartInput) -> dict[str, dict[str, str]]:
    config = {key: dict(value) for key, value in payload.config.items()}
    for idx, series in enumerate(payload.series):
        item_config = config.setdefault(series.dataKey, {})
        item_config.setdefault("label", series.label or _format_label(series.dataKey))
        item_config.setdefault(
            "color",
            series.color or _CHART_PALETTE_TOKENS[idx % len(_CHART_PALETTE_TOKENS)],
        )
    return config


def _infer_default_series_key(
    data: list[dict[str, Any]], x_axis_key: str, exclude: Optional[set[str]] = None
) -> Optional[str]:
    if not data:
        return None

    exclude = exclude or set()
    sample = data[0]
    for key, value in sample.items():
        if key == x_axis_key or key in exclude:
            continue
        if isinstance(value, (int, float)):
            return key

    return None


def _format_label(raw: str) -> str:
    return raw.replace('_', ' ').replace('-', ' ').strip().title()


async def render_chart(
    kind: ChartKind,
    xAxisKey: str,
    data: Optional[list[dict[str, Any]]] = None,
    title: Optional[str] = None,
    yAxisKey: Optional[str] = None,
    nameKey: Optional[str] = None,
    zAxisKey: Optional[str] = None,
    series: Optional[list[dict[str, Any]]] = None,
    stacked: bool = False,
    layout: ChartLayout = "horizontal",
    innerRadius: int = 0,
    showLegend: bool = True,
    showGrid: bool = True,
    config: Optional[dict[str, dict[str, str]]] = None,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Render a structured chart inside the conversation.

    Use this tool for analytical answers when a chart will help explain trends,
    comparisons, distributions, proportions, correlations, or mixed metrics.
    Call it between explanatory paragraphs so the chart appears inline in the chat.

    Picking `kind`:
      - "line"     : trends over an ordered axis (time, rank).
      - "bar"      : discrete comparisons where every series has a comparable scale.
      - "area"     : cumulative trends or part-to-whole over time.
      - "pie"      : proportions of a single total (3–8 slices max).
      - "scatter"  : correlation between two numeric variables.
      - "composed" : MIXED METRICS — use this whenever series live on different
                     scales or represent fundamentally different quantities
                     (e.g. a percentage rate alongside a monetary volume,
                     a policy rate alongside an inflation index, a count
                     alongside a ratio). Put the smaller-magnitude or continuous
                     series on a line (set its `kind` to "line") and the
                     larger-magnitude or discrete series on bars. Do NOT use
                     plain "bar" for mixed-scale comparisons — the smaller
                     series will collapse to invisible bars.

    If one of the series is near-constant (e.g. a 0% rate held all year), prefer
    "composed" with that series rendered as a line so it stays visually present.
    Series values must be finite numbers. Plain numeric strings and unambiguous
    currency, percentage, or grouped-number strings are normalized to numbers;
    ambiguous formatted values are rejected instead of producing an empty chart.
    """

    try:
        payload = RenderChartInput.model_validate(
            {
                "kind": kind,
                "title": title,
                "data": data or [],
                "xAxisKey": xAxisKey,
                "yAxisKey": yAxisKey,
                "nameKey": nameKey,
                "zAxisKey": zAxisKey,
                "series": series or [],
                "stacked": stacked,
                "layout": layout,
                "innerRadius": innerRadius,
                "showLegend": showLegend,
                "showGrid": showGrid,
                "config": config or {},
            }
        )
    except ValidationError as exc:
        error_messages = []
        for item in exc.errors():
            location = ".".join(str(part) for part in item.get("loc", []))
            message = str(item.get("msg", "invalid chart payload"))
            error_messages.append(f"{location}: {message}" if location else message)

        return {
            "error": "invalid_chart_payload",
            "title": title or "",
            "details": error_messages,
        }

    return {
        "title": payload.title or "",
        "chartData": payload.data,
        "config": _build_chart_config(payload),
        "xAxisKey": payload.xAxisKey,
        "yAxisKey": payload.yAxisKey or "",
        "nameKey": payload.nameKey or "",
        "zAxisKey": payload.zAxisKey or "",
        "series": [item.model_dump(exclude_none=True) for item in payload.series],
        "kind": payload.kind,
        "stacked": payload.stacked,
        "layout": payload.layout,
        "innerRadius": payload.innerRadius,
        "showLegend": payload.showLegend,
        "showGrid": payload.showGrid,
    }
