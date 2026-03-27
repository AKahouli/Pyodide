# Playbook Frontend Architecture

## Scope

This document covers the React frontend implementation of the Playbook feature in:

- `front/src/modules/playbook`

It focuses on the editor, store, API layer, and shared SSE behavior.

## Main Responsibilities

The frontend is responsible for:

- rendering the playbook list and canvas editor
- keeping the playbook DAG synchronized with persisted backend state
- providing the inline execution panel and execution history views
- handling interrupt, replay, output-format, and semantic-evaluation UX
- maintaining a shared live-update connection across browser tabs

## Important Files

- `api.ts`: REST client for CRUD, execution, replay, rerun, and output-format endpoints
- `types.ts`: frontend domain contracts
- `store.ts`: main Zustand state and actions
- `services/playbookStreamService.ts`: singleton SSE service with BroadcastChannel leader election
- `hooks/usePlaybookCanvas.ts`: ReactFlow synchronization bridge
- `hooks/useAutosave.ts`: debounced save behavior
- `components/PlaybookCanvasPage.tsx`: main editing page
- `components/ExecutionPanel.tsx`: inline execution experience

## Routing

Main routes:

- `/playbooks`
- `/playbooks/generating`
- `/playbooks/:id`
- `/playbooks/:id/executions`
- `/playbooks/:id/executions/compare`
- `/playbooks/:id/executions/:executionId`

The main operational surface is `PlaybookCanvasPage.tsx`, which combines:

- header and toolbar
- ReactFlow canvas
- execution split panel
- designer panel
- workspace explorer
- node editor

## Store Design

`store.ts` is the center of the frontend feature.

It owns:

- playbook list and pagination state
- current playbook and dirty state
- current execution and execution history
- execution cache
- selected step
- designer state
- execution panel state
- workspace explorer state
- SSE handlers

Important store characteristics:

- execution summaries are kept lightweight
- full executions are cached separately
- API execution reads are merged with fresher SSE state
- execution panel visibility is persisted in local storage
- optimistic updates exist for resume, rerun-step, and resume-from-step flows

## Canvas Synchronization

`usePlaybookCanvas.ts` maps persisted tasks and edges into ReactFlow nodes and edges.

Key behavior:

- prevents cycle creation
- syncs node positions only on drag stop
- avoids update loops between ReactFlow local state and store state
- preserves responsiveness while still supporting autosave

## Autosave

The editor is autosave-driven.

Behavior:

- most graph changes set `isDirty`
- dirty changes increment `dirtyVersion`
- a debounced save persists the playbook
- workspace changes save immediately
- outgoing task payloads are sanitized so derived replay/output-format metadata is not patched back as source-of-truth task config

## Shared SSE Model

`playbookStreamService.ts` uses a single connection model across tabs.

Behavior:

- elects one leader tab via `BroadcastChannel`
- only the leader owns the real `EventSource`
- follower tabs receive relayed events
- followers can request current execution state from the leader
- named backend SSE events are normalized into the same store handlers

Important consumed event types:

- `playbook_execution_start`
- `playbook_step_start`
- `playbook_step_complete`
- `playbook_step_evaluation_updated`
- `playbook_replay_format_guide_updated`
- `playbook_output_format_template_updated`
- `playbook_execution_complete`
- `playbook_interrupt`

## API Surface Used by the Frontend

The frontend uses REST for:

- CRUD
- design and revert
- execution start/resume/stop/skip-step
- active-execution catch-up
- execution history
- replay baseline management
- output-format template management
- rerun-step and resume-from-step

## Mental Model

The frontend is a DAG editor plus a live execution console.

The store is the integration layer between:

- ReactFlow editing
- backend persistence
- SSE execution updates
- execution provenance and evaluation UI

