from sandbox_mcp.server import (
    OUTPUT_ROOT,
    _describe_paths,
    _extract_abs_vm_paths,
    _extract_rel_files,
    _is_valid_deliverable_path,
    _path_file_type,
    _path_filename,
    _path_verdict,
    _path_zone,
    _resolve_against,
    _script_write_targets,
)


def test_output_path_is_expected():
    path = f"{OUTPUT_ROOT}/report.xlsx"
    assert _path_filename(path) == "report.xlsx"
    assert _path_file_type(path) == "xlsx"
    assert _path_zone(path) == "outputs"
    assert _path_verdict(path, action="write") == "EXPECTED_OUTPUT"
    assert _is_valid_deliverable_path(path)


def test_workspace_input_read_vs_write():
    path = "/mnt/workspace/finance/invoice.pdf"
    assert _path_zone(path) == "workspace_input"
    assert _path_verdict(path, action="read") == "EXPECTED_INPUT"
    assert _path_verdict(path, action="write") == "WRONG_PATH_WORKSPACE"


def test_wrong_tmp_and_home_subdir():
    tmp = "/tmp/out.xlsx"
    nested = "/home/ubuntu/work/out.xlsx"
    assert _path_verdict(tmp, action="write") == "WRONG_PATH_TMP"
    assert _path_verdict(nested, action="write") == "WRONG_PATH_HOME_SUBDIR"
    assert _path_verdict("/home/ubuntu/out.xlsx", action="write") == "EXPECTED_LEGACY_HOME"


def test_extract_paths_from_python_command():
    cmd = (
        "python3 /mnt/yellowmind/run/outputs/build.py "
        "--in /mnt/workspace/finance/invoice.pdf "
        "--out /tmp/report.xlsx"
    )
    abs_paths = _extract_abs_vm_paths(cmd)
    assert "/mnt/yellowmind/run/outputs/build.py" in abs_paths
    assert "/mnt/workspace/finance/invoice.pdf" in abs_paths
    assert "/tmp/report.xlsx" in abs_paths


def test_relative_output_resolves_against_exec_dir():
    rel = _extract_rel_files('wb.save("credit_score.xlsx")')
    assert "credit_score.xlsx" in rel
    resolved = _resolve_against("credit_score.xlsx", OUTPUT_ROOT)
    assert resolved == f"{OUTPUT_ROOT}/credit_score.xlsx"
    assert _path_verdict(resolved, action="write") == "EXPECTED_OUTPUT"


def test_script_targets_flag_tmp_write():
    src = (
        "import openpyxl\n"
        "wb = openpyxl.Workbook()\n"
        "wb.save('/tmp/report.xlsx')\n"
    )
    abs_targets, _rel = _script_write_targets(src, f"{OUTPUT_ROOT}/build.py")
    assert "/tmp/report.xlsx" in abs_targets
    described = _describe_paths(abs_targets, action="write")
    assert "WRONG_PATH_TMP" in described
    assert "filename=report.xlsx" in described
    assert "type=xlsx" in described
