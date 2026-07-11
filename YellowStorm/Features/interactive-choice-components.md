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

Selection sends the existing ordinary message route with `interaction` metadata. The agent receives only selected `submitText`; the metadata is persisted for UI/audit use. The widget SSE registry subscribes before flushing pending events so an early choice component is not lost.

## Submission Authority

Authenticated choice submissions require the persisted assistant `sourceMessageId`. NestJS loads that assistant message in the current conversation, finds and normalizes the referenced `choice` component, and accepts only a ready component with matching `componentId`, `questionId`, and selection mode. Option IDs must exist and be enabled. Browser-provided labels, values, display text, and message content are discarded: labels/values and the agent-facing message are rebuilt from the persisted component. Custom answers are accepted only when the component permits them and within its canonical limit; dismissals require a dismissible component and cannot contain an answer.

This prevents a browser from selecting an unknown/disabled option or substituting arbitrary choice metadata. Historical interactions remain readable. Widget source-message binding and replay prevention are follow-up work because widget choice stream events do not yet expose the persisted assistant message ID.

## Verification

- Backend: `npm test -- --runInBand choice-component-normalizer.spec.ts component-mapper.spec.ts widget-component-normalizer.spec.ts widget-chat.service.spec.ts`
- Frontend: `npm test -- --run widget-renderers.spec.ts widget-template.spec.ts choice-interactions.test.ts`
- ADK: install `requirements.txt`, then `python -m pytest tests/test_tools/test_utilities/test_present_choices.py --no-cov`

For manual widget QA, use the generated embed snippet on an allowed origin, inspect the open Shadow DOM, and verify quick replies wrap while lists remain vertical at a 375px viewport. A repository-managed widget host fixture and browser E2E remain outstanding.
