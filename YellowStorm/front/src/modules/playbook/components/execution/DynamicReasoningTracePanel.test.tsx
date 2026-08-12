import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DynamicReasoningAttempt } from '../../types';
import { DynamicReasoningTracePanel } from './DynamicReasoningTracePanel';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'dynamicReasoning.trace.rootTask': 'Root task',
        'dynamicReasoning.trace.unknownDependency': 'Unavailable task',
      };
      return translations[key] ?? key;
    },
  }),
}));

describe('DynamicReasoningTracePanel', () => {
  it('renders dependency titles instead of internal generated node ids', () => {
    const attempt = {
      status: 'completed',
      acceptedPlan: {
        schemaVersion: '1',
        nodes: [
          { id: 'collect-data', title: 'Collect prices', instruction: 'Collect', dependsOn: [] },
          { id: 'calculate-risk', title: 'Calculate risk', instruction: 'Calculate', dependsOn: ['collect-data'] },
        ],
        synthesis: { id: 'synthesis', title: 'Synthesize report', instruction: 'Synthesize', dependsOn: ['calculate-risk'], kind: 'synthesis' },
      },
    } as unknown as DynamicReasoningAttempt;

    render(<DynamicReasoningTracePanel attempt={attempt} />);

    expect(screen.getAllByText('Collect prices')).not.toHaveLength(0);
    expect(screen.getAllByText('Calculate risk')).not.toHaveLength(0);
    expect(screen.queryByText('collect-data')).not.toBeInTheDocument();
    expect(screen.queryByText('calculate-risk')).not.toBeInTheDocument();
  });
});
