"""Tests for render_chart utility."""

import importlib.util
import pathlib
import sys

import pytest

# Import render_chart without triggering src/smart_rag/tools/__init__.py, which pulls
# in heavy langchain deps that aren't required for this pure pydantic validator.
_MODULE_PATH = (
    pathlib.Path(__file__).resolve().parents[3]
    / "src"
    / "smart_rag"
    / "tools"
    / "utilities"
    / "render_chart.py"
)
_spec = importlib.util.spec_from_file_location("render_chart_under_test", _MODULE_PATH)
_module = importlib.util.module_from_spec(_spec)
sys.modules["render_chart_under_test"] = _module
_spec.loader.exec_module(_module)
render_chart = _module.render_chart


class TestRenderChart:
    @pytest.mark.asyncio
    async def test_bar_chart_output_shape(self):
        result = await render_chart(
            kind="bar",
            xAxisKey="produit",
            yAxisKey="prix",
            title="Prix des produits",
            data=[
                {"produit": "Stylo", "prix": 1.2},
                {"produit": "Cahier", "prix": 2.5},
            ],
            series=[{"dataKey": "prix", "label": "Prix (€)"}],
        )

        expected_keys = {
            "title",
            "chartData",
            "config",
            "xAxisKey",
            "yAxisKey",
            "nameKey",
            "zAxisKey",
            "series",
            "kind",
            "stacked",
            "layout",
            "innerRadius",
            "showLegend",
            "showGrid",
        }
        assert set(result.keys()) == expected_keys
        assert "json" not in result
        assert result["kind"] == "bar"
        assert result["xAxisKey"] == "produit"
        assert result["yAxisKey"] == "prix"
        assert result["nameKey"] == ""
        assert result["zAxisKey"] == ""
        assert result["chartData"] == [
            {"produit": "Stylo", "prix": 1.2},
            {"produit": "Cahier", "prix": 2.5},
        ]
        assert result["series"] == [{"dataKey": "prix", "label": "Prix (€)"}]

    @pytest.mark.asyncio
    async def test_pie_chart_sets_name_key(self):
        result = await render_chart(
            kind="pie",
            xAxisKey="category",
            data=[{"category": "A", "value": 10}, {"category": "B", "value": 20}],
            series=[{"dataKey": "value"}],
        )

        assert result["nameKey"] == "category"
        assert result["kind"] == "pie"

    @pytest.mark.asyncio
    async def test_scatter_infers_z_axis(self):
        result = await render_chart(
            kind="scatter",
            xAxisKey="x",
            yAxisKey="y",
            data=[{"x": 1, "y": 2, "size": 5}, {"x": 3, "y": 4, "size": 10}],
            series=[{"dataKey": "y"}],
        )

        assert result["kind"] == "scatter"
        assert result["yAxisKey"] == "y"
        assert result["zAxisKey"] == "size"

    @pytest.mark.asyncio
    async def test_empty_data_returns_error(self):
        result = await render_chart(
            kind="bar",
            xAxisKey="produit",
            data=[],
        )

        assert result.get("error") == "invalid_chart_payload"
