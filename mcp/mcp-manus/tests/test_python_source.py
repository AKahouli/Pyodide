from sandbox_mcp.python_source import python_write_error


def test_rejects_excel_a1_as_python():
    src = (
        "labels = [(\"Verdict\", '3. Verdict & Gaps'!B4)]\n"
    )
    err = python_write_error("/home/ubuntu/build_scoring.py", src)
    assert err
    assert "SyntaxError" in err
    assert "Excel A1" in err
    assert "openpyxl" in err


def test_accepts_quoted_excel_formula():
    src = (
        "labels = [(\"Verdict\", \"='3. Verdict & Gaps'!B4\")]\n"
        "ws = {}\n"
        "ws['A1'] = \"='4. Scoring Detail'!$F$40\"\n"
    )
    assert python_write_error("/tmp/ok.py", src) is None


def test_ignores_non_python():
    assert python_write_error("/tmp/notes.txt", "foo!bar") is None
