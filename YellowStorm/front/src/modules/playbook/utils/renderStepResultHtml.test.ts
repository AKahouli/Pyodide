import { describe, expect, it } from 'vitest';
import { renderWorkflowExecutionResultsHtml } from './renderStepResultHtml';
import type { PlaybookExecution } from '../types';

describe('renderWorkflowExecutionResultsHtml', () => {
  it('renders all step results into a single workflow html document', () => {
    const execution = {
      id: 'exec-1',
      playbookId: 'playbook-1',
      status: 'completed',
      startedAt: '2025-01-01T00:00:00.000Z',
      completedAt: '2025-01-01T00:10:00.000Z',
      durationMs: 600000,
      taskResults: [
        {
          taskId: 'task-1',
          nodeTitle: 'Collect Sources',
          agentName: 'Research Agent',
          order: 1,
          status: 'completed',
          output: 'First result',
          error: null,
          durationMs: 1200,
          startedAt: '2025-01-01T00:00:00.000Z',
          completedAt: '2025-01-01T00:00:01.200Z',
        },
        {
          taskId: 'task-2',
          nodeTitle: 'Write Summary',
          agentName: 'Writer Agent',
          order: 2,
          status: 'failed',
          output: null,
          error: 'Boom',
          durationMs: 2200,
          startedAt: '2025-01-01T00:00:02.000Z',
          completedAt: '2025-01-01T00:00:04.200Z',
        },
      ],
    } as PlaybookExecution;

    const html = renderWorkflowExecutionResultsHtml(execution);

    expect(html).toContain('Workflow Results');
    expect(html).toContain('Collect Sources');
    expect(html).toContain('Write Summary');
    expect(html).toContain('First result');
    expect(html).toContain('Boom');
    expect(html).toContain('exec-1');
  });
});
