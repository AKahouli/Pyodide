
from src.config.settings import get_settings
from src.schema.celery_models import TaskStatus


def get_task_status(task_id: str) -> TaskStatus:
    """
    Get the status of a task

    Parameters
    ----------
    task_id : str
        The ID of the task

    Returns
    -------
    TaskStatus
        The status of the task
    """
    from worker import celery_app
    task = celery_app.AsyncResult(task_id)
    return TaskStatus(
        id=task_id,
        status=task.status,
        result=str(task.result),
    )

