import { inArray } from 'drizzle-orm';
import * as schema from '../../../postgres/schema';
import type { RootControlTransaction } from './root-background-owner';
import type { DelegateResultV1 } from '../../root-work/root-work.types';
import { flattenProducerEvidence } from '../../root-work/root-producer-evidence';
import { sanitizePublicComponent } from '../../utils/public-component-sanitizer';

type Member = typeof schema.rootExecutions.$inferSelect;
export async function loadFollowupEvidence(tx: RootControlTransaction, members: Member[]) {
  const references = new Map(members.filter((member) => member.status === 'completed').flatMap((member) => {
    const result = member.resultPayload as DelegateResultV1 | null;
    return [...(result?.citationRefs ?? []), ...(result?.artifactRefs ?? [])]
      .map((id) => [id, { executionId: member.id, producerAgentId: result?.producerAgentId }] as const);
  }));
  if (!references.size) return [];
  const records = await tx.select().from(schema.rootEvidenceRecords)
    .where(inArray(schema.rootEvidenceRecords.id, [...references.keys()]));
  if (records.length !== references.size || records.some((record) => {
    const expected = references.get(record.id)!;
    return record.executionId !== expected.executionId || record.producerAgentId !== expected.producerAgentId;
  })) throw new Error('Synthesis evidence does not match its original producer');
  let reference = 0;
  return records.sort((a, b) => a.id.localeCompare(b.id)).map((record) => {
    const source = flattenProducerEvidence(record.payload as Record<string, unknown>);
    const filename = String(source.filename ?? source.file_name ?? source.fileName ?? '');
    const displayReference = record.kind === 'citation' ? String(++reference) : undefined;
    return { record, displayReference, nativeReference: source.reference,
      component: sanitizePublicComponent({ id: record.id, type: record.kind === 'citation' ? 'citation' : 'artifact',
        data: { evidenceId: record.id, executionId: record.executionId, actorId: record.producerAgentId,
          ...(record.kind === 'citation' ? { source: filename || `evidence:${record.id}`, fileName: filename || undefined,
            reference: displayReference } : { artifactId: record.id, nativeArtifactId: source.artifact_id, filename,
            artifactKind: source.artifact_kind, mimeType: source.mime_type, sizeBytes: source.size_bytes, availability: 'ready' }) } }) };
  });
}
