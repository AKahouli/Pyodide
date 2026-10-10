import { isDeepStrictEqual } from 'node:util';
import { eq } from 'drizzle-orm';
import * as schema from '../../../postgres/schema';
import type { RootControlTransaction } from './root-background-owner';
import type { RegisterEvidenceInput } from '../../root-work/root-work.store';
import { evidenceManifest, verifyEvidenceManifest } from '../../root-work/root-evidence-manifest';

export async function loadStagedEvidence(tx: RootControlTransaction, executionId: string): Promise<RegisterEvidenceInput[]> {
  const rows = await tx.select().from(schema.rootEvidenceRecords).where(eq(schema.rootEvidenceRecords.executionId, executionId)).limit(1001);
  return rows.map(({ id, createdAt: _createdAt, ...row }) => {
    if (row.kind !== 'citation' && row.kind !== 'artifact') throw new Error('Staged evidence kind is invalid');
    return { ...row, kind: row.kind, evidenceId: id, payload: row.payload as Record<string, unknown> };
  });
}

export async function stageEvidencePage(tx: RootControlTransaction, executionId: string, evidence: RegisterEvidenceInput[]) {
  if (evidence.length < 1 || evidence.length > 100 || Buffer.byteLength(JSON.stringify(evidence)) > 131072) {
    throw new Error('Evidence page exceeds its bounded contract');
  }
  for (const item of evidence) {
    await tx.insert(schema.rootEvidenceRecords).values({ id: item.evidenceId, executionId: item.executionId,
      conversationId: item.conversationId, kind: item.kind, producerAgentId: item.producerAgentId,
      payload: item.payload, dedupKey: item.dedupKey }).onConflictDoNothing({ target: schema.rootEvidenceRecords.dedupKey });
    const [stored] = await tx.select().from(schema.rootEvidenceRecords).where(eq(schema.rootEvidenceRecords.dedupKey, item.dedupKey)).limit(1);
    if (!stored || stored.id !== item.evidenceId || stored.executionId !== executionId || stored.kind !== item.kind
      || stored.conversationId !== item.conversationId || stored.producerAgentId !== item.producerAgentId
      || !isDeepStrictEqual(stored.payload, item.payload)) throw new Error('Evidence page replay conflicts with its immutable producer');
  }
  const all = await loadStagedEvidence(tx, executionId);
  return verifyEvidenceManifest(all, evidenceManifest(all));
}
