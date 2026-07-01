import type { WAMessage } from '@whiskeysockets/baileys';

function unwrapMessageContent(message: WAMessage): NonNullable<WAMessage['message']> | undefined {
  const content = message.message;
  if (!content) return undefined;
  if (content.ephemeralMessage?.message) {
    return content.ephemeralMessage.message as NonNullable<WAMessage['message']>;
  }
  if (content.viewOnceMessage?.message) {
    return content.viewOnceMessage.message as NonNullable<WAMessage['message']>;
  }
  return content;
}

export function isWhatsAppAudioMessage(message: WAMessage): boolean {
  return Boolean(unwrapMessageContent(message)?.audioMessage);
}

export function getWhatsAppAudioMimetype(message: WAMessage): string | undefined {
  return unwrapMessageContent(message)?.audioMessage?.mimetype ?? undefined;
}
