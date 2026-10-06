import { describe, expect, it } from 'vitest';
import { appendRootWorkEvents } from './root-work-replay';

const event = (sequence: string, eventId = sequence, epoch = 4) =>
  ({ sequence, eventId, payload: { conversationEpoch: epoch, kind: 'native_hint' } });

describe('Durable Root replay', () => {
  it('orders cross-replica pages and deduplicates overlapping event IDs without rewinding the cursor', () => {
    const first = appendRootWorkEvents(undefined, 4, [event('12'), event('10'), event('11')]);
    const next = appendRootWorkEvents(first, 4, [event('11'), event('14', '12'), event('13')]);
    expect(next.events.map((item) => item.eventId)).toEqual(['10', '11', '12', '13']);
    expect(next.cursor).toBe('14');
  });
  it('fences old-epoch replies and clears activity on a new Stop barrier', () => {
    const first = appendRootWorkEvents(undefined, 4, [event('12')]);
    const stopped = appendRootWorkEvents(first, 5, []);
    expect(appendRootWorkEvents(stopped, 4, [event('13')])).toBe(stopped);
    expect(appendRootWorkEvents(stopped, 5, [event('14')]).events).toEqual([]);
    expect(stopped.cursor).toBe('0');
  });
  it('bounds retained activity while preserving the durable cursor', () => {
    const result = appendRootWorkEvents(undefined, 4, Array.from({ length: 150 }, (_, i) => event(String(i + 1))));
    expect(result.events).toHaveLength(100);
    expect(result.cursor).toBe('150');
  });
});
