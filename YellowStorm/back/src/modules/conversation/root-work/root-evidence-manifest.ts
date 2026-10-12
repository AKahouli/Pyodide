import { createHash } from 'node:crypto';
import { BadRequestException, ErrorCode } from '../../exceptions';
import type { RegisterEvidenceInput } from './root-work.store';

export interface RootEvidenceManifest { count: number; digest: string }
export const MAX_EXECUTION_EVIDENCE = 1000;
export const MAX_EXECUTION_EVIDENCE_BYTES = 1048576;

export function evidenceManifest(records: Array<{ evidenceId: string }>): RootEvidenceManifest {
  return { count: records.length, digest: createHash('sha256').update(records.map((item) => item.evidenceId).sort().join(',')).digest('hex') };
}

export function verifyEvidenceManifest(records: RegisterEvidenceInput[], manifest: RootEvidenceManifest) {
  const actual = evidenceManifest(records);
  if (records.length > MAX_EXECUTION_EVIDENCE || Buffer.byteLength(JSON.stringify(records)) > MAX_EXECUTION_EVIDENCE_BYTES
    || actual.count !== manifest.count || actual.digest !== manifest.digest) {
    throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Staged evidence manifest is incomplete or exceeds its bound');
  }
  return records;
}
