"""Download path checks — `python test_download.py`.

Only the pure part: the run folder string, path sanitising, and collision
handling. The Graph walk and the Ceph write need a real tenant and bucket, so
they are not covered here.
"""
from graph_helpers import (
    _request_conversation_id,
    _request_user_id,
    dedupe_relative_path,
    logger,
    run_storage_key,
    safe_relative_path,
    system_workspace_prefix,
)


def test_the_run_folder_matches_the_sandbox_mcps_convention():
    # sandbox_mcp/server.py::_ceph_info builds "{user_id}/system_{conversation_id}"
    _request_user_id.set("u123")
    _request_conversation_id.set("conv-1")
    assert system_workspace_prefix() == "u123/system_conv-1"

    _request_conversation_id.set("exec-9")  # what the middleware falls back to
    assert system_workspace_prefix() == "u123/system_exec-9"


def test_a_missing_id_yields_no_folder_rather_than_a_half_formed_one():
    _request_user_id.set("u123")
    _request_conversation_id.set(None)
    assert system_workspace_prefix() == ""

    _request_user_id.set(None)
    _request_conversation_id.set("conv-1")
    assert system_workspace_prefix() == ""


def test_folder_structure_is_preserved():
    assert safe_relative_path("", "report.docx") == "report.docx"
    assert safe_relative_path("Rapports", "2026", "q1.xlsx") == "Rapports/2026/q1.xlsx"


def test_a_sharepoint_name_cannot_escape_the_run_folder():
    # Names come from SharePoint, not from us. Without this a crafted name would
    # write outside <user>/system_<run>/ and into another user's prefix.
    assert safe_relative_path("../../etc", "passwd") == "etc/passwd"
    assert safe_relative_path("ok", "../../../secret.txt") == "ok/secret.txt"
    assert safe_relative_path("a/b", "c\\d.txt") == "a/b/c/d.txt"
    assert safe_relative_path("", "  ", ".", "..") == ""


def test_same_named_documents_do_not_overwrite_each_other():
    taken = set()
    first = dedupe_relative_path("report.docx", taken)
    taken.add(first)
    second = dedupe_relative_path("report.docx", taken)
    taken.add(second)
    third = dedupe_relative_path("report.docx", taken)
    assert [first, second, third] == ["report.docx", "report (2).docx", "report (3).docx"]


def test_dedupe_keeps_the_file_in_its_own_folder():
    taken = {"Rapports/2026/q1.xlsx"}
    assert (
        dedupe_relative_path("Rapports/2026/q1.xlsx", taken)
        == "Rapports/2026/q1 (2).xlsx"
    )


def test_either_name_download_documents_returned_resolves_to_the_same_key():
    folder = "u123/system_conv-1"
    assert (
        run_storage_key("u123/system_conv-1/Rapports/q1.xlsx", folder)
        == "u123/system_conv-1/Rapports/q1.xlsx"
    )
    # the mounted name for that same file
    assert (
        run_storage_key("/mnt/workspace/system_conv-1/Rapports/q1.xlsx", folder)
        == "u123/system_conv-1/Rapports/q1.xlsx"
    )


def test_a_file_outside_this_run_cannot_be_sent():
    # The model picks this string; without the prefix check it could hand the
    # user another user's file, or another conversation's.
    folder = "u123/system_conv-1"
    assert run_storage_key("u999/system_conv-1/payroll.xlsx", folder) == ""
    assert run_storage_key("u123/system_other/notes.docx", folder) == ""
    assert run_storage_key("u123/system_conv-1", folder) == ""
    assert run_storage_key("", folder) == ""
    # no run folder resolved -> nothing is sendable
    assert run_storage_key("u123/system_conv-1/q1.xlsx", "") == ""


if __name__ == "__main__":
    passed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            logger.info(f"  ok  {name}")
            passed += 1
    logger.info(f"\n{passed} passed")
