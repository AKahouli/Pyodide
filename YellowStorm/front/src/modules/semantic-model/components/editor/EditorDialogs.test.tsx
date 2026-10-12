import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSemanticModelEditorStore } from '../../store';
import type { SemanticGraph } from '../../types';
import { AddConceptDialog, ManualTableDialog } from './EditorDialogs';

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

describe('ManualTableDialog', () => {
  it('says so, and cannot be confirmed, when no concept can hold rows', () => {
    useSemanticModelEditorStore.getState().hydrate({...graph,nodes:[{id:'files',key:'files',label:'Files',description:'',category:'system_collection',recordPolicy:'none',systemKey:'workspace_documents',aliases:[],attributes:[],position:{x:0,y:0}}]});
    const onPick = vi.fn();
    render(<ManualTableDialog open onOpenChange={vi.fn()} onPick={onPick} />);
    expect(screen.getByText('manualTable.noConcept')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'manualTable.open'})).toBeDisabled();
    expect(onPick).not.toHaveBeenCalled();
  });
});
