"""The routing token — minting, planting, and finding it again on a reply.

Pure functions, no ADK and no Postgres.

    <adk venv>/bin/python tests/orchestrator/test_mail_token.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from src.companion_ai import mail_token


def test_tokens_are_unique_and_unguessable():
    tokens = {mail_token.mint() for _ in range(1000)}
    assert len(tokens) == 1000, "minting collided"
    t = mail_token.mint()
    assert t.startswith("YW-")
    # A token anyone could guess would let a stranger answer a step.
    assert len(t) - len("YW-") >= 20, t


def test_a_reply_carries_the_token_back_in_the_subject():
    token = mail_token.mint()
    sent = mail_token.stamp_subject("Which company do you work for?", token)
    # What a mail client sends back:
    assert mail_token.extract(f"Re: {sent}") == token
    assert mail_token.extract(f"RE: {sent}") == token
    assert mail_token.extract(f"Fwd: {sent}") == token
    assert mail_token.extract(f"TR: {sent}") == token          # fr


def test_a_reply_carries_the_token_back_in_quoted_body_when_the_subject_is_rewritten():
    token = mail_token.mint()
    body = mail_token.stamp_body("<p>Which company?</p>", token)
    assert token in body
    assert "display:none" in body, "the token must not be visible to the reader"
    quoted = f"<p>Yellow Systems.</p><blockquote>On Fri, we wrote:<br>{body}</blockquote>"
    # Subject rewritten to something with no token at all — body still routes it.
    assert mail_token.extract("A totally different subject", quoted) == token


def test_the_subject_wins_when_both_carriers_are_present():
    token = mail_token.mint()
    subject = mail_token.stamp_subject("Q", token)
    body = mail_token.stamp_body("<p>Q</p>", token)
    assert mail_token.extract(f"Re: {subject}", body) == token


def test_a_mail_with_no_token_routes_nowhere():
    assert mail_token.extract("Re: unrelated thread", "<p>hello</p>") is None
    assert mail_token.extract(None, "") is None
    # Not every YW- lookalike is a token; the registry rejects unknowns anyway,
    # but junk must not even parse.
    assert mail_token.extract("YW-short") is None


if __name__ == "__main__":
    test_tokens_are_unique_and_unguessable()
    test_a_reply_carries_the_token_back_in_the_subject()
    test_a_reply_carries_the_token_back_in_quoted_body_when_the_subject_is_rewritten()
    test_the_subject_wins_when_both_carriers_are_present()
    test_a_mail_with_no_token_routes_nowhere()
    print("ok")
