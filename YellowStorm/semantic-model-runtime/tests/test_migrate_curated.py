"""The curated runner must apply every data-plane migration, not just the first one."""

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SQL_DIR = ROOT / "deploy" / "data-plane" / "sql"


def _load():
    spec = importlib.util.spec_from_file_location("migrate_curated", ROOT / "scripts" / "migrate-curated.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


migrate_curated = _load()


def test_applies_every_data_plane_migration():
    """A migration committed to Git but never executed leaves a deployment on weaker RLS."""
    discovered = [path.name for path in migrate_curated.migrations()]

    assert discovered == sorted(path.name for path in SQL_DIR.glob("*.sql"))
    assert "002_source_authorization.sql" in discovered


def test_orders_by_numeric_prefix_not_string():
    names = ["001_a.sql", "002_b.sql", "010_c.sql"]
    ordered = sorted((Path(name) for name in names), key=migrate_curated._order)

    assert [path.name for path in ordered] == names


def test_rejects_a_migration_without_a_numeric_prefix():
    with pytest.raises(SystemExit):
        migrate_curated._order(Path("source_authorization.sql"))
