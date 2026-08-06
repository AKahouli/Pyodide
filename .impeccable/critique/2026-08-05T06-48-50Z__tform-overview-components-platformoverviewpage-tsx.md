---
target: platform overview page as an English business-user entry point
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 5
timestamp: 2026-08-05T06-48-50Z
slug: tform-overview-components-platformoverviewpage-tsx
---
Method: dual-agent (A: ses_02f5a1b10ffela3FxOIyUFVAJg · B: ses_02f56aa80ffebJE39grSoPRs9u)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|------:|-----------|
| 1 | Visibility of System Status | 2 | Capabilities show no readiness, setup, availability, or beta state. |
| 2 | Match System / Real World | 3 | Categories are legible, but Worky, agents, playbooks, and semantic models need business examples. |
| 3 | User Control and Freedom | 3 | Direct destinations are available, but there is no goal-oriented path to choose or preserve. |
| 4 | Consistency and Standards | 3 | The card system is coherent; naming and language diverge from the broader navigation and requested English role. |
| 5 | Error Prevention | 2 | Governance restrictions are handled, but unconfigured or unavailable capability dead ends are not anticipated. |
| 6 | Recognition Rather Than Recall | 2 | Users must infer how knowledge, semantic models, agents, conversations, playbooks, and Worky connect. |
| 7 | Flexibility and Efficiency | 2 | Direct links help experts, but there are no role-, goal-, recent-, or workflow-based accelerators. |
| 8 | Aesthetic and Minimalist Design | 3 | Calm and readable, but repeated equal-weight cards create scanning monotony. |
| 9 | Error Recovery | 2 | Restricted governance is explained; broader unavailable, empty, or setup-required states are absent. |
| 10 | Help and Documentation | 1 | No examples, glossary, onboarding path, or guidance for choosing the right experience. |
| **Total** | | **23/40** | **Acceptable: strong visual foundation, weak orientation model** |

## Design Specificity Verdict

**LLM assessment:** Moderately product-specific, but still a polished capability directory rather than a true YellowStorm platform story. The four pillars and enterprise language are credible, yet the composition could be reused by another enterprise AI suite with minor copy changes. YellowStorm's distinctive promise - governed knowledge becoming cited answers, controlled agent work, repeatable playbooks, coordinated Worky execution, and inspectable outcomes - is not visible as one connected experience.

**Deterministic scan:** The required source scan returned zero findings for `PlatformOverviewPage.tsx`. Assessment B could not execute the scanner in its isolated runtime, so the parent reran it once as allowed by the critique workflow. The clean result confirms that the main shortcomings are information architecture, product narrative, prioritization, and copy rather than mechanical design-rule violations.

**Visual overlays:** No reliable user-visible overlay is available. Mutable injection succeeded, but the bundled live server failed to start in the parent runtime and was unavailable in Assessment B. Browser screenshots, accessibility trees, responsive measurements, console output, and the clean CLI scan remain the evidence base.

## Overall Impression

The page looks competent and trustworthy at first glance, but it explains the menu rather than the product. Its biggest opportunity is to replace equal-weight feature discovery with a business journey that shows how YellowStorm turns a goal and enterprise information into grounded, governed, repeatable work.

## Cognitive Load

The page has moderate-to-high orientation load despite its calm appearance.

- Pass: content is grouped into four understandable pillars.
- Pass: visual hierarchy and card boundaries are clear.
- Fail: the hero offers two competing starting actions without explaining when to use each.
- Fail: eight capability destinations plus hero and administration controls exceed the four-option decision threshold.
- Fail: users must understand unexplained terms including Worky, agents, playbooks, semantic models, and governance.
- Fail: no visible sequence explains how connected apps, workspaces, semantic models, conversations, agents, playbooks, and Worky depend on each other.
- Fail: all capabilities receive nearly equal weight instead of being prioritized by business goal or maturity.
- Partial: administration is progressively disclosed, but end-user complexity is exposed at once.

## Emotional Journey

- Arrival: calm, polished, and credible.
- Orientation: the four pillars briefly reduce ambiguity.
- Evaluation: confidence drops because capabilities read as isolated modules rather than a coherent operating model.
- Decision: users face too many equally weighted destinations and cannot identify the right starting point.
- Action: a module opens before the page establishes prerequisites, expected outputs, or the next connected step.
- Mobile: the long repeated card stack removes the sense of a platform and turns discovery into scrolling.

## What's Working

1. The knowledge, collaboration, automation, and governance grouping gives the platform an understandable top-level frame.
2. Card construction, typography, iconography, spacing, and full-card links are consistent and accessible; desktop and 390px mobile showed no horizontal overflow.
3. Governance appears as a first-class capability, correctly expressing that control and oversight are integral to the product rather than an administrative afterthought.

## Priority Issues

### [P1] The platform connection model is missing

**Why it matters:** A business user sees destinations but cannot understand the expected end-to-end experience or YellowStorm's differentiation beyond chat.

**Fix:** Make the primary composition a five-stage operating story: **Connect enterprise information -> Ground it in workspaces and semantic models -> Explore through conversations or delegate to agents -> Standardize and coordinate through playbooks and Worky -> Review evidence, approvals, and governance**. Each stage should show one concrete output and link to the relevant capability.

**Suggested command:** `/impeccable shape`

### [P1] The entry architecture is capability-led instead of goal-led

**Why it matters:** A first-time business user must translate a goal into product taxonomy before they can act. The current two hero CTAs do not explain when a conversation or workspace is the correct starting point.

**Fix:** Lead with three or four business intents such as **Answer a question with evidence**, **Build a governed knowledge foundation**, **Automate a repeatable process**, and **Coordinate a complex initiative**. Show the recommended capability chain for each intent; keep the complete module directory secondary.

**Suggested command:** `/impeccable onboard`

### [P1] Important capabilities and boundaries are absent or conflated

**Why it matters:** Semantic models and app builder are missing, while connected applications, marketplace, ingestion, agents, and Worky are not distinguished. The overview therefore cannot serve as an accurate map of the available experience.

**Fix:** Add semantic models explicitly. Separate **Connect apps and import knowledge** from **Build or deploy an application experience** and **Discover apps in the marketplace**. Define Worky as an orchestrator, colleague, or separate experience based on the actual product contract, then show how it uses agents and playbooks.

**Suggested command:** `/impeccable clarify`

### [P1] The copy describes benefits but not product truth

**Why it matters:** Phrases such as "coordinated action," "reliable execution," and "digital colleague" are polished but interchangeable. Decision-makers cannot see cited evidence, structured outputs, schedules, approvals, human handoffs, execution monitoring, budgets, or traceability.

**Fix:** Replace generic descriptions with concise experience statements and representative outputs. For example: "Ask across approved sources and inspect every citation," "Turn a successful analysis into a scheduled, approval-aware playbook," and "Coordinate a goal across tasks, clarifications, reports, and human handoffs."

**Suggested command:** `/impeccable clarify`

### [P1] It does not currently function as the requested English entry point

**Why it matters:** The first design assessment rendered the authenticated surface in French. Business orientation fails immediately when the entry locale does not match the intended audience, and a hard locale override could also violate existing user preference.

**Fix:** Define the route's locale contract: either honor the user's selected locale while making English the default for new English users, or provide an explicit language affordance. Keep all new content in both existing localization resources until language commitments are confirmed.

**Suggested command:** `/impeccable harden`

## Persona Red Flags

### Jordan, first-time business user

- Cannot tell whether to start with a conversation, workspace, semantic model, agent, playbook, or Worky.
- Encounters product terms without examples, prerequisites, or expected deliverables.
- Receives no guided route from a familiar business goal to the right capability chain.
- The observed French interface conflicts with the requested English onboarding role.

### Alex, experienced operator

- Gets no fast path to semantic models, app builder, schedules, execution history, reusable assets, or recently used capabilities.
- Equal-weight cards hide the most frequent and most ready workflows.
- Cannot see capability readiness, such as whether a workspace has approved sources, an agent has tools, or a playbook is executable.

### Morgan, business decision-maker

- Cannot verify the promise of grounded work because citations and evidence are absent from the story.
- Cannot see operational controls such as approvals, budgets, auditability, traceability, and human oversight.
- Has no representative scenario connecting integrations, enterprise knowledge, AI work, automation, and governance to a business result.
- May interpret Worky and "digital colleague" as promotional language because controls and reporting are not explained.

## Minor Observations

- Repeated "Explore" labels waste the most valuable action-copy position; use outcome-specific labels.
- Teams, groups, workspaces, and projects are not conceptually differentiated.
- The administration tab competes for attention before the end-user platform model is understood.
- Mobile needs a concise journey summary or anchored stage navigation before the card directory.
- The document title remains "POC," weakening orientation and trust.
- The current capability cards do not display beta, permission, configuration, or readiness states.

## Questions to Consider

- If YellowStorm's differentiator is not chat alone, why is "Start a conversation" the dominant first action?
- Should users choose a capability, or should YellowStorm recommend the capability chain from their business goal?
- Is Worky the orchestrator of agents and playbooks, a separate product experience, or both?
- Where does enterprise meaning live: connected applications, workspaces, semantic models, or a deliberate progression through all three?
- What single proof point would convince a business decision-maker that "governed" means operational control rather than marketing language?
- Should this page optimize for first-session orientation, repeat visits, or adapt between the two?
