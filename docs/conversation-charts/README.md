# Conversation Charts

> **Slug:** `conversation-charts` | **Status:** 🚧 draft | **Last Updated:** 2026-04-23 00:00 UTC

## Purpose
Support inline analytical charts in assistant messages using a stable chart component contract streamed from the ADK through the backend SSE layer into the chat UI.

## Scope
- Included: chart component normalization, gRPC-to-SSE streaming, React rendering in assistant bubbles, and chart-specific tests.
- Excluded: non-chat analytics pages, playbook chart rendering, and chart authoring tools.

## Architecture
- ADK emits `Component.chart` payloads in `StreamChunk` messages.
- Backend normalizes chart chunks and forwards them as SSE `stream_chunk` events with `action: add` and a stable `component_id` derived from the tool call id when available.
- Frontend maps chart chunks into a stable internal chart model and renders them with `recharts` through the existing shadcn chart wrapper.

## Requirements
- As an assistant user, I want streamed chart chunks to render inline inside the conversation bubble so that insights are visible without leaving the chat.
- [ ] Support `bar`, `line`, `area`, `pie`, `scatter`, and `composed` charts.
- [ ] Preserve chart updates during streaming without leaving stale state behind.

## API / Interfaces
- Stream chunk payloads use `action`, `component`, `metadata`, and `usage`.
- Chart components are normalized with `title`, `chartData`, `config`, `xAxisKey`, `yAxisKey`, `nameKey`, `zAxisKey`, `series`, `kind`, `stacked`, `layout`, `innerRadius`, `showLegend`, and `showGrid`.
- The frontend accepts chart payload fields in both camelCase and legacy snake_case variants where present in backend-adjacent code paths.

## Design Decisions
| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Use `recharts` via the existing shadcn chart wrapper | Already installed, already integrated with the message UI, and supports the chart kinds currently handled in the frontend | Switching to Chart.js would require a second rendering abstraction and a new payload model |
| Treat chart updates as full payload replacements | Avoids partial merge bugs and stale axes/series/config state | Deep merge semantics are harder to reason about and easy to break |

## Related Features
- [`conversation`](/docs/conversation/README.md)
