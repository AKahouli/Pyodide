import json

from app.jobs.error_details import capture_error


def test_db_payload_is_not_public():
    import asyncpg
    exc = asyncpg.DataError("invalid input for query argument $7: SECRET DOCUMENT (expected str, got dict)")
    details = capture_error(exc, phase="search")
    assert "SECRET" not in json.dumps(details)
    assert "$7" in details["message"]
    assert "Expected str, got dict" in details["message"]


def test_http_cause_and_frames_are_metadata_only():
    import httpx
    try:
        try:
            raise httpx.HTTPStatusError("SECRET", request=httpx.Request("GET", "https://secret.invalid/token"),
                                       response=httpx.Response(403))
        except httpx.HTTPStatusError as cause:
            raise RuntimeError("SECRET DOCUMENT") from cause
    except RuntimeError as exc:
        details = capture_error(exc)
    assert details["causes"][0]["httpStatus"] == 403
    assert "SECRET" not in json.dumps(details)
    assert "secret.invalid" not in json.dumps(details)
    assert len(details["frames"]) <= 8
    assert all("/" not in frame["file"] for frame in details["frames"])


def test_cause_cycles_are_bounded():
    exc = RuntimeError("secret")
    exc.__context__ = exc
    assert "causes" not in capture_error(exc)


def test_all_strings_and_causes_are_bounded_and_public_extras_removed():
    from app.jobs.error_details import public_details
    exc = RuntimeError("SECRET" * 1000)
    current = exc
    for _ in range(10):
        current.__cause__ = ValueError("SECRET" * 1000)
        current = current.__cause__
    details = capture_error(exc, code="secret " * 1000)
    assert len(details["causes"]) == 3
    projected = public_details({**details, "locals": {"password": "SECRET"},
                                "frames": [{"file": "C:/private/a.py", "function": "f", "line": 1}]})
    assert "locals" not in projected and "frames" not in projected
    def check(value):
        if isinstance(value, str):
            assert len(value.encode()) <= 512
        elif isinstance(value, dict):
            for item in value.values(): check(item)
        elif isinstance(value, list):
            for item in value: check(item)
    check(projected)
    assert "SECRET" not in json.dumps(projected)


def test_saved_multibyte_and_malformed_nested_diagnostics_are_bounded_after_roundtrip():
    from app.jobs.error_details import public_details

    try:
        exec(compile("raise RuntimeError('PRIVATE_DOCUMENT')", "秘密" * 300 + ".py", "exec"))
    except RuntimeError as exc:
        details = capture_error(exc)
    assert all(len(frame["file"].encode()) <= 512 for frame in details["frames"])
    saved = json.loads(json.dumps({**details, "frames": details["frames"] + [
        {"file": "../private.env", "function": "secret", "line": 1},
        {"file": "safe.py", "function": {"password": "PRIVATE"}, "line": True},
        {"file": {"password": "PRIVATE"}, "function": "f", "line": 1},
    ], "causes": [None, "PRIVATE", {"errorType": [], "message": {"prompt": "PRIVATE"},
                                     "response": "PRIVATE"}]}))
    projected = public_details(saved)
    assert "PRIVATE" not in json.dumps(projected)
    assert all(len(frame["file"].encode()) <= 512 and ".." not in frame["file"]
               for frame in projected.get("frames", []))
    assert projected["causes"] == [{"errorType": "unknown", "message":
        "Runtime operation failed; inspect the exception type and frame locations."}]
