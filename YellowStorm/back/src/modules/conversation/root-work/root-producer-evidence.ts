import { createHash } from 'node:crypto';
import { BadRequestException, ErrorCode } from '../../exceptions';
import { RootProducerEvidenceDto } from '../dto/root-producer-evidence.dto';
import { RegisterEvidenceInput } from './root-work.store';
import { evidenceDedupKey, RootExecutionRecord } from './root-work.types';

const fields = new Set(['type', 'title', 'filename', 'file_name', 'fileName', 'path', 'filepath',
  'file_path', 'source', 'url', 'document_id', 'documentId', 'workspace_id', 'workspaceId',
  'brain_id', 'reference', 'page', 'artifact_id', 'artifact_kind', 'mime_type', 'size_bytes',
  'availability', 'producer_tool_id']);
export function flattenProducerEvidence(payload: Record<string, unknown>): Record<string, unknown> {
  const source = payload.source_object as Record<string, unknown> | undefined;
  return { ...payload, ...(source ?? {}), ...(source?.metadata as object ?? {}), ...(source?.content as object ?? {}) };
}

function safePayload(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 4) return false;
  return Object.entries(value).every(([key, item]) => {
    if (['source_object', 'metadata', 'content'].includes(key)) return safePayload(item, depth + 1);
    return fields.has(key) && (typeof item === 'string' && item.length <= 2000
      || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item));
  });
}

export function producerEvidence(child: RootExecutionRecord, evidence: RootProducerEvidenceDto[] = []): RegisterEvidenceInput[] {
  const identities = new Set<string>();
  if (evidence.length > 100) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Evidence limit exceeded');
  return evidence.map((item) => {
    if (!['citation', 'artifact'].includes(item.kind) || !item.nativeIdentity || item.nativeIdentity.length > 200
      || !Number.isInteger(item.outputOrdinal) || item.outputOrdinal < 0 || item.outputOrdinal > 99
      || !safePayload(item.payload) || Buffer.byteLength(JSON.stringify(item.payload), 'utf8') > 8192) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid producer evidence');
    }
    const dedupKey = evidenceDedupKey(child.id, item.nativeIdentity, item.outputOrdinal);
    if (identities.has(dedupKey)) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Duplicate evidence identity');
    identities.add(dedupKey);
    return { evidenceId: createHash('sha256').update(dedupKey).digest('hex').slice(0, 24),
      dedupKey, executionId: child.id, conversationId: child.conversationId,
      producerAgentId: String(child.resultPayload!.nativeState!.rootContext.selected_agent_id),
      kind: item.kind, payload: item.payload };
  });
}
