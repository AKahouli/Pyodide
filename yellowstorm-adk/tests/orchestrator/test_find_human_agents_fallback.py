"""find_human_agents falls back to a semantic top-K ranking of the full
roster when a filtered ROLE search comes up empty — role is free text, not a
fixed taxonomy, so a guessed title (e.g. "portfolio manager") rarely appears
in it verbatim. Regression for a live session where the caller tried 6
different role guesses, all empty, and gave up instead of ever finding the
actual match ("Investment approver").

Also covers two follow-up bugs found in the same live testing:
- A bare NAME miss must never semantically fall back — it forced two
  nonexistent people ("Karim", "Nadia") onto the two real unrelated agents,
  which then received their delegated tasks by mistake.
- A relevance floor: a role guess with no real match must return no one
  rather than forcing the closest (but irrelevant) candidate.
"""
from unittest.mock import AsyncMock

from src.companion_ai import human_agents as human_agents_mod


async def test_falls_back_to_semantic_top_k_when_role_search_is_empty(monkeypatch):
    roster = [
        {"id": "oussama", "name": "Oussama", "role": "Investment approver."},
        {"id": "rabeb", "name": "Rabeb", "role": "Investment analyst."},
    ]

    async def fake_search(*, name=None, role=None):
        return [] if (name or role) else roster

    monkeypatch.setattr(human_agents_mod, "search_human_agents", AsyncMock(side_effect=fake_search))

    # Fake embeddings: query is close to Oussama, orthogonal (unrelated) to Rabeb.
    vectors = {
        "portfolio manager": [1.0, 0.0],
        "Oussama. Investment approver.": [0.9, 0.1],
        "Rabeb. Investment analyst.": [0.0, 1.0],
    }
    monkeypatch.setattr(
        "src.smart_rag.tools.utilities.esg_helpers.get_embeddings",
        lambda text: vectors[text])

    tool = human_agents_mod.make_find_human_agents_tool()
    result = await tool.func(role="portfolio manager")

    # Only Oussama clears the relevance floor — Rabeb (orthogonal, similarity 0)
    # is dropped rather than force-matched.
    assert [a["name"] for a in result] == ["Oussama"]


async def test_bare_name_miss_never_falls_back(monkeypatch):
    """A name is a literal identifier, not a concept — a miss must stay a
    miss, not get fuzzy-matched to some unrelated real person."""
    mock = AsyncMock(return_value=[])
    monkeypatch.setattr(human_agents_mod, "search_human_agents", mock)
    embed_mock = AsyncMock()
    monkeypatch.setattr("src.smart_rag.tools.utilities.esg_helpers.get_embeddings", embed_mock)

    tool = human_agents_mod.make_find_human_agents_tool()
    result = await tool.func(name="Karim")

    assert result == []
    mock.assert_awaited_once()  # only the filtered attempt — no unfiltered fallback fetch
    embed_mock.assert_not_called()


async def test_semantic_fallback_returns_nothing_below_relevance_floor(monkeypatch):
    roster = [{"id": "oussama", "name": "Oussama", "role": "Investment approver."}]

    async def fake_search(*, name=None, role=None):
        return [] if (name or role) else roster

    monkeypatch.setattr(human_agents_mod, "search_human_agents", AsyncMock(side_effect=fake_search))
    # Orthogonal vectors — zero similarity, well below the floor.
    vectors = {"veterinarian": [1.0, 0.0], "Oussama. Investment approver.": [0.0, 1.0]}
    monkeypatch.setattr(
        "src.smart_rag.tools.utilities.esg_helpers.get_embeddings",
        lambda text: vectors[text])

    tool = human_agents_mod.make_find_human_agents_tool()
    result = await tool.func(role="veterinarian")

    assert result == []


async def test_does_not_fall_back_when_filtered_search_already_matches(monkeypatch):
    async def fake_search(*, name=None, role=None):
        return [{"id": "rabeb", "name": "Rabeb", "role": "Investment analyst."}]

    mock = AsyncMock(side_effect=fake_search)
    monkeypatch.setattr(human_agents_mod, "search_human_agents", mock)
    tool = human_agents_mod.make_find_human_agents_tool()

    result = await tool.func(name="Rabeb")

    assert result == [{"id": "rabeb", "name": "Rabeb", "role": "Investment analyst."}]
    mock.assert_awaited_once()  # no fallback round-trip, no embedding calls needed
