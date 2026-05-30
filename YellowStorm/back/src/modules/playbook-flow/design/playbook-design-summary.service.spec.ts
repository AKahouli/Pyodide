import { PlaybookDesignSummaryService } from './playbook-design-summary.service';

describe('PlaybookDesignSummaryService', () => {
  const service = new PlaybookDesignSummaryService();

  it('summarizes added and removed nodes and connections', () => {
    expect(service.summarizeStructuralChanges(
      [{ id: 'a' }, { id: 'b' }],
      [{ source: 'a', target: 'b' }],
      [{ id: 'b' }, { id: 'c' }],
      [{ source: 'b', target: 'c' }],
    )).toBe('Added 1 node, Removed 1 node, Added 1 connection, Removed 1 connection');
  });

  it('returns a stable no-change summary', () => {
    expect(service.summarizeStructuralChanges(
      [{ id: 'a' }],
      [{ source: 'a', target: 'b' }],
      [{ id: 'a' }],
      [{ source: 'a', target: 'b' }],
    )).toBe('No structural changes');
  });
});
