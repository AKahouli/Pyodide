from __future__ import annotations

from app.persistence.population_store import revision_id_for
from app.population import engine_version


def test_the_engine_version_follows_the_code(monkeypatch, tmp_path):
    assert engine_version.population_engine_version() == engine_version.population_engine_version()
    first = revision_id_for("v1", "fp", [], 0)
    for package in ("population", "datasource", "workers"):
        (tmp_path / package).mkdir()
        (tmp_path / package / "reader.py").write_text("A = 1\n")
    monkeypatch.setattr(engine_version, "_APP", tmp_path)
    engine_version.population_engine_version.cache_clear()
    before = engine_version.population_engine_version()
    assert revision_id_for("v1", "fp", [], 0) != first
    (tmp_path / "datasource" / "reader.py").write_text("A = 2\n")
    engine_version.population_engine_version.cache_clear()
    assert engine_version.population_engine_version() != before
    engine_version.population_engine_version.cache_clear()
