---
target: playbook Edit Step UI
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-14T10-36-42Z
slug: modules-playbook-components-playbooknodeeditor-tsx
---
Method: dual-agent (A: ses_0002dd76fffec11MhsZPDbr6kK · B: ses_0002c6184ffee7wkakAy84B1Q5)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Debounced autosave and save-on-close have no persistent Saving/Saved/Failed status. |
| 2 | Match System / Real World | 2 | Domain terms are valid but their relationships and precedence are unexplained. |
| 3 | User Control and Freedom | 1 | Closing commits changes; there is no visible cancel/revert path, and type conversion can clear settings. |
| 4 | Consistency and Standards | 3 | The editor follows the product's compact dark system, though native and searchable selects diverge. |
| 5 | Error Prevention | 2 | Required-agent feedback exists, but destructive node-type transitions are not previewed or confirmed. |
| 6 | Recognition Rather Than Recall | 2 | Inherited model, workflow HITL, ports, baselines, and overrides must be mentally composed. |
| 7 | Flexibility and Efficiency | 2 | Search and accordions help, but there is no compact path, section navigator, preset, or readiness jump list. |
| 8 | Aesthetic and Minimalist Design | 2 | Calm styling is undermined by four initially open, equally weighted configuration regions. |
| 9 | Error Recovery | 2 | Inline validation exists, but autosave failure and destructive conversion recovery are not evident. |
| 10 | Help and Documentation | 2 | Helper copy exists, but scope, inheritance, consequences, and recommended defaults remain unclear. |
| **Total** | | **20/40** | **Acceptable; significant simplification needed** |

## Design Specificity Verdict

**LLM assessment:** The editor is recognizably YellowStorm through its governed workflow concepts, semantic dark theme, compact controls, and conditional node configuration. It is not generic CRUD, but its composition is generic: a near-fullscreen stack of uniform accordion cards. Product-specific complexity is exposed as an inventory instead of shaped around the operator's sequence: define purpose, assign execution, verify inputs/outputs, add exceptions, confirm readiness.

**Deterministic scan:** The CLI detector returned zero findings for `YellowStorm/front/src/modules/playbook/components/PlaybookNodeEditor.tsx`. This does not invalidate the usability findings: the detector checks mechanical patterns, while the main failures are information architecture, state communication, and task sequencing. The browser's accessibility audit additionally reported eight fields missing `id`/`name` and five fields without associated labels.

**Visual overlays:** The live modal was reached in an isolated browser assessment, with no relevant runtime or network failures. Mutable injection worked there, but the live detector server could not be launched inside that agent. A parent fallback started the server, but its fresh isolated tab was blocked at authentication, so no reliable user-visible overlay is available.

## Overall Impression

This is a powerful editor that makes users confront the platform's implementation model. The biggest opportunity is to turn it from a configuration warehouse into a guided inspector with a clear basic path, an effective-policy summary, and advanced exceptions disclosed only when needed.

## What's Working

- The header clearly establishes the editing context, task name, and Enabled state.
- Conditional fields and searchable Agent/Model selectors support a large enterprise configuration space.
- The visual treatment is calm and consistent with the incumbent workbench; the problem is hierarchy, not ornament.

## Priority Issues

### P1: The primary edit path is buried

**Why it matters:** Step basics, Execution, Smart HITL, and Data Flow open by default, while Expected result sits between them collapsed. Users cannot tell what is required to make this step ready.

**Fix:** Open one combined `Basics & execution` section by default. Add a sticky readiness summary with required, inherited, modified, and error states. Keep governance, resilience, data-contract detail, and replay history collapsed unless incomplete or recently used.

**Suggested command:** `/impeccable distill`

### P1: Persistence and exit semantics are unsafe

**Why it matters:** The implementation autosaves and flushes on close without a visible saving state or a discard path. Editing a governed workflow feels consequential but provides weak assurance.

**Fix:** Show persistent `Saving`, `Saved`, and `Save failed - Retry` status. Either add explicit Save/Cancel, or clearly state autosave and provide revert/undo until dismissal.

**Suggested command:** `/impeccable harden`

### P1: Node type is treated as harmless metadata

**Why it matters:** The six-option selector can clear agent, model, retry, iterator, router, approval, or port configuration. Users receive no impact preview.

**Fix:** Rename the action to `Convert step`, give each type a one-line purpose, preview affected settings, and confirm destructive conversions while retaining recoverable prior values.

**Suggested command:** `/impeccable clarify`

### P2: Governance concepts are fragmented

**Why it matters:** Enabled, Dynamic Reasoning, Smart HITL, interrupts, and Advisor settings appear in separate regions with different scopes and inheritance. Users must infer the effective runtime policy.

**Fix:** Introduce a compact `Governance & oversight` summary showing workflow defaults and step overrides. Put exception controls behind one Configure action.

**Suggested command:** `/impeccable layout`

### P2: Success is split across unrelated sections

**Why it matters:** Expected result, output ports, evaluation expectation, output format, and Reference Run all describe what good output means, but the editor scatters them across the scroll.

**Fix:** Group them into a `Success contract` section with a simple default view and advanced evaluation/replay controls nested within it.

**Suggested command:** `/impeccable shape`

## Persona Red Flags

**Alex (Power User):** A routine agent-step edit requires scanning multiple open panels, with no section navigator, compact mode, or keyboard-oriented completion path.

**Jordan (First-Timer):** `Node type`, `Dynamic Reasoning`, `Smart HITL`, model inheritance, ports, and reference behavior are introduced without explaining which settings are required versus optional.

**Sam (Accessibility-Dependent):** Browser evidence found unlabeled or unnamed fields. The very long modal also lacks an obvious semantic progress/readiness structure, and silent autosave is difficult to verify non-visually.

## Minor Observations

- `Step basics` contains node conversion, which is an architectural operation rather than basic metadata.
- Equal rounded cards and equal header weights flatten the hierarchy.
- The near-fullscreen modal behaves like a dedicated inspector but lacks inspector navigation and a stable footer.
- The enabled switch is visually detached from persistence and readiness.

## Questions to Consider

- If most steps inherit safe defaults, why foreground capabilities instead of exceptions?
- Is node-type conversion truly editing the same step, or a separate high-consequence operation?
- Could the entire default experience be `Title + Agent + Instructions + Ready`, with everything else summarized below?
