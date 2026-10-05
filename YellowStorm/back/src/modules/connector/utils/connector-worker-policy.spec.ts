import { DEFAULT_WORKER_POLICY, workerExecutionKind } from './connector-worker-policy';

describe('connector worker policy', () => {
  it('allows ordinary inherited tools by default', () => {
    expect(workerExecutionKind(undefined, {})).toBe('leaf');
  });
  it.each([
    [true, 'inherit', 'leaf'], [true, 'block', 'unknown'],
    [false, 'inherit', 'unknown'], [false, 'allow', 'leaf'],
  ])('resolves default %s with override %s', (enabled, workerAccess, expected) => {
    expect(workerExecutionKind({ ...DEFAULT_WORKER_POLICY, enabled }, { workerAccess })).toBe(expected);
  });
  it.each(['unknown', 'orchestration'])('never promotes explicit %s classification', (executionKind) => {
    expect(workerExecutionKind({ ...DEFAULT_WORKER_POLICY, agentLaunchEnabled: true }, {
      workerAccess: 'allow', executionKind,
    })).toBe('unknown');
  });
  it('can require explicit classification at connector level', () => {
    expect(workerExecutionKind({ ...DEFAULT_WORKER_POLICY, defaultExecutionKind: 'unknown' }, {})).toBe('unknown');
  });
  it.each(['start_playbook_execution', 'reexecute_playbook_execution', 'run_playbook_from_step', 'create_agent',
    'start_playbook_generation', 'start_playbook_construction', 'modify_playbook',
    'continue_playbook_clarification', 'assess_playbook_request', 'analyze_task_optimization',
    'start_advisor_remediation_construction', 'analyze_workflow_optimization', 'start_workflow_optimization',
  ])('blocks platform orchestration %s even if relabelled', (key) => {
    expect(workerExecutionKind(DEFAULT_WORKER_POLICY, { key, executionKind: 'leaf', workerAccess: 'allow' })).toBe('unknown');
  });
});
