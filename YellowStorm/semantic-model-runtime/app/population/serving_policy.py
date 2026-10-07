"""Whether a population result may replace the graph people are using.

Some gaps mean the result is missing data it should have: a source could not be
read, an index was not ready, or a cap cut records, assertions or relationships.
Serving such a result would silently replace a complete graph with a partial one,
so it is stored for diagnosis and the previous draft binding stays in use.

Other gaps are about values inside records that were read (a field not found in a
document, a reference that matched nothing, conflicting values): the result is
still the best picture of the sources, so it is served and the gaps are reported.
"""

from __future__ import annotations

from typing import Any, Iterable

BLOCKING_GAP_KINDS = frozenset({
    "source_unavailable",
    "index_unavailable",
    "index_ambiguous",
    "enumeration_capped",
    "materialization_cap",
    "assertion_cap",
    "relationship_cap",
})

# A retrieval budget cut means documents may never have been read at all; a read
# budget cut inside one document leaves some of its fields unresolved, like any
# unresolved document field.
BLOCKING_BUDGET_SCOPES = frozenset({"retrieval"})


def blocking_gap_kinds(gaps: Iterable[dict[str, Any]]) -> list[str]:
    """The kinds of gaps that keep this result from replacing the graph in use."""
    kinds: set[str] = set()
    for gap in gaps:
        kind = gap.get("kind")
        if kind in BLOCKING_GAP_KINDS:
            kinds.add(kind)
        elif kind == "budget_exhausted" and gap.get("scope") in BLOCKING_BUDGET_SCOPES:
            kinds.add(kind)
    return sorted(kinds)


def serving_decision(blocking: list[str], has_current_draft: bool) -> str:
    """activate: serve the result. keep_previous: store it, keep the graph in use.

    A model with no graph yet gets the partial one: showing it with its gaps beats
    showing nothing, and there is no complete graph to protect.
    """
    if not blocking:
        return "activate"
    return "keep_previous" if has_current_draft else "activate"
