import py_compile
from pathlib import Path


def test_every_source_file_compiles():
    root = Path(__file__).resolve().parent.parent
    sources = sorted(root.rglob("*.py"))
    assert len(sources) >= 12
    for path in sources:
        py_compile.compile(str(path), doraise=True)
