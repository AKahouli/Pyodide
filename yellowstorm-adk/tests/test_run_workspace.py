"""The run folder string has to match what the sandbox MCP and the Outlook MCP
build independently. If these drift, a downloaded file lands in a folder nothing
mounts and the failure is silent — the sandbox just sees an empty directory.
"""
from src.run_workspace import run_workspace_path, with_run_workspace_path


def test_the_folder_matches_the_sandbox_mcps_own_convention() -> None:
    # sandbox_mcp/server.py::_ceph_info builds "{user_id}/system_{conversation_id}"
    assert run_workspace_path("u123", "conv-1") == "u123/system_conv-1"


def test_a_missing_half_yields_no_path_rather_than_a_one_segment_one() -> None:
    # The mount script requires "user/workspace"; a bare name is dropped silently.
    assert run_workspace_path("", "conv-1") == ""
    assert run_workspace_path("u123", "") == ""
    assert run_workspace_path("/u123/", "/conv-1/") == "u123/system_conv-1"


def test_the_run_folder_is_appended_after_the_real_workspaces() -> None:
    # The manager resolves a bare alias to workspace_paths[0] when exactly one
    # workspace is mounted, so the run folder must never take that slot.
    assert with_run_workspace_path(["u123/cvs"], "u123", "conv-1") == [
        "u123/cvs",
        "u123/system_conv-1",
    ]


def test_it_is_added_once_and_leaves_the_list_alone_when_unresolvable() -> None:
    already = ["u123/system_conv-1"]
    assert with_run_workspace_path(already, "u123", "conv-1") == already
    assert with_run_workspace_path(["u123/cvs"], "", "conv-1") == ["u123/cvs"]
    assert with_run_workspace_path([], "u123", "conv-1") == ["u123/system_conv-1"]
