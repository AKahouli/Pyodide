import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PlaybookCanvasFloatingToolbar } from './PlaybookCanvasFloatingToolbar';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

const fetchNodeTemplatesMock = vi.fn();

vi.mock('../store', () => ({
  usePlaybookStore: (sel: (state: {
    nodeTemplates: Array<{
      id: string;
      type: string;
      title: string;
      description: string;
      icon: string;
      color: string;
      category: string;
      inputPorts: Array<{ id: string; name: string; artifactKind: string; required: boolean }>;
      outputPorts: Array<{ id: string; name: string; artifactKind: string }>;
      promptTemplate: string;
      recommendedAgentTypeSlug: string | null;
      requiredToolNames: string[];
    }>;
    nodeTemplatesLoading: boolean;
    fetchNodeTemplates: typeof fetchNodeTemplatesMock;
  }) => unknown) => sel({
    nodeTemplates: [
      {
        id: 'summarizer',
        type: 'summarizer',
        title: 'taskType.summarizer',
        description: 'Summarize',
        icon: 'FileText',
        color: 'blue',
        category: 'content',
        inputPorts: [{ id: 'source', name: 'Source Content', artifactKind: 'text', required: true }],
        outputPorts: [{ id: 'summary', name: 'Summary', artifactKind: 'text' }],
        promptTemplate: '',
        recommendedAgentTypeSlug: null,
        requiredToolNames: [],
      },
    ],
    nodeTemplatesLoading: false,
    fetchNodeTemplates: fetchNodeTemplatesMock,
  }),
}));

vi.mock('../utils/port-colors', () => ({
  PORT_COLORS: { text: { icon: () => null, bg: '', ring: '', dot: '' }, document: { icon: () => null, bg: '', ring: '', dot: '' }, code: { icon: () => null, bg: '', ring: '', dot: '' }, image: { icon: () => null, bg: '', ring: '', dot: '' }, data: { icon: () => null, bg: '', ring: '', dot: '' }, dashboard: { icon: () => null, bg: '', ring: '', dot: '' } },
}));

describe('PlaybookCanvasFloatingToolbar', () => {
  const container = document.createElement('div');
  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) }),
  });

  const containerRef = { current: container };

  it('renders canvas edit actions and calls handlers', async () => {
    const onAddStep = vi.fn();
    const onAutoLayout = vi.fn();
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const onToggleExplorer = vi.fn();
    const onToggleConnectors = vi.fn();

    render(
      <PlaybookCanvasFloatingToolbar
        containerRef={containerRef}
        onAddStep={onAddStep}
        onAddStepFromTemplate={vi.fn()}
        onAutoLayout={onAutoLayout}
        onUndo={onUndo}
        onRedo={onRedo}
        onToggleExplorer={onToggleExplorer}
        onToggleConnectors={onToggleConnectors}
        explorerOpen={false}
        connectorsOpen={false}
        canUndo
        canRedo
        waitingForHumanInput={false}
        interruptType={null}
      />,
    );

    await userEvent.click(screen.getByText('toolbar.addBlankStep'));
    await userEvent.click(screen.getByText('toolbar.undo'));
    await userEvent.click(screen.getByText('toolbar.redo'));
    await userEvent.click(screen.getByText('toolbar.autoLayout'));
    await userEvent.click(screen.getByText('toolbar.showExplorer'));
    await userEvent.click(screen.getByText('toolbar.showConnectors'));

    expect(onAddStep).toHaveBeenCalledOnce();
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onRedo).toHaveBeenCalledOnce();
    expect(onAutoLayout).toHaveBeenCalledOnce();
    expect(onToggleExplorer).toHaveBeenCalledOnce();
    expect(onToggleConnectors).toHaveBeenCalledOnce();
  });

  it('opens template menu and calls template handler', async () => {
    const onAddStepFromTemplate = vi.fn();

    render(
      <PlaybookCanvasFloatingToolbar
        containerRef={containerRef}
        onAddStep={vi.fn()}
        onAddStepFromTemplate={onAddStepFromTemplate}
        onAutoLayout={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onToggleExplorer={vi.fn()}
        onToggleConnectors={vi.fn()}
        explorerOpen={false}
        connectorsOpen={false}
        canUndo
        canRedo
        waitingForHumanInput={false}
        interruptType={null}
      />,
    );

    await userEvent.click(screen.getByLabelText('toolbar.tasks'));
    expect(screen.getByRole('menu')).toHaveAttribute('data-side', 'bottom');
    await userEvent.click(screen.getAllByText('taskType.summarizer')[0]);

    expect(onAddStepFromTemplate).toHaveBeenCalledWith(expect.objectContaining({ id: 'summarizer' }));
  });
});
