"""The Ceph folder a single run owns, and its place in the sandbox mount list.

The sandbox manager symlinks every path in `x-workspace-paths` to live Ceph
(`ln -sfn /home/manus/ceph-workspaces/<path> /mnt/workspace/<name>`), so a file
written to one of those folders is visible inside an already-running sandbox with
no restart. Mounting the run's own folder is what lets one connector drop a file
into the run mid-flight -- mail attachments, say -- and another read it back.

`system_<run_id>` is the sandbox MCP's own convention for this folder, and the run
id resolves the same way it does there: conversation id first, execution id as the
fallback for a playbook run that has no conversation. The three services have to
agree on this string or a file lands where nothing will look for it.
"""

RUN_FOLDER_PREFIX = "system_"


def run_workspace_path(user_id: str, run_id: str) -> str:
    """`<user_id>/system_<run_id>`, or "" when either half is missing.

    Empty rather than half-formed: a one-segment path is not a Ceph workspace and
    the mount script silently drops it.
    """
    user_id = (user_id or "").strip().strip("/")
    run_id = (run_id or "").strip().strip("/")
    if not user_id or not run_id:
        return ""
    return f"{user_id}/{RUN_FOLDER_PREFIX}{run_id}"


def with_run_workspace_path(
    workspace_paths: list[str], user_id: str, run_id: str
) -> list[str]:
    """`workspace_paths` plus the run's own folder, appended once and last.

    Last so it never displaces a real workspace in the manager's single-workspace
    alias fallback, which resolves a bare name to `workspace_paths[0]`.
    """
    run_path = run_workspace_path(user_id, run_id)
    if not run_path or run_path in workspace_paths:
        return list(workspace_paths)
    return [*workspace_paths, run_path]
