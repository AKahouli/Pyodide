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
            return self

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

        return self


_CHART_PALETTE_TOKENS = (
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
)


def _build_chart_config(payload: RenderChartInput) -> dict[str, dict[str, str]]:
    if payload.config:
        return payload.config

    config: dict[str, dict[str, str]] = {}
    for idx, series in enumerate(payload.series):
        config[series.dataKey] = {
            "label": series.label or _format_label(series.dataKey),
            "color": series.color or _CHART_PALETTE_TOKENS[idx % len(_CHART_PALETTE_TOKENS)],
        }
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
