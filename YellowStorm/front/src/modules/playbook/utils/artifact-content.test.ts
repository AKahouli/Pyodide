import { describe, expect, it } from 'vitest';
import type { TaskArtifact } from '../types';
import { getArtifactDisplayContent, getArtifactPreviewContent } from './artifact-content';

describe('artifact-content', () => {
  it('stringifies object-valued data artifacts for display', () => {
    const artifact: TaskArtifact = {
      portId: 'lead_list',
      artifactKind: 'data',
      metadata: {
        data: {
          candidates: [{ company_name: 'BIAT' }],
          notes: ['Initial list'],
        },
      },
    };

    expect(getArtifactDisplayContent(artifact)).toBe(JSON.stringify(artifact.metadata?.data, null, 2));
  });

  it('stringifies array-valued data artifacts for display', () => {
    const artifact: TaskArtifact = {
      portId: 'lead_list',
      artifactKind: 'data',
      metadata: {
        data: [{ company_name: 'STEG' }, { company_name: 'SNCFT' }],
      },
    };

    expect(getArtifactDisplayContent(artifact)).toBe(JSON.stringify(artifact.metadata?.data, null, 2));
  });

  it('truncates long preview content', () => {
    const artifact: TaskArtifact = {
      portId: 'lead_list',
      artifactKind: 'data',
      metadata: {
        data: { text: 'a'.repeat(40) },
      },
    };

    const preview = getArtifactPreviewContent(artifact, 20);

    expect(preview).toBeTruthy();
    expect(preview?.endsWith('...')).toBe(true);
    expect(preview?.length).toBe(23);
  });
});
