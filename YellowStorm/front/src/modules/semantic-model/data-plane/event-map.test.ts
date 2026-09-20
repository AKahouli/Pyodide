import { describe, expect, it } from 'vitest';
import { isNewerRevision, keysForEvent, parseSignal } from './event-map';

describe('event-map (P2.SB20)', () => {
  it('maps each event to its resource keys', () => {
    expect(keysForEvent('m', null, 'data-revision-changed')).toHaveLength(4);
    expect(keysForEvent('m', null, 'review-items-changed')).toHaveLength(2);
    expect(keysForEvent('m', null, 'population-status-changed')).toHaveLength(2);
    expect(keysForEvent('m', null, 'datasource-status-changed')).toHaveLength(2);
    expect(keysForEvent('m', null, 'model-read-state-changed')).toHaveLength(1);
  });

  it('ignores stale revisions and accepts first/unknown ones', () => {
    expect(isNewerRevision(null, 42)).toBe(true);
    expect(isNewerRevision(41, 42)).toBe(true);
    expect(isNewerRevision(42, 42)).toBe(false);
    expect(isNewerRevision(43, 42)).toBe(false);
    expect(isNewerRevision(41, undefined)).toBe(true);
  });

  it('rejects untrusted frames without failing', () => {
    expect(parseSignal(null)).toBeNull();
    expect(parseSignal('x')).toBeNull();
    expect(parseSignal({})).toBeNull();
    expect(parseSignal({ payload: { dataRevision: 1 } })).toBeNull();
    expect(parseSignal({ payload: { modelId: 'm', dataRevision: 'x' } })).toBeNull();
    expect(parseSignal({ event: 'data-revision-changed', payload: { modelId: 'm', dataRevision: 2 } })).toMatchObject({
      modelId: 'm',
      dataRevision: 2,
    });
  });
});
