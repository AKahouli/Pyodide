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


def test_an_incoming_reply_never_carries_a_token_into_the_plan():
    """Root cause of a live failure, fixed at the source.

    A reply quotes the mail it answers, so the text that comes back carries
    our own outbound subject line -- token and all. That text becomes the
    await_reply step's result, i.e. the next step's context. Reading it, the
    model composed round 2's subject by carrying round 1's forward (token
    included); stamping appended round 2's, so the mail left as
    "... [round-1] [round-2]". extract() takes the FIRST token -- round 1's,
    already matched and spent -- so the real reply resolved to a dead wait,
    was dropped as "already delivered", and round 2 waited forever.

    The executor is never told about tokens precisely so it can never be
    relied on to handle one; scrubbing the inbound reply is what keeps that
    true. Verbatim shape of the real reply that broke it.
    """
    spent = "YW--eztV2BQOiwekB1Up0puKpjf"
    reply = (
        "before approving this i need first firas kahia confirmation so i give you the go\n"
        "Envoye a partir de Outlook pour Android\n"
        "From: Rabeb Sdiri <rsdiri@yellowsys.fr>\n"
        "To: Imed Hamdi <ihamdi@yellowsys.fr>\n"
        f"Subject: Decision needed: Databricks migration [{spent}]  Hi Hamdi,\n"
        f'<span style="display:none">{spent}</span>'
    )

    scrubbed = mail_token.scrub(reply)

    assert mail_token._TOKEN_RE.findall(scrubbed) == [], scrubbed
    assert '<span style="display:none"></span>' not in scrubbed
    # The human's actual words -- the only part that matters -- are intact.
    assert "before approving this i need first firas kahia confirmation" in scrubbed
    assert "Subject: Decision needed: Databricks migration" in scrubbed


def test_scrub_leaves_an_ordinary_reply_alone():
    plain = "Yes, approved. Go ahead with the phased migration."
    assert mail_token.scrub(plain) == plain
    assert mail_token.scrub("") == ""
    assert mail_token.scrub(None) is None


def test_stamping_stays_a_plain_append():
    """Stamping is deliberately untouched: the fix is on the way IN, so the
    outbound side has nothing to defend against."""
    token = mail_token.mint()
    assert mail_token.stamp_subject("Which company?", token) == f"Which company? [{token}]"
    assert mail_token.stamp_body("<p>Q</p>", token) == (
        f'<p>Q</p><span style="display:none">{token}</span>')


if __name__ == "__main__":
    test_tokens_are_unique_and_unguessable()
    test_a_reply_carries_the_token_back_in_the_subject()
    test_a_reply_carries_the_token_back_in_quoted_body_when_the_subject_is_rewritten()
    test_the_subject_wins_when_both_carriers_are_present()
    test_a_mail_with_no_token_routes_nowhere()
    test_an_incoming_reply_never_carries_a_token_into_the_plan()
    test_scrub_leaves_an_ordinary_reply_alone()
    test_stamping_stays_a_plain_append()
    print("ok")
