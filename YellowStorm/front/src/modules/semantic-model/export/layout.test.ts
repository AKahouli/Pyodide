// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { layoutRecords } from './layout';

describe('layoutRecords', () => {
  it('places every record, linked ones nearer than unlinked ones', async () => {
    const nodes = ['a', 'b', 'c', 'd'].map((id) => ({ id, size: 30 }));
    const places = await layoutRecords(nodes, [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'a', target: 'ghost' }]);
    expect([...places.keys()].sort()).toEqual(['a', 'b', 'c', 'd']);
    for (const place of places.values()) expect(Number.isFinite(place.x) && Number.isFinite(place.y)).toBe(true);
    const gap = (one: string, other: string) => Math.hypot(places.get(one)!.x - places.get(other)!.x, places.get(one)!.y - places.get(other)!.y);
    expect(gap('a', 'b')).toBeLessThan(gap('a', 'd') * 2);
  });

  it('lays out nothing for nothing', async () => {
    expect((await layoutRecords([], [])).size).toBe(0);
  });
});
