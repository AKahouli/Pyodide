/**
 * Finding the routing token on an incoming reply.
 *
 * The token is minted and planted by worky (see `companion_ai/mail_token.py`);
 * this is the read side, and the two must agree on the pattern. It rides in the
 * subject and in a hidden span in the body, because either carrier alone can be
 * lost: a sender may rewrite the subject, or trim the quoted original.
 *
 * Nothing here decides whether a token is real — an unknown one simply resolves
 * to no wait and the mail is ignored. This only has to find candidates.
 */

/** Tolerant: the token may arrive bare or bracketed, from a subject or from quoted HTML. */
const TOKEN_RE = /YW-[A-Za-z0-9_-]{16,}/;

/**
 * The first routing token found across `texts` (pass the reply's subject and
 * body), or null when the mail carries none — which is the common case, since a
 * mailbox subscription fires for every arriving mail, not just ours.
 */
export function extractMailToken(...texts: Array<string | null | undefined>): string | null {
  for (const text of texts) {
    if (!text) continue;
    const match = TOKEN_RE.exec(text);
    if (match) return match[0];
  }
  return null;
}
