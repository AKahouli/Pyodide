# Worky Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Worky module UI around an agent-team, voice-first philosophy — mobile-responsive first, then desktop — backed by real data, with the one missing backend hop (per-task agent identity) closed end-to-end.

**Architecture:** The orchestrator already stamps each plan step with the executor sub-agent handling it (`Step.agent`), synced to the client via ElectricSQL (`PgPlanStepRow.agent`). We (Phase A) persist that onto the `WorkyTask` and expose it to the frontend, then (Phases B–E) group tasks by agent, resolve agent identity from the existing `modules/agent` store, derive a per-agent "global status" from that agent's task lanes, and present it in a responsive mobile layout, a turn-based voice session, and a redesigned desktop workspace + dashboard. Design language and tokens come from the approved `Worky_mobile.pen` mockups (dark + `theme-yellowsys`).

**Tech Stack:** Backend — NestJS, Mongoose, `@electric-sql/client`, Jest. Frontend — React 18 + TypeScript, Tailwind v4 (CSS-first, OKLCH tokens, `@theme inline`), shadcn/ui (Radix), lucide-react, TanStack Query, Zustand, Vitest + Testing Library, i18next (`useModuleTranslation`).

## Global Constraints

- **No fabricated data.** Every UI value binds to a real field. Where a design element has no backing (see Flags), it is feature-flagged or degrades gracefully — never mocked into production.
- **Semantic tokens only** for color: `bg-background`, `bg-card`, `bg-primary`, `text-muted-foreground`, `border-border`, etc. New status colors are added as CSS variables in `front/src/index.css` under each theme block, not raw `emerald-500`/`amber-500` classes.
- **Theme:** design target is `<html class="dark theme-yellowsys">`. Do not hardcode hex; use tokens so all four color themes keep working.
- **i18n:** all user-facing strings go through `useModuleTranslation('worky')` and are added to BOTH `front/src/modules/worky/locales/en.json` and `fr.json`. No literal strings in JSX.
- **Backend enum discipline:** the `agent` field is a free-form string from the manager; never enum-constrain it. `replica: 'full'` is already set on the Electric consumer — keep partial-row safety intact.
- **Reuse before create:** `Sheet` (`side="bottom"`), `Avatar`, `Badge`, `Progress`, `Tabs`, `ScrollArea`, `useIsMobile()` (768px) already exist. Do not add `vaul`/new deps without calling it out.
- **Commits:** conventional-commit messages, no AI attribution trailer.

---

## File Structure

**Phase A — Agent data (full-stack)**
- Modify `back/src/modules/worky/electric/worky-electric.contract.ts` — `agent?` already present; no change (documentation only).
- Modify `back/src/modules/worky/electric/worky-electric.mapper.ts` — `mapPlanStep` writes `agent` into `set`.
- Modify `back/src/modules/worky/electric/worky-electric.mapper.spec.ts` — assert agent mapping.
- Modify `back/src/modules/worky/schemas/worky-task.schema.ts` — add `agentKey` field.
- Modify the board serialization (task → API DTO) so `agentKey` reaches the client — locate in `back/src/modules/worky/controllers/*` / `services/worky-task.service.ts`.
- Modify `front/src/modules/worky/types.ts` — add `agentKey` to `WorkyTask`.

**Phase B — Frontend foundation**
- Modify `front/src/index.css` — add `--worky-working/blocked/idle/done` status tokens per theme.
- Create `front/src/modules/worky/agents/agentModel.ts` — `WorkyAgent` type, `deriveAgentStatus`, `groupTasksByAgent`, `resolveAgentIdentity`.
- Create `front/src/modules/worky/agents/useStreamAgents.ts` — hook composing board + agent store into `WorkyAgent[]`.
- Create `front/src/modules/worky/components/agents/AgentAvatar.tsx`, `AgentStatusPill.tsx`, `AgentCard.tsx`.
- Modify `front/src/modules/worky/locales/{en,fr}.json`, `front/src/modules/worky/index.ts` (barrel).

**Phase C — Mobile responsive workspace**
- Create `front/src/modules/worky/components/mobile/WorkyMobileNav.tsx`, `AgentTeamView.tsx`, `TaskDetailSheet.tsx`, `BudgetSheet.tsx`, `ApprovalSheet.tsx`, `ManagerChatSheet.tsx`, `ManagerVoiceBanner.tsx`.
- Modify `front/src/modules/worky/components/WorkyStreamPage.tsx` — responsive branch (`useIsMobile()`).
- Modify `front/src/modules/worky/uiStore.ts` — mobile UI flags.

**Phase D — Turn-based voice mode**
- Create `front/src/modules/worky/voice/useVoiceSession.ts` — the STT→send→await→TTS→re-arm loop.
- Create `front/src/modules/worky/components/voice/VoiceSession.tsx`, `VoiceOrb.tsx`.
- Modify `uiStore.ts` — `voiceOpen`.

**Phase E — Desktop redesign + dashboard**
- Modify `WorkyStreamPage.tsx` desktop branch → focused-center + docked rails; create `WorkyVoiceDock.tsx`.
- Create `front/src/modules/worky/components/desktop/StreamsDashboard.tsx` (or restyle `WorkyPage.tsx`).

---

## Phase A — Agent data layer (full-stack, enabling)

Ships: every task carries a stable `agentKey`, end-to-end from the orchestrator. Independently testable via the mapper spec + a board API assertion.

### Task A1: Map `agent` onto the task in the Electric mapper

**Files:**
- Modify: `back/src/modules/worky/electric/worky-electric.mapper.ts` (`mapPlanStep`, ~lines 83-118)
- Test: `back/src/modules/worky/electric/worky-electric.mapper.spec.ts`

**Interfaces:**
- Consumes: `PgPlanStepRow.agent?: string` (already in contract).
- Produces: `mapPlanStep().set.agentKey: string | null` — the normalized agent key persisted on the task.

- [ ] **Step 1: Write the failing test** — append to `worky-electric.mapper.spec.ts`:

```ts
describe('mapPlanStep agent', () => {
  const base = { session_id: 's1', step_id: 'st1', ordinal: 1, status: 'running', description: 'do it' };

  it('maps a non-empty agent to a trimmed agentKey', () => {
    const { set } = mapPlanStep({ ...base, agent: '  Researcher ' } as any, 'stream-1');
    expect(set.agentKey).toBe('Researcher');
  });

  it('maps a missing/blank agent to null', () => {
    expect(mapPlanStep({ ...base } as any, 'stream-1').set.agentKey).toBeNull();
    expect(mapPlanStep({ ...base, agent: '   ' } as any, 'stream-1').set.agentKey).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && npx jest worky-electric.mapper.spec -t "mapPlanStep agent"`
Expected: FAIL — `set.agentKey` is `undefined`.

- [ ] **Step 3: Implement** — in `mapPlanStep`, add to the returned `set` object:

```ts
agentKey: (row.agent ?? '').trim() || null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd back && npx jest worky-electric.mapper.spec`
Expected: PASS (existing mapper tests still green).

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/worky/electric/worky-electric.mapper.ts back/src/modules/worky/electric/worky-electric.mapper.spec.ts
git commit -m "feat(worky): persist plan-step agent as task agentKey in electric mapper"
```

### Task A2: Add `agentKey` to the task schema

**Files:**
- Modify: `back/src/modules/worky/schemas/worky-task.schema.ts` (after `assigneeId`, ~line 131)
- Test: `back/src/modules/worky/schemas/worky-task.schema.spec.ts` (create if absent, else extend)

**Interfaces:**
- Produces: `WorkyTask.agentKey?: string | null` persisted in Mongo; included in `toJSON`.

- [ ] **Step 1: Write the failing test** — assert the schema path exists and defaults to null:

```ts
import { WorkyTaskSchema } from './worky-task.schema';

it('has an agentKey path defaulting to null', () => {
  const path = WorkyTaskSchema.path('agentKey');
  expect(path).toBeDefined();
  expect(path.options.default).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && npx jest worky-task.schema.spec`
Expected: FAIL — `WorkyTaskSchema.path('agentKey')` is `undefined`.

- [ ] **Step 3: Implement** — add the prop to `WorkyTask`:

```ts
/**
 * plan_steps.agent (Electric source) — which executor sub-agent handled this
 * step, for display/grouping. Free-form string keyed to a chatbot Agent's
 * name/slug. Null for tasks not attributed to an agent.
 */
@Prop({ type: String, default: null, index: true })
agentKey?: string | null;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd back && npx jest worky-task.schema.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/worky/schemas/worky-task.schema.ts back/src/modules/worky/schemas/worky-task.schema.spec.ts
git commit -m "feat(worky): add agentKey field to WorkyTask schema"
```

### Task A3: Ensure `agentKey` is serialized in the board API response

**Files:**
- Inspect/Modify: the task → response mapping used by `GET /worky/streams/:id/board`. Start at `back/src/modules/worky/controllers/worky-task.controller.ts` (or `worky-board.controller.ts`) and `back/src/modules/worky/services/worky-task.service.ts`. If it returns `task.toJSON()`/lean docs directly, no code change is needed — only a test. If it maps to an explicit DTO, add `agentKey`.

**Interfaces:**
- Produces: board response task objects include `agentKey: string | null`.

- [ ] **Step 1: Write the failing test** — in the board controller/service spec, seed a task with `agentKey: 'Researcher'` and assert the serialized board payload includes it:

```ts
it('includes agentKey in the board payload', async () => {
  await taskModel.create({ streamId, title: 'T', lane: 'running', agentKey: 'Researcher' });
  const board = await service.getBoard(streamId.toString());
  const all = Object.values(board).flat();
  expect(all.find((t: any) => t.title === 'T')?.agentKey).toBe('Researcher');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && npx jest worky-task.service.spec` (adjust to the real spec name)
Expected: FAIL if a DTO strips it; PASS immediately if it passes docs through (then this task is test-only and confirms the contract).

- [ ] **Step 3: Implement** — if a DTO/serializer omits it, add `agentKey: task.agentKey ?? null` to that mapping. If the response already passes `toJSON`, no change.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd back && npx jest worky-task.service.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/worky/
git commit -m "test(worky): assert agentKey flows through the board API"
```

### Task A4: Expose `agentKey` on the frontend `WorkyTask` type

**Files:**
- Modify: `front/src/modules/worky/types.ts` (`WorkyTask`, ~lines 142-171)

**Interfaces:**
- Produces: `WorkyTask.agentKey?: string | null` for all frontend consumers.

- [ ] **Step 1: Add the field** (type-only; verified by the Phase B tests that consume it):

```ts
/** Executor sub-agent that handled this task (Electric plan_steps.agent). Null when unattributed. */
agentKey?: string | null;
```

- [ ] **Step 2: Typecheck**

Run: `cd front && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add front/src/modules/worky/types.ts
git commit -m "feat(worky): expose task.agentKey on the frontend type"
```

---

## Phase B — Frontend foundation (agent model + shared components)

Ships: a reusable `WorkyAgent` derivation + the `AgentAvatar` / `AgentStatusPill` / `AgentCard` components rendered from real board data. Independently testable and viewable in isolation.

### Task B1: Status color tokens

**Files:**
- Modify: `front/src/index.css` — add to `:root`, `.dark`, `.theme-yellowsys`, `.theme-yellowsys.dark`, and the `@theme inline` block.

**Interfaces:**
- Produces: utilities `bg-worky-working`, `text-worky-blocked`, `bg-worky-idle`, `bg-worky-done`, etc.

- [ ] **Step 1: Add variables** — in `@theme inline` (near `--color-running`):

```css
--color-worky-working: var(--worky-working);
--color-worky-blocked: var(--worky-blocked);
--color-worky-idle: var(--worky-idle);
--color-worky-done: var(--worky-done);
```

Then in each theme block set values (dark shown; light uses slightly darker variants):

```css
/* .dark and .theme-yellowsys.dark */
--worky-working: oklch(0.75 0.16 162);
--worky-blocked: oklch(0.75 0.16 55);
--worky-idle: oklch(0.62 0.02 60);
--worky-done: oklch(0.72 0.14 235);
```

- [ ] **Step 2: Verify** — temporarily add `<div className="bg-worky-working size-4" />` to a page, confirm it renders green in dark mode, remove it.

Run: `cd front && npx tsc --noEmit` (sanity) — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add front/src/index.css
git commit -m "feat(worky): add semantic status color tokens"
```

### Task B2: Agent model — status derivation + grouping (pure functions)

**Files:**
- Create: `front/src/modules/worky/agents/agentModel.ts`
- Test: `front/src/modules/worky/agents/agentModel.test.ts`

**Interfaces:**
- Consumes: `WorkyTask` (with `agentKey`, `lane`), `Agent` (from `modules/agent/types`).
- Produces:
  - `type WorkyAgentStatus = 'working' | 'blocked' | 'idle' | 'done'`
  - `interface WorkyAgent { key: string; name: string; role: string; initials: string; colorSeed: string; status: WorkyAgentStatus; currentTask: WorkyTask | null; tasks: WorkyTask[]; doneCount: number; totalCount: number }`
  - `deriveAgentStatus(tasks: WorkyTask[]): WorkyAgentStatus`
  - `groupTasksByAgent(tasks: WorkyTask[], resolve: (key: string) => Agent | undefined): WorkyAgent[]`
  - `agentInitials(name: string): string`

- [ ] **Step 1: Write the failing test:**

```ts
import { deriveAgentStatus, groupTasksByAgent, agentInitials } from './agentModel';

const task = (o: Partial<any>) => ({ id: Math.random().toString(), title: 't', lane: 'backlog', agentKey: 'a', ...o });

describe('deriveAgentStatus', () => {
  it('is working when any task is running', () => {
    expect(deriveAgentStatus([task({ lane: 'done' }), task({ lane: 'running' })])).toBe('working');
  });
  it('is blocked when blocked and none running', () => {
    expect(deriveAgentStatus([task({ lane: 'blocked' }), task({ lane: 'done' })])).toBe('blocked');
  });
  it('is done when all terminal-done', () => {
    expect(deriveAgentStatus([task({ lane: 'done' }), task({ lane: 'done' })])).toBe('done');
  });
  it('is idle otherwise', () => {
    expect(deriveAgentStatus([task({ lane: 'backlog' })])).toBe('idle');
  });
});

describe('agentInitials', () => {
  it('takes up to two word-initials', () => {
    expect(agentInitials('Research Agent')).toBe('RA');
    expect(agentInitials('atlas')).toBe('A');
  });
});

describe('groupTasksByAgent', () => {
  it('groups by agentKey and resolves identity', () => {
    const resolve = (k: string) => (k === 'researcher' ? ({ id: '1', name: 'Atlas', role: 'Research' } as any) : undefined);
    const groups = groupTasksByAgent(
      [task({ agentKey: 'researcher', lane: 'running' }), task({ agentKey: 'researcher', lane: 'done' })],
      resolve,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'researcher', name: 'Atlas', role: 'Research', status: 'working', totalCount: 2, doneCount: 1 });
  });
  it('falls back to the raw key as name when unresolved, skips null keys', () => {
    const groups = groupTasksByAgent([task({ agentKey: null }), task({ agentKey: 'x' })], () => undefined);
    expect(groups.map((g) => g.key)).toEqual(['x']);
    expect(groups[0].name).toBe('x');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd front && npx vitest run src/modules/worky/agents/agentModel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `agentModel.ts`:**

```ts
import type { Agent } from '../../agent/types';
import type { WorkyTask } from '../types';

export type WorkyAgentStatus = 'working' | 'blocked' | 'idle' | 'done';

export interface WorkyAgent {
  key: string;
  name: string;
  role: string;
  initials: string;
  colorSeed: string;
  status: WorkyAgentStatus;
  currentTask: WorkyTask | null;
  tasks: WorkyTask[];
  doneCount: number;
  totalCount: number;
}

const TERMINAL_DONE = new Set(['done']);
const isRunning = (t: WorkyTask) => t.lane === 'running' || t.lane === 'review';
const isBlocked = (t: WorkyTask) => t.lane === 'blocked';

export function deriveAgentStatus(tasks: WorkyTask[]): WorkyAgentStatus {
  if (tasks.some(isRunning)) return 'working';
  if (tasks.some(isBlocked)) return 'blocked';
  if (tasks.length > 0 && tasks.every((t) => TERMINAL_DONE.has(t.lane))) return 'done';
  return 'idle';
}

export function agentInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return (words[0][0] + (words[1]?.[0] ?? '')).toUpperCase();
}

export function groupTasksByAgent(
  tasks: WorkyTask[],
  resolve: (key: string) => Agent | undefined,
): WorkyAgent[] {
  const byKey = new Map<string, WorkyTask[]>();
  for (const t of tasks) {
    if (!t.agentKey) continue;
    (byKey.get(t.agentKey) ?? byKey.set(t.agentKey, []).get(t.agentKey)!).push(t);
  }
  return [...byKey.entries()].map(([key, list]) => {
    const agent = resolve(key);
    const name = agent?.name ?? key;
    const status = deriveAgentStatus(list);
    const currentTask = list.find(isRunning) ?? list.find(isBlocked) ?? list[0] ?? null;
    return {
      key,
      name,
      role: agent?.role ?? agent?.agentType?.name ?? '',
      initials: agentInitials(name),
      colorSeed: agent?.id ?? key,
      status,
      currentTask,
      tasks: list,
      doneCount: list.filter((t) => TERMINAL_DONE.has(t.lane)).length,
      totalCount: list.length,
    };
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd front && npx vitest run src/modules/worky/agents/agentModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add front/src/modules/worky/agents/agentModel.ts front/src/modules/worky/agents/agentModel.test.ts
git commit -m "feat(worky): agent grouping + status derivation model"
```

### Task B3: `useStreamAgents` hook

**Files:**
- Create: `front/src/modules/worky/agents/useStreamAgents.ts`
- Test: `front/src/modules/worky/agents/useStreamAgents.test.tsx`

**Interfaces:**
- Consumes: `useWorkyBoard()` (store) or `useBoard(streamId)` (query) for tasks; the agent store (`useAgentStore` from `modules/agent/store`) for `getAgentById` / agents list; `groupTasksByAgent`.
- Produces: `useStreamAgents(streamId: string): { agents: WorkyAgent[]; ungrouped: WorkyTask[] }`.

- [ ] **Step 1: Write the failing test** — render the hook with a mocked board + agent store, assert it returns grouped agents. (Mock `useWorkyBoard` and the agent store with `vi.mock`.) Assert: given two tasks with `agentKey:'researcher'`, one running, the hook returns one agent with `status:'working'`.

- [ ] **Step 2: Run to verify it fails** — `cd front && npx vitest run src/modules/worky/agents/useStreamAgents.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Implement** — flatten the board lanes into a task array, build a `resolve` from the agent store (match `agentKey` against agent `slug` then `name`, case-insensitive), call `groupTasksByAgent`, and compute `ungrouped` (tasks with null `agentKey`) for a fallback bucket:

```ts
export function useStreamAgents(streamId: string) {
  const board = useWorkyBoard();
  const agents = useAgentStore((s) => s.agents);
  const tasks = useMemo(() => Object.values(board ?? {}).flat(), [board]);
  const resolve = useMemo(() => {
    const bySlug = new Map(agents.map((a) => [a.slug?.toLowerCase(), a]));
    const byName = new Map(agents.map((a) => [a.name.toLowerCase(), a]));
    return (key: string) => bySlug.get(key.toLowerCase()) ?? byName.get(key.toLowerCase());
  }, [agents]);
  return useMemo(() => ({
    agents: groupTasksByAgent(tasks, resolve),
    ungrouped: tasks.filter((t) => !t.agentKey),
  }), [tasks, resolve]);
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.
- [ ] **Step 5: Commit** — `feat(worky): useStreamAgents hook composing board + agent store`.

### Task B4: `AgentAvatar` + `AgentStatusPill`

**Files:**
- Create: `front/src/modules/worky/components/agents/AgentAvatar.tsx`, `AgentStatusPill.tsx`
- Test: colocated `.test.tsx`

**Interfaces:**
- `AgentAvatar({ initials, colorSeed, status, size? })` — a status-ring avatar (ring color = status token, body color derived deterministically from `colorSeed`, centered initials). Mirrors the `Avatar` component in `Worky_mobile.pen`.
- `AgentStatusPill({ status })` — capsule with a status dot + localized label; colors from `bg-worky-*`/`text-worky-*`.

- [ ] **Step 1: Write the failing test** — render `<AgentStatusPill status="blocked" />`, assert it shows the localized "Blocked" text and has the `text-worky-blocked` class; render `<AgentAvatar initials="AT" colorSeed="x" status="working" />` and assert "AT" is present.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** both. `AgentStatusPill` maps status→`{ token, i18nKey }`. `AgentAvatar` computes a body color from a small hashed palette of `colorSeed` and applies a 2px ring in the status color. Use `text-worky-*` and inline ring via a wrapping element (ring = `border-2 border-worky-<status>` on a rounded element). All labels via `t('agents.status.<status>')`.

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(worky): AgentAvatar and AgentStatusPill components`.

### Task B5: `AgentCard`

**Files:**
- Create: `front/src/modules/worky/components/agents/AgentCard.tsx`
- Test: `AgentCard.test.tsx`

**Interfaces:**
- `AgentCard({ agent, onOpen })` where `agent: WorkyAgent`. Renders avatar + name/role + `AgentStatusPill`, the current-task line (`agent.currentTask?.title` or a localized "standing by"), and progress (`doneCount`/`totalCount` + a `Progress` bar). Matches the `AgentCard` in the mockup. Calls `onOpen(agent)` on click.

- [ ] **Step 1: Write the failing test** — render with a `WorkyAgent` fixture (name Atlas, status working, currentTask title "Drafting…", done 3/5); assert name, "Drafting…", and "3" all render, and clicking fires `onOpen`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** using `Progress` (value = `doneCount/totalCount*100`), `AgentAvatar`, `AgentStatusPill`. Strings via i18n. Add all new keys to `en.json`/`fr.json`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(worky): AgentCard component`. Add exports to `front/src/modules/worky/index.ts`.

---

## Phase C — Mobile-responsive workspace

Ships: on phones (`< 768px`) the stream page becomes a single-column agent-team view with a bottom nav and bottom-sheet detail/budget/approval/chat. Desktop is untouched this phase.

### Task C1: Mobile UI state

**Files:** Modify `front/src/modules/worky/uiStore.ts`
**Interfaces:** add `mobileTab: 'agents' | 'chat' | 'more'`, `activeSheet: null | 'task' | 'budget' | 'approval' | 'chat'`, and setters.

- [ ] Step 1: Write failing store test (set/read each new field). Step 2: Run → FAIL. Step 3: Implement in the Zustand slice. Step 4: Run → PASS. Step 5: Commit `feat(worky): mobile UI store flags`.

### Task C2: `AgentTeamView` (mobile body)

**Files:** Create `components/mobile/AgentTeamView.tsx` + test.
**Interfaces:** `AgentTeamView({ streamId })` — uses `useStreamAgents`, renders the `ManagerVoiceBanner`, a "Team · N agents" header, a vertical list of `AgentCard`, and (if `ungrouped.length`) a single "Unassigned / AI workers" fallback card. Empty state when no agents.

- [ ] Step 1: Failing test — mock `useStreamAgents` to return 2 agents; assert 2 cards render + header count. Step 2: FAIL. Step 3: Implement. Step 4: PASS. Step 5: Commit.

### Task C3: `TaskDetailSheet`, `BudgetSheet`, `ApprovalSheet`

**Files:** Create the three under `components/mobile/`, each a `Sheet side="bottom"`. Reuse existing data hooks (`useTaskOps`, `useStreamBudget`/`updateStreamBudget`, `useRespondInteraction`). These wrap EXISTING behavior in the new sheet chrome — no new backend.
**Interfaces:** each `({ streamId, open, onOpenChange, ... })`. `TaskDetailSheet` shows assignee agent (via `resolve`), description, dependencies, result, and the existing task controls. `ApprovalSheet` maps to the current `interaction.requested` approval payload and calls `respondInteraction(id, content, { approve })`.

- [ ] Per sheet: Step 1 failing render test (open=true shows title + primary action). Step 2 FAIL. Step 3 implement with `Sheet`. Step 4 PASS. Step 5 commit. (Three commits.)

### Task C4: `ManagerVoiceBanner` + `WorkyMobileNav`

**Files:** Create `components/mobile/ManagerVoiceBanner.tsx` and `WorkyMobileNav.tsx` + tests.
**Interfaces:**
- `ManagerVoiceBanner({ streamId, onTalk })` — compact CoS row showing the live phase from `OrchestratorStatusHeader` data (`useWorkyStreaming`/store phase) + a mic affordance; `onTalk` opens the voice session (Phase D; until then it opens the chat sheet).
- `WorkyMobileNav({ active, onChange, onVoice })` — the bottom capsule tab bar with the centered voice button (Home/Agents/◉/Chat/More), matching the mockup. Icons from lucide-react. `onVoice` triggers the voice session.

- [ ] Test each (active tab highlighted; onVoice fires). TDD cycle each. Commit each.

### Task C5: Wire the mobile branch into `WorkyStreamPage`

**Files:** Modify `WorkyStreamPage.tsx`.
**Interfaces:** when `useIsMobile()` is true, render `StatusBar-less` mobile layout: header (stream title + status), `AgentTeamView`, `WorkyMobileNav`, and the sheets driven by `uiStore.activeSheet`. Keep the existing desktop 3-column layout for `>= 768px` (unchanged until Phase E). Preserve all existing SSE wiring (it lives in the page and must run for both branches).

- [ ] **Step 1: Write the failing test** — render `WorkyStreamPage` with `useIsMobile` mocked true; assert `AgentTeamView` + `WorkyMobileNav` present and the desktop `StreamSidebar` is NOT rendered.
- [ ] Step 2: FAIL. Step 3: Implement the branch (extract the SSE/effect wiring so it runs regardless of branch). Step 4: PASS. Step 5: Commit `feat(worky): mobile-responsive stream workspace`.

### Task C6: Manager chat as a mobile sheet

**Files:** Create `components/mobile/ManagerChatSheet.tsx` (wraps existing `ChatMessageThread` + `PromptBar` inside `Sheet side="bottom"`, near-fullscreen), open from nav "Chat" and the banner.
- [ ] TDD: failing render test (open shows the thread + composer) → implement → PASS → commit.

---

## Phase D — Turn-based voice session

Ships: a voice UI that chains the EXISTING STT (`useAudioRecorder` + `transcribeAudio`) and TTS (`synthesizeSpeech`) into a half-duplex loop. **Flag:** honestly not streaming/duplex — documented in-code and in a tooltip.

### Task D1: `useVoiceSession` loop

**Files:** Create `voice/useVoiceSession.ts` + `useVoiceSession.test.tsx`.
**Interfaces:** `useVoiceSession(streamId): { state: 'idle'|'listening'|'thinking'|'speaking'; transcript: {you?: string; manager?: string}; start(): void; stop(): void; mute(): void }`. Composes: `useAudioRecorder` (auto-stop on silence) → `transcribeAudio(blob)` → `sendMessage` → await the next `manager` message (subscribe to store `messages`/SSE `message.appended`) → `synthesizeSpeech(text)` → play → re-arm mic. All existing APIs; no new endpoint.

- [ ] **Step 1: Failing test** — mock the recorder + `transcribeAudio` + `sendMessage` + `synthesizeSpeech`; drive one full cycle; assert state transitions idle→listening→thinking→speaking→listening and that `sendMessage` was called with the transcript.
- [ ] Step 2: FAIL. Step 3: Implement the state machine (guard against overlapping cycles; stop on `stop()`). Step 4: PASS. Step 5: Commit `feat(worky): turn-based voice session loop`.

### Task D2: `VoiceOrb` + `VoiceSession`

**Files:** Create `components/voice/VoiceOrb.tsx`, `VoiceSession.tsx` + tests. Matches the mockup (glowing orb, state label, transcript strip, mute/end/keyboard controls). `VoiceSession({ streamId, open, onOpenChange })` drives `useVoiceSession`; the orb reflects `state`.
- [ ] TDD: failing test (state 'listening' shows the localized "Listening…" label; End calls `onOpenChange(false)` + `stop()`), implement, PASS, commit.

### Task D3: Hook voice into mobile nav + banner

**Files:** Modify `WorkyStreamPage.tsx` / `uiStore.ts` (`voiceOpen`). `WorkyMobileNav.onVoice` and `ManagerVoiceBanner.onTalk` open `VoiceSession`.
- [ ] TDD: failing test (tapping the nav voice button sets `voiceOpen` and renders `VoiceSession`), implement, PASS, commit.

---

## Phase E — Desktop redesign + dashboard

Ships: the desktop stream page becomes focused-center + docked rails with the agent grid and a persistent voice dock; `WorkyPage` becomes the streams dashboard. Reuses all Phase B/D components.

### Task E1: Desktop agent grid in the center pane

**Files:** Modify `WorkyStreamPage.tsx` desktop branch to render the `AgentCard` grid (2-up) as the default center view, keeping the Board/Graph toggle to switch back to `KanbanBoard`/`WorkyGraphBoard`.
- [ ] TDD: failing test (desktop shows agent grid by default; toggling to "Board" shows `KanbanBoard`), implement, PASS, commit.

### Task E2: `WorkyVoiceDock`

**Files:** Create `components/desktop/WorkyVoiceDock.tsx` — the bottom-center gold dock that opens `VoiceSession`. Rendered in the desktop branch.
- [ ] TDD: failing test (clicking the dock sets `voiceOpen`), implement, PASS, commit.

### Task E3: Docked collapsible rails

**Files:** Modify `WorkyStreamPage.tsx` — left `StreamSidebar` and right context/activity rail become collapsible (reuse the existing `orchestratorOpen`/slide-over pattern + a new left-collapse flag in `uiStore`). Right rail shows the live SSE activity feed (accumulated in-session) + budget mini.
- [ ] TDD: failing test (collapse toggles hide/show rails), implement, PASS, commit. **Flag:** activity feed is live-only (no persisted history) — note in-code.

### Task E4: Streams dashboard

**Files:** Restyle `WorkyPage.tsx` (or create `components/desktop/StreamsDashboard.tsx` used by it) — KPI tiles + stream-card grid. KPIs: **Active streams** (client-derived from `useStreams` filtered by status) and per-stream progress are real; **"Agents working"** and **"Tasks done today"** are **Flagged** — render only if cheaply derivable from already-loaded data, else omit with a code comment linking to the missing aggregate endpoint. No fan-out of N budget calls.
- [ ] TDD: failing test (renders active-streams count from a mocked `useStreams`), implement, PASS, commit.

---

## Flags — carried into code as comments + a short `docs/superpowers/plans/worky-redesign-flags.md`

1. **Agent identity avatar** — no stored avatar; we derive initials + deterministic color. If real avatars are added to `Agent`, swap `AgentAvatar` body for the image. (Backed otherwise — resolved in Phase A/B.)
2. **Live voice session** — built as **turn-based** half-duplex (Phase D). True streaming/duplex voice (WebRTC/streaming STT+TTS) is NOT built; UI documents this.
3. **Activity feed history** — live-only (SSE accumulated in session). No persisted/scrollback endpoint exists (Phase E3).
4. **Dashboard aggregates** — "Agents working" and "Tasks done today (cross-stream)" have no endpoint; only client-derivable KPIs shipped (Phase E4).
5. **`agentKey` population upstream** — depends on the manager actually emitting `Step.agent`. Until it does for AI tasks, agent groups may be sparse and the "Unassigned/AI workers" fallback card carries them (Phase C2). No fabricated agents.

---

## Self-Review

- **Spec coverage:** agent-grouped view → A+B+C2/E1; voice-first → D; manager chat hidden/reachable → C6; bottom-center voice button → C4/E2; mobile responsive → C; desktop focused-center + docked + dock → E1/E2/E3; dashboard → E4; full-stack agent link → A. All covered.
- **Type consistency:** `agentKey` used identically in A2/A3/A4/B2/B3. `WorkyAgent`/`WorkyAgentStatus` defined once in B2 and consumed in B3/B4/B5/C2. `useVoiceSession` return shape defined in D1, consumed in D2/D3.
- **Placeholders:** logic-bearing tasks (A1, B2, B3, D1) carry full code + tests; pure-presentational tasks (B4/B5/C/E) specify exact props, data sources, i18n, and TDD cycle, and defer visual detail to the approved `Worky_mobile.pen` mockups by design.
- **No fabricated data:** every flagged gap degrades or is omitted, never mocked.
