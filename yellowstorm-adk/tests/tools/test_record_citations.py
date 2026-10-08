from types import SimpleNamespace

from src.smart_rag.tools.utilities.connector_tools import (
    _STATE_KEY_CONNECTOR_RECORD_SOURCES,
    _register_record_citations,
)


def _source(entity_id: str) -> dict:
    return {"type": "record", "modelId": "m1", "modelName": "Mails", "data": "published",
            "dataRevisionId": "rev-1", "entityId": entity_id, "concept": "Message",
            "name": entity_id, "keyFields": {"id": entity_id}}


def test_records_are_numbered_once_and_stamped():
    context = SimpleNamespace(state={})
    response = {"text": "raw", "data": {"records": [{"entityId": "e1"}, {"entityId": "e2"}],
                                        "citationSources": [_source("e1"), _source("e2")]}}
    first = _register_record_citations(response, context)
    assert [record["cite"] for record in first["data"]["records"]] == ["[1]", "[2]"]
    assert "citationSources" not in first["data"]
    assert first["text"] != "raw"

    again = _register_record_citations({"data": {"records": [{"entityId": "e2"}], "citationSources": [_source("e2")]}}, context)
    assert again["data"]["records"][0]["cite"] == "[2]"
    stored = context.state[_STATE_KEY_CONNECTOR_RECORD_SOURCES]
    assert [entry["reference"] for entry in stored] == ["1", "2"]
    assert stored[0]["object"]["content"]["entity_id"] == "e1"


def test_result_without_sources_is_untouched():
    context = SimpleNamespace(state={})
    response = {"text": "raw", "data": {"records": []}}
    assert _register_record_citations(response, context) is response


def test_record_sources_are_recognised_without_the_mode():
    from src.smart_rag.tools.utilities.connector_tools import _register_connector_response_sources
    context = SimpleNamespace(state={})
    response = {"ok": True, "data": {"records": [{"entityId": "e1"}], "citationSources": [_source("e1")]}}
    result = _register_connector_response_sources(response, context, action_key="query_records")
    assert result["data"]["records"][0]["cite"] == "[1]"


class _DeltaState(dict):
    """Records the keys assigned, like ADK's State: in-place changes to a stored value are not saved."""

    def __init__(self, stored):
        super().__init__(stored)
        self.assigned = set()

    def __setitem__(self, key, value):
        self.assigned.add(key)
        super().__setitem__(key, value)


def test_a_later_turn_writes_the_record_sources_back():
    state = _DeltaState({_STATE_KEY_CONNECTOR_RECORD_SOURCES: [{"reference": "1", "object": {}}]})
    _register_record_citations({"data": {"citationSources": [_source("e9")]}}, SimpleNamespace(state=state))
    assert _STATE_KEY_CONNECTOR_RECORD_SOURCES in state.assigned
    assert len(state[_STATE_KEY_CONNECTOR_RECORD_SOURCES]) == 2
