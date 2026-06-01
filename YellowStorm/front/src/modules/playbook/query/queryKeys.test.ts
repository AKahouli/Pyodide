import { describe, expect, it } from 'vitest';

import { playbookKeys } from '@/modules/playbook/query/queryKeys';

describe('playbookKeys', () => {
  it('creates stable list keys', () => {
    const query = { page: 1, search: 'audit' };

    expect(playbookKeys.list(query)).toEqual(['playbook', 'list', query]);
  });

  it('separates base and enriched detail reads', () => {
    expect(playbookKeys.legacyDetail('playbook-1')).toEqual([
      'playbook',
      'legacy-detail',
      'playbook-1',
    ]);
    expect(playbookKeys.detail('flow-1', 'base')).toEqual([
      'playbook',
      'detail',
      'flow-1',
      'base',
    ]);
    expect(playbookKeys.detail('flow-1', 'enriched')).toEqual([
      'playbook',
      'detail',
      'flow-1',
      'enriched',
    ]);
  });

  it('uses execution-specific cache buckets', () => {
    expect(playbookKeys.executions('flow-1')).toEqual(['playbook', 'executions', 'flow-1']);
    expect(playbookKeys.execution('execution-1')).toEqual(['playbook', 'execution', 'execution-1']);
    expect(playbookKeys.activeExecutions()).toEqual(['playbook', 'active-executions']);
  });

  it('separates replay and output-format task reads', () => {
    expect(playbookKeys.replays('playbook-1', 'task-1')).toEqual([
      'playbook',
      'detail',
      'playbook-1',
      'enriched',
      'replays',
      'task-1',
    ]);
    expect(playbookKeys.flowReplays('flow-1', 'task-1')).toEqual([
      'playbook',
      'detail',
      'flow-1',
      'enriched',
      'flow-replays',
      'task-1',
    ]);
    expect(playbookKeys.outputFormatTemplate('playbook-1', 'task-1')).toEqual([
      'playbook',
      'detail',
      'playbook-1',
      'enriched',
      'output-format-template',
      'task-1',
    ]);
    expect(playbookKeys.flowOutputFormatTemplate('flow-1', 'task-1')).toEqual([
      'playbook',
      'detail',
      'flow-1',
      'enriched',
      'flow-output-format-template',
      'task-1',
    ]);
  });

  it('separates evaluation, advisor, and trigger reads', () => {
    expect(playbookKeys.evaluationExecutions('playbook-1', 'task-1')).toEqual([
      'playbook',
      'legacy-detail',
      'playbook-1',
      'evaluation-executions',
      'task-1',
    ]);
    expect(playbookKeys.flowEvaluationBaseline('flow-1', 'task-1')).toEqual([
      'playbook',
      'detail',
      'flow-1',
      'enriched',
      'flow-evaluation-baseline',
      'task-1',
    ]);
    expect(playbookKeys.advisorRemediations('playbook-1', 'execution-1', 'task-1')).toEqual([
      'playbook',
      'execution',
      'execution-1',
      'advisor-remediations',
      'playbook-1',
      'task-1',
    ]);
    expect(playbookKeys.flowTriggers('flow-1')).toEqual([
      'playbook',
      'detail',
      'flow-1',
      'enriched',
      'triggers',
    ]);
  });
});
