import type { ConnectorWorkerPolicy } from '../connector.types';

export const DEFAULT_WORKER_POLICY: ConnectorWorkerPolicy = {
  enabled: true, defaultExecutionKind: 'leaf', agentLaunchEnabled: false,
};

export function isPlatformOrchestration(key: string): boolean {
  return ['start_playbook_execution', 'reexecute_playbook_execution', 'run_playbook_from_step',
    'start_playbook_generation', 'start_playbook_construction', 'modify_playbook',
    'continue_playbook_clarification', 'assess_playbook_request',
    'analyze_task_optimization', 'start_advisor_remediation_construction',
    'analyze_workflow_optimization', 'start_workflow_optimization',
    'create_agent', 'create_temporary_child_agent', 'delegate_to_agent', 'start_background_task'].includes(key);
}

/** Catalog policy is trusted administration; remote annotations never set it. */
export function workerExecutionKind(
  policy: ConnectorWorkerPolicy = DEFAULT_WORKER_POLICY,
  action: { key?: string; workerAccess?: string; executionKind?: string },
): string {
  if (isPlatformOrchestration(action.key ?? '')) return 'unknown';
  const allowed = action.workerAccess === 'allow'
    || (action.workerAccess !== 'block' && policy.enabled);
  if (!allowed) return 'unknown';
  const kind = !action.executionKind || action.executionKind === 'inherit'
    ? policy.defaultExecutionKind : action.executionKind;
  // Current workers are depth-one leaves. A launch permission cannot bypass this.
  return kind === 'leaf' ? 'leaf' : 'unknown';
}
