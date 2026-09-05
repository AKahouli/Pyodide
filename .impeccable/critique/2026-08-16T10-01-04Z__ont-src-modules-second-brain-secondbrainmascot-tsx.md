---
target: Yellowmind assistant chatbox
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-16T10-01-04Z
slug: ont-src-modules-second-brain-secondbrainmascot-tsx
---
# Yellowmind Assistant Critique

Method: dual-agent (A: `A-YM-OPERATE-20260816` · B: `ses_ff5febafdffeHJLMTmdh2ikMkI`)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of status | 2/4 | Work states exist, but actions have no destination or lifecycle context. |
| 2 | Match with user language | 2/4 | Raw IDs and generic navigation labels describe implementation, not outcomes. |
| 3 | User control and freedom | 1/4 | A viewport-wide scrim makes the visible Canvas inert. |
| 4 | Consistency and standards | 2/4 | Global and Canvas Yellowmind surfaces compete on the same route. |
| 5 | Error prevention | 2/4 | Identical actions conceal destination and consequence. |
| 6 | Recognition over recall | 1/4 | Users must remember which repeated button belongs to which result. |
| 7 | Flexibility and efficiency | 2/4 | No docking, grouping, deduplication, or compact expert path. |
| 8 | Aesthetic minimalism | 2/4 | A narrow panel suppresses the workbench and repeats heavy controls. |
| 9 | Error recovery | 2/4 | Failures are global rather than attached to the affected action. |
| 10 | Help and guidance | 2/4 | Capability copy does not explain context, effect, or confirmation boundaries. |
| **Total** | | **18/40** | **Poor: redesign required.** |

## Design Specificity Verdict

The branding belongs to YellowStorm, but the interaction is a generic modal chat imposed on an operational Canvas. The product idea of an agent working alongside a governed workflow disappears when opening the agent disables the workflow. The deterministic detector returned zero findings; browser and source inspection exposed semantic interaction defects outside detector rules.

## What's Working

- Clear Yellowmind identity and compact visual primitives.
- Accessible dialog naming, prompt label, and send/close controls.
- Existing semantic tokens support every product theme.

## Priority Issues

- **P1:** The modal scrim blocks the work surface. Replace it with a non-modal desktop sidecar that reflows the Canvas; retain a full-height mobile sheet only where parallel interaction is impossible.
- **P1:** Repeated actions are ambiguous. Deduplicate by destination identity, attach actions to their originating message, and label the actual destination.
- **P1:** Two Yellowmind experiences compete. On a Playbook route, use one docked assistant shell rather than opening global Yellowmind over the Canvas assistant.
- **P2:** Raw identifiers displace meaningful context. Show the Playbook name and compact route context; keep IDs secondary.
- **P2:** Mobile close/send targets are below 44px. Increase touch targets and keep the composer keyboard-safe.

## Persona Red Flags

- **Alex, power user:** modal behavior prevents side-by-side verification; duplicate full-width actions waste scanning time; no compact keyboard-efficient target model.
- **Sam, accessibility-dependent:** identical accessible button names are indistinguishable; translucent Canvas adds noise; action status is not announced locally.
- **Casey, mobile user:** close/send controls are too small; repeated actions force excess scrolling; composer and context compete for limited height.

## Minor Observations

- Capability-heavy introductory copy is less useful than context-aware starter prompts.
- The response treatment resembles generic chat instead of an enterprise action log.
- Execution status lacks compact semantic iconography and timestamps.

## Questions Considered

- Why should opening an operating assistant make the work disappear?
- Should action labels describe Yellowmind, or the destination and effect?
- Can global and Canvas Yellowmind share one route-aware shell?
