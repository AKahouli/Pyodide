import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlaybookCanvasFloatingToolbar } from './PlaybookCanvasFloatingToolbar';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

const fetchFlowNodeTemplatesMock = vi.fn();

vi.mock('../store', () => ({
  usePlaybookStore: (sel: (state: {
    flowNodeTemplates: Array<{
      id: string;
      type: string;
      nodeType: string;
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
      iteratorConfig: null;
      routerConfig: { outputLabels: string[]; maxIterations: number } | null;
      humanApprovalConfig: { promptTemplate: string; timeoutSeconds?: number } | null;
    }>;
    flowNodeTemplatesLoading: boolean;
    fetchFlowNodeTemplates: typeof fetchFlowNodeTemplatesMock;
  }) => unknown) => sel({
    flowNodeTemplates: [
      {
        id: 'summarizer',
        type: 'summarizer',
        nodeType: 'action',
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
        iteratorConfig: null,
        routerConfig: null,
        humanApprovalConfig: null,
      },
      {
        id: 'router-default',
        type: 'router-default',
        nodeType: 'router',
        title: 'taskType.routerDefault',
        description: 'Route work',
        icon: 'GitBranch',
        color: 'blue',
        category: 'analysis',
        inputPorts: [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }],
        outputPorts: [],
        promptTemplate: '',
        recommendedAgentTypeSlug: null,
        requiredToolNames: [],
        iteratorConfig: null,
        routerConfig: { outputLabels: ['retry', 'done', '__error__'], maxIterations: 3 },
        humanApprovalConfig: null,
      },
    ],
    flowNodeTemplatesLoading: false,
    fetchFlowNodeTemplates: fetchFlowNodeTemplatesMock,
  }),
}));

vi.mock('../utils/port-colors', () => ({
  PORT_COLORS: { text: { icon: () => null, bg: '', ring: '', dot: '' }, document: { icon: () => null, bg: '', ring: '', dot: '' }, code: { icon: () => null, bg: '', ring: '', dot: '' }, image: { icon: () => null, bg: '', ring: '', dot: '' }, data: { icon: () => null, bg: '', ring: '', dot: '' }, dashboard: { icon: () => null, bg: '', ring: '', dot: '' } },
}));

describe('PlaybookCanvasFloatingToolbar', () => {
  let toolbarRect = { x: 0, y: 0, left: 0, top: 0, right: 280, bottom: 54, width: 280, height: 54, toJSON: () => ({}) };
  let avoidRect = { x: 0, y: 0, left: 0, top: 0, right: 20, bottom: 140, width: 20, height: 140, toJSON: () => ({}) };
  const container = document.createElement('div');
  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) }),
  });

  const containerRef = { current: container };
  const avoidRectElement = document.createElement('div');
  Object.defineProperty(avoidRectElement, 'getBoundingClientRect', {
    value: () => avoidRect,
  });

  const avoidRectRef = { current: avoidRectElement };

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    toolbarRect = { x: 0, y: 0, left: 0, top: 0, right: 280, bottom: 54, width: 280, height: 54, toJSON: () => ({}) };
    avoidRect = { x: 0, y: 0, left: 0, top: 0, right: 20, bottom: 140, width: 20, height: 140, toJSON: () => ({}) };
  });

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

  it('loads flow node templates for the toolbar menu', () => {
    render(
      <PlaybookCanvasFloatingToolbar
        containerRef={containerRef}
        onAddStep={vi.fn()}
        onAddStepFromTemplate={vi.fn()}
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

    expect(fetchFlowNodeTemplatesMock).toHaveBeenCalledOnce();
  });

  it('supports controlled collapsed state', async () => {
    const onCollapsedChange = vi.fn();

    render(
      <PlaybookCanvasFloatingToolbar
        containerRef={containerRef}
        onAddStep={vi.fn()}
        onAddStepFromTemplate={vi.fn()}
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
        collapsed
        onCollapsedChange={onCollapsedChange}
      />,
    );

    expect(screen.queryByText('toolbar.addBlankStep')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('toolbar.expandCanvasToolbar'));
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it('defaults to the bottom left when there is no stored position', () => {
    render(
      <PlaybookCanvasFloatingToolbar
        containerRef={containerRef}
        onAddStep={vi.fn()}
        onAddStepFromTemplate={vi.fn()}
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
        collapsed
      />,
    );

    const toolbar = screen.getByRole('toolbar').parentElement;
    expect(toolbar).toHaveStyle({ left: '16px', top: '584px' });
  });

  it('ignores stored positions and anchors to the bottom left', () => {
    window.localStorage.setItem('playbook-canvas-floating-toolbar-position-v3', JSON.stringify({ x: 40, y: 0 }));

    render(
      <PlaybookCanvasFloatingToolbar
        containerRef={containerRef}
        onAddStep={vi.fn()}
        onAddStepFromTemplate={vi.fn()}
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
        minLeftOffset={40}
      />,
    );

    const toolbar = screen.getByRole('toolbar').parentElement;
    expect(toolbar).toHaveStyle({ left: '40px', top: '584px' });
  });

  it('keeps the bottom-left default when the avoid rect is at the top', () => {
    render(
      <PlaybookCanvasFloatingToolbar
        containerRef={containerRef}
        avoidRectRef={avoidRectRef}
        onAddStep={vi.fn()}
        onAddStepFromTemplate={vi.fn()}
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

    const toolbar = screen.getByRole('toolbar').parentElement;
    expect(toolbar).toHaveStyle({ left: '16px', top: '584px' });
  });

  it('reclamps after expand changes the toolbar size', async () => {
    avoidRect = { x: 300, y: 0, left: 300, top: 0, right: 780, bottom: 200, width: 480, height: 200, toJSON: () => ({}) };

    render(
      <PlaybookCanvasFloatingToolbar
        containerRef={containerRef}
        avoidRectRef={avoidRectRef}
        onAddStep={vi.fn()}
        onAddStepFromTemplate={vi.fn()}
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
        collapsed
      />,
    );

    const wrapper = screen.getByRole('toolbar').parentElement as HTMLDivElement;
    Object.defineProperty(wrapper, 'getBoundingClientRect', {
      configurable: true,
      value: () => toolbarRect,
    });

    toolbarRect = { x: 0, y: 0, left: 0, top: 0, right: 280, bottom: 54, width: 280, height: 54, toJSON: () => ({}) };
    await userEvent.click(screen.getByLabelText('toolbar.expandCanvasToolbar'));

    toolbarRect = { x: 0, y: 0, left: 0, top: 0, right: 597.3125, bottom: 54, width: 597.3125, height: 54, toJSON: () => ({}) };
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(wrapper).toHaveStyle({ top: '530px' });
  });
});
