# YellowStorm Governance Scope-Centric UX Implementation Plan

## 1. Goal

Rework the Governance experience from a CRUD-oriented operations panel into an intuitive scope-centric lifecycle cockpit.

The admin should be able to configure a governed public assistant network by answering practical setup questions:

- What scope am I configuring?
- Which workspaces and sources belong to this scope?
- Which agents are expected to answer for this scope?
- Which collaborators can edit, review, test, or publish this scope?
- Which public channels expose this scope?
- Is this scope ready to publish?
- What is already public versus still draft?

The product mental model should become:

```text
Program
→ Scope Blueprint
→ Knowledge Mapping
→ Agent Mapping
→ Channel Setup
→ Dry-run
→ Publish
→ Monitor
```

Deployment and revision objects remain backend lifecycle mechanics, but the UI should present them as advanced details behind the selected scope.

---

## 2. Product Principle

Governance should be organized around scopes, not deployments.

Admins think in operational perimeters:

```text
"Make Courbevoie ready with the right knowledge, agents, reviewers, channels, and tests."
```

They do not naturally think:

```text
"Create a deployment revision and bind channel config to it."
```

Therefore:

- Scope is the main workspace in the UI.
- Deployment, revision, dry-run, and publish are lifecycle states of a scope.
- Knowledge and agent coverage are first-class setup steps.
- Readiness is shown continuously, not only during publish.

---

## 3. Target UX Structure

### 3.1 Page Layout

```text
GovernancePage
├── ProgramHeader
├── ScopeLifecycleShell
│   ├── Left: Program + Scope Tree
│   ├── Center: Selected Scope Workspace
│   └── Right: Readiness + Next Actions
└── Advanced drawer/dialogs when needed
```

### 3.2 Left Panel: Program And Scope Tree

Responsibilities:

- Select active program.
- Show scope hierarchy.
- Create scope.
- Show per-scope readiness indicator.
- Highlight scopes missing knowledge, agents, deployment, tests, or channels.

Example scope card states:

```text
Courbevoie       75% ready
Nanterre         Missing agent
Puteaux          Needs dry-run
Global POLD      Published
```

### 3.3 Center Panel: Selected Scope Workspace

Tabs or step cards for the selected scope:

```text
Overview
Knowledge
Agents
Access
Channels
Test & Publish
Monitor
```

Each tab must show one primary objective and one obvious primary action.

### 3.4 Right Panel: Readiness And Next Actions

Always visible for the selected scope.

Shows:

- readiness score
- blockers
- warnings
- next best action
- public versus draft state
- last dry-run result
- channel health summary

Example:

```text
Readiness: 60%

Blockers:
- No agent mapped
- Widget origin missing

Warnings:
- 2 sources need review

Next action:
Map at least one agent to Courbevoie.
```

---

## 4. Scope Workspace Design

### 4.1 Overview Tab

Purpose: give the admin a complete, non-dense status of the selected scope.

Show cards:

- Scope identity: name, type, parent, status.
- Knowledge coverage: shared sources, local sources, mapped workspaces.
- Agent coverage: mapped agents and public/draft status.
- Channel coverage: widget, WhatsApp, Telegram readiness.
- Lifecycle state: draft, dry-run, published, suspended.

Primary action:

```text
Continue setup
```

### 4.2 Knowledge Tab

Purpose: map source workspaces and governed sources to the selected scope.

Capabilities:

- Add program-shared source.
- Add scope-local source.
- Map one or more existing workspaces to the selected scope.
- Show effective knowledge for selected scope:
  - inherited program-shared sources
  - scope-specific sources
  - multi-scope sources
  - revision included sources
  - revision excluded sources
- Flag sources needing review, expired sources, and indexing issues.

Primary action:

```text
Map workspace/source
```

Expected UX:

```text
Effective Knowledge For Courbevoie
├── Shared Program Sources
├── Courbevoie Sources
├── Workspace Mappings
└── Review Blockers
```

### 4.3 Agents Tab

Purpose: map expected agents to the selected scope.

Capabilities:

- Select one or more existing agents for this scope.
- Mark primary agent when multiple agents are available.
- Show whether each agent has knowledge coverage.
- Show draft versus public agent binding when deployment exists.
- Warn when scope has knowledge but no agent, or agent has no knowledge.

Primary action:

```text
Map agent
```

Important rule:

```text
No scope should be publishable without at least one mapped agent.
```

### 4.4 Access Tab

Purpose: invite collaborators in scope context.

Capabilities:

- Add program-wide member.
- Add scope-specific member.
- Show role badges.
- Show what each role can do.
- Prevent scoped collaborators from seeing other scopes.

Primary action:

```text
Invite collaborator
```

### 4.5 Channels Tab

Purpose: configure public exposure for the selected scope.

Capabilities:

- Configure widget.
- Configure WhatsApp.
- Configure Telegram.
- Show real readiness from channel adapters.
- Show channel-specific blockers.
- Copy widget embed snippet when ready.

Primary action:

```text
Configure channel
```

### 4.6 Test & Publish Tab

Purpose: validate draft behavior and publish safely.

Capabilities:

- Run dry-run against selected scope draft revision.
- Simulate channel.
- Ask test questions.
- Show answer, sources, and checks.
- Mark result passed, failed, or needs review.
- Publish ready channels.
- Rollback.
- Suspend.

Primary action before readiness:

```text
Run dry-run
```

Primary action after readiness:

```text
Publish scope
```

### 4.7 Monitor Tab

Purpose: show post-publication governance signals for the selected scope.

Capabilities:

- Usage by channel.
- Unanswered questions.
- Weak sources.
- Source freshness.
- Dry-run pass rate.
- Channel health.
- Feedback/contact requests.

Primary action:

```text
Review weak spots
```

---

## 5. Backend Contract Adjustments

The backend mostly has the right primitives, but the frontend needs scope-centric aggregation endpoints or service methods to avoid assembling too much state client-side.

### 5.1 Add Scope Overview Endpoint

Route:

```http
GET /api/v1/governance/programs/:programId/scopes/:scopeId/overview
```

Response shape:

```ts
interface GovernanceScopeOverview {
  scope: GovernanceScope;
  readiness: GovernanceScopeReadiness;
  knowledge: {
    sharedSources: GovernanceSource[];
    localSources: GovernanceSource[];
    workspaceMappings: GovernanceWorkspaceMapping[];
    reviewBlockers: GovernanceReadinessCheck[];
  };
  agents: {
    mappedAgents: GovernanceMappedAgent[];
    primaryAgentId?: string;
    missingAgent: boolean;
  };
  deployment?: GovernanceDeployment;
  draftRevision?: GovernanceDeploymentRevision;
  publishedRevision?: GovernanceDeploymentRevision;
  channels: GovernanceChannels;
  latestDryRun?: GovernanceDryRun;
  metricsSummary?: GovernanceScopeMetricsSummary;
}
```

### 5.2 Add Workspace Mapping Model Or Extend Source Model

Current source model supports `workspaceId`, but the UX needs explicit workspace-to-scope mapping.

Preferred minimal approach:

- Continue using `GovernanceSource` with `sourceType = manual_record | pdf | web_page | api | spreadsheet`.
- Add a source category or metadata convention for workspace-backed sources.
- Expose workspace mappings in scope overview by querying sources where `workspaceId` is set and scope visibility matches.

Future cleaner approach:

```ts
GovernanceWorkspaceMapping {
  programId: ObjectId;
  scopeId: ObjectId;
  workspaceId: ObjectId;
  status: 'draft' | 'active' | 'disabled';
  mappedBy: ObjectId;
}
```

Recommendation:

```text
Use existing GovernanceSource.workspaceId first. Add a separate mapping schema only if source semantics become overloaded.
```

### 5.3 Agent Mapping

Current backend already has:

```text
GovernanceScope.agentIds
```

Frontend should expose this directly in the scope builder.

Backend should add/update DTO support if missing:

```ts
UpdateGovernanceScopeDto.agentIds?: string[];
```

Readiness should fail if:

```text
scope.agentIds is empty
```

### 5.4 Readiness Should Become Scope-Centric

Current readiness is deployment-centric.

Add scope readiness service:

```ts
GovernanceScopeReadinessService
```

Checks:

- scope exists and active
- at least one mapped agent
- at least one effective source or mapped workspace
- deployment exists
- draft revision exists
- dry-run passed for current draft revision
- selected channels ready
- published revision exists if already public
- no blocking expired source
- no source requiring mandatory review

### 5.5 Effective Context Resolver

Implement the plan formula explicitly:

```text
EffectiveSources =
  Program shared sources
  + Scope-specific sources
  + Multi-scope sources containing current scope
  + Revision explicitly included sources
  - Revision explicitly excluded sources
```

Expose it through scope overview and deployment resolve-context.

---

## 6. Frontend Implementation Plan

### Phase A — Replace Page Skeleton With Scope Lifecycle Shell

Files:

```text
YellowStorm/front/src/modules/governance/components/GovernancePage.tsx
YellowStorm/front/src/modules/governance/components/GovernanceScopeLifecycleShell.tsx
YellowStorm/front/src/modules/governance/components/GovernanceScopeTree.tsx
YellowStorm/front/src/modules/governance/components/GovernanceScopeWorkspace.tsx
YellowStorm/front/src/modules/governance/components/GovernanceReadinessPanel.tsx
```

Acceptance criteria:

- Governance page shows program selector/header.
- Left panel shows scopes.
- Selecting a scope updates center and right panels.
- Empty state guides admin to create first program/scope.
- Existing OperationsPanel is hidden behind advanced mode or replaced.

### Phase B — Scope Builder

Files:

```text
GovernanceScopeForm.tsx
ScopeOverviewTab.tsx
```

Capabilities:

- Create/edit scope name, type, parent.
- Show status and setup checklist.
- Make scope the primary configuration object.

Acceptance criteria:

- Admin can create a scope and immediately configure knowledge/agents from that scope.
- Scope cards show readiness state.

### Phase C — Knowledge Mapping UI

Files:

```text
ScopeKnowledgeTab.tsx
WorkspaceMappingCard.tsx
EffectiveSourcesPanel.tsx
SourceReviewBadge.tsx
```

Capabilities:

- Map workspace as scope source.
- Add local source.
- Show inherited shared sources.
- Show effective sources.
- Show review/indexing/freshness blockers.

Acceptance criteria:

- Admin can see exactly what knowledge a scope will use.
- Scope with no knowledge shows clear blocker.

### Phase D — Agent Mapping UI

Files:

```text
ScopeAgentsTab.tsx
AgentMappingCard.tsx
AgentCoverageWarning.tsx
```

Capabilities:

- Select one or more agents for selected scope.
- Show primary agent.
- Show warnings when agent/source coverage is incomplete.

Acceptance criteria:

- Admin can map expected agents during scope setup.
- Readiness blocks publish when no agent is mapped.

### Phase E — Channels UI

Files:

```text
ScopeChannelsTab.tsx
WidgetChannelCard.tsx
WhatsAppChannelCard.tsx
TelegramChannelCard.tsx
```

Capabilities:

- Show channel readiness from backend.
- Configure channel fields currently supported by deployment DTO.
- Show blockers from real channel adapters once backend supports them.

Acceptance criteria:

- Admin understands which channels are publishable and why.

### Phase F — Test And Publish UI

Files:

```text
ScopeTestPublishTab.tsx
DryRunConversationPanel.tsx
PublishChecklist.tsx
PublishActions.tsx
RollbackSuspendActions.tsx
```

Capabilities:

- Run dry-run for selected scope.
- Mark dry-run result.
- Show readiness checklist.
- Publish ready channels.
- Rollback/suspend.

Acceptance criteria:

- Admin can test draft behavior before publication.
- Publish is blocked with clear reasons.
- Public versus draft state is obvious.

### Phase G — Monitor UI

Files:

```text
ScopeMonitorTab.tsx
ScopeMetricCards.tsx
UnansweredQuestionsPanel.tsx
SourceFreshnessPanel.tsx
```

Capabilities:

- Show metrics scoped to selected scope.
- Show channel usage.
- Show weak sources and unanswered questions.

Acceptance criteria:

- Admin can understand scope health after publication.

---

## 7. Backend Implementation Plan

### Phase 1 — Scope Overview Aggregation

Add:

```text
GovernanceScopeOverviewService
GET /programs/:programId/scopes/:scopeId/overview
```

Responsibilities:

- enforce scope access
- load scope
- load effective sources
- load mapped agents
- load deployment and revisions
- load latest dry-run
- compute scope readiness
- return one UI-friendly aggregate

### Phase 2 — Scope Readiness Service

Add:

```text
GovernanceScopeReadinessService
```

Initial checks:

- scope active
- agents mapped
- sources/workspaces mapped
- deployment exists
- draft revision exists
- channel readiness
- dry-run passed
- no blocking source review/freshness issues

### Phase 3 — Effective Context Service

Add or complete:

```text
GovernanceEffectiveContextService
```

Responsibilities:

- resolve source formula
- deduplicate source IDs
- exclude explicitly excluded sources
- prevent draft/to_review sources in public runtime
- warn on expired/rejected sources

### Phase 4 — Workspace Mapping Support

Minimal first pass:

- expose workspace-backed `GovernanceSource` creation from scope knowledge UI
- ensure `workspaceId` is returned in source responses
- include workspace-backed sources in effective context

Optional later pass:

- add dedicated `GovernanceWorkspaceMapping` schema if source model becomes overloaded

### Phase 5 — Agent Mapping Support

Ensure backend supports:

```text
PATCH /programs/:programId/scopes/:scopeId
body: { agentIds: string[] }
```

Readiness should use `scope.agentIds`.

Deployment creation should default to the selected scope's primary or first mapped agent when possible.

### Phase 6 — Dry-Run Runtime

Implement real dry-run message execution:

- create internal conversation
- resolve draft context
- run selected draft agent through existing conversation/stream service
- persist answer, sources, warnings, and checks
- tie dry-run result to current draft revision

### Phase 7 — Real Channel Adapters

Complete:

```text
WidgetChannelAdapter
WhatsAppChannelAdapter
TelegramChannelAdapter
```

Each adapter should provide:

```ts
getStatus()
validateBeforePublish()
publish()
suspend()
```

Use owning modules only. Do not re-register schemas from widget/WhatsApp/Telegram modules.

### Phase 8 — Monitoring Expansion

Improve metrics attribution:

```text
public agentId
→ published revision
→ deployment
→ scope
→ program
```

Add:

- usage by scope/channel
- unanswered questions
- source freshness
- weak source detection
- dry-run pass rate

---

## 8. Data And Contract Notes

### 8.1 Source Mapping

Admin-facing language should use:

```text
Knowledge
Workspace
Source
```

Backend can still use `GovernanceSource`.

Avoid making admins think in `sourceIds`, `workspaceIds`, or revision internals.

### 8.2 Agent Mapping

Admin-facing language:

```text
Agents expected to answer for this scope
```

Backend field:

```text
GovernanceScope.agentIds
```

### 8.3 Deployment Visibility

Deployment/revision should be shown as lifecycle details:

```text
Draft version
Published version
Last published at
Rollback target
```

Avoid making deployment creation a separate conceptual step unless needed.

### 8.4 Readiness Language

Use human-friendly blocker labels:

```text
No agent mapped
No workspace or source mapped
Widget origin missing
Dry-run not passed
2 sources need review
```

Not:

```text
GOVERNANCE_NO_DRAFT_REVISION
widget_ready failed
```

---

## 9. Migration Strategy From Current UI

### Step 1

Keep existing backend endpoints.

Build new `ScopeLifecycleShell` using existing APIs where possible.

### Step 2

Add scope overview endpoint to reduce frontend query sprawl.

### Step 3

Move current `GovernanceOperationsPanel` behind an advanced section.

### Step 4

Replace CRUD-first forms with scope-first configuration cards.

### Step 5

Add real dry-run and channel readiness once UX structure is stable.

---

## 10. Acceptance Criteria

The redesigned Governance UX is successful when:

- Admins start from a Program and immediately see scopes.
- Scope setup includes agent mapping and workspace/source mapping.
- A selected scope clearly shows what is missing before publish.
- Deployment/revision details do not dominate the primary UI.
- Readiness is visible throughout setup, not only in publish.
- Admins can understand public versus draft state without reading backend concepts.
- Publish blockers are actionable.
- Scoped collaborators only see their scopes.
- The UI remains usable on desktop and mobile.
- All frontend strings use governance i18n.
- All API paths remain in `API_ENDPOINTS.governance`.

---

## 11. Recommended Implementation Order

1. Frontend scope-centric shell and scope tree.
2. Scope overview endpoint.
3. Knowledge mapping tab with workspace/source mapping.
4. Agent mapping tab using `scope.agentIds`.
5. Scope readiness service and right-side readiness panel.
6. Move existing operations panel into advanced lifecycle.
7. Dry-run conversation runtime.
8. Real channel adapters.
9. Monitor expansion.
10. POLD demo bootstrap.
11. Full hardening tests and responsive QA.

This order prioritizes the admin experience first, then strengthens runtime correctness behind it.
