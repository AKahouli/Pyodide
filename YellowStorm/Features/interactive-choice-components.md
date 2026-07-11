---
project: YellowStorm
type: feature
slug: interactive-choice-components
status: active
updated: 2026-07-11 UTC
---

# Interactive Choice Components

`present_choices` is a native ADK tool that emits one atomic `choice` component after validation. The component crosses the mirrored `chatbot.proto` contracts, is normalized again by the NestJS conversation boundary, persisted with assistant components, and rendered by both the authenticated conversation and widget runtimes.

Schema version 1 uses `questionId`, `prompt`, `presentation` (`quick_replies` or `list`), `selectionMode`, `submitBehavior`, and two to ten options. Options are text-only and contain an opaque ID, display label, and agent-facing `submitText`. They never execute URLs, connectors, or arbitrary actions.

Selection sends the existing ordinary message route with optional `interaction` metadata. The agent receives only the selected `submitText`; the metadata is persisted for UI/audit use. The widget SSE registry subscribes before flushing pending events so an early choice component is not lost.
