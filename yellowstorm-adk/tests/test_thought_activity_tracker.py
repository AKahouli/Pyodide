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
