import { describe, it, expect } from 'vitest';
import { buildResultParts } from './TaskDetailDrawer';
import type { WorkyTaskResultContent } from '../types';

describe('buildResultParts', () => {
  it('maps components to parts (artifacts are rendered separately as clickable cards)', () => {
    const content: WorkyTaskResultContent = {
      components: [{ id: 'c1', type: 'text', data: { content: 'summary' } }],
      artifacts: [{ id: 'a1', filePath: 'key/x', filename: 'out.png', artifactKind: 'image', mimeType: 'image/png', size: 10, createdAt: '2026-08-13T10:00:00.000Z' }],
    };
    const parts = buildResultParts(content);
    expect(parts[0]).toEqual({ type: 'text', content: 'summary' });
    // artifacts are no longer folded into the parts list (static card); the drawer
    // renders them as clickable TaskArtifactCards that open the file viewer.
    expect(parts).not.toContainEqual({ type: 'artifact', filePath: 'key/x', filename: 'out.png' });
  });

  it('returns empty array for empty content', () => {
    expect(buildResultParts({ components: [], artifacts: [] })).toEqual([]);
  });
});
