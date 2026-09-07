from src.smart_rag.thought_activity_tracker import ThoughtActivityTracker


def test_reconciles_partial_deltas_with_complete_snapshot_after_visible_text() -> None:
    tracker = ThoughtActivityTracker()
    first = tracker.observe("The", True, "start")
    second = tracker.observe(" user", True, "later")

    tracker.end_for_visible_text()
    replay = tracker.observe("The user", False, "complete")

    assert first is not None
    assert second is not None
    assert first.component_id == second.component_id
    assert second.detail == "The user"
    assert replay is None


def test_complete_snapshot_extends_existing_partial_without_repeating_prefix() -> None:
    tracker = ThoughtActivityTracker()
    first = tracker.observe("The user", True, "start")
    complete = tracker.observe("The user asked for revenue", False, "complete")

    assert first is not None
    assert complete is not None
    assert complete.component_id == first.component_id
    assert complete.action == "update"
    assert complete.detail == "The user asked for revenue"


def test_complete_snapshot_replaces_corrected_partial() -> None:
    tracker = ThoughtActivityTracker()
    first = tracker.observe("Draft reasoning", True, "start")
    complete = tracker.observe("Corrected reasoning", False, "complete")

    assert first is not None
    assert complete is not None
    assert complete.component_id == first.component_id
    assert complete.action == "update"
    assert complete.detail == "Corrected reasoning"


def test_corrected_complete_snapshot_updates_replayed_activity_after_visible_text() -> None:
    tracker = ThoughtActivityTracker()
    first = tracker.observe("Draft reasoning", True, "start")
    tracker.end_for_visible_text()
    complete = tracker.observe("Corrected reasoning", False, "complete")

    assert first is not None
    assert complete is not None
    assert complete.component_id == first.component_id
    assert complete.action == "update"
    assert complete.detail == "Corrected reasoning"


def test_complete_only_thought_starts_activity() -> None:
    update = ThoughtActivityTracker().observe("Complete reasoning", False, "start")

    assert update is not None
    assert update.action == "add"
    assert update.detail == "Complete reasoning"


def test_complete_only_short_fragment_does_not_start_or_seed_activity() -> None:
    tracker = ThoughtActivityTracker()

    assert tracker.observe("start", False, "ignored") is None
    assert tracker.observe("search first.", False, "ignored") is None
    assert tracker.observe("4\n files", False, "ignored") is None
    assert tracker.observe("me read them", False, "ignored") is None
    update = tracker.observe("Inspect contracts", False, "start")

    assert update is not None
    assert update.action == "add"
    assert update.detail == "Inspect contracts"


def test_punctuation_separated_four_word_thought_starts_activity() -> None:
    update = ThoughtActivityTracker().observe("search/read/compare/respond", False, "start")

    assert update is not None
    assert update.action == "add"


def test_complete_one_word_can_correct_an_existing_activity() -> None:
    tracker = ThoughtActivityTracker()
    first = tracker.observe("Draft reasoning", True, "start")
    corrected = tracker.observe("Done", False, "complete")

    assert first is not None
    assert corrected is not None
    assert corrected.component_id == first.component_id
    assert corrected.action == "update"
    assert corrected.detail == "Done"


def test_complete_short_suffix_does_not_replace_accumulated_reasoning() -> None:
    tracker = ThoughtActivityTracker()
    first = tracker.observe("Reuse citation-grounded citations", True, "start")
    duplicate = tracker.observe("-grounded citations", False, "complete")

    assert first is not None
    assert duplicate is None


def test_complete_short_delta_extends_accumulated_reasoning() -> None:
    tracker = ThoughtActivityTracker()
    first = tracker.observe("Reuse citation", True, "start")
    suffix = tracker.observe("-grounded citations", False, "complete")

    assert first is not None
    assert suffix is not None
    assert suffix.component_id == first.component_id
    assert suffix.action == "update"
    assert suffix.detail == "Reuse citation-grounded citations"


def test_tool_boundary_allows_identical_reasoning_in_new_span() -> None:
    tracker = ThoughtActivityTracker()
    first = tracker.observe("Check revenue", False, "first")
    tracker.end_for_tool_boundary()
    second = tracker.observe("Check revenue", False, "second")

    assert first is not None
    assert second is not None
    assert first.component_id != second.component_id


def test_standalone_punctuation_does_not_start_or_replace_activity() -> None:
    tracker = ThoughtActivityTracker()

    assert tracker.observe(".", True, "partial") is None
    first = tracker.observe("Inspect the report", True, "start")
    assert tracker.observe(".", False, "snapshot") is None

    assert first is not None


def test_partial_punctuation_extends_active_reasoning() -> None:
    tracker = ThoughtActivityTracker()
    first = tracker.observe("Inspect the report", True, "start")
    punctuation = tracker.observe(".", True, "later")

    assert first is not None
    assert punctuation is not None
    assert punctuation.component_id == first.component_id
    assert punctuation.detail == "Inspect the report."
