"""Mail-token stamping for the LG send path (offline).

Proves: for a send step a planned await_reply depends on, the send_email tool's
outbound subject/body get the routing token, and the wait records the recipients
(so the reply's sender is verified). A send with no awaiting sibling stays plain.
"""
from __future__ import annotations

import asyncio

from src.companion_ai import mail_token
from src.companion_ai.lg.tools import make_stamping_tools_for
from src.companion_ai.plan import Plan, Step

_sent = []


# A fake "raw connector tool": the detector nodes.is_send_email_tool keys on
# tool.func.__name__ ending in _send_email, so name the callable accordingly.
async def _mailer_send_email(*, subject: str = "", body: str = "",
                             to_recipients=None):
    _sent.append({"subject": subject, "body": body, "to": to_recipients})
    return "sent-ok"


class RawTool:
    def __init__(self, func, name):
        self.func = func
        self.name = name
        self.description = name


class FakeRM:
    def __init__(self, token):
        self._token = token
        self.expected_from = {}

    async def mail_token_for(self, session_id, step_id):
        return self._token

    async def set_mail_wait_expected_from(self, token, expected_from):
        self.expected_from[token] = expected_from


# Patch create_connector_tools to return our fake raw tool.
def _install_fake_connectors(monkeypatch, raw_tools):
    import src.smart_rag.tools.utilities.connector_tools as ct
    monkeypatch.setattr(ct, "create_connector_tools",
                        lambda connectors, context: raw_tools)


async def test_send_tool_is_stamped_for_awaited_step(monkeypatch):
    _sent.clear()
    token = mail_token.mint()
    rm = FakeRM(token)
    _install_fake_connectors(monkeypatch, [RawTool(_mailer_send_email, "mailer_send_email")])

    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="send", title="SEND", description="send mail", depends_on=[]),
        Step(id="wait", title="WAIT", kind="await_reply", depends_on=["send"]),
    ])
    tools_for = make_stamping_tools_for([{"slug": "mailer"}], "sess", "u", plan, rm)

    tool = tools_for(plan.step("send"))[0]
    await tool.ainvoke({"subject": "Validation", "body": "Please approve.",
                        "to_recipients": ["Reviewer <reviewer@example.com>"]})

    assert len(_sent) == 1
    assert token in _sent[0]["subject"]           # stamped into subject
    assert token in _sent[0]["body"]              # and body
    assert rm.expected_from[token] == "reviewer@example.com"  # recipient recorded, lowercased


async def test_send_tool_plain_when_no_awaiting_sibling(monkeypatch):
    _sent.clear()
    token = mail_token.mint()
    rm = FakeRM(token)
    _install_fake_connectors(monkeypatch, [RawTool(_mailer_send_email, "mailer_send_email")])

    plan = Plan(id="p", title="t", goal="g", steps=[
        Step(id="notify", title="NOTIFY", description="fyi mail", depends_on=[]),
    ])
    tools_for = make_stamping_tools_for([{"slug": "mailer"}], "sess", "u", plan, rm)

    tool = tools_for(plan.step("notify"))[0]
    await tool.ainvoke({"subject": "FYI", "body": "info", "to_recipients": ["x@y.com"]})

    assert _sent[0]["subject"] == "FYI"           # untouched — nothing awaits it
    assert token not in _sent[0]["body"]
    assert rm.expected_from == {}


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-q"]))
