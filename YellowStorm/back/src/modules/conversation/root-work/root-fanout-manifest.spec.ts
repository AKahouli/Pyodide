import { buildFanoutManifest } from './root-fanout-manifest';

const parent = 'a'.repeat(24);
const proposal = () => ({ version: 1, mode: 'foreground', nativeCallId: 'call-1',
  nativeCallBranch: 'root.run_fanout@call-1', target: { kind: 'temporary' },
  items: [{ key: 'first', task: 'First', contextRefs: ['workspace'] }, { key: 'second', task: 'Second' }] });
const build = (value: unknown) => buildFanoutManifest(parent, value, 3, ['workspace']);

describe('foreground fan-out manifest', () => {
  it('preserves order and stable isolated identities on replay', () => {
    const original = build(proposal());
    expect(build(JSON.parse(JSON.stringify(proposal())))).toEqual(original);
    expect(original.items.map((item) => item.key)).toEqual(['first', 'second']);
    expect(new Set(original.items.map((item) => item.executionId)).size).toBe(2);
    expect(original.items[0].nativeRunId).toMatch(/^item_[0-9a-f]{64}$/);
    const reordered = proposal(); reordered.items.reverse();
    expect(build(reordered).items[1].executionId).toBe(original.items[0].executionId);
    expect(build(reordered).digest).not.toBe(original.digest);
  });
  it('keeps manifest identity but changes digest for conflicting replay', () => {
    const changed = proposal(); changed.items[0].task = 'Changed';
    expect(build(changed).manifestId).toBe(build(proposal()).manifestId);
    expect(build(changed).digest).not.toBe(build(proposal()).digest);
  });
  it('accepts background only through a trusted admission seam and binds mode into the digest', () => {
    const value = { ...proposal(), mode: 'background' };
    expect(() => build(value)).toThrow();
    const background = buildFanoutManifest(parent, value, 3, ['workspace'], true);
    expect(background.mode).toBe('background');
    expect(background.manifestId).toBe(build(proposal()).manifestId);
    expect(background.digest).not.toBe(build(proposal()).digest);
    expect(background.items).toEqual(build(proposal()).items);
  });
  it.each([
    { ...proposal(), mode: 'background' }, { ...proposal(), items: [] },
    { ...proposal(), nativeCallBranch: 'delegate_to_agent@call-1' },
    { ...proposal(), items: [...proposal().items, ...proposal().items] },
    { ...proposal(), items: [{ key: 'first', task: ' ', contextRefs: [] }] },
    { ...proposal(), items: [{ key: 'first', task: 'Task', contextRefs: ['revoked'] }] },
    { ...proposal(), items: [{ key: 'first', task: 'Task', contextRefs: ['workspace', 'workspace'] }] },
    { ...proposal(), target: { kind: 'temporary', agentId: parent } },
    { ...proposal(), target: { kind: 'library', agentId: 'unknown' } },
    { ...proposal(), untrusted: true },
  ])('rejects invalid entire proposal before dispatch %#', (value) => expect(() => build(value)).toThrow());
  it('bounds total UTF8 bytes independently of per-item characters', () => {
    const items = Array.from({ length: 3 }, (_, index) => ({ key: String(index), task: '界'.repeat(40000) }));
    expect(() => build({ ...proposal(), items })).toThrow(/payload/);
  });
});
