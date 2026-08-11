"""The routing token that ties an email reply back to the step waiting for it.

Why a token at all: the connector's `send_email` action wraps Graph
`POST /me/sendMail`, which answers `202 Accepted` with an empty body — no
message id, no conversationId. There is nothing to correlate on afterwards, so
the correlation has to be planted in the mail on the way out.

It rides in two independent carriers, because either one alone can be lost:

    subject  "Which company? [YW-xxxx]"     survives Re:/Fwd:, but a sender may
                                            edit the subject line
    body     <span style="display:none">    survives reply-quoting, but a sender
                                            may trim the quoted text

The token is opaque and random rather than a signed encoding of
(session_id, step_id): a wait row has to exist regardless — for expiry, dedupe
and the mailbox refcount — so the lookup is happening either way, and a random
token needs no secret to store, rotate or leak. The registry is the only truth.

Unguessable matters: anyone who learns a live token could answer a step and
feed the plan input the real correspondent never sent.
"""
from __future__ import annotations

import re
import secrets

PREFIX = "YW-"

# 18 random bytes -> 24 urlsafe chars. Enough that guessing a live token is not
# a thing, short enough not to mangle a subject line.
_ENTROPY_BYTES = 18

# Tolerant on the way in: the token may arrive bare or bracketed, from a subject
# or from quoted HTML, so accept it anywhere and let the registry reject unknowns.
_TOKEN_RE = re.compile(r"YW-[A-Za-z0-9_-]{16,}")

# For scrub(): the same token in each carrier stamp_* writes, outermost first —
# the hidden span has to go whole, or removing the token would leave a stray
# empty <span> behind.
_HIDDEN_SPAN_RE = re.compile(
    r'<span style="display:none">\s*YW-[A-Za-z0-9_-]{16,}\s*</span>', re.IGNORECASE)
# Bracketed as stamp_subject writes it, plus any leading space, so stripping
# " Subject [YW-x]" leaves "Subject" and not "Subject ".
_BRACKETED_TOKEN_RE = re.compile(r"\s*\[\s*YW-[A-Za-z0-9_-]{16,}\s*\]")


def mint() -> str:
    """A fresh routing token."""
    return PREFIX + secrets.token_urlsafe(_ENTROPY_BYTES)


def scrub(text: str) -> str:
    """Remove every routing token from an INCOMING reply, before the plan sees it.

    Tokens are deliberately not the executor's business — it is never told
    about them, so that it can never be relied on (and fail) to carry one
    (see nodes.stamp_send_email_tool). This function is what keeps that
    invariant true on the way back in.

    A reply quotes the mail it answers, so the text a correspondent sends
    back carries our own outbound subject line — token and all:

        Subject: Decision needed: Databricks migration [YW-<round-1>]

    That text becomes the await_reply step's result, i.e. context for the
    step that runs next. Seen live: reading it, the model composed round 2's
    subject by carrying round 1's forward, token included, so stamping
    appended a second token and the mail left as
    "... [YW-<round-1>] [YW-<round-2>]". The reader takes the FIRST token it
    finds — round 1's, already matched and spent — so the real reply
    resolved to a dead wait, was dropped as "already delivered", and round 2
    waited forever.

    Scrubbing here fixes that at the source: the model never sees a token,
    so it cannot echo one, and every outbound mail carries exactly the one
    stamped on it.

    Order matters: the hidden span goes whole (removing just the token would
    leave a stray empty <span>), then bracketed, then any bare leftover.
    """
    if not text:
        return text
    text = _HIDDEN_SPAN_RE.sub("", text)
    text = _BRACKETED_TOKEN_RE.sub("", text)
    return _TOKEN_RE.sub("", text)


def stamp_subject(subject: str, token: str) -> str:
    """Put the token in the subject, where a reply's `Re:` prefix preserves it."""
    return f"{subject} [{token}]"


def stamp_body(body: str, token: str) -> str:
    """Put the token in the body, hidden, where reply-quoting preserves it.

    `send_email`'s body is HTML, so this is invisible to the reader. It is the
    fallback for a correspondent who rewrites the subject line."""
    return f'{body}<span style="display:none">{token}</span>'


def extract(*texts: str | None) -> str | None:
    """The first routing token found across `texts`, or None.

    Pass the reply's subject and body: a reply keeps the token in at least one of
    them unless the sender stripped both.
    """
    for text in texts:
        if not text:
            continue
        m = _TOKEN_RE.search(text)
        if m:
            return m.group(0)
    return None
