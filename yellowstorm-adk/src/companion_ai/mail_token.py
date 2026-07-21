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


def mint() -> str:
    """A fresh routing token."""
    return PREFIX + secrets.token_urlsafe(_ENTROPY_BYTES)


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
