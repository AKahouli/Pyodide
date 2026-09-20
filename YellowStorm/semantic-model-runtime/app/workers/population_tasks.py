"""Population worker entry point (P2.3). No heavy imports at module load."""

from __future__ import annotations

from .celery_app import POPULATION_QUEUES, celery_app


@celery_app.task(name="semantic-model-population.run", queue=POPULATION_QUEUES[1])
def populate_model(task_id: int) -> dict:
    raise NotImplementedError("population lands in Phase 5; this stub reserves the queue binding.")
