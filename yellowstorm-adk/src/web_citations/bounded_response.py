"""Bound trusted web evidence previews without changing source identities."""
import json
from yellowmind_observability import get_logger

logger = get_logger(__name__)


def bound_web_response(response, limit=131072):
    if not isinstance(response, dict):
        return response
    size = lambda value: len(json.dumps(value, separators=(',', ':'), allow_nan=False).encode())
    if size(response) <= limit:
        return response
    # Provider payloads often repeat the whole page in text and normalized sources.
    # Keep the canonical sources and error state, not another copy of the page.
    result = {key: response[key] for key in ('web_sources', 'citation_sources', 'error', 'isError')
              if key in response}
    if not result.get('web_sources'):
        logger.warning('tool.call.failed', operation='bound_web_response', dependency='web_preview')
        return {'error': 'Web response exceeded the size limit; no bounded source preview is available.'}
    result['truncation'] = {'originalBytes': size(response), 'rawPayloadOmitted': True,
                            'message': 'Partial page previews. Do not infer that omitted text was inspected.'}
    text_fields = {'content', 'snippet', 'exact_text', 'prefix', 'suffix'}
    def preview(value, budget):
        if isinstance(value, list):
            return [preview(item, budget) for item in value]
        if not isinstance(value, dict):
            return value
        return {key: item.encode('utf-8')[:budget].decode('utf-8', errors='ignore')
                if key in text_fields and isinstance(item, str) else preview(item, budget)
                for key, item in value.items()}
    for budget in (8192, 4096, 2048, 1024, 0):
        bounded = preview(result, budget)
        if size(bounded) <= limit:
            logger.info('tool.call.completed', operation='bounded_web_preview', dependency='web_preview')
            return bounded
    raise ValueError('Web source metadata exceeds the bounded response limit')
