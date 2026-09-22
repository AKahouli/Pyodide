import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Plus } from 'lucide-react';
import { NextStepPicker, type PickerCandidate } from './NextStepPicker';
import type { TaskTemplate } from '../types';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

const presetCandidate: PickerCandidate = {
  id: 'preset:blank',
  blueprint: { kind: 'blank' },
  title: 'Blank step',
  description: 'Start from a blank step',
  icon: Plus,
};

const template: TaskTemplate = {
  id: 'tpl-1',
  key: 'tpl-key',
  nodeType: 'agent',
  title: 'Summarize document',
  description: 'Summarizes a document',
  icon: 'FileText',
  color: '#3b82f6',
  category: 'content',
  inputPorts: [{ id: 'in', name: 'Doc', artifactKind: 'document', required: true }],
  outputPorts: [{ id: 'out', name: 'Summary', artifactKind: 'text' }],
  promptTemplate: '',
  recommendedAgentTypeSlug: null,
  requiredToolNames: [],
};

function renderPicker(props: Partial<Parameters<typeof NextStepPicker>[0]> = {}) {
  return render(
    <NextStepPicker
      anchor={{ x: 40, y: 40 }}
      title="Add next step"
      candidates={[presetCandidate, {
        id: `template:${template.id}`,
        blueprint: { kind: 'template', template },
        title: template.title,
        description: template.description,
        icon: Plus,
      }]}
      onChoose={() => {}}
      onCancel={() => {}}
      {...props}
    />,
  );
}

describe('NextStepPicker', () => {
  it('lists presets and catalog templates', () => {
    renderPicker();
    expect(screen.getByText('Blank step')).toBeInTheDocument();
    expect(screen.getByText('Summarize document')).toBeInTheDocument();
  });

  it('invokes onChoose when a candidate is selected', () => {
    const onChoose = vi.fn();
    renderPicker({ onChoose });
    fireEvent.click(screen.getByText('Blank step'));
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0][0].blueprint).toEqual({ kind: 'blank' });
  });

  it('cancels on Escape', () => {
    const onCancel = vi.fn();
    renderPicker({ onCancel });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels when clicking the backdrop', () => {
    const onCancel = vi.fn();
    const { container } = renderPicker({ onCancel });
    fireEvent.pointerDown(container.querySelector('[data-next-step-backdrop]')!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the output chooser first when the source has several outputs', () => {
    const onResolveOutput = vi.fn();
    renderPicker({
      outputChoices: [
        { id: 'done', label: 'done' },
        { id: '__error__', label: '__error__' },
      ],
      onResolveOutput,
    });
    expect(screen.queryByText('Blank step')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('__error__'));
    expect(onResolveOutput).toHaveBeenCalledWith('__error__');
  });

  it('shows an empty state when no candidate fits', () => {
    render(
      <NextStepPicker
        anchor={{ x: 0, y: 0 }}
        title="Insert step"
        candidates={[]}
        onChoose={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('nextStep.empty')).toBeInTheDocument();
  });

  it('clamps the anchor inside the viewport', () => {
    const { container } = renderPicker({ anchor: { x: 99999, y: 99999 } });
    const picker = container.querySelector('[data-next-step-picker]')!;
    const style = getComputedStyle(picker);
    expect(Number.parseFloat(style.left)).toBeLessThanOrEqual(window.innerWidth);
    expect(Number.parseFloat(style.top)).toBeLessThanOrEqual(window.innerHeight);
  });
});
