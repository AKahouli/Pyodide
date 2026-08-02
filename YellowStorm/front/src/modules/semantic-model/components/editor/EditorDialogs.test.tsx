import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSemanticModelEditorStore } from '../../store';
import type { SemanticGraph } from '../../types';
import { AddConceptDialog } from './EditorDialogs';

const graph:SemanticGraph = {modelId:'model',versionId:'version',revision:0,nodes:[],relations:[],records:[],recordRelations:[]};

describe('AddConceptDialog', () => {
  beforeEach(() => useSemanticModelEditorStore.getState().hydrate(graph));

  it('allows Business Records by default for a new concept', () => {
    render(<AddConceptDialog open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('concept.placeholder'),{target:{value:'Customer'}});
    fireEvent.click(screen.getByRole('button',{name:'concept.add'}));
    expect(useSemanticModelEditorStore.getState().pending[0][0]).toMatchObject({
      type:'node_type.create',entity:{label:'Customer',recordPolicy:'optional'},
    });
  });
});
