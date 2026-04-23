---
name: render-chart
description: Render analytical charts (line, bar, area, pie, donut, scatter, composed) inline when a visual would help the user understand data. Use when the user asks for a chart, or when the answer becomes analytical and a visual would clarify trends, comparisons, proportions, or correlations.
---

# Render Chart Skill

When the answer becomes analytical and a visual would help the user, call `render_chart` between two short explanatory paragraphs.

## General Rules

- Never call `render_chart` with an empty `data` array.
- Prefer explicit keys over relying on inference.
- Use human-friendly chart titles.
- For `composed`, always provide `series[].kind`.
- For `scatter`, use numeric `xAxisKey` and `yAxisKey`.
- For `pie`, provide category labels and one numeric value field.
- If you do not have concrete numeric data, do not call the chart tool.
- When the user explicitly asks for a chart, call `render_chart` unless there is no numeric data.

## Chart Types

### Line Chart

Use for trends over time.

```text
render_chart(
  kind="line",
  title="Population mondiale par annee",
  xAxisKey="year",
  yAxisKey="population_billions",
  data=[
    {"year":"2022","population_billions":7.95},
    {"year":"2023","population_billions":8.01},
    {"year":"2024","population_billions":8.08},
    {"year":"2025","population_billions":8.15}
  ],
  series=[
    {"dataKey":"population_billions","label":"Population (Md)"}
  ],
  showLegend=True,
  showGrid=True
)
```

### Bar Chart

Use for category comparisons.

```text
render_chart(
  kind="bar",
  title="Ventes par categorie",
  xAxisKey="category",
  yAxisKey="sales",
  data=[
    {"category":"A","sales":120},
    {"category":"B","sales":95},
    {"category":"C","sales":150}
  ],
  series=[
    {"dataKey":"sales","label":"Ventes"}
  ],
  showLegend=True,
  showGrid=True
)
```

### Stacked Bar Chart

Use for part-of-whole comparison across categories.

```text
render_chart(
  kind="bar",
  title="Revenus par region et produit",
  xAxisKey="region",
  data=[
    {"region":"Europe","product_a":120,"product_b":80},
    {"region":"Amerique","product_a":140,"product_b":60},
    {"region":"Asie","product_a":160,"product_b":110}
  ],
  series=[
    {"dataKey":"product_a","label":"Produit A"},
    {"dataKey":"product_b","label":"Produit B"}
  ],
  stacked=True,
  showLegend=True,
  showGrid=True
)
```

### Area Chart

Use for cumulative or volumetric trends.

```text
render_chart(
  kind="area",
  title="Trafic mensuel",
  xAxisKey="month",
  yAxisKey="visits",
  data=[
    {"month":"Jan","visits":1200},
    {"month":"Fev","visits":1450},
    {"month":"Mar","visits":1700},
    {"month":"Avr","visits":1600}
  ],
  series=[
    {"dataKey":"visits","label":"Visites"}
  ],
  showLegend=True,
  showGrid=True
)
```

### Pie Chart

Use for proportions of a whole.

```text
render_chart(
  kind="pie",
  title="Part de marche",
  xAxisKey="category",
  nameKey="category",
  yAxisKey="value",
  data=[
    {"category":"Produit A","value":42},
    {"category":"Produit B","value":33},
    {"category":"Produit C","value":25}
  ],
  series=[
    {"dataKey":"value","label":"Part"}
  ],
  showLegend=True,
  showGrid=False
)
```

### Donut Chart

Use the same as pie, but set `innerRadius > 0`.

```text
render_chart(
  kind="pie",
  title="Repartition budgetaire",
  xAxisKey="category",
  nameKey="category",
  yAxisKey="amount",
  data=[
    {"category":"RH","amount":25},
    {"category":"IT","amount":40},
    {"category":"Marketing","amount":35}
  ],
  series=[
    {"dataKey":"amount","label":"Budget"}
  ],
  innerRadius=60,
  showLegend=True,
  showGrid=False
)
```

### Scatter Chart

Use for correlation between two numeric variables.

```text
render_chart(
  kind="scatter",
  title="Taille vs poids",
  xAxisKey="height_cm",
  yAxisKey="weight_kg",
  zAxisKey="score",
  data=[
    {"height_cm":160,"weight_kg":55,"score":80},
    {"height_cm":168,"weight_kg":62,"score":90},
    {"height_cm":175,"weight_kg":70,"score":95},
    {"height_cm":182,"weight_kg":78,"score":88}
  ],
  showLegend=False,
  showGrid=True
)
```

### Composed Chart

Use when you need bars + line or bars + area together. Always provide `series[].kind`.

```text
render_chart(
  kind="composed",
  title="Revenu et marge",
  xAxisKey="month",
  data=[
    {"month":"Jan","revenue":120,"margin":18},
    {"month":"Fev","revenue":150,"margin":22},
    {"month":"Mar","revenue":170,"margin":25},
    {"month":"Avr","revenue":160,"margin":21}
  ],
  series=[
    {"dataKey":"revenue","label":"Revenu","kind":"bar"},
    {"dataKey":"margin","label":"Marge","kind":"line"}
  ],
  showLegend=True,
  showGrid=True
)
```

## Minimal Fallback Examples

Use these when you need the smallest valid call.

### Minimal Line

```text
render_chart(
  kind="line",
  title="Evolution",
  xAxisKey="date",
  yAxisKey="value",
  data=[{"date":"J1","value":10},{"date":"J2","value":12}],
  series=[{"dataKey":"value","label":"Valeur"}]
)
```

### Minimal Bar

```text
render_chart(
  kind="bar",
  title="Comparaison",
  xAxisKey="label",
  yAxisKey="value",
  data=[{"label":"A","value":10},{"label":"B","value":12}],
  series=[{"dataKey":"value","label":"Valeur"}]
)
```

### Minimal Pie

```text
render_chart(
  kind="pie",
  title="Repartition",
  xAxisKey="label",
  nameKey="label",
  yAxisKey="value",
  data=[{"label":"A","value":60},{"label":"B","value":40}],
  series=[{"dataKey":"value","label":"Valeur"}]
)
```

### Minimal Scatter

```text
render_chart(
  kind="scatter",
  title="Correlation",
  xAxisKey="x",
  yAxisKey="y",
  data=[{"x":10,"y":20},{"x":15,"y":28},{"x":20,"y":35}]
)
```

### Minimal Composed

```text
render_chart(
  kind="composed",
  title="Barres et ligne",
  xAxisKey="month",
  data=[{"month":"Jan","sales":10,"target":12},{"month":"Fev","sales":14,"target":13}],
  series=[
    {"dataKey":"sales","label":"Ventes","kind":"bar"},
    {"dataKey":"target","label":"Objectif","kind":"line"}
  ]
)
```

## Parameter Reference

| Parameter      | Type    | Required | Description |
|----------------|---------|----------|-------------|
| `kind`         | string  | yes      | Chart type: `line`, `bar`, `area`, `pie`, `scatter`, `composed` |
| `title`        | string  | yes      | Human-friendly chart title |
| `xAxisKey`     | string  | yes      | Data key for X axis |
| `yAxisKey`     | string  | no*      | Data key for Y axis (required for non-pie, non-scatter) |
| `zAxisKey`     | string  | no       | Data key for Z axis (scatter only, for bubble size) |
| `nameKey`      | string  | no*      | Category name key (required for pie charts) |
| `data`         | array   | yes      | Array of data objects, must not be empty |
| `series`       | array   | yes*     | Series definitions with `dataKey` and `label` (not required for minimal scatter) |
| `series[].kind`| string  | no*      | Chart sub-type per series, required for `composed` (`bar`, `line`, `area`) |
| `stacked`      | boolean | no       | Stack bar series (bar chart only) |
| `innerRadius`  | number  | no       | > 0 for donut variant (pie chart only) |
| `showLegend`   | boolean | no       | Show chart legend |
| `showGrid`     | boolean | no       | Show grid lines |
