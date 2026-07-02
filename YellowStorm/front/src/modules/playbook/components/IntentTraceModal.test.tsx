import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IntentTraceModal } from './IntentTraceModal';
import type { PlaybookIntentTraceEntry } from '../types';

const { tMock, copyTextMock } = vi.hoisted(() => ({ tMock: vi.fn(), copyTextMock: vi.fn() }));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: tMock }),
}));

vi.mock('@/lib/notifications', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

function makeTrace(stage: PlaybookIntentTraceEntry['stage'], index: number): PlaybookIntentTraceEntry {
  return {
    stage,
    model: 'gpt-test',
    systemPrompt: `system-${stage}-${index}`,
    userPrompt: `user-${stage}-${index}`,
    rawOutput: `raw-${stage}-${index}`,
    createdAt: new Date(2026, 0, 1, 0, 0, index).toISOString(),
  };
}

function renderModal(props: Partial<React.ComponentProps<typeof IntentTraceModal>> = {}) {
  return render(
    <IntentTraceModal
      open
      onOpenChange={vi.fn()}
      intentAnalyze={[makeTrace('intent.analyze', 1)]}
      designAssessment={[makeTrace('intent.design_assessment', 1)]}
      {...props}
    />,
  );
}

describe('IntentTraceModal', () => {
  beforeEach(() => {
    tMock.mockImplementation((key: string) => key);
    copyTextMock.mockReset();
    copyTextMock.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: copyTextMock },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders both panes with their latest traces', () => {
    renderModal();

    expect(screen.getByText('designer.traces.pane.intentAnalyze')).toBeInTheDocument();
    expect(screen.getByText('designer.traces.pane.designAssessment')).toBeInTheDocument();
    expect(screen.getByText(/system-intent\.analyze-1/)).toBeInTheDocument();
    expect(screen.getByText(/system-intent\.design_assessment-1/)).toBeInTheDocument();
    expect(screen.getAllByRole('tab', { name: 'designer.traces.input' })).toHaveLength(2);
    expect(screen.getAllByRole('tab', { name: 'designer.traces.output' })).toHaveLength(2);
  });

  it('shows the empty state when a stage has no trace', () => {
    renderModal({ intentAnalyze: [], designAssessment: [makeTrace('intent.design_assessment', 1)] });

    expect(screen.getAllByText('designer.traces.empty').length).toBeGreaterThanOrEqual(1);
  });

  it('copies the input tab content when the copy button is clicked', async () => {
    renderModal();

    const copyButtons = screen.getAllByLabelText('designer.traces.copyButton');
    await act(async () => {
      fireEvent.click(copyButtons[0]);
    });

    await waitFor(() => {
      expect(copyTextMock).toHaveBeenCalledTimes(1);
    });
    const written = copyTextMock.mock.calls[0][0];
    expect(written).toContain('system-intent.analyze-1');
    expect(written).toContain('user-intent.analyze-1');
    expect(written).not.toContain('raw-intent.analyze-1');
  });
});