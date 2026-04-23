# Chart Rendering Flow — End-to-End Developer Guide

This document describes how the `render_chart` feature works across all three layers of the YellowStorm stack: the Python ADK agent runtime, the NestJS gRPC backend, and the React frontend.

---

## Architecture Overview

```
┌──────────────────────────────────────────┐
│  ADK (Python)                            │
│  Agent calls render_chart tool           │
│  → runner.py / streaming_processor.py   │
│    builds chart component, pushes to q  │
└────────────────────┬─────────────────────┘
                     │ asyncio Queue (dict)
                     ▼
┌──────────────────────────────────────────┐
│  gRPC Server (Python)                    │
│  chatbot_servicer.py                     │
│  Serialises chart dict → ChartComponent  │
│  proto message, streams via SSE          │
└────────────────────┬─────────────────────┘
                     │ gRPC stream (protobuf)
                     ▼
┌──────────────────────────────────────────┐
│  Backend (NestJS / TypeScript)           │
│  stream.service.ts + component-mapper.ts │
│  Deserialises proto → internal JS object │
│  Forwards over SSE to browser            │
└────────────────────┬─────────────────────┘
                     │ Server-Sent Events (JSON)
                     ▼
┌──────────────────────────────────────────┐
│  Frontend (React / TypeScript)           │
│  conversation/utils.ts → mapChartComponent│
│  ai-message-content.tsx → ChartPartRenderer│
│  Recharts renders the final chart        │
└──────────────────────────────────────────┘
```

---

## Layer 1 — ADK Python Runtime

### Tool Definition
**File:** `yellowstorm-adk/src/smart_rag/tools/utilities/render_chart.py`

The `render_chart` async function is the ADK tool the LLM calls. It:

1. Validates the LLM-supplied arguments through `RenderChartInput` (Pydantic model).
2. Infers missing fields automatically:
   - **pie** — sets `nameKey` from `xAxisKey`, infers numeric series key if `series` is empty.
   - **scatter** — infers `yAxisKey` and `zAxisKey` from the first two numeric data keys.
   - **non-scatter** — auto-builds a one-entry `series` from `yAxisKey` when `series` is empty.
   - **composed** — normalises each series item and defaults `kind` to `bar` / `line` alternation.
3. Builds a `config` dict mapping each series `dataKey` → `{ label, color }` for Recharts.
4. Returns a plain `dict` with these exact keys:

```python
{
    "title", "chartData", "config",
    "xAxisKey", "yAxisKey", "nameKey", "zAxisKey",
    "series", "kind", "stacked", "layout",
    "innerRadius", "showLegend", "showGrid",
}
```

On validation failure the dict contains `{ "error": "invalid_chart_payload", "details": [...] }`.

### Tool Registration
**File:** `yellowstorm-adk/src/smart_rag/agents/factories/base_factory.py` (line 190)

```python
tools.append(render_chart)
```

`render_chart` is appended to **every** agent's tool list in the base factory — both the manager agent and all sub-agents.

### Event Routing — Two Code Paths

Because `render_chart` can be called by any agent, function response events flow through **two separate processors** depending on who called the tool.

#### Manager agent calls render_chart
**File:** `yellowstorm-adk/src/smart_rag/engines/multi_agent/streaming_processor.py`

`_handle_render_chart_response(self, function_response, message_id, q)` is called when the **manager** agent's tool response arrives (lines ~760–855).

#### Sub-agent calls render_chart
**File:** `yellowstorm-adk/src/smart_rag/agents/core/runner.py`

`_handle_render_chart_response(self, function_response, agent_id, session_id, q)` is called by the function_response dispatcher (line ~529) when any **sub-agent** invokes the tool.

Both handlers share the same logic:

```python
# 1. Coerce proto Struct / JSON string → plain dict
response_data = coerce_to_dict(getattr(function_response, "response", None))

# 2. Guard: empty or error response → log & return
if not response_data or response_data.get("error"):
    ...

# 3. Emit the component into the streaming queue
chart_chunk = self.streaming_formatter.format_component_event(
    agent_id=agent_id,
    component_type="chart",
    component_data={...all 14 chart fields...},
    message_id=session_id,
    action="add",
    component_id=call_id,   # function_response.id or fresh uuid4
)
await q.put(chart_chunk)
```

The diagnostic log line is:
```
[CHART] emitting render_chart component_id=<id> kind=<kind> data_len=<n>
```

### Proto-Type Coercion Helper
**File:** `yellowstorm-adk/src/smart_rag/engines/helpers.py`

`coerce_to_dict(value)` and `coerce_to_plain(value)` handle the fact that Google ADK wraps tool response payloads in a `google.protobuf.Struct`-backed `Mapping` rather than a plain Python `dict`. A naïve `isinstance(value, dict)` check fails on these wrappers. The helpers also handle the case where litellm returns the response as a JSON string.

---

## Layer 2 — gRPC Server (chatbot_servicer.py)

**File:** `yellowstorm-adk/src/grpc_server/chatbot_servicer.py`

When the streaming formatter emits a `chart` component dict, the gRPC servicer serialises it into a `ChartComponent` protobuf message (lines ~1099–1118):

```python
component_kwargs["chart"] = chatbot_pb2.ChartComponent(
    title=...,
    data=json.dumps(chartData),      # JSON-encoded list of dicts
    config=json.dumps(config),       # JSON-encoded config object
    series=json.dumps(series),       # JSON-encoded series array
    xAxisKey=...,  yAxisKey=...,
    nameKey=...,   zAxisKey=...,
    kind=self._chart_kind_to_enum(kind),       # string → proto enum int
    layout=self._chart_layout_to_enum(layout), # string → proto enum int
    stacked=...,  inner_radius=...,
    show_legend=..., show_grid=...,
)
```

Note that `data`, `config`, and `series` are **JSON-stringified** at this point because the proto `ChartComponent` field type for these is `string`.

Proto enum mappings (both helpers in `chatbot_servicer.py`):

| String | Proto int |
|--------|-----------|
| `bar` | `CHART_KIND_BAR` (1) |
| `line` | `CHART_KIND_LINE` (2) |
| `area` | `CHART_KIND_AREA` (3) |
| `pie` | `CHART_KIND_PIE` (4) |
| `scatter` | `CHART_KIND_SCATTER` (5) |
| `composed` | `CHART_KIND_COMPOSED` (6) |
| `horizontal` | `CHART_LAYOUT_HORIZONTAL` (1) |
| `vertical` | `CHART_LAYOUT_VERTICAL` (2) |

---

## Layer 3 — NestJS Backend

### Component Mapper
**File:** `YellowStorm/back/src/modules/conversation/utils/component-mapper.ts`

`extractComponentData` maps the incoming gRPC component to an internal TypeScript object (lines 91–111). It handles both camelCase (`xAxisKey`) and snake_case (`x_axis_key`) proto field names for resilience:

```ts
case 'chart':
  const chart = comp.chart || {};
  return {
    type,
    data: {
      title:       chart.title || '',
      chartData:   chart.data || chart.chartData || '',  // still JSON string
      config:      chart.config || '',                   // still JSON string
      series:      chart.series || '',                   // still JSON string
      xAxisKey:    chart.xAxisKey  || chart.x_axis_key  || '',
      yAxisKey:    chart.yAxisKey  || chart.y_axis_key  || '',
      nameKey:     chart.nameKey   || chart.name_key    || '',
      zAxisKey:    chart.zAxisKey  || chart.z_axis_key  || '',
      kind:        chart.kind      || 'CHART_KIND_UNSPECIFIED',  // numeric or string
      layout:      chart.layout    || 'CHART_LAYOUT_UNSPECIFIED',
      stacked:     chart.stacked   || false,
      innerRadius: chart.inner_radius || chart.innerRadius || 0,
      showLegend:  chart.show_legend  ?? chart.showLegend  ?? true,
      showGrid:    chart.show_grid    ?? chart.showGrid    ?? true,
    },
  };
```

At this stage `chartData`, `config`, and `series` are still JSON strings — they are parsed on the frontend.

### Stream Service
**File:** `YellowStorm/back/src/modules/conversation/services/stream.service.ts`

- `applyChunkToBuffer` applies incoming `action=add` chunks to the conversation buffer.
- `mergeComponentData` for the `chart` case does a full replace (`return { ...incoming }`).
- A chunk with `action=update` is silently dropped if no prior `add` exists for the same component ID. Chart always uses `action=add`, so this is not a concern.

---

## Layer 4 — React Frontend

### Zod Schema & Parsing
**File:** `YellowStorm/front/src/modules/conversation/utils.ts`

`chartPayloadSchema` (lines 17–33) validates the incoming component data with `.catch()` fallbacks on every field so a bad value never throws — it degrades gracefully.

```ts
const chartPayloadSchema = z.object({
  chartData: z.union([z.string(), z.array(...)]).catch([]),
  config:    z.union([z.string(), chartConfigSchema]).catch({}),
  series:    z.union([z.string(), z.array(...)]).catch([]),
  kind:      z.union([z.string(), chartKindSchema]).optional().catch('bar'),
  layout:    z.union([z.string(), chartLayoutSchema]).optional().catch('horizontal'),
  // ...
});
```

### Enum Normalisation
`normalizeChartKind` and `normalizeChartLayout` (lines 263–291) handle three input forms:
- **Numeric** proto enum int (e.g. `1` → `'bar'`)
- **Prefixed string** (e.g. `'CHART_KIND_BAR'` → `'bar'`)
- **Plain string** (e.g. `'bar'` → passed through)

### mapChartComponent
`mapChartComponent` (line 293) orchestrates the full parse:

```ts
function mapChartComponent(data) {
  const parsed = chartPayloadSchema.safeParse(data);
  if (!parsed.success) return { type: 'error', content: 'ai.chart.errorContent' };
  if (parsed.data.error) return { type: 'error', ... };

  return {
    type: 'chart',
    data: parseChartData(payload.chartData),   // JSON string → array
    config: parseJsonValue(payload.config, {}),
    series: parseJsonValue(payload.series, []),
    kind: normalizeChartKind(payload.kind),
    layout: normalizeChartLayout(payload.layout),
    // ...all other fields
  };
}
```

### Renderer
**File:** `YellowStorm/front/src/components/ai-elements/ai-message-content.tsx` (line 584)

`ChartPartRenderer` receives the typed `ChartPart` and delegates to the appropriate Recharts component based on `kind`:

| `kind` | Recharts component |
|--------|--------------------|
| `line` | `<LineChart>` |
| `bar` | `<BarChart layout={layout}>` (supports horizontal/vertical) |
| `area` | `<AreaChart>` |
| `pie` | `<PieChart>` + `<Pie nameKey={nameKey}>` |
| `scatter` | `<ScatterChart>` with `zAxisKey` |
| `composed` | `<ComposedChart>` with per-series `kind` |

If `data.length === 0` the component renders a `ai.chart.noData` localised message instead.

The container div carries `role="figure"` and `aria-label={title}` for accessibility and testability.

---

## Data Flow Summary

```
LLM response (JSON tool call)
        │
        ▼
render_chart() — Pydantic validation + field inference
        │ returns plain dict
        ▼
_handle_render_chart_response() in runner.py or streaming_processor.py
  coerce_to_dict()     ← handles proto Struct / JSON string wrappers
  format_component_event(action="add", component_type="chart", ...)
        │ pushes to asyncio Queue
        ▼
chatbot_servicer.py
  ChartComponent(
    data=json.dumps(chartData),
    config=json.dumps(config),
    series=json.dumps(series),
    kind=CHART_KIND_BAR (int enum),
    layout=CHART_LAYOUT_HORIZONTAL (int enum),
    ...
  )
        │ gRPC stream
        ▼
NestJS stream.service.ts
  extractComponentData() → { type:'chart', data:{ chartData:"[…]", kind:1, ... } }
        │ SSE JSON
        ▼
conversation/utils.ts → mapChartComponent()
  chartPayloadSchema.safeParse(data)
  normalizeChartKind(1)   → 'bar'
  normalizeChartLayout(1) → 'horizontal'
  parseChartData("[…]")   → [{ … }]
        │ MessageContentPart { type:'chart', data:[…], kind:'bar', ... }
        ▼
AIMessageContent → ChartPartRenderer
  <BarChart data={data}>
    <Bar dataKey="prix" fill="var(--color-prix)" />
  </BarChart>
```

---

## Key Design Decisions

### Why two handler code paths?
`render_chart` is registered on all agents via `base_factory.py`. Manager-agent tool responses are processed by `StreamingEventProcessor` (streaming_processor.py); sub-agent responses go through `AgentRunner` (runner.py). Both are now symmetric.

### Why JSON-stringify data/config/series in the proto?
The `ChartComponent` proto fields `data`, `config`, and `series` are typed as `string` to avoid defining complex nested proto messages. The frontend schema handles either form (string or already-parsed array) via `z.union([z.string(), z.array(...)])`.

### Why proto enum integers on the frontend?
The NestJS gRPC client deserialises enum fields as integers unless a custom decoder is added. `normalizeChartKind` / `normalizeChartLayout` bridge this so the frontend never breaks regardless of whether the value arrives as `1`, `"CHART_KIND_BAR"`, or `"bar"`.

### Why `.catch()` on every Zod field?
Chart payloads arrive through a multi-hop serialisation chain (Python dict → JSON string → proto string → TypeScript object). Using `.catch()` means a single malformed field degrades to a sensible default rather than dropping the whole chart.

---

## Testing

| Layer | File | What is tested |
|-------|------|----------------|
| ADK tool | `tests/test_tools/test_utilities/test_render_chart.py` | Shape validation, pie/scatter inference, empty-data error |
| Frontend mapper | `front/src/components/ai-elements/ai-message-content.chart.test.tsx` | Chart renders between text parts, no-data state, error state, numeric enum normalisation |
| Backend mapper | `back/src/modules/conversation/utils/component-mapper.spec.ts` | Proto → internal object mapping |

Run ADK tests:
```bash
cd yellowstorm-adk
pytest tests/test_tools/test_utilities/test_render_chart.py -v
```
