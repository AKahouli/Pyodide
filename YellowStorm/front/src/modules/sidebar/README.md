# Sidebar Module (Frontend)

The sidebar module renders the application left navigation, conversation history list, and sidebar auto-collapse behavior.

## Overview

- `AppSidebar` composes the navigation shell, history panel, and footer controls.
- `ConversationItem` renders one conversation row with rename/share/delete actions.
- `useAutoCollapse` collapses the sidebar when the viewport shrinks.

## Directory Structure

```text
sidebar/
├── index.ts
├── index.test.ts
├── hooks/
│   ├── index.ts
│   ├── index.test.ts
│   ├── useAutoCollapse.ts
│   └── useAutoCollapse.test.tsx
├── components/
│   ├── index.ts
│   ├── index.test.ts
│   ├── AppSidebar.tsx
│   ├── AppSidebar.test.tsx
│   ├── ConversationItem.tsx
│   └── ConversationItem.test.tsx
└── README.md
```

## Testing

- Tests are colocated with implementation files (`*.test.ts` / `*.test.tsx`).
- Covered behavior includes:
  - sidebar fetch/navigation/history interactions
  - conversation item action flows and typewriter branch
  - auto-collapse resize behavior
  - barrel export integrity

Run sidebar tests from `front/`:

```bash
npm test -- src/modules/sidebar
```

Check duplication threshold (<3%):

```bash
npx jscpd src/modules/sidebar --pattern "**/*.test.{ts,tsx}" --threshold 3 --reporters console
```
