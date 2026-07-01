/**
 * Normalizes a Baileys user JID for group invites and persistence.
 * Strips the multi-device suffix (`:0`, `:21`, …) that `socket.user.id` includes.
 */
export function normalizeWhatsappUserJid(jid: string): string {
  const trimmed = jid.trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0) {
    const digits = trimmed.replace(/\D/g, '');
    return `${digits}@s.whatsapp.net`;
  }
  const userPart = trimmed.slice(0, atIndex).split(':')[0];
  const server = trimmed.slice(atIndex + 1);
  return `${userPart}@${server}`;
}
