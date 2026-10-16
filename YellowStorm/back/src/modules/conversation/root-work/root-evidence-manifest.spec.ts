import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RootBackgroundSettlementDto } from '../dto/root-background.dto';
import { SettleRootDelegateDto } from '../dto/settle-root-delegate.dto';
import { evidenceManifest, verifyEvidenceManifest } from './root-evidence-manifest';

describe('bounded staged evidence contract', () => {
  const records = Array.from({ length: 101 }, (_, index) => ({ evidenceId: index.toString(16).padStart(24, '0') }));
  it('uses an order-independent exact identity seal and rejects incomplete or oversized sets', () => {
    const manifest = evidenceManifest(records);
    expect(evidenceManifest([...records].reverse())).toEqual(manifest);
    expect(() => verifyEvidenceManifest(records.slice(0, 100) as any, manifest)).toThrow('incomplete');
    expect(() => verifyEvidenceManifest(records.map((item) => ({ ...item, payload: { value: 'x'.repeat(11000) } })) as any, manifest))
      .toThrow('bound');
  });
  it.each([SettleRootDelegateDto, RootBackgroundSettlementDto])('keeps 100-entry inline pages while accepting a verified-manifest shape (%p)', async (Dto) => {
    const value = { status: 'completed', text: 'Useful result', owner: 'owner', nativeOwner: 'native', fence: 1,
      requestDigest: 'a'.repeat(64), evidenceManifest: evidenceManifest(records) };
    expect(await validate(plainToInstance<object, object>(Dto, value))).toHaveLength(0);
    const oversized = plainToInstance<object, object>(Dto, { ...value, evidence: Array.from({ length: 101 }, (_, index) => ({
      nativeIdentity: `tool-${index}`, outputOrdinal: 0, kind: 'citation', payload: { source: 'https://official.test/' },
    })) });
    expect((await validate(oversized)).some((error) => error.property === 'evidence')).toBe(true);
  });
});
