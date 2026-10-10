import json
import pytest
from src.web_citations import normalize_web_connector_response
from src.web_citations.bounded_response import bound_web_response


def test_large_multibyte_page_preserves_citations_and_explicit_partial_preview():
    response = normalize_web_connector_response(
        {'url': 'https://example.com/page', 'content': 'réponse 🌍' * 50000},
        'web_fetch', 'text_fragment', {})
    bounded = bound_web_response(response)
    assert len(json.dumps(bounded, separators=(',', ':')).encode()) <= 131072
    assert bounded['truncation']['rawPayloadOmitted'] is True
    assert bounded['web_sources'][0]['url'] == 'https://example.com/page'
    assert bounded['citation_sources'][0]['source'] == 'https://example.com/page'
    assert response['web_sources'][0]['content'].startswith(bounded['web_sources'][0]['content'])
    assert bounded == bound_web_response(bounded)


def test_small_response_unchanged_and_metadata_is_never_truncated():
    small = {'web_sources': [{'url': 'https://example.com', 'content': 'text'}]}
    assert bound_web_response(small) is small
    with pytest.raises(ValueError, match='metadata'):
        bound_web_response({'web_sources': [{'url': 'https://example.com/' + 'a' * 140000}]})


def test_large_unrecognized_web_payload_is_explicit_failure():
    assert 'error' in bound_web_response({'text': 'x' * 150000})


def test_preview_logs_only_registered_bounded_metadata(monkeypatch):
    from unittest.mock import Mock
    from src.web_citations import bounded_response
    logger = Mock()
    monkeypatch.setattr(bounded_response, 'logger', logger)
    bounded_response.bound_web_response({'web_sources': [{'url': 'https://example.com', 'content': 'private' * 30000}]})
    logger.info.assert_called_once_with('tool.call.completed', operation='bounded_web_preview', dependency='web_preview')
    bounded_response.bound_web_response({'text': 'secret' * 30000})
    logger.warning.assert_called_once_with('tool.call.failed', operation='bound_web_response', dependency='web_preview')
