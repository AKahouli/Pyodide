// Relative (not @common/*): pulled in by ts-node migration scripts without path aliases.
import { stripNul } from '../../../common/postgres/json';
import type {
  FlowMailAttachmentWorkspaceImport,
  FlowMailMessageAttachmentData,
  FlowMailSenderData,
} from '../interfaces/playbook-flow-mail.interface';

/**
 * The mail ledger's participant and attachment subdocuments as Mongoose cast them: the schema's keys
 * only, null (or false) for what is missing. Returned JSON-ready, without U+0000.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const str = (value: unknown): string => stripNul(value == null ? '' : String(value));
const strOrNull = (value: unknown): string | null => (value == null ? null : stripNul(String(value)));
const numOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export function castMailParticipant(value: unknown): FlowMailSenderData {
  const participant = isPlainObject(value) ? value : {};
  return { name: strOrNull(participant.name), address: str(participant.address) };
}

export function castMailParticipants(value: unknown): FlowMailSenderData[] {
  return Array.isArray(value) ? value.filter(isPlainObject).map(castMailParticipant) : [];
}

function castWorkspaceImport(value: unknown): FlowMailAttachmentWorkspaceImport | null {
  if (!isPlainObject(value)) return null;
  return {
    workspaceDocumentId: strOrNull(value.workspaceDocumentId),
    filename: str(value.filename),
    finalFilename: strOrNull(value.finalFilename),
    mimeType: strOrNull(value.mimeType),
    size: numOrNull(value.size),
    sourcePath: strOrNull(value.sourcePath),
    collisionResolved: value.collisionResolved === true,
    error: strOrNull(value.error),
  };
}

export function castMailAttachments(value: unknown): FlowMailMessageAttachmentData[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPlainObject).map((attachment) => ({
    providerAttachmentId: str(attachment.providerAttachmentId),
    filename: str(attachment.filename),
    mimeType: strOrNull(attachment.mimeType),
    size: numOrNull(attachment.size),
    isInline: attachment.isInline === true,
    workspaceImport: castWorkspaceImport(attachment.workspaceImport),
  }));
}
