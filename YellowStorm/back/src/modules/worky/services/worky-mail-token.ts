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

/**
 * The reply's actual text. Graph's `bodyPreview` is a plain-text summary
 * silently capped at 255 characters — fine for a one-line "ok, approved",
 * but it truncates anything longer mid-sentence, discarding the rest of a
 * real decision. Prefer the full body; fall back to bodyPreview only when
 * the body itself is empty (seen: a step correctly noticed a reply looked
 * "truncated mid-word" and worked around it via a mailbox search instead —
 * this is the actual fix, not a workaround for the model to route around).
 */
export function fullReplyText(
  body: { contentType?: string; content?: string } | null | undefined,
  bodyPreview: string | null | undefined,
): string {
  const content = body?.content?.trim();
  if (!content) return (bodyPreview ?? '').trim();
  return (body?.contentType === 'html' ? stripHtml(content) : content).trim();
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
    .trim();
}
