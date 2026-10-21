"""Syntax guard: every Python file in the module must compile."""
import py_compile
from pathlib import Path

ROOT = Path(__file__).parents[1]


def test_every_source_file_compiles():
    files = [path for path in ROOT.rglob("*.py") if "__pycache__" not in path.parts]
    assert len(files) >= 16, files
    for path in files:
        py_compile.compile(str(path), doraise=True)
