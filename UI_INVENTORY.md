# Playbook UI Inventory — Phase 4 Touch Map

> **Purpose.** Document every existing playbook frontend surface and what (if anything) Phase 4 does to it. The frontend is **refactored in place**, not rewritten — most rows are `preserve` and the agent must not touch them beyond type imports.
>
> **How to use.** Skim the verdicts and flag anything you disagree with. No row-by-row sign-off ritual required; this file is a working reference for the agent (and the reviewer) during Phase 4 sub-phases. Screenshot tests captured against `main` enforce `preserve` and `extend` rows; everything else is enforced by the "reuse, don't recreate" rule in `PLAYBOOK_REWRITE_GUIDELINES.md` §15.

## Verdict legend

| Verdict | Meaning | Phase 4 treatment |
|---------|---------|-------------------|
| **preserve** | Same UI, same UX. Behaviour identical. | Copy existing component as starting point. Retarget to new types only. Screenshot diff = zero. |
| **extend** | Same UI plus new affordances (router handles, conditional edges, iteration grouping, HITL approval, etc.). | Same as preserve + new additions in obvious places. Screenshot diff allowed only in the new-affordance region. |
| **replace** | New design. The concept survives, the implementation is new. | Designed from scratch; reuses shared primitives. New screenshot baseline. |
| **delete** | Feature removed entirely. | Not ported. Translations / API endpoints cleaned up in Phase 6. |
| **new** | Did not exist before. | Designed from scratch; reuses shared primitives. |

## How to read "New affordances"

Anything listed under "New affordances" is mandatory for the row. The agent cannot ship the row without it. Anything not listed must match the existing UI.

---

## 1. Top-level pages

| # | File / Page | Verdict (proposed) | Notes / New affordances |
|---|-------------|--------------------|-------------------------|
| 1.1 | `PlaybookListPage.tsx` | **preserve** | List layout, card grid, filters unchanged. New playbook button retained. |
| 1.2 | `PlaybookCanvasPage.tsx` | **extend** | Same overall page layout (toolbar + canvas + side panels). New affordances: router node creation, conditional edge handles, control/data layer toggle, max-iterations field on router nodes. |
| 1.3 | `PlaybookExecutionPage.tsx` | **extend** | Same page shell. New affordances: iteration grouping in step list, router-decision badges, HITL approval dialog inline, queue-position indicator while queued. |
| 1.4 | `PlaybookExecutionListPage.tsx` | **preserve** | Same list, same filters. Pure retarget. |
| 1.5 | `PlaybookExecutionComparePage.tsx` | **extend** | Comparison still works for trace replay / re-execution. New affordance: iteration-aware diff (per `(taskId, iteration)`). |

---

## 2. Canvas — nodes & edges

| # | File | Verdict (proposed) | Notes / New affordances |
|---|------|--------------------|-------------------------|
| 2.1 | `PlaybookNode.tsx` (step node) | **preserve** | Same shape, ports, status indicators, hover/selection. |
| 2.2 | `PlaybookTriggerNode.tsx` | **preserve** | Same visual, same trigger menu. |
| 2.3 | `PlaybookIteratorContainerNode.tsx` | **extend** | Same container visual. New affordance: explicit "iterator" badge to disambiguate from control-loop. |
| 2.4 | (new) `RouterNode.tsx` | **new** | One handle per `outputLabel` on the right edge of the node, labelled. Body shows `maxIterations` and current iteration count when executing. Reuses step-node shell visually. |
| 2.5 | (new) `HumanApprovalNode.tsx` | **new** | Step-node shell with a pause icon. Body shows approval prompt summary. Pulsing border while pending. |
| 2.6 | (current edges, via React Flow) | **extend** | Sequential edges identical. New: conditional edges rendered dashed with `routerLabel` text along the line; `__error__` edges in alert color. |
| 2.7 | (new) Data-flow layer overlay | **new** | Toggle (icon button on canvas toolbar). When on, thin secondary-color lines from output ports to bound input ports across the canvas. Off by default. |

---

## 3. Canvas — chrome

| # | File | Verdict (proposed) | Notes / New affordances |
|---|------|--------------------|-------------------------|
| 3.1 | `PlaybookToolbar.tsx` (top) | **extend** | Same buttons, layout. New: data-layer toggle, recursion-limit setting access. |
| 3.2 | `PlaybookCanvasFloatingToolbar.tsx` | **preserve** | Zoom, fit, minimap controls unchanged. |
| 3.3 | `PortLabel.tsx` | **preserve** | Same label rendering. |
| 3.4 | `ConnectorSidebar.tsx` | **extend** | Same connector list. New: router and human-approval node kinds in the palette. |
| 3.5 | `WorkspaceExplorerSidebar.tsx` | **preserve** | Workspace files browser unchanged. |
| 3.6 | `ConnectorBindingModal.tsx` | **preserve** | Same binding modal for connector actions. |

---

## 4. Editors

| # | File | Verdict (proposed) | Notes / New affordances |
|---|------|--------------------|-------------------------|
| 4.1 | `PlaybookNodeEditor.tsx` | **extend** | Same drawer, same tabs for step nodes. New tab/section for router nodes: `outputLabels` editor, `maxIterations` field. New tab for human-approval: prompt template, timeout. **Critical new:** per-input-port "Source" picker (the data-binding editor) replacing today's implicit "wired by edge" model. |
| 4.2 | `PlaybookIteratorConfigFields.tsx` | **preserve** | Same fields. Iterator stays its own kind. |
| 4.3 | (new) `RouterNodeEditor.tsx` (section in NodeEditor) | **new** | Labels list (add/remove), default label, max-iterations slider. |
| 4.4 | (new) `DataBindingEditor.tsx` (section in NodeEditor) | **new** | Per input port: source picker (node-output / trigger / state / constant / expression), iteration selector (current / previous / specific N) when source is `node-output` inside a loop. |
| 4.5 | (new) `HumanApprovalEditor.tsx` (section in NodeEditor) | **new** | Prompt template, approval timeout, default action on timeout. |

---

## 5. Execution surfacing

| # | File | Verdict (proposed) | Notes / New affordances |
|---|------|--------------------|-------------------------|
| 5.1 | `ExecutionHeader.tsx` | **extend** | Same status bar. New: queue position when queued, recursion-budget remaining when running. |
| 5.2 | `ExecutionPanel.tsx` | **extend** | Same overall layout. New: collapse-by-iteration toggle. |
| 5.3 | `ExecutionStepList.tsx` | **extend** | Same list rendering for non-looped flows. New: iteration grouping accordion per `(taskId)` when a node has multiple iterations. Router decisions shown as inline badges between iterations. |
| 5.4 | `ExecutionStepDetail.tsx` | **extend** | Same detail panel. New: iteration selector (jump between iterations of the same task), router-decision history for routers. |
| 5.5 | `ExecutionHistoryDropdown.tsx` | **preserve** | Same dropdown. |
| 5.6 | `IteratorResultPanel.tsx` | **preserve** | Same panel for foreach iterator results. |
| 5.7 | `RepeatabilityDetails.tsx` | **replace** | Two metrics now: structural + content. New layout splits them. Same visual language. |
| 5.8 | `BaselineBadgePopover.tsx` | **extend** | Same popover. New: per-iteration baseline targeting. |
| 5.9 | `ArtifactBadge.tsx` | **preserve** | Same. |
| 5.10 | `InputFilesBadge.tsx` | **preserve** | Same. |
| 5.11 | `InputFilesPopover.tsx` | **preserve** | Same. |
| 5.12 | `PlaybookStatusBadge.tsx` | **extend** | Same statuses + new: `queued`, `pending_approval`, `cancelled`. |

---

## 6. HITL / Interrupts

| # | File | Verdict (proposed) | Notes / New affordances |
|---|------|--------------------|-------------------------|
| 6.1 | `InterruptDialog.tsx` | **replace** | Today's interrupt dialog assumes a single point; new dialog supports the `human_approval` node kind with approve / reject / edit-and-continue actions, iteration context, and timeout countdown. Reuses Dialog primitive — same visual language. |
| 6.2 | `HumanFeedbackInline.tsx` | **extend** | Same inline feedback widget. New: tied to `(nodeId, iteration)` so feedback on iteration 2 doesn't overwrite iteration 1. |

---

## 7. Advisor

| # | File | Verdict (proposed) | Notes / New affordances |
|---|------|--------------------|-------------------------|
| 7.1 | `AdvisorResultPanel.tsx` | **extend** | Same panel. New: suggestions scoped to `(nodeId, iteration)`. |
| 7.2 | `AdvisorChangeReviewDialog.tsx` | **preserve** | Same review dialog. |
| 7.3 | `PlaybookNodeAdvisorDialog.tsx` | **preserve** | Same advisor entry dialog. |

---

## 8. Design chat / intent / generation

| # | File | Verdict (proposed) | Notes / New affordances |
|---|------|--------------------|-------------------------|
| 8.1 | `PlaybookDesignerPanel.tsx` | **preserve** | Same design chat panel. Topology-agnostic. |
| 8.2 | `PlaybookIntentBar.tsx` | **preserve** | Same intent bar. Initial output stays DAG-only (loops as later follow-up). |
| 8.3 | `PlaybookGeneratingOverlay.tsx` | **preserve** | Same loading overlay. |

---

## 9. List / cards / shared chrome

| # | File | Verdict (proposed) | Notes / New affordances |
|---|------|--------------------|-------------------------|
| 9.1 | `PlaybookCard.tsx` | **preserve** | Same card visual. |
| 9.2 | `CreatePlaybookDialog.tsx` | **preserve** | Same creation flow. |
| 9.3 | `CloneShareDialog.tsx` | **preserve** | Same clone/share dialog. |
| 9.4 | `PlaybookButton.tsx` | **preserve** | Shared button styling. |
| 9.5 | `PlaybookWorkspaceSelect.tsx` | **preserve** | Same selector. |
| 9.6 | `PlaybookBetaDisclaimer.tsx` | **delete?** | If feature exits beta with the rewrite, delete. **Decision needed.** |
| 9.7 | `PlaybookUsageIndicator.tsx` | **extend** | Same indicator. New: shows queue depth + concurrent-execution count from new limits. |
| 9.8 | `StepComponents.tsx` | **preserve** | Shared step rendering bits. |

---

## 10. Swiper (`components/playbook-swiper/`)

| # | File | Verdict (proposed) | Notes / New affordances |
|---|------|--------------------|-------------------------|
| 10.1 | `playbook-swiper/Header.tsx` | **preserve** | Same. |
| 10.2 | `playbook-swiper/PlaybookCard.tsx` | **preserve** | Same. |
| 10.3 | `playbook-swiper/PlaybooksCarousel.tsx` | **preserve** | Same. |
| 10.4 | `playbook-swiper/VisibilityDots.tsx` | **preserve** | Same. |

> **Question for you:** what surfaces the swiper today? Onboarding? Empty state? If you confirm its entry point I'll lock the verdict.

---

## 11. Schedule (`components/schedule/`)

| # | File | Verdict (proposed) | Notes / New affordances |
|---|------|--------------------|-------------------------|
| 11.1 | `PlaybookScheduleSheet.tsx` | **preserve** | Same schedule sheet. |
| 11.2 | `PlaybookScheduleBadge.tsx` | **preserve** | Same badge. |
| 11.3 | `ScheduleTypeSelector.tsx` | **preserve** | Same selector. |
| 11.4 | `ScheduleActiveToggle.tsx` | **preserve** | Same toggle. |
| 11.5 | `DailyScheduleEditor.tsx` | **preserve** | Same editor. |
| 11.6 | `WeeklyScheduleEditor.tsx` | **preserve** | Same editor. |
| 11.7 | `MonthlyScheduleEditor.tsx` | **preserve** | Same editor. |
| 11.8 | `AdvancedScheduleEditor.tsx` | **preserve** | Same editor. |

---

## 12. New surfaces required by the rewrite

| # | Surface | Verdict | Notes |
|---|---------|---------|-------|
| 12.1 | Data-layer toggle on canvas toolbar | **new** | Icon button; persisted preference in localStorage. |
| 12.2 | Data binding editor (drawer section) | **new** | See 4.4. |
| 12.3 | Router node + editor | **new** | See 2.4, 4.3. |
| 12.4 | Human approval node + editor + dialog | **new** | See 2.5, 4.5, 6.1. |
| 12.5 | Iteration grouping in step list | **new** | See 5.3. |
| 12.6 | Queue position indicator | **new** | See 5.1; rendered inline with status badge when `status: queued`. |
| 12.7 | Trace replay vs re-execute action separation | **new** | Two distinct buttons in execution detail with explicit copy: "Replay trace (deterministic)" / "Re-run (may diverge)". |
| 12.8 | Recursion-limit & max-parallelism settings panel | **new** | Section in flow settings drawer; reads `PLAYBOOK_RECURSION_LIMIT_DEFAULT` / `_MAX` for bounds. |

---

## Summary counts (proposed)

| Verdict | Count |
|---------|-------|
| preserve | ~35 |
| extend | ~15 |
| replace | 2 |
| delete | 0–1 (TBD: beta disclaimer) |
| new | 8 |

If these counts hold after your review, the rewrite preserves the vast majority of your UI exactly as it is today. The user-visible change is: router/iteration/HITL surfaces are added in obvious places; the existing pages and editors gain new sections; nothing is silently restyled.

---

## Open questions for you (please answer before signing off)

1. **Swiper** — what surface uses it today? Onboarding, empty state, list page? (§10)
2. **Beta disclaimer** — does the rewrite mark playbook out of beta? (§9.6)
3. **Compare page (1.5)** — do you actively use it? If not, demote to `delete` to save Phase 4 time.
4. **Repeatability redesign (5.7)** — happy with the "two metrics" split, or keep one combined score?
5. **Data-binding editor placement (4.4)** — section inside the existing NodeEditor drawer, or new modal? I propose section-inside.
6. **Conditional edge styling** — dashed + label is my default. Any brand-specific preference?
7. **HITL dialog placement** — modal blocking the page, or panel inside the execution view? I propose panel inside.
8. **Pages/views I might have missed** — anything not in this inventory that you'd expect to see?

Once you answer those and confirm verdicts, this file is the Phase 4 contract. I'll then capture screenshot baselines on `main` for every `preserve` and `extend` row.
