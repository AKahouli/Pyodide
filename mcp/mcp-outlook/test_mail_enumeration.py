"""Mail enumeration checks — `python test_mail_enumeration.py`.

Covers the deterministic paging that replaces search_m365's fixed `from: 0`:
filter building, client-side predicates, cursor round-trip and host validation,
a full two-page walk over a fake Graph transport, and the read-only attachment
listing. No network: `server._fetch_page`/`_get_message_attachments` are patched.
"""
import asyncio
import json

import server
import mail_export
from mail_enumeration import (
    build_filter,
    client_predicates,
    decode_cursor,
    encode_cursor,
    normalize_attachment,
    normalize_datetime,
    normalize_message,
)

NEXT = "https://graph.microsoft.com/v1.0/me/messages?$skip=2"
FIRST_PAGE = "https://graph.microsoft.com/v1.0/me/messages"

RAW_A = {
    "id": "m1",
    "conversationId": "c1",
    "subject": "Contrat Sony",
    "from": {"emailAddress": {"name": "John", "address": "john@sony.com"}},
    "toRecipients": [{"emailAddress": {"address": "me@yellowsys.fr"}}],
    "receivedDateTime": "2025-01-02T10:00:00Z",
    "sentDateTime": "2025-01-02T09:59:00Z",
    "hasAttachments": True,
    "isRead": False,
    "importance": "normal",
    "bodyPreview": "a",
    "webLink": "https://outlook/x",
}
RAW_B = {
    "id": "m2",
    "conversationId": "c1",
    "subject": "FW: Contrat sony",
    "from": {"emailAddress": {"name": "Jane", "address": "jane@sony.com"}},
    "receivedDateTime": "2025-01-03T10:00:00Z",
    "hasAttachments": False,
    "isRead": True,
    "bodyPreview": "b",
}
RAW_C = {
    "id": "m3",
    "conversationId": "c2",
    "subject": "Autre",
    "from": {"emailAddress": {"name": "Bob", "address": "bob@other.com"}},
    "receivedDateTime": "2025-01-04T10:00:00Z",
    "hasAttachments": False,
    "isRead": True,
    "bodyPreview": "c",
}
PAGES = {
    FIRST_PAGE: {"value": [RAW_A, RAW_B], "@odata.nextLink": NEXT, "@odata.count": 3},
    NEXT: {"value": [RAW_C], "@odata.count": 3},
}


def _install_fake_graph():
    server.graph_headers = lambda: {"Authorization": "Bearer test"}

    async def fake_fetch(client, headers, url, params):
        return PAGES.get(url, {"value": []})

    server._fetch_page = fake_fetch


def call(tool, **kwargs):
    return json.loads(asyncio.run(tool(**kwargs)))


def test_sender_filter_is_server_side():
    assert build_filter(sender="john@sony.com") == [
        "from/emailAddress/address eq 'john@sony.com'"
    ]


def test_a_quote_in_a_filter_value_is_escaped():
    assert build_filter(sender="o'brien@x.com") == [
        "from/emailAddress/address eq 'o''brien@x.com'"
    ]


def test_date_only_inputs_become_full_utc_instants():
    clause = " and ".join(build_filter(date_from="2025-01-01", date_to="2025-01-31"))
    assert "receivedDateTime ge 2025-01-01T00:00:00Z" in clause
    assert "receivedDateTime le 2025-01-31T23:59:59Z" in clause


def test_full_timestamps_pass_through_untouched():
    assert normalize_datetime("2025-01-01T08:30:00Z") == "2025-01-01T08:30:00Z"


def test_unread_maps_to_isread_false():
    assert build_filter(unread=True) == ["isRead eq false"]
    assert build_filter(unread=False) == ["isRead eq true"]


def test_domain_predicate_matches_only_that_domain():
    preds = client_predicates(sender_domain="sony.com")
    kept = [m["id"] for m in map(normalize_message, [RAW_A, RAW_B, RAW_C]) if all(p(m) for p in preds)]
    assert kept == ["m1", "m2"]


def test_subject_is_a_server_side_contains_filter():
    # contains(subject,...) is supported by Exchange and combines with a from
    # filter; it is not a client predicate.
    assert build_filter(subject="Contrat") == ["contains(subject,'Contrat')"]
    assert build_filter(sender="a@b.com", subject="x") == [
        "from/emailAddress/address eq 'a@b.com'",
        "contains(subject,'x')",
    ]


def test_recipients_predicate_matches_to_or_cc():
    message = normalize_message(
        {**RAW_A, "ccRecipients": [{"emailAddress": {"address": "cc@yellowsys.fr"}}]}
    )
    assert client_predicates(recipients="cc@yellowsys.fr")[0](message) is True
    assert client_predicates(recipients="me@yellowsys.fr")[0](message) is True
    assert client_predicates(recipients="nope@x.com")[0](message) is False


def test_cursor_round_trips_the_next_link():
    assert decode_cursor(encode_cursor(NEXT)) == NEXT
    assert encode_cursor(None) is None


def test_a_cursor_pointing_off_graph_is_rejected():
    for url in ("https://evil.example/v1.0/me/messages", "http://graph.microsoft.com/x"):
        try:
            decode_cursor(encode_cursor(url))
        except ValueError:
            pass
        else:
            raise AssertionError(f"cursor should have been rejected: {url}")


def test_single_page_returns_the_rest_as_a_cursor():
    _install_fake_graph()
    result = call(server.search_emails, sender="john@sony.com")
    assert result["status"] == "success"
    assert [m["id"] for m in result["items"]] == ["m1", "m2"]
    assert result["pagination"] == {
        "returned": 2,
        "hasMore": True,
        "nextCursor": encode_cursor(NEXT),
        "total": 3,
    }


def test_list_items_carry_only_the_enumeration_projection():
    # A full normalize_message payload is ~2 KB per message; 72 of them made the
    # model drop entries and under-report. List results keep identity + ordering.
    _install_fake_graph()
    item = call(server.search_emails, sender="john@sony.com")["items"][0]
    assert item["id"] == "m1" and item["subject"] == "Contrat Sony"
    for dropped in ("bodyPreview", "webLink", "toRecipients", "ccRecipients"):
        assert dropped not in item


def test_total_is_omitted_when_a_client_side_filter_narrows_the_page():
    # sender_domain is applied after Graph answers, so its count would describe a
    # wider set than `items` and must not be reported as the result total.
    _install_fake_graph()
    result = call(server.search_emails, sender_domain="sony.com")
    assert "total" not in result["pagination"]


def test_total_is_omitted_when_graph_does_not_return_it():
    server.graph_headers = lambda: {"Authorization": "Bearer test"}

    async def fake_fetch(client, headers, url, params):
        return {"value": [RAW_A]}

    server._fetch_page = fake_fetch
    result = call(server.search_emails, sender="john@sony.com")
    assert "total" not in result["pagination"]


def test_the_cursor_fetches_the_following_page():
    _install_fake_graph()
    first = call(server.search_emails, sender="john@sony.com")
    second = call(server.search_emails, cursor=first["pagination"]["nextCursor"])
    assert [m["id"] for m in second["items"]] == ["m3"]
    assert second["pagination"]["hasMore"] is False
    assert second["pagination"]["nextCursor"] is None


def test_a_forged_cursor_is_an_error_not_a_request():
    _install_fake_graph()
    result = call(
        server.search_emails, cursor=encode_cursor("https://evil.example/steal")
    )
    assert result["status"] == "error"


def test_fetch_all_walks_every_page():
    _install_fake_graph()
    result = call(server.search_emails, fetch_all_metadata=True)
    assert [m["id"] for m in result["items"]] == ["m1", "m2", "m3"]
    assert result["pagination"]["complete"] is True
    assert result["pagination"]["pages"] == 2
    assert result["pagination"]["hasMore"] is False
    assert result["pagination"]["total"] == 3


def test_fetch_all_honours_max_results():
    _install_fake_graph()
    result = call(server.search_emails, fetch_all_metadata=True, max_results=1)
    assert result["pagination"]["returned"] == 1
    assert result["pagination"]["complete"] is False
    assert result["pagination"]["hasMore"] is True


def test_attachments_are_normalized_for_the_read_only_listing():
    inline = normalize_attachment(
        {"@odata.type": "#microsoft.graph.fileAttachment", "id": "a1", "name": "logo.png",
         "contentType": "image/png", "size": 3421, "isInline": True}
    )
    assert inline == {
        "id": "a1", "filename": "logo.png", "contentType": "image/png",
        "size": 3421, "isInline": True, "type": "fileAttachment",
    }


def test_list_mail_attachments_reports_without_downloading():
    class FakeResponse:
        status_code = 200
        text = "{}"

        def json(self):
            return {"value": [
                {"@odata.type": "#microsoft.graph.fileAttachment", "id": "a1",
                 "name": "Sony_Contract.pdf", "contentType": "application/pdf",
                 "size": 894123, "isInline": False}
            ]}

    async def fake_get(client, headers, message_id, select=None):
        return FakeResponse()

    server._get_message_attachments = fake_get
    result = call(server.list_mail_attachments, message_id="m1")
    assert result["count"] == 1
    assert result["attachments"][0]["filename"] == "Sony_Contract.pdf"


# --- Graph throttling resilience -------------------------------------------


class _FakeResponse:
    def __init__(self, status_code, json_body=None, text="", headers=None):
        self.status_code = status_code
        self._json = json_body
        self.text = text if text else json.dumps(json_body or {})
        self.headers = headers or {}

    def json(self):
        return self._json


class _FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def request(self, method, url, *, headers=None, params=None, json=None, timeout=None):
        self.calls.append(method)
        return self.responses.pop(0)


def _capture_sleep(record):
    real = server.asyncio.sleep

    async def _sleep(seconds):
        record.append(seconds)

    server.asyncio.sleep = _sleep
    return real


def test_retry_after_header_is_read_and_capped():
    assert server._retry_after_seconds({"Retry-After": "7"}, 1.0) == 7.0
    assert server._retry_after_seconds({"retry-after": "3"}, 1.0) == 3.0
    assert server._retry_after_seconds({}, 1.5) == 1.5
    assert server._retry_after_seconds({"Retry-After": "9999"}, 1.0) == server.GRAPH_MAX_WAIT_SECONDS


def test_graph_request_waits_and_retries_a_429():
    sleeps = []
    real = _capture_sleep(sleeps)
    try:
        client = _FakeClient([
            _FakeResponse(429, {"error": {"code": "ApplicationThrottled"}}, headers={"Retry-After": "2"}),
            _FakeResponse(200, {"ok": True}),
        ])
        response = asyncio.run(
            server._graph_request(client, "GET", "https://graph.microsoft.com/v1.0/me/messages", headers={})
        )
    finally:
        server.asyncio.sleep = real
    assert response.status_code == 200
    assert len(client.calls) == 2
    assert sleeps == [2.0]


def test_graph_request_stops_after_the_attempt_budget():
    sleeps = []
    real = _capture_sleep(sleeps)
    try:
        client = _FakeClient([_FakeResponse(429, {"error": {}}) for _ in range(10)])
        response = asyncio.run(
            server._graph_request(client, "GET", "https://graph.microsoft.com/v1.0/me/messages", headers={})
        )
    finally:
        server.asyncio.sleep = real
    assert response.status_code == 429
    assert len(client.calls) == server.GRAPH_MAX_ATTEMPTS


def test_a_malformed_id_error_carries_an_actionable_hint():
    hint = server._graph_error_hint(400, json.dumps({"error": {"code": "ErrorInvalidIdMalformed"}}))
    assert hint and "malformed" in hint.lower() and "search_emails" in hint
    assert server._graph_error_hint(400, "other") is None
    throttle = server._graph_error_hint(429, '{"error":{"code":"ApplicationThrottled"}}')
    assert throttle and "throttled" in throttle.lower()


def test_list_mail_attachments_surfaces_the_hint_on_a_bad_id():
    class BadId:
        status_code = 400
        text = json.dumps({"error": {"code": "ErrorInvalidIdMalformed", "message": "Id is malformed."}})

        def json(self):
            return {}

    async def fake_get(client, headers, message_id, select=None):
        return BadId()

    server._get_message_attachments = fake_get
    result = call(server.list_mail_attachments, message_id="truncated-id")
    assert result["status"] == "error"
    assert "malformed" in result["hint"].lower()


def test_batch_fetch_retries_only_the_throttled_reads():
    sleeps = []
    real = _capture_sleep(sleeps)
    try:
        client = _FakeClient([
            _FakeResponse(200, {"responses": [
                {"id": "0", "status": 200, "body": {"id": "m1", "subject": "A"}},
                {"id": "1", "status": 429, "headers": {"Retry-After": "1"},
                 "body": {"error": {"code": "ApplicationThrottled"}}},
            ]}),
            _FakeResponse(200, {"responses": [
                {"id": "0", "status": 200, "body": {"id": "m2", "subject": "B"}},
            ]}),
        ])
        out = asyncio.run(server._batch_fetch_messages(client, {"Authorization": "Bearer x"}, ["m1", "m2"]))
    finally:
        server.asyncio.sleep = real
    assert sorted(m["id"] for m in out) == ["m1", "m2"]
    assert all("error" not in m for m in out)
    assert len(client.calls) == 2  # first round (2 ids), second round (the one throttled)


def test_batch_fetch_reports_an_id_that_stays_throttled():
    sleeps = []
    real = _capture_sleep(sleeps)
    try:
        client = _FakeClient([
            _FakeResponse(200, {"responses": [
                {"id": "0", "status": 429, "headers": {"Retry-After": "1"},
                 "body": {"error": {"code": "ApplicationThrottled"}}},
            ]})
            for _ in range(server.GRAPH_MAX_ATTEMPTS)
        ])
        out = asyncio.run(server._batch_fetch_messages(client, {}, ["m1"]))
    finally:
        server.asyncio.sleep = real
    assert out[0]["id"] == "m1"
    assert "429" in out[0]["error"]


def test_include_preview_adds_the_body_preview():
    _install_fake_graph()
    item = call(server.search_emails, sender="john@sony.com", include_preview=True)["items"][0]
    assert item["bodyPreview"] == "a"


def test_preview_is_absent_by_default():
    _install_fake_graph()
    item = call(server.search_emails, sender="john@sony.com")["items"][0]
    assert "bodyPreview" not in item


# --- server-side selectors (so the model never re-types a message id) --------

_ORIG = {
    name: getattr(server, name)
    for name in (
        "_fetch_page",
        "_get_message_attachments",
        "_graph_request",
        "_resolve_messages",
        "_attachment_bytes",
        "_attachment_report",
        "graph_headers",
        "system_workspace_prefix",
        "put_storage_object",
    )
}


def _restore():
    for name, fn in _ORIG.items():
        setattr(server, name, fn)


def test_resolve_selector_returns_newest_or_all_oldest_first():
    _restore()
    server.graph_headers = lambda: {"Authorization": "Bearer t"}

    async def fake_fetch(client, headers, url, params):
        return {"value": [RAW_A, RAW_B, RAW_C]} if url == FIRST_PAGE else {"value": []}

    server._fetch_page = fake_fetch
    newest = asyncio.run(server._resolve_messages(None, {}, sender="x@y.com", match="newest"))
    assert [m["id"] for m in newest] == ["m3"]
    everything = asyncio.run(server._resolve_messages(None, {}, sender="x@y.com", match="all"))
    assert [m["id"] for m in everything] == ["m1", "m2", "m3"]


def test_get_emails_by_selector_pages_bodies():
    _restore()
    _install_fake_graph()
    result = call(server.get_emails, sender="john@sony.com", page_size=2)
    assert result["status"] == "success"
    assert [m["id"] for m in result["messages"]] == ["m1", "m2"]
    assert "body" in result["messages"][0]
    assert result["pagination"] == {
        "returned": 2,
        "hasMore": True,
        "nextCursor": encode_cursor(NEXT),
        "total": 3,
    }


def test_get_email_by_selector_uses_the_newest_match():
    _restore()

    async def fake_resolve(client, headers, **kwargs):
        return [{"id": "m3", "subject": "Autre", "receivedDateTime": "2025-01-04T10:00:00Z"}]

    server._resolve_messages = fake_resolve

    class Resp:
        status_code = 200

        def json(self):
            return {
                "id": "m3",
                "subject": "Autre",
                "from": {"emailAddress": {"address": "bob@other.com"}},
                "body": {"contentType": "text", "content": "hello"},
            }

    async def fake_request(client, method, url, **kwargs):
        return Resp()

    server._graph_request = fake_request
    result = call(server.get_email, sender="bob@other.com")
    assert result["status"] == "success"
    assert result["message"]["id"] == "m3"
    assert result["message"]["body"]["content"] == "hello"


def test_list_mail_attachments_by_selector_groups_per_message():
    _restore()

    async def fake_resolve(client, headers, **kwargs):
        return [
            {"id": "m1", "subject": "A", "receivedDateTime": "2025-01-02T10:00:00Z"},
            {"id": "m2", "subject": "B", "receivedDateTime": "2025-01-03T10:00:00Z"},
        ]

    server._resolve_messages = fake_resolve

    async def fake_get(client, headers, message_id, select=None):
        class R:
            status_code = 200

            def json(self):
                return {"value": [{"@odata.type": "#microsoft.graph.fileAttachment", "id": "a1",
                                   "name": message_id + ".pdf", "contentType": "application/pdf",
                                   "size": 10, "isInline": False}]}

        return R()

    server._get_message_attachments = fake_get
    result = call(server.list_mail_attachments, sender="x@y.com", has_attachments=True)
    assert result["count"] == 2
    assert result["messages"][0]["subject"] == "A"
    assert result["messages"][0]["attachments"][0]["filename"] == "m1.pdf"


def test_download_mail_attachments_by_selector_downloads_matches():
    _restore()
    server.system_workspace_prefix = lambda: "u1/system_c1"
    stored = []
    server.put_storage_object = lambda key, raw, content_type: stored.append(key)

    async def fake_resolve(client, headers, **kwargs):
        return [{"id": "m9", "subject": "PJ", "receivedDateTime": "2025-01-05T10:00:00Z"}]

    server._resolve_messages = fake_resolve

    async def fake_get(client, headers, message_id, select=None):
        class R:
            status_code = 200

            def json(self):
                return {"value": [{"@odata.type": "#microsoft.graph.fileAttachment", "id": "a1",
                                   "name": "doc.pdf", "contentType": "application/pdf",
                                   "size": 5, "isInline": False}]}

        return R()

    async def fake_bytes(client, headers, attachment):
        return b"hello", "application/pdf"

    server._get_message_attachments = fake_get
    server._attachment_bytes = fake_bytes
    result = call(server.download_mail_attachments, sender="x@y.com", has_attachments=True, match="all")
    assert result["status"] == "success"
    assert result["files"][0]["filename"] == "doc.pdf"
    assert result["files"][0]["subject"] == "PJ"
    assert result["files"][0]["sandbox_path"] == "/mnt/workspace/system_c1/doc.pdf"
    assert stored == ["u1/system_c1/doc.pdf"]


def test_export_emails_table_writes_one_row_per_mail():
    _restore()
    server.system_workspace_prefix = lambda: "u1/system_c1"
    written = {}
    server.put_storage_object = lambda key, raw, content_type: written.update(
        key=key, raw=raw, content_type=content_type
    )

    async def fake_fetch(client, headers, url, params):
        return {"value": [RAW_A, RAW_B]} if url == FIRST_PAGE else {"value": []}

    server._fetch_page = fake_fetch

    async def fake_report(client, headers, message_id, extract):
        return (["c.pdf"], ["[c.pdf]\nPage 1"]) if message_id == "m1" else ([], [])

    server._attachment_report = fake_report
    result = call(server.export_emails_table, sender="john@sony.com")
    assert result["status"] == "success"
    assert result["rows"] == 2
    assert result["columns"] == list(mail_export.COLUMNS)
    assert written["key"].startswith("u1/system_c1/emails_")
    assert written["content_type"] == "text/csv"
    assert result["markdown"].splitlines()[0] == "| " + " | ".join(mail_export.COLUMNS) + " |"
    text = written["raw"].decode("utf-8-sig")
    assert "Contrat Sony" in text
    assert "c.pdf" in text
    assert "Aucune" in text  # the second mail has no attachment


def test_export_emails_table_requires_a_selector():
    _restore()
    server.system_workspace_prefix = lambda: "u1/system_c1"
    result = call(server.export_emails_table)
    assert result["status"] == "error"


def test_export_emails_table_filters_by_domain_client_side():
    _restore()
    server.system_workspace_prefix = lambda: "u1/system_c1"
    server.put_storage_object = lambda key, raw, ct: None

    async def fake_fetch(client, headers, url, params):
        return {"value": [RAW_A, RAW_B, RAW_C]} if url == FIRST_PAGE else {"value": []}

    server._fetch_page = fake_fetch

    async def fake_report(client, headers, message_id, extract):
        return ([], [])

    server._attachment_report = fake_report
    result = call(server.export_emails_table, sender_domain="sony.com", include_attachment_first_page=False)
    assert result["rows"] == 2  # RAW_C is other.com and is filtered out
    assert "markdown" in result  # small table -> single markdown blob


if __name__ == "__main__":
    passed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            passed += 1
            print(f"  ok  {name}")
    print(f"\n{passed} passed")
