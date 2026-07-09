# Governance UI/UX Polish Implementation Plan

## 1. Scope
Improve the current Governance module without backend contract changes. The existing model stays intact: cockpit KPIs, scope cards, action queue, scope detail workspace, readiness panel, and lifecycle tabs.

The goal is to make triage and blocker resolution clearer: users should quickly understand what is blocked, why it matters, and where to fix it.

## 2. Success Criteria
- A governance user identifies the next required action within 5 seconds on the cockpit.
- Every blocker explains the missing requirement, consequence, and repair location.
- Scope cards are scannable without opening each scope.
- The detail view behaves like a guided readiness workflow.
- Empty states include a next step.
- Destructive actions are separated from routine actions.
- Mobile layout prioritizes action before secondary metrics.
- All user-facing strings remain in governance i18n files.
- Existing readiness navigation still routes to the correct lifecycle tab.

## 3. Current Findings
### Cockpit
The cockpit has the right sections, but hierarchy is too even. `Governed scopes`, `Average readiness`, `Ready to publish`, `Needs attention`, `Program scopes`, and `To handle` all compete for attention. The page reports state well, but does not strongly guide the next action.

### Scope Cards
Cards show readiness, name, scope type, and top status. They need slightly more operational context: next blocker, ownership state, primary mapped agent name, draft/published state, and latest dry-run state. The always-visible delete icon competes with the primary card action.

### Action Queue
The queue is the strongest cockpit element because it routes to the relevant tab. It should become the command center by showing the blocker, affected scope, reason, and direct action.

### Detail View
The detail view has a strong left-panel + workspace structure. The weakness is sparse tab content after navigation. Example: an Ownership blocker lands on a tab that can say `No collaborators yet` without explaining which assignment is required.

### Mobile
The mobile order should be task-first: header/program selector, action queue, KPI summary, scope list, then secondary details.

## 4. Design Principles
- Make readiness actionable: state, reason, action.
- Keep scope as the primary object.
- Keep deployment, revision, and dry-run data as lifecycle details.
- Use the cockpit for triage and the detail view for resolution.
- Separate destructive actions from routine actions.

## 5. Information Architecture
### Label Cleanup
Update unclear labels:

| Current | Proposed |
|---|---|
| To handle | Action queue |
| Scope cycle | Readiness checklist |
| Next: Ownership assigned | Next: Assign ownership |
| No collaborators yet | No owner assigned |
| Back to cockpit | Back to governance |

Acceptance criteria:
- Labels describe the user task.
- Blocker labels use action-oriented wording.
- Updated labels exist in `en.json` and `fr.json`.

### Header Polish
Target: `YellowStorm/front/src/modules/governance/components/GovernancePage.tsx`

Plan:
- Keep the compact module header and program selector.
- Keep `Create program` as a routine action.
- Move `Delete program` behind a program actions menu or settings affordance.

Acceptance criteria:
- Program deletion is no longer adjacent to routine creation.
- Header remains compact on cockpit and detail states.
- Header does not duplicate sidebar information.

## 6. Cockpit Plan
Target: `YellowStorm/front/src/modules/governance/components/GovernanceCockpit.tsx`

### KPI Filtering
Add local filter state: `all`, `published`, `draft`, `ready`, `needs_attention`.

Behavior:
- Clicking a KPI applies its filter.
- The active filter is shown near `Program scopes`.
- Clearing the filter returns to all scopes.
- The action queue remains based on all scopes.

Acceptance criteria:
- `Needs attention` shows scopes with visible blockers.
- `Ready to publish` shows scopes with ready readiness status.
- `Governed scopes` returns to all scopes.
- Filtering does not navigate away from the cockpit.

### Action Queue Upgrade
Change terse rows into actionable rows:

```text
Assign ownership
gfdgf
Add at least one responsible owner before review.
Open Ownership
```

Each row should include blocker label, scope name, helper line, destination tab label, and direct action affordance.

Acceptance criteria:
- Users can understand the blocker before opening the scope.
- Rows still call `onSelectScope(scopeId, tab)`.
- Rows are keyboard-accessible buttons.

### Empty Queue State
Replace passive empty copy with guidance:

```text
No blockers
All visible readiness checks are currently clear.
Review scopes ready to publish.
```

Acceptance criteria:
- Empty state explains what the absence of blockers means.
- Empty state does not imply automatic publication.

### Scope Card Metadata
Add a compact metadata line with primary agent display name, ownership status, latest dry-run status, and lifecycle state.

Acceptance criteria:
- Scope name remains the strongest card text.
- Long names truncate cleanly.
- Card height stays stable across common states.
- Users can distinguish blocked, draft, published, and ready scopes without opening each one.

### Secondary Delete Action
Move scope delete out of the always-visible primary card surface.

Preferred first pass:
- desktop: show delete on card hover/focus
- touch layout: expose delete through an overflow action
- keep the existing confirmation dialog

Acceptance criteria:
- Main card action is structurally dominant.
- Delete remains keyboard accessible.
- Existing permission and confirmation behavior is preserved.

## 7. Detail View Plan
Targets:
- `YellowStorm/front/src/modules/governance/components/GovernanceScopeLifecycleShell.tsx`
- `YellowStorm/front/src/modules/governance/components/GovernanceReadinessPanel.tsx`
- `YellowStorm/front/src/modules/governance/components/GovernanceScopeWorkspace.tsx`

### Readiness Panel As Workflow Controller
Plan:
- Rename `Scope cycle` to `Readiness checklist`.
- Show the current blocking step with action wording.
- Add one helper sentence for the current blocker.
- Preserve existing tab navigation.

Example:

```text
Next: Assign ownership
Add at least one owner or approver before this scope can move to review.
Go to Ownership
```

Acceptance criteria:
- The first unresolved item is clear.
- Clicking checklist items navigates to the current mapped tabs.
- Internal readiness checks remain hidden from user-facing surfaces.

### Lifecycle Tabs
Plan:
- Keep the existing tab order.
- Add completion/pending indicators for tabs tied to readiness checks.
- Keep horizontal overflow behavior for narrow containers.

Acceptance criteria:
- Users can see complete, current, and pending lifecycle steps.
- Active tab state remains clear.
- Tab labels do not wrap awkwardly.

### Guided Empty States
Each tab empty state should include state title, implication, and primary action.

Examples:

```text
No owner assigned
Assign at least one owner or approver to unblock review.
Invite collaborator
```

```text
No dry-run completed
Run a scoped conversation test before review.
Start dry-run
```

Acceptance criteria:
- Empty states never end at a passive statement.
- The action matches the tab's main task.
- Copy uses governance i18n keys.

### Overview, Ownership, Dry-run, Review
Plan:
- Overview order: scope settings, readiness summary, operational summaries, lifecycle details.
- Show primary agent display name when available; avoid exposing internal ids when a name exists.
- Ownership empty state explains the exact role assignment needed to clear the blocker.
- If collaborators exist but no owner/approver exists, show blocker-specific helper copy.
- Dry-run tab states whether the current draft has passed.
- Review tab explains disabled publish conditions and links back to Dry-run when needed.

Acceptance criteria:
- Editable identity is separated from status summaries.
- Unconfigured lifecycle details link to the relevant tab.
- Existing user/group invite behavior and partial-failure behavior remain unchanged.
- Review does not duplicate dry-run controls.
- Disabled publish state has an actionable reason.

## 8. Responsive Plan
### Cockpit Mobile Order
Order narrow layouts as: header, program selector, action queue, KPI summary, scope list.

Acceptance criteria:
- First mobile viewport includes blocker/action information or a no-blockers state.
- Scope cards do not cause horizontal scrolling.
- Program actions remain reachable.

### Detail Mobile Order
Order narrow detail layouts as: back action, scope title, current blocker summary, tab navigation, active tab content, full readiness checklist.

Acceptance criteria:
- Users do not scroll past the full checklist before fixing the current blocker.
- Desktop sticky behavior does not interfere with mobile scrolling.
- Tabs remain close to the scope title.

## 9. Accessibility And Interaction
Known issue from inspection: a delete action exposed `cockpit.scopes.delete` instead of human-facing text.

Acceptance criteria:
- No untranslated i18n keys appear as visible text or accessible names.
- Icon-only buttons have localized `aria-label` values.
- Delete actions have clear labels and confirmation copy.
- KPI filters, scope cards, secondary actions, action queue rows, and tabs are keyboard reachable.
- `Save changes` is disabled until the draft is dirty and valid.
- Save, invite, dry-run, publish, suspend, and delete have pending states.
- Failed actions use existing error handling and notification helpers.

## 10. Implementation Phases
### Phase 1: Copy And Structure
Files:
- `YellowStorm/front/src/modules/governance/locales/en.json`
- `YellowStorm/front/src/modules/governance/locales/fr.json`
- `YellowStorm/front/src/modules/governance/components/GovernanceReadinessPanel.tsx`
- `YellowStorm/front/src/modules/governance/components/GovernanceCockpit.tsx`

Work: rename unclear labels, add helper copy for blockers and empty states, fix leaked i18n keys, keep behavior unchanged.

Verification:

```text
cd YellowStorm/front
npm run build
```

### Phase 2: Cockpit Triage
Files:
- `YellowStorm/front/src/modules/governance/components/GovernanceCockpit.tsx`
- `YellowStorm/front/src/modules/governance/components/ReadinessRing.tsx`

Work: add KPI filtering, upgrade action queue rows, add compact scope-card metadata, move scope delete into secondary actions.

Browser QA: cockpit renders all scopes, KPI filters update scope list, action queue opens expected tab, scope delete still requires confirmation.

### Phase 3: Detail Workflow
Files:
- `YellowStorm/front/src/modules/governance/components/GovernanceScopeLifecycleShell.tsx`
- `YellowStorm/front/src/modules/governance/components/GovernanceReadinessPanel.tsx`
- `YellowStorm/front/src/modules/governance/components/GovernanceScopeWorkspace.tsx`

Work: treat readiness panel as a workflow controller, add lifecycle indicators, improve guided empty states, improve Overview summaries and display-name fallbacks, clarify Dry-run to Review handoff.

Browser QA: `Go fix it` lands on the correct tab, current blocker remains clear, empty Ownership state explains the action, Review disabled states explain missing prerequisites.

### Phase 4: Responsive Polish
Work: reorder cockpit/detail sections on narrow screens, prevent normal-use horizontal overflow, keep secondary actions reachable on touch layouts.

Browser QA: desktop around 1440px, tablet around 768px, mobile around 390px, first mobile viewport prioritizes action information.

### Phase 5: Focused Tests
Candidate tests:
- `YellowStorm/front/src/modules/governance/components/GovernanceCockpit.test.tsx`
- `YellowStorm/front/src/modules/governance/components/GovernanceReadinessPanel.test.tsx`

Coverage: KPI filtering, action queue tab routing, hidden internal readiness checks, empty queue state, readiness next-action routing.

Verification:

```text
cd YellowStorm/front
npm test -- governance
npm run build
```

## 11. Constraints
- Do not add new libraries.
- Do not introduce a new state-management pattern.
- Keep server-state reads in existing governance query hooks.
- Keep UI-only state local unless it must survive navigation.
- Keep all user-facing strings in `en.json` and `fr.json`.
- Use existing UI primitives under `src/components/ui/`.
- Use `lucide-react` icons where icons are needed.
- Preserve current backend contracts.
- Do not extract `GovernanceScopeWorkspace.tsx` solely for cleanup in this pass.

## 12. Risks And Mitigations
- Scope cards become too dense: limit metadata to two compact lines and move secondary detail to the scope detail view.
- KPI filtering hides important blockers: keep the action queue based on all scopes and show the active filter near the scope list title.
- Copy drifts from backend readiness keys: keep `useGovernanceCheckLabel` as mapping owner and add tests for labels and tab destinations.
- Responsive reordering breaks desktop: use responsive ordering, not duplicate rendered sections, and verify desktop/tablet/mobile.

## 13. Non-Goals
- Backend contract changes.
- Database changes.
- New governance roles or permissions.
- Changes to publish, dry-run, or review business rules.
- Redesign of global sidebar navigation.
- Extraction of the oversized workspace file unless required for safety.

## 14. Final QA Checklist
- [ ] `npm run build` passes in `YellowStorm/front`.
- [ ] Focused governance tests pass if added.
- [ ] No untranslated i18n keys are visible.
- [ ] No untranslated i18n keys appear as accessible names.
- [ ] Action queue routes to expected tabs.
- [ ] KPI filters work and can be cleared.
- [ ] Scope delete still requires confirmation.
- [ ] Ownership empty state explains the required action.
- [ ] Dry-run and Review handoff is clear.
- [ ] Desktop layout remains stable.
- [ ] Mobile layout prioritizes blocker/action information.
- [ ] Browser console has no new errors.
