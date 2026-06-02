import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlaybookExecutionKpiCards, getExecutionStatusCounts } from './PlaybookExecutionKpiCards';
import type { PlaybookSummary } from '../types';

vi.mock('@/modules/localization/useModuleTranslation', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

function buildPlaybook(id: string, executionStatus?: PlaybookSummary['executionStatus']): PlaybookSummary {
  return {
    id,
    name: `Playbook ${id}`,
    description: '',
    taskCount: 1,
    isFavorite: false,
    scheduleEnabled: false,
    executionStatus: executionStatus ?? null,
    lastExecutionAt: null,
    createdAt: '',
    updatedAt: '',
  };
}

describe('PlaybookExecutionKpiCards', () => {
  it('counts playbooks by execution status', () => {
    const counts = getExecutionStatusCounts([
      buildPlaybook('1', 'running'),
      buildPlaybook('2', 'running'),
      buildPlaybook('3', 'failed'),
      buildPlaybook('4'),
    ]);

    expect(counts.running).toBe(2);
    expect(counts.failed).toBe(1);
    expect(counts.completed).toBe(0);
  });

  it('renders all statuses and keeps zero-count cards visible', () => {
    render(
      <PlaybookExecutionKpiCards
        playbooks={[
          buildPlaybook('1', 'running'),
          buildPlaybook('2', 'queued'),
          buildPlaybook('3', 'queued'),
          buildPlaybook('4'),
        ]}
      />, 
    );

    expect(screen.getByText('status.running')).toBeInTheDocument();
    expect(screen.getByText('status.queued')).toBeInTheDocument();
    expect(screen.getByText('status.failed')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('renders zero-count cards when no playbooks have an execution status', () => {
    render(
      <PlaybookExecutionKpiCards playbooks={[buildPlaybook('1'), buildPlaybook('2')]} />,
    );

    expect(screen.getByText('status.running')).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });
});
