import { producerEvidence } from './root-producer-evidence';
import { RootExecutionRecord } from './root-work.types';

describe('producer evidence trust boundary', () => {
  const child = { id: 'child', conversationId: 'conversation',
    resultPayload: { nativeState: { rootContext: { selected_agent_id: 'worker' } } } } as unknown as RootExecutionRecord;
  const source = { kind: 'citation' as const, nativeIdentity: 'call', outputOrdinal: 0,
    payload: { reference: '7', filename: 'document.pdf' } };
  it('assigns stable identity from child/native call/ordinal and authoritative owner', () => {
    const [record] = producerEvidence(child, [source]);
    expect(producerEvidence(child, [source])).toEqual([record]);
    expect(record).toEqual(expect.objectContaining({ executionId: 'child', conversationId: 'conversation',
      producerAgentId: 'worker', kind: 'citation' }));
    expect(record.evidenceId).toMatch(/^[a-f0-9]{24}$/);
    expect(producerEvidence({ ...child, id: 'other-child' }, [source])[0].evidenceId).not.toBe(record.evidenceId);
  });
  it('denies duplicate identities, private fields, invalid ordinals and oversized nested payloads', () => {
    for (const inputs of [[source, source], [{ ...source, outputOrdinal: -1 }],
      [{ ...source, nativeIdentity: '' }], [{ ...source, payload: { authorization: 'secret' } }],
      [{ ...source, payload: { source_object: { content: { text: 'private source content' } } } }],
      [{ ...source, payload: { filename: 'x'.repeat(2001) } }]]) {
      expect(() => producerEvidence(child, inputs)).toThrow();
    }
  });
});
