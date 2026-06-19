import logging
from datetime import datetime, timezone
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from elasticsearch import Elasticsearch

try:
    from elasticsearch import Elasticsearch
except Exception:  # pragma: no cover - optional dependency
    Elasticsearch = Any  # type: ignore[misc,assignment]

def elastic_search_logging(
    record: logging.LogRecord,
    log_source: str,
    es_connection: Elasticsearch,
    index_name: str,
):
    """
    Log a message into Elasticsearch.

    Args:
        record (logging.LogRecord): The log record to be logged.
        log_source (str): The source of the log message.
        es_connection: An Elasticsearch connection object.
        index_name (str): The name of the Elasticsearch index.
    """
    log_entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "level": record.levelname,
        "message": record.getMessage(),
        "log_source": log_source,
    }
    try:
        if not es_connection.indices.exists(index=index_name):
            index_mappings = {
                "mappings": {
                    "properties": {
                        "timestamp": {
                            "type": "date",
                            "fields": {"keyword": {"type": "keyword"}},
                        },
                        "level": {
                            "type": "text",
                            "fields": {"keyword": {"type": "keyword"}},
                        },
                        "message": {
                            "type": "text",
                            "fields": {"keyword": {"type": "keyword"}},
                        },
                        "log_source": {
                            "type": "text",
                            "fields": {"keyword": {"type": "keyword"}},
                        },
                    }
                }
            }
            es_connection.indices.create(index=index_name, body=index_mappings)  # type: ignore
        es_connection.index(index=index_name, document=log_entry)
    except Exception as e:
        print(f"Error when sending logs to Elasticsearch: {e}")
