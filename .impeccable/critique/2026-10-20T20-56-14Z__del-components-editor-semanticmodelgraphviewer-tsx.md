---
target: Semantic model Data Graph browser review
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-10-20T20-56-14Z
slug: del-components-editor-semanticmodelgraphviewer-tsx
---
Method: dual-agent (A: /root/design_assessment; B: /root/ui_evidence), with primary browser verification.

The Data Graph needs a clearer investigation flow. Existing domain concepts and relationship verbs are useful, but the initial composition feels like a graph debugging tool: 227 tiny record circles compete for attention. Search and local focus already improve this substantially.

| Nielsen heuristic | Score /4 | Evidence |
| --- | --- | --- |
| System status | 2 | Counts/loading present; editor freshness not retained in graph header |
| Real-world match | 2 | Domain verbs useful; provenance uses raw technical metadata |
| User control | 3 | Fit, close, focus and filters exist |
| Consistency | 3 | Coherent panels and concept colors |
| Error prevention | 3 | Exploration separated from model editing |
| Recognition over recall | 1 | Tiny truncated labels conceal record identity |
| Efficiency | 3 | Search, focus, layouts, path tools exist |
| Minimalist design | 2 | Initial graph/control density obscures the starting action |
| Error recovery | 2 | Missing-data cues present; failure recovery not tested |
| Help/documentation | 2 | Hints exist; click versus information-badge behavior is hard to discover |
| Total | 23/40 | Bounded desktop review; errors/destructive flows not tested |

Strengths: concept counts and domain relationships supply useful context. Search, local focus and the right inspector already provide the foundations for an evidence workspace. Overview already contains completeness, unlinked/most-linked records, counts, period filtering and shortest-path tools.

Priority issues:

1. P1 - Record identity and initial scale. The full 227-record graph displays a dense island of unreadable short fragments. Start at concept overview or a chosen record. Use small dots at overview scale and readable label cards for the selected record and nearby nodes. Keep arrows and meaningful relationship labels in focus. Expand search to show concept and matching snippet. Move Draw up to and layout settings under advanced controls. Suggested workflow: Impeccable shape/layout.
2. P1 - Investigation and evidence are too indirect. Search selection leaves 227 records visible; the separate Focus selector reduced a checked example to three records. Details require a small i badge. Sources then display JSON. Use a three-part workspace: left concepts/search results; central selected neighborhood; right inspector with Values, Relationships and Sources. Single click opens the inspector; an explicit Explore connections action sets a local neighborhood; back/forward and return-to-overview preserve orientation. Render source filenames as readable rows, provide document opening only through existing authorized resolution, and put raw IDs/JSON under technical details. Preserve missing-versus-empty provenance, permissions and revision scope. Suggested workflow: Impeccable shape/clarify.

Reference adaptation: borrow the screenshots' visual hierarchy, search prominence and connected inspector. Keep YellowStorm tokens and themes. Use its actual concepts, not the reference ontology stack. Promote existing time/path tools contextually. Period filtering is already implemented; event-history replay, as-known clocks and pinned slices require a separate data capability review and are outside the first improvement.

Cognitive load: five concept choices and roughly seven graph controls appear before a useful starting record. Initial curiosity becomes overload; search restores orientation, then raw source JSON weakens the evidence-reading experience.

Persona flags: a first-time analyst struggles to find a starting record or discover the i badge; a frequent investigator struggles to distinguish similarly prefixed results; an evidence reviewer sees identifiers instead of a readable source destination.

Minor observations: keep current theme support and semantic colors; use less saturated category fills and reserve strong selection contrast. Retain freshness and serving-revision information in the graph header. Preserve existing Overview analyses. Field-value search has limitations on partial graphs; communicate search scope instead of implying all-model coverage.

Recommended first slice: improved record search, concept navigator, readable focused neighborhood, automatic inspector on selection, readable source rows. Example: find Claire Morel, inspect Participation, follow its message, read source metadata without losing context. No model/code behavior changed during review; no feature documentation update is needed until implementation.

Questions skipped: 2 Priority Issues; the requested deliverable is recommendations, with implementation scope left for the user's next instruction.
