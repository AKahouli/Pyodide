---
target: "Left sidebar at http://localhost:5174/#/semantic-models"
total_score: 18
max_score: 32
na_heuristics: 5,9
p0_count: 0
p1_count: 2
timestamp: 2026-10-09T13-08-26Z
slug: ront-src-modules-sidebar-components-appsidebar-tsx
---
Method: dual-agent (A: /root/sidebar_design_assessment; B: /root/sidebar_evidence_assessment), with authenticated live browser verification by parent. Design assessment used the user screenshot independently of detector output. Evidence assessor's fresh browser was unauthenticated; parent supplied direct live measurements and interactions. No runtime edits.

Target: YellowStorm/front/src/modules/sidebar/components/AppSidebar.tsx, observed at http://localhost:5174/#/semantic-models.

The incumbent dark theme, Yellowmind brand, consistent icons, labeled destinations, search shortcut and grouped navigation are worth retaining. The largest opportunity is better allocation of vertical space and predictable access to nested destinations, not a replacement visual identity.

| Heuristic | Score | Evidence |
|---|---:|---|
| System status/location | 2 | Page title clear, selected Business Models navigation item initially clipped |
| Match with real world | 2 | Familiar destinations; Launcher label and plus affordance can imply creation |
| User control/freedom | 3 | Launcher dismisses via Escape and collapse can be reversed; group shortcut changes destination unexpectedly |
| Consistency | 3 | Coherent labels/icons/theme; expanded and collapsed group behavior differs |
| Error prevention | n/a | No consequential actions tested |
| Recognition | 2 | Many labeled destinations exist but are outside initial navigation viewport |
| Efficiency | 2 | Search shortcut and Launcher offer alternatives; navigation and history require separate scrolling |
| Minimalist hierarchy | 2 | Calm styling; large header and constrained scroll regions waste space |
| Error recovery | n/a | Actual failure paths untested |
| Help/documentation | 2 | Search shortcut and accessible control names; Launcher scope needs clearer wording |
| Total | 18/32 | Partial assessment; meaningful navigation improvements needed |

Design specificity: the vocabulary and enterprise theme fit the product. Much of the shell is a standard app rail; character should come from precise hierarchy, predictable route indication and useful recent work, rather than more decorative styling.

Priority suggestions:

1. [P1] Remove fragmented scrolling and horizontal overflow. The live upper pane has clientHeight about 230px for scrollHeight 560px; it is capped at max-height 65% while History gets a second scroll area. Its clientWidth is 245px versus scrollWidth 253px. A source-backed candidate is nested w-full plus ml-4; parent measurements confirm actual overflow, but no code fix has been applied. Use one central vertical scroll area between fixed header/footer; fit primary destinations at usual desktop heights and allow scrolling on short windows. Use indentation inside available width, never horizontal navigation scrolling. Suggested command: layout.
2. [P2] Compact the brand and starting actions. In the live 639px-high browser, navigation starts about 192px down. Bring the logo and collapse control into a compact header, then global Search and a prominent New chat action. Make Launcher secondary and clarify its scope, for example All tools. Its menu repeats most sidebar links but also contains Connected Apps and Teams, so retain those destinations if restructuring. Suggested command: distill.
3. [P1] Keep the current destination visible and make collapsed groups predictable. Business Models is styled as active, but its row can start clipped under Knowledge. Expand the current route's branch and reveal its item when navigating; highlight Knowledge when a child is current. In collapsed mode parent measured Knowledge data-active=false, then clicked it: it expanded the rail and navigated to /workspace. Prefer a flyout containing Workspaces and Business Models so users choose their destination. Suggested command: clarify.
4. [P2] Make recent conversations useful. History shows one truncated Today title and a Yesterday heading at the tested short viewport. Prefer a small recent list of 3–5 conversations and an always-findable All chats link; use more available space at taller heights. Avoid date headings consuming most of a tiny pane. Preserve full titles through accessible tooltip/focus treatment. Suggested command: layout.
5. [P2] Clarify navigation grouping without hiding functionality. Worky performs delegated work and could sit beside Projects in Work; keep agent/playbook configuration together and Workspaces/Business Models together. Place Administration with Govern or in the account/admin area, subject to user preference. Treat this as an optional information-architecture pass after geometry is fixed, not a reason to delete destinations. Suggested command: shape.

Suggested vertical order: compact brand/collapse; search; New chat; stable grouped destinations; recent chats/All chats; anchored account/theme footer. Keep approximately the current CSS rail width (about 256px); the attached screenshot's 320 image pixels do not establish a 320px CSS width. Fix vertical space and overflow before narrowing the rail.

Personas: first-time users must interpret Launcher versus New chat; returning users recognize too few recent conversations; keyboard users need logical focus and visible current-route indication. Launcher Escape was exercised; complete keyboard/contrast/mobile audits were not performed.

Cognitive load: moderate. Existing groups help, but two scroll panes, offscreen destinations and hidden current location require users to maintain a mental map. The calm first impression becomes friction when switching tools or returning to work.

Deterministic scan: 0 findings, exit0, JSON[] for the sidebar directory. No false positives. The detector does not measure browser overflow. No overlay injection or live server was used; browser evaluate is read-only. No source changes or application data mutations. Original route, expanded sidebar/Knowledge and navigation scroll position restored after exploration. Graph tools/crg-navigation unavailable; evidence assessor used focused source fallback. Source evidence: ManagedNavigation.tsx caps the upper pane and separately scrolls History; RecentChats.tsx implements sticky headings and All chats; the generic parent has no descendant-active styling.

Minor observations: the footer collapse icon is small and requires interpretation; put a visible collapse control near the header while keeping account/theme access in the footer. Keep the same icon family and semantic accent rather than adding colors to distinguish every destination. Do not add a second search mechanism when the existing global search can serve discovery.

Questions for next step: layout/scrolling fixes only, or also regrouping destinations? Recent chats as a short list, or a full timeline?
