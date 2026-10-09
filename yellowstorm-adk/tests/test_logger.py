import builtins
import importlib
import logging
from unittest.mock import Mock

from src.logger import logging as logger_module
from src.logger.setup_logging import setup_logging


def test_logger_import_does_not_load_retired_elasticsearch(monkeypatch):
    original_import = builtins.__import__
    retired_imports = []

    def track_import(name, *args, **kwargs):
        if name.startswith(("elasticsearch", "elastic_transport", "src.logger.elastic_search")):
            retired_imports.append(name)
            raise ImportError("Elasticsearch logging has been retired")
        return original_import(name, *args, **kwargs)

    with monkeypatch.context() as context:
        context.setattr(builtins, "__import__", track_import)
        importlib.reload(logger_module)
        assert logger_module.get_logger("test.adk") is logging.getLogger("test.adk")

    assert retired_imports == []


def test_logging_setup_uses_shared_observability_sdk(monkeypatch):
    sdk_setup = Mock()
    monkeypatch.setattr("yellowmind_observability.setup_observability", sdk_setup)
    monkeypatch.setattr("src.logger.setup_logging._silence_noise_loggers", Mock())

    setup_logging(log_level="WARNING")

    sdk_setup.assert_called_once_with(min_level="WARNING")
