"""A run reads as many sources as the admin's ``maxRunSources`` allows (a workspace mapping expands per file)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.jobs.models import PopulationCommand
from app.population.run_limits import DEFAULT_RUN_LIMITS, MAX_SOURCES_PER_TASK, max_run_sources
from app.workers.population_tasks import run_population_for_payload
from test_population_task import SOURCE, command


def sources(count: int) -> list[dict]:
    return [{"conceptId": "c1", "source": {**SOURCE, "assetId": f"{index:024x}"}, "options": {},
             "columnMapping": {"customer_id": "customer_id", "name": "name"}, "mappingVersion": "map-v1"}
            for index in range(count)]


def with_limits(count: int, limits: dict | None = None) -> dict:
    built = command(sources=sources(count))
    if limits is not None:
        built["payload"]["limits"] = limits
    return built


def test_the_ceiling_of_a_run_is_the_admin_limit_never_above_the_task_maximum() -> None:
    assert MAX_SOURCES_PER_TASK == DEFAULT_RUN_LIMITS["maxRunSources"]
    assert max_run_sources({}) == 5000
    assert max_run_sources({"limits": {"maxRunSources": 40}}) == 40
    assert max_run_sources({"limits": {"maxRunSources": 50000}}) == MAX_SOURCES_PER_TASK
    assert max_run_sources({"limits": {"maxRunSources": 0}}) == 5000


@pytest.mark.parametrize("count", [26, 100, 5000])
def test_more_than_25_sources_are_admitted_by_default(count: int) -> None:
    admitted = PopulationCommand.model_validate(with_limits(count))
    assert len(admitted.payload.sources) == count


def test_admission_stops_at_the_admin_limit() -> None:
    PopulationCommand.model_validate(with_limits(40, {"maxRunSources": 40}))
    with pytest.raises(ValidationError, match="at most 40 sources"):
        PopulationCommand.model_validate(with_limits(41, {"maxRunSources": 40}))


def test_admission_stops_at_the_hard_ceiling_whatever_the_admin_limit() -> None:
    with pytest.raises(ValidationError):
        PopulationCommand.model_validate(with_limits(MAX_SOURCES_PER_TASK + 1, {"maxRunSources": 50000}))


def test_a_run_applies_the_same_bound() -> None:
    assert run_population_for_payload(with_limits(26))["ok"] is True
    assert run_population_for_payload(with_limits(41, {"maxRunSources": 40})) == {
        "ok": False, "errorCode": "invalid_sources"}
