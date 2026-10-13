import asyncio
import logging

from google.adk.flows.llm_flows.context import _contents

from src.grpc_server import adk_warm_up


def test_warm_up_relies_on_a_memoized_adk_hook():
    # Guards the google-adk private hook this warm-up depends on.
    assert hasattr(_contents._id_pairing_model_types, "cache_info")


def test_warm_up_fills_the_adk_model_type_cache():
    _contents._id_pairing_model_types.cache_clear()

    asyncio.run(adk_warm_up.warm_up_adk_lazy_imports())

    assert _contents._id_pairing_model_types.cache_info().currsize == 1


def test_warm_up_failure_is_reported_not_raised(monkeypatch, caplog):
    def fail():
        raise ImportError("boom")

    monkeypatch.setattr(adk_warm_up, "_warm_model_type_imports", fail)

    with caplog.at_level(logging.WARNING):
        asyncio.run(adk_warm_up.warm_up_adk_lazy_imports())


def test_warm_up_skips_a_missing_hook(monkeypatch):
    monkeypatch.delattr(_contents, "_id_pairing_model_types")

    asyncio.run(adk_warm_up.warm_up_adk_lazy_imports())
