import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LastDocumentMapping, MappingPreset, MappingSettings } from '../../types';

const api = vi.hoisted(() => ({
  listMappingPresets: vi.fn(),
  lastUsedMapping: vi.fn(),
  saveMappingPreset: vi.fn(),
  deleteMappingPreset: vi.fn(),
}));
vi.mock('../../api', () => ({ semanticModelApi: api }));
vi.mock('@/lib/notifications', () => ({ showError: vi.fn(), showSuccess: vi.fn() }));

import { droppedFields, MappingPresetBar } from './MappingPresetBar';

const field = (key: string, location: 'same_line' | 'after_label' = 'same_line') =>
  ({ sourceField: null, targetAttribute: key, mode: 'extract' as const, extractionStrategy: 'deterministic' as const, rules: { location } });
const blank: MappingSettings = { fieldMappings: [field('date'), field('title')], aiSettings: {}, identityFields: [] };
const last: LastDocumentMapping = {
  mappingId: 'm-1', scope: 'document', sourceName: 'FP_LIGNE.pdf', workspaceLinked: true, updatedAt: '2026-10-01T10:00:00.000Z',
  fieldMappings: [field('date', 'after_label'), field('title')], aiSettings: { maxBlocks: 80 }, identityFields: ['title'],
};
const preset: MappingPreset = {
  id: 'p-1', conceptId: 'c-1', name: 'Fiches BPCE', description: 'Dates after labels', updatedAt: '2026-10-01T10:00:00.000Z',
  fieldMappings: [field('date', 'after_label'), field('gone')], aiSettings: {}, identityFields: [],
};

function Harness({ autoStart, onApply }: { autoStart: boolean; onApply?: (settings: MappingSettings, exact: boolean) => void }) {
  const [settings, setSettings] = useState(blank);
  return <>
    <MappingPresetBar modelId='model' conceptId='c-1' attributes={[{ key: 'date', label: 'Date' }, { key: 'title', label: 'Title' }]}
      current={settings} autoStart={autoStart} onApply={(next, exact) => { onApply?.(next, exact); setSettings(next); }} />
    <button type='button' onClick={() => setSettings({ ...settings, aiSettings: { maxBlocks: 99 } })}>edit</button>
    <pre data-testid='settings'>{JSON.stringify(settings)}</pre>
  </>;
}
const renderBar = (autoStart: boolean, onApply?: (settings: MappingSettings, exact: boolean) => void) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><Harness autoStart={autoStart} onApply={onApply} /></QueryClientProvider>);
};
const shown = () => JSON.parse(screen.getByTestId('settings').textContent!) as MappingSettings;
const openMenu = () => {
  const trigger = screen.getByRole('button', { name: /mapping\.presets\.(choose|lastUsedItem)|Fiches BPCE/ });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
};

describe('MappingPresetBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listMappingPresets.mockResolvedValue([preset]);
    api.lastUsedMapping.mockResolvedValue(last);
  });

  it('starts a new mapping from the last one of the concept, with undo', async () => {
    const onApply = vi.fn();
    renderBar(true, onApply);
    await waitFor(() => expect(shown().aiSettings).toEqual({ maxBlocks: 80 }));
    expect(screen.getByRole('status')).toHaveTextContent('mapping.presets.started');
    fireEvent.click(screen.getByRole('button', { name: /mapping\.presets\.undo/ }));
    expect(shown()).toEqual(blank);
    expect(onApply).toHaveBeenLastCalledWith(blank, true);
  });

  it('does not start by itself when editing a saved mapping', async () => {
    renderBar(false);
    await waitFor(() => expect(api.lastUsedMapping).toHaveBeenCalled());
    expect(shown()).toEqual(blank);
  });

  it('applies a preset, says which fields the concept lacks, and marks it modified after an edit', async () => {
    renderBar(false);
    await waitFor(() => expect(api.listMappingPresets).toHaveBeenCalledWith('model', 'c-1'));
    openMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: /Fiches BPCE/ }));
    expect(shown().fieldMappings[0].rules?.location).toBe('after_label');
    expect(screen.getByRole('status')).toHaveTextContent('mapping.presets.dropped');
    expect(screen.queryByText('mapping.presets.modified')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    expect(await screen.findByText('mapping.presets.modified')).toBeInTheDocument();
    api.saveMappingPreset.mockResolvedValue({ ...preset, aiSettings: { maxBlocks: 99 } });
    fireEvent.click(screen.getByRole('button', { name: 'mapping.presets.update' }));
    await waitFor(() => expect(api.saveMappingPreset).toHaveBeenCalledWith('model',
      expect.objectContaining({ conceptId: 'c-1', name: 'Fiches BPCE', aiSettings: { maxBlocks: 99 } }), 'p-1'));
  });

  it('saves the current settings as a new preset, or replaces one with the same name', async () => {
    api.saveMappingPreset.mockResolvedValue({ ...preset, id: 'p-2', name: 'Contrats' });
    renderBar(false);
    await waitFor(() => expect(api.listMappingPresets).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /mapping\.presets\.save/ }));
    const name = await screen.findByRole('textbox', { name: 'mapping.presets.name' });
    fireEvent.change(name, { target: { value: 'fiches bpce' } });
    expect(screen.getByRole('button', { name: 'mapping.presets.replace' })).toBeInTheDocument();
    fireEvent.change(name, { target: { value: 'Contrats' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'mapping.presets.saveButton' })); });
    expect(api.saveMappingPreset).toHaveBeenCalledWith('model', expect.objectContaining({ name: 'Contrats', fieldMappings: blank.fieldMappings }), undefined);
  });

  it('lists the fields a preset reads that the concept does not have', () => {
    expect(droppedFields(preset, [{ key: 'date' }])).toEqual(['gone']);
  });
});
