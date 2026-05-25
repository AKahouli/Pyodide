import { describe, expect, it } from 'vitest';
import { renderStepResultHtml, renderWorkflowExecutionResultsHtml } from './renderStepResultHtml';
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

  it('prefers displayText and renders artifacts in step html', () => {
    const html = renderStepResultHtml({
      taskId: 'task-1',
      nodeTitle: 'Write Summary',
      agentName: 'Writer Agent',
      order: 1,
      status: 'completed',
      output: '{"display_text":"json blob"}',
      displayText: 'Readable answer',
      error: null,
      durationMs: 2200,
      startedAt: '2025-01-01T00:00:02.000Z',
      completedAt: '2025-01-01T00:00:04.200Z',
      artifacts: [{
        portId: 'report',
        artifactKind: 'document',
        filename: 'report.pdf',
        url: 'https://example.com/report.pdf',
        mimeType: 'application/pdf',
      }],
    } as PlaybookExecution['taskResults'][number]);

    expect(html).toContain('Readable answer');
    expect(html).toContain('Artifacts');
    expect(html).toContain('report.pdf');
    expect(html).not.toContain('json blob');
  });

  it('summarizes python-style structured outputs in exported html', () => {
    const html = renderStepResultHtml({
      taskId: 'task-1',
      nodeTitle: 'Write Summary',
      agentName: 'Writer Agent',
      order: 1,
      status: 'completed',
      output: "{('node-1', 0): {'output': '2', 'display_text': '2', 'artifacts': [{'port_id': 'default', 'artifact_kind': 'text', 'content': '2'}]}}",
      error: null,
      durationMs: 2200,
      startedAt: '2025-01-01T00:00:02.000Z',
      completedAt: '2025-01-01T00:00:04.200Z',
    } as PlaybookExecution['taskResults'][number]);

    expect(html).toContain('2');
    expect(html).not.toContain("('node-1', 0)");
  });

  it('summarizes python-style outputs when display_text uses double quotes', () => {
    const html = renderStepResultHtml({
      taskId: 'task-1',
      nodeTitle: 'Write Summary',
      agentName: 'Writer Agent',
      order: 1,
      status: 'completed',
      output: `{('node-1', 0): {'output': "Bob's answer", 'display_text': "Bob's answer", 'node_id': 'node-1'}}`,
      error: null,
      durationMs: 2200,
      startedAt: '2025-01-01T00:00:02.000Z',
      completedAt: '2025-01-01T00:00:04.200Z',
    } as PlaybookExecution['taskResults'][number]);

    expect(html).toContain("Bob's answer");
    expect(html).not.toContain("('node-1', 0)");
  });

  it('summarizes python-style dumps that only expose a readable output field', () => {
    const html = renderStepResultHtml({
      taskId: 'task-1',
      nodeTitle: 'Write Summary',
      agentName: 'Writer Agent',
      order: 1,
      status: 'completed',
      output: "{('node-1', 0): {'output': 'Plain answer', 'node_id': 'node-1', 'artifacts': []}}",
      error: null,
      durationMs: 2200,
      startedAt: '2025-01-01T00:00:02.000Z',
      completedAt: '2025-01-01T00:00:04.200Z',
    } as PlaybookExecution['taskResults'][number]);

    expect(html).toContain('Plain answer');
    expect(html).not.toContain("('node-1', 0)");
  });

  it('unescapes double quotes in summarized python-style outputs', () => {
    const html = renderStepResultHtml({
      taskId: 'task-1',
      nodeTitle: 'Write Summary',
      agentName: 'Writer Agent',
      order: 1,
      status: 'completed',
      output: `{('node-1', 0): {'output': \"He said \\\"hello\\\"\", 'display_text': \"He said \\\"hello\\\"\", 'node_id': 'node-1'}}`,
      error: null,
      durationMs: 2200,
      startedAt: '2025-01-01T00:00:02.000Z',
      completedAt: '2025-01-01T00:00:04.200Z',
    } as PlaybookExecution['taskResults'][number]);

    expect(html).toContain('He said &quot;hello&quot;');
    expect(html).not.toContain('\\\"hello\\\"');
  });

  it('does not collapse ordinary text that merely mentions display_text', () => {
    const html = renderStepResultHtml({
      taskId: 'task-1',
      nodeTitle: 'Write Summary',
      agentName: 'Writer Agent',
      order: 1,
      status: 'completed',
      output: "The log says 'display_text': 'draft' but this is plain text.",
      error: null,
      durationMs: 2200,
      startedAt: '2025-01-01T00:00:02.000Z',
      completedAt: '2025-01-01T00:00:04.200Z',
    } as PlaybookExecution['taskResults'][number]);

    expect(html).toContain("The log says 'display_text': 'draft' but this is plain text.");
  });

  it('omits unsafe artifact urls from exported html', () => {
    const html = renderStepResultHtml({
      taskId: 'task-1',
      nodeTitle: 'Write Summary',
      agentName: 'Writer Agent',
      order: 1,
      status: 'completed',
      output: 'Readable answer',
      error: null,
      durationMs: 2200,
      startedAt: '2025-01-01T00:00:02.000Z',
      completedAt: '2025-01-01T00:00:04.200Z',
      artifacts: [{
        portId: 'report',
        artifactKind: 'document',
        filename: 'report.pdf',
        url: 'javascript:alert(1)',
      }],
    } as PlaybookExecution['taskResults'][number]);

    expect(html).toContain('report.pdf');
    expect(html).not.toContain('javascript:alert(1)');
  });
});
