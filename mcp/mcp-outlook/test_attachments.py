"""Attachment routing checks — `python test_attachments.py`.

Only the pure part: parsing/validating what the caller sent, the size split that
decides inline vs upload, and the ownership check on a storage key. The HTTP and
storage paths need a real mailbox / Ceph, so they are not covered here.
"""
import base64

from graph_helpers import (
    _request_conversation_id,
    _request_user_id,
    AttachmentError,
    INLINE_ATTACHMENT_LIMIT,
    UPLOAD_ATTACHMENT_LIMIT,
    build_message_attachments,
    parse_attachments,
    run_storage_key,
    split_bytes_by_message_budget,
    storage_key_owner,
    system_workspace_prefix,
)


def b64(size: int) -> str:
    return base64.b64encode(b"x" * size).decode()


def names(entries):
    return [e["name"] for e in entries]


def test_bytes_attachment_is_decoded_and_typed():
    parsed = parse_attachments(
        [{"filename": "notes.txt", "content_base64": b64(1024)}]
    )
    assert len(parsed) == 1
    assert parsed[0]["kind"] == "bytes"
    assert parsed[0]["name"] == "notes.txt"
    assert len(parsed[0]["raw"]) == 1024


def test_storage_key_is_kept_as_a_reference_not_fetched():
    parsed = parse_attachments(
        [{"filename": "deck.pptx", "storage_key": "u123/system_abc/deck.pptx"}]
    )
    assert parsed[0]["kind"] == "storage"
    assert parsed[0]["storage_key"] == "u123/system_abc/deck.pptx"
    assert "raw" not in parsed[0]  # nothing fetched during parse


def test_small_file_splits_inline():
    inline, upload = split_bytes_by_message_budget(
        parse_attachments([{"filename": "notes.txt", "content_base64": b64(1024)}])
    )
    assert names(inline) == ["notes.txt"]
    assert not upload


def test_large_file_splits_to_upload():
    inline, upload = split_bytes_by_message_budget(
        parse_attachments(
            [{"filename": "big.zip", "content_base64": b64(INLINE_ATTACHMENT_LIMIT + 1)}]
        )
    )
    assert names(upload) == ["big.zip"]
    assert not inline


def test_small_files_that_breach_the_limit_together_all_move_to_upload():
    """Each is individually inline-able, but Graph's ceiling is per MESSAGE, so
    sending them inline would 413. Packing some inline and some not would still
    risk it, so they move together."""
    half = INLINE_ATTACHMENT_LIMIT // 2 + 1024
    inline, upload = split_bytes_by_message_budget(
        parse_attachments(
            [
                {"filename": "a.bin", "content_base64": b64(half)},
                {"filename": "b.bin", "content_base64": b64(half)},
            ]
        )
    )
    assert not inline
    assert names(upload) == ["a.bin", "b.bin"]


def test_storage_key_owner_is_the_first_segment():
    assert storage_key_owner("u123/system_abc/deck.pptx") == "u123"
    assert storage_key_owner("/u123/x/y") == "u123"
    assert storage_key_owner("") == ""


def test_bad_input_is_rejected_with_the_filename_and_the_reason():
    def rejects(attachment, expect: str):
        try:
            parse_attachments([attachment])
        except AttachmentError as exc:
            assert expect in str(exc), f"{expect!r} not in {exc!r}"
        else:
            raise AssertionError(f"should have been rejected: {attachment}")

    rejects({"content_base64": b64(10)}, "missing 'filename'")
    rejects({"filename": "x.txt"}, "content_base64")
    rejects({"filename": "x.txt", "content_base64": "not base64!!"}, "not valid base64")
    rejects({"filename": "x.txt", "content_base64": ""}, "content_base64")
    rejects(
        {"filename": "x.txt", "content_base64": b64(10), "storage_key": "u/x"},
        "not both",
    )
    rejects(
        {"filename": "huge.iso", "content_base64": b64(UPLOAD_ATTACHMENT_LIMIT + 1)},
        "exceeds",
    )


def test_the_message_array_carries_inline_file_attachments():
    inline, _ = split_bytes_by_message_budget(
        parse_attachments(
            [{"filename": "a.pdf", "content_base64": b64(16), "content_type": "application/pdf"}]
        )
    )
    built = build_message_attachments(inline)
    assert len(built) == 1
    assert built[0]["@odata.type"] == "#microsoft.graph.fileAttachment"
    assert built[0]["contentType"] == "application/pdf"
    assert built[0]["contentBytes"] == b64(16)


def test_no_attachments_is_still_valid():
    assert parse_attachments(None) == []
    assert parse_attachments([]) == []
    assert split_bytes_by_message_budget([]) == ([], [])


def test_the_run_folder_matches_what_the_sandbox_mounts():
    """`<user>/system_<conversation>` — and a playbook run, which sends only an
    execution id, must land in the same shape or the sandbox mounts nothing."""
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


def test_every_optional_param_actually_accepts_null():
    """A param defaulting to None must be typed Optional, or FastMCP builds a
    schema that rejects an explicit `null` — and models do send `null` rather
    than omitting the argument. Guards the whole class, not one tool."""
    import asyncio

    import server  # noqa: F401 — imported here so the pure tests stay dependency-free

    for tool in asyncio.run(server.mcp.list_tools()):
        properties = (tool.parameters or {}).get("properties", {})
        for name, schema in properties.items():
            if "default" not in schema or schema["default"] is not None:
                continue
            accepts_null = schema.get("type") == "null" or any(
                option.get("type") == "null" for option in schema.get("anyOf", [])
            )
            assert accepts_null, f"{tool.name}.{name} defaults to null but rejects it"


def test_either_name_the_download_returned_resolves_to_the_same_key():
    folder = "u123/system_conv-1"
    assert (
        run_storage_key("u123/system_conv-1/cv_dupont.pdf", folder)
        == "u123/system_conv-1/cv_dupont.pdf"
    )
    # the mounted name for that same file
    assert (
        run_storage_key("/mnt/workspace/system_conv-1/cv_dupont.pdf", folder)
        == "u123/system_conv-1/cv_dupont.pdf"
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
    assert run_storage_key("u123/system_conv-1/cv.pdf", "") == ""


if __name__ == "__main__":
    passed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            passed += 1
            print(f"  ok  {name}")
    print(f"\n{passed} passed")
