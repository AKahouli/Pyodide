import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReplayExecutionPlanCard } from './ReplayExecutionPlanCard';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('ReplayExecutionPlanCard', () => {
  it('renders expected substituted args for planned tool steps', () => {
    render(
      <ReplayExecutionPlanCard
        plan={{
          taskId: 'task-1',
          replayId: 'replay-1',
          validationVersion: 3,
          intentKey: 'earnings.summary',
          intentLabel: 'Summarize earnings',
          matchedContextCount: 1,
          missingRequiredContextCount: 0,
          requiredStageLabels: [],
          requiredOutputChecks: [],
          plannedToolSteps: [
            {
              stepIndex: 1,
              toolName: 'search_financials',
              purpose: 'load earnings',
              required: true,
              argumentShape: { ticker: 'string' },
              argumentShapeKeys: ['ticker'],
              expectedArgs: { ticker: 'NVDA' },
              sourceCallIndex: 1,
            },
          ],
          semanticChecklist: [],
        }}
      />,
    );

    expect(screen.getByText('1. search_financials')).toBeInTheDocument();
    expect(screen.getByText(/replayPlanning.expectedArgs/)).toBeInTheDocument();
    expect(screen.getByText(/"ticker":"NVDA"/)).toBeInTheDocument();
  });
});
