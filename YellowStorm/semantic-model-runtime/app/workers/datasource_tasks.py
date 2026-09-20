"""Datasource worker entry point (P2.3). No heavy imports at module load.

Parser libraries (workbooks, OCR, embeddings) are imported lazily inside task
bodies from Phase 3 onward, so importing the API never initializes them.
"""

from __future__ import annotations

from .celery_app import DATASOURCE_QUEUES, celery_app


@celery_app.task(name="semantic-model-datasource.discover", queue=DATASOURCE_QUEUES[1])
def discover_asset(task_id: int) -> dict:
    raise NotImplementedError("discovery lands in Phase 3; this stub reserves the queue binding.")
