import { describe, expect, it } from 'vitest';

import { dataBindingsToLayerEdges } from './data-binding-serializer';
import { makeTask } from '../../test-utils';

describe('data-binding-serializer', () => {
  it('uses selected resource labels for constant data binding source labels', () => {
    const edges = dataBindingsToLayerEdges([{
      id: 'binding-1',
      targetNode: 'target-1',
      targetPort: 'source_document',
      sourceKind: 'constant',
      constantValue: {
        kind: 'document',
        id: 'doc-1',
        label: 'invoice.xlsx',
        workspaceId: 'workspace-1',
      },
    }], [makeTask({
      id: 'target-1',
      title: 'Generate PDF',
      inputPorts: [{ id: 'source_document', name: 'Source document', artifactKind: 'document', required: true }],
    })]);

    expect(edges[0].label).toContain('invoice.xlsx');
    expect(edges[0].details[0]).toContain('invoice.xlsx');
  });

  it('falls back for selected resource constants without a label', () => {
    const edges = dataBindingsToLayerEdges([{
      id: 'binding-1',
      targetNode: 'target-1',
      targetPort: 'source_document',
      sourceKind: 'constant',
      constantValue: {
        kind: 'document',
        id: 'doc-1',
        label: '',
        workspaceId: 'workspace-1',
      },
    }], [makeTask({
      id: 'target-1',
      inputPorts: [{ id: 'source_document', name: 'Source document', artifactKind: 'document', required: true }],
    })]);

    expect(edges[0].label).toContain('constant');
    expect(edges[0].label).not.toContain('undefined');
  });

  it('falls back for selected resource constant arrays without labels', () => {
    const edges = dataBindingsToLayerEdges([{
      id: 'binding-1',
      targetNode: 'target-1',
      targetPort: 'source_documents',
      sourceKind: 'constant',
      constantValue: [{ kind: 'document', id: 'doc-1', workspaceId: 'workspace-1' }],
    }], [makeTask({
      id: 'target-1',
      inputPorts: [{ id: 'source_documents', name: 'Source documents', artifactKind: 'document', required: true }],
    })]);

    expect(edges[0].label).toContain('constant');
    expect(edges[0].label).not.toContain('undefined');
  });
});
