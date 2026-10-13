/** The kinds of data source a model can be connected to. SQL databases come next. */
export const DATA_CONNECTION_KINDS = ['mail_archive'] as const;
export type DataConnectionKind = (typeof DATA_CONNECTION_KINDS)[number];

/** A .zip of .eml files, or one .eml: the runtime reads it as the messages, participants and attachments tables. */
export const MAIL_ARCHIVE_MIME_TYPES = ['application/zip', 'application/x-zip-compressed', 'message/rfc822'];

export function isMailArchive(mimeType: string | undefined): boolean {
  return typeof mimeType === 'string' && MAIL_ARCHIVE_MIME_TYPES.some((prefix) => mimeType.startsWith(prefix));
}

export interface DataConnection {
  id: string;
  kind: DataConnectionKind;
  name: string;
  workspaceId: string;
  documentId: string;
  /** Whether runs also copy the e-mails and attachments into the workspace to be indexed there; off by default. */
  indexInWorkspace: boolean;
  /** The reading limits set on this connection; a limit left out uses its default. */
  limits: ArchiveReadLimits;
  /** The most read time and reader memory an admin allows; also what a connection without its own value gets. */
  ceilings: ArchiveReadCeilings;
  /** False when the file is gone or the person can no longer open its workspace. */
  available: boolean;
  createdAt: string;
}

/** How much of a mail archive one run reads, chosen per connection. */
export interface ArchiveReadLimits {
  /** Most e-mails the archive may hold. */
  maxArchiveEmails?: number;
  /** Largest archive read, in MB. */
  maxArchiveMb?: number;
  /** Time one full read of the archive may take, in seconds; at most the admin's value. */
  archiveTimeoutSeconds?: number;
  /** Memory of the process reading the archive, in MB; at most the admin's value. */
  parserMemoryMb?: number;
}

export type ArchiveReadCeilings = Required<Pick<ArchiveReadLimits, 'archiveTimeoutSeconds' | 'parserMemoryMb'>>;

export const ARCHIVE_LIMIT_DEFAULTS = { maxArchiveEmails: 50000, maxArchiveMb: 1024 } as const;

export const ARCHIVE_LIMIT_RANGES: Record<keyof ArchiveReadLimits, readonly [number, number]> = {
  maxArchiveEmails: [100, 200000],
  maxArchiveMb: [10, 51200],
  archiveTimeoutSeconds: [60, 7200],
  parserMemoryMb: [256, 16384],
};

/** Only the limits that were set and are in range; read time and memory are lowered to the admin's ceiling. */
export function pickArchiveLimits(input: unknown, ceilings?: ArchiveReadCeilings): ArchiveReadLimits {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const picked: ArchiveReadLimits = {};
  for (const key of Object.keys(ARCHIVE_LIMIT_RANGES) as (keyof ArchiveReadLimits)[]) {
    const value = (input as Record<string, unknown>)[key];
    const [low, high] = ARCHIVE_LIMIT_RANGES[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > high) continue;
    const ceiling = key === 'archiveTimeoutSeconds' || key === 'parserMemoryMb' ? ceilings?.[key] : undefined;
    picked[key] = ceiling === undefined ? value : Math.min(value, ceiling);
  }
  return picked;
}
