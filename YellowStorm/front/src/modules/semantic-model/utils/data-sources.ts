/** A .zip of .eml files, or one .eml: the runtime reads it as the messages, participants and attachments tables. */
const MAIL_ARCHIVE_MIME_PREFIXES = ['application/zip', 'application/x-zip-compressed', 'message/rfc822'];

export function isMailArchive(mimeType: string | undefined): boolean {
  return typeof mimeType === 'string' && MAIL_ARCHIVE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

/** The tables of a mail archive, in the order they are listed. */
export const MAIL_TABLES = ['messages', 'participants', 'attachments'] as const;

/** A known table's translated name (dataSources.table.*), or the table's own name. */
export function tableLabel(t: (key: `dataSources.table.${MailTable}`) => string, name: string): string {
  return isMailTable(name) ? t(`dataSources.table.${name}`) : name;
}

export type MailTable = (typeof MAIL_TABLES)[number];

const isMailTable = (name: string): name is MailTable => (MAIL_TABLES as readonly string[]).includes(name);
