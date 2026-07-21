# YellowStorm Playbooks — Multi-Step AI Workflow Orchestrator

## Elevator Pitch

YellowStorm Playbooks transform AI from a single-turn chat into a **repeatable, multi-step, agentic workflow**. Think of it as a visual DAG builder and execution engine where each node is an AI agent task and edges define the flow of data and control. Playbooks are the automation layer for AI: design once, schedule, share, and replay at scale.

---

## What It Is

A playbook is a **directed acyclic graph (DAG) of AI agent steps** — a program for a team of LLM-powered agents. Users build workflows on a visual canvas (ReactFlow) and execute them through a real-time streaming runtime that orchestrates agents across steps, handles conditional branching, iteration, human approval gates, and structured output formatting.

| Capability | Summary |
|---|---|
| **Visual DAG Editor** | Drag-and-drop canvas to compose multi-step agent workflows |
| **AI Generation** | Describe a workflow in natural language; the system generates the full DAG |
| **AI Designer** | Iteratively refine a playbook through chat conversation |
| **Real-Time Execution** | Live SSE-streamed step-by-step execution with auto-follow |
| **Human-in-the-Loop** | Pre-execution approval, post-execution review, and clarification interrupts |
| **Scheduled Runs** | Daily, weekly, monthly, or advanced cron-style execution schedules |
| **Execution History & Comparison** | Browse past runs and compare them side-by-side |
| **Replay & Output Templates** | Re-run individual steps with refined prompts; enforce structured output schemas |
| **Sharing & Collaboration** | Share playbooks via email (creates independent copies for recipients) |
| **Scalable Runtime** | gRPC-backed Python ADK runtime with graph caching and checkpoint persistence |

---

## Who It's For

- **AI Engineers & Developers** — Build, test, and iterate on multi-agent pipelines
- **Operations Teams** — Automate recurring AI workflows on a schedule
- **Knowledge Workers** — Turn complex multi-step research and analysis into repeatable playbooks
- **Product Teams** — Embed structured AI workflows into user-facing features

---

## Key Features in Detail

### 1. Visual Workflow Canvas

A ReactFlow-powered editor that provides an IDE-like experience for composing AI agent workflows.

- **Node types**: `step` (agent task), `router` (conditional branching), `iterator` (loop over inputs), `human_approval` (HITL gate)
- **Auto-layout**: Dagre-based left-to-right DAG layout at the click of a button
- **Drag-to-connect**: Draw edges between nodes; cycle detection built in
- **Resizable split view**: Edit the canvas and monitor execution simultaneously
- **Undo/redo**: Full snapshot-based undo/redo for safe experimentation
- **Context menu**: Clone, edit, execute individual steps, or delete nodes
- **Autosave**: Debounced delta-based persistence (1s debounce) for worry-free editing
- **Execution schedule sheet**: Configure recurring runs directly from the canvas toolbar

### 2. AI-Assisted Authoring

Two complementary AI modes for creating and refining playbooks without manual DAG assembly.

- **Auto Builder**: "Create a research-and-summarize workflow" → system generates a complete DAG with appropriate agents, routing, and structure
- **AI Designer**: A chat panel on the right side of the canvas. Describe changes in natural language: "Add a validation step after research" or "Change the writing agent to use GPT-4". Full message history with **revert-to-snapshot** support
- **Undo/redo** across AI-assisted edits

### 3. Real-Time Execution Engine

Plays the DAG through a distributed execution pipeline.

1. Frontend dispatches `POST /playbooks/:id/execute`
2. NestJS backend persists a `FlowExecution` record and normalizes the DAG into a gRPC flow snapshot
3. Python ADK runtime receives the snapshot, builds (or retrieves from cache) a LangGraph, and executes
4. Events stream back through gRPC → NestJS → SSE → browser
5. Frontend merges events into the execution state: step status, output components, tokens, timing

**SSE event types**: execution start, step start, step complete, evaluation updated, replay format guide updated, output format template updated, execution complete, execution error, interrupt.

**Cross-tab SSE**: Uses BroadcastChannel leader election so only one browser tab holds the SSE connection; all tabs receive events.

### 4. Human-in-the-Loop (HITL)

Three interrupt modes that pause execution for human judgment:

| Mode | When | UX |
|---|---|---|
| **Clarification** | Before a step executes | User provides additional context via textarea |
| **Pre-execution Approval** | Before a step runs | Approve/reject with optional reason |
| **Post-execution Review** | After a step completes | Review output, approve/reject, provide feedback |

In all cases, the workflow pauses at the interrupt node. The user responds inline (or via a modal dialog), and the runtime resumes from that point with the provided input.

### 5. Scheduling & Automation

Recurring playbook execution without manual intervention.

- **Daily**: One or more times per day (HH:mm)
- **Weekly**: Per-weekday slots with individual times
- **Monthly**: Day-of-month slots with next-occurrence preview
- **Advanced**: Weekdays-only, weekends-only, or every-N-days variants
- **Active toggle**: Enable/disable without losing configuration
- **Backend schedule runner**: NestJS cron service checks due playbooks, triggers execution with `executionTrigger: 'scheduled'` metadata

### 6. Execution History & Comparison

- **History dropdown** in the execution panel: switch between past runs without leaving the canvas
- **Full execution list** at `/playbooks/:id/executions` with pagination and status badges
- **Side-by-side comparison** of any two executions: per-step status, duration (with % delta), token usage, model names
- **Aggregate view**: run duration, total tokens, completion rate

### 7. Replay & Output Formatting

Refine individual steps after seeing results.

- **Validate replay**: Preview what a step would produce with a modified prompt
- **Activate replay**: Replace a step's result with the refined version
- **Output format templates**: Grab a step's output schema, edit it, and enforce it on the next execution — ensuring consistent structured output
- **Format guide updates**: Guide the replay engine with format specifications

### 8. Sharing & Collaboration

- **Clone & Share**: Share via email (comma or enter-separated). Each recipient receives an independent copy of the playbook
- **Favorites**: Star playbooks for quick filtering
- **Bulk operations**: Select-and-delete, bulk delete with confirmation

---

## Architecture

```
┌──────────────┐     REST/SSE      ┌──────────────┐     gRPC       ┌──────────────────┐
│   Browser    │◄─────────────────►│   NestJS 10  │◄──────────────►│   Python ADK     │
│   React 18   │                   │   MongoDB    │                │   LangGraph      │
│   ReactFlow  │   SSE stream      │   Controllers│                │   LiteLLM        │
│   Zustand    │   (step events)   │   Services   │   Proto buf    │   Checkpoints    │
└──────────────┘                   └──────┬───────┘                └──────────────────┘
                                          │
                                    ┌─────┴──────┐
                                    │   MongoDB   │
                                    │ Documents:  │
                                    │ - Flow      │
                                    │ - Execution │
                                    │ - Replay    │
                                    │ - Schedule  │
                                    └─────────────┘
```

### Stack

| Layer | Technology | Role |
|---|---|---|
| **Frontend** | React 18, Zustand, ReactFlow, Tailwind CSS, Radix UI | Visual DAG editor, execution console, history browser |
| **Backend** | NestJS 10, Mongoose 8, Passport JWT | REST API, SSE streaming, gRPC orchestration, schedule runner |
| **Database** | MongoDB 6+ | Playbook documents, execution records, checkpoints |
| **AI Runtime** | Python 3.12+, LangGraph, Google ADK, LiteLLM | DAG compilation, agent execution, HITL interrupt handling, graph caching |
| **Communication** | gRPC (backend → runtime), SSE (backend → browser) | Type-safe inter-service, native browser streaming |

### Data Model

- **Flow** — The playbook document: `nodes[]`, `controlEdges[]`, `dataBindings[]`, owner, revision, workspace context, trigger config, HITL settings, execution schedule
- **FlowExecution** — A single run: status, flow snapshot at execution time, input context, checkpoint/thread ID, `taskResults[]` with per-step outputs, tokens, timing, pending approvals, audit events
- **Node** — A step in the graph: kind (`step` / `router` / `iterator` / `human_approval`), assigned agent, input/output ports, template, model, retry policy, routing rules, iteration config

---

## User Workflow

### Create

```
Manual:   Name + Description → empty canvas → drag & compose
Auto:     Describe intent → AI generates DAG → review & refine
Designer: Open chat → "Add a validation step" → AI modifies → revert if needed
```

### Execute

```
Click Run → SSE stream begins → Step turns yellow (running) →
Auto-follow tracks progress → Human approval pauses →
User responds → Execution resumes → Green (complete) or Red (failed)
```

### Iterate

```
View execution history → Compare two runs →
Replay a step with refined prompt → Update output format template →
Re-execute with improvements → Schedule for daily automation
```

### Share

```
Open share dialog → Enter email(s) → Each recipient gets an independent copy
```

---

## Current Status

- **Phase**: Beta (active development, production deployments)
- **Frontend**: ~190 files across 15+ components, 3 custom hooks, Zustand store with 50+ actions, full i18n (en/fr)
- **Backend**: Full REST API surface with CRUD, execution, schedule, replay, HITL, and sharing controllers; gRPC runtime client; Mongoose schemas with optimistic concurrency
- **AI Runtime**: Python ADK service with dynamic LangGraph compilation, graph caching, checkpoint persistence, cancellation queues, and replay modes
- **Tests**: Colocated unit/integration tests across all three tiers (frontend Vitest, backend Jest, ADK Pytest)
- **Schedule runner**: NestJS cron service with due-playbook detection and automated execution

---

## Roadmap Highlights

- Rich **evaluation baselines** for comparing output quality across runs
- **Trigger integrations** (webhook, email, Slack) for event-driven execution
- **Playbook templates marketplace** (pre-built workflow blueprints)
- **Advanced branching** with parallel step execution
- **Role-based access control** for playbook editing and execution
- **Versioning and rollback** for playbook revisions

---

## Competitive Differentiation

| Dimension | YellowStorm Playbooks | Typical Alternatives |
|---|---|---|
| **Authoring** | Visual DAG + AI generation + chat-based designer | Visual-only or code-only |
| **Execution** | Real-time SSE streaming with auto-follow | Polling or post-hoc results |
| **HITL** | 3 interrupt modes (pre/post/clarification) | Limited to simple approval |
| **Scheduling** | Daily/weekly/monthly/advanced with active toggle | Often absent or basic cron |
| **Replay** | Per-step replay with format templates | Full re-run only |
| **Architecture** | gRPC runtime + NestJS orchestration + SSE frontend | Monolithic or single-service |
| **Cross-tab SSE** | BroadcastChannel leader election with catch-up | Single-tab or no streaming |
| **History** | Side-by-side comparison with % deltas | Simple list view |
