/**
 * Root-execution policy (WP01) — the versioned configuration of an enrolled
 * mono-agent root. Persisted as the `agents.root_execution_policy` jsonb
 * column; an absent column value means the agent is not enrolled as a root
 * and keeps legacy temporary-child semantics for unaffected callers.
 *
 * Platform ceilings bound every user-facing limit regardless of policy.
 */

export type RootConfigurationMode = 'native' | 'root_constrained';

export interface RootDelegateModeOverride {
  agentId: string;
  configurationMode: RootConfigurationMode;
}

export interface RootExecutionPolicyV1 {
  version: 1;
  delegation: {
    enabled: boolean;
    defaultConfigurationMode: RootConfigurationMode;
  };
  temporaryWorkers: { enabled: boolean; maxPerWorkGroup: number };
  fanout: { enabled: boolean; maxItems: number; allowBackground: boolean };
  background: {
    enabled: boolean;
    maxOutstandingPerConversation: number;
    taskTimeoutSeconds: number;
    maxAttempts: number;
  };
  limits: {
    maxDepth: 1;
    maxParallelWorkers: number;
    maxChildExecutionsPerWorkGroup: number;
    maxWorkGroupDurationSeconds: number;
  };
  /** Per-specialist capability-mode overrides; validated against the pool. */
  perAgentModeOverrides?: RootDelegateModeOverride[];
}

export type RootExecutionPolicy = RootExecutionPolicyV1;

/** Platform ceilings — policy values are clamped/validated against these. */
export const ROOT_POLICY_CEILINGS = {
  maxTemporaryWorkersPerWorkGroup: 8,
  maxParallelWorkers: 8,
  maxChildExecutionsPerWorkGroup: 64,
  maxWorkGroupDurationSeconds: 3600,
  maxFanoutItems: 50,
  maxOutstandingBackgroundJobs: 5,
  maxBackgroundTaskTimeoutSeconds: 3600,
  maxBackgroundAttempts: 5,
} as const;

/**
 * Defaults for newly created root profiles (plan §5.1): delegation enabled
 * with an empty pool; temporary workers ON (the only requested default-on
 * capability); fan-out and background present but disabled until qualified.
 */
export function newRootExecutionPolicy(delegationEnabled = true): RootExecutionPolicy {
  return {
    version: 1,
    delegation: { enabled: delegationEnabled, defaultConfigurationMode: 'native' },
    temporaryWorkers: { enabled: true, maxPerWorkGroup: 4 },
    fanout: { enabled: false, maxItems: 20, allowBackground: false },
    background: {
      enabled: false,
      maxOutstandingPerConversation: 2,
      taskTimeoutSeconds: 900,
      maxAttempts: 3,
    },
    limits: {
      maxDepth: 1,
      maxParallelWorkers: 2,
      maxChildExecutionsPerWorkGroup: 32,
      maxWorkGroupDurationSeconds: 1800,
    },
  };
}

/**
 * Enrollment mapping for an EXISTING mono-agent record (plan §5.1/A25): a
 * legacy `enable_temporary_child_agents` value that cannot be distinguished
 * from the untouched schema default (false) is preserved as an opt-out; new
 * roots get the default-on via `newRootExecutionPolicy()`.
 */
export function enrollLegacyRootPolicy(legacyTemporaryChildEnabled: boolean): RootExecutionPolicy {
  const policy = newRootExecutionPolicy();
  policy.temporaryWorkers.enabled = legacyTemporaryChildEnabled;
  if (legacyTemporaryChildEnabled) {
    policy.temporaryWorkers.maxPerWorkGroup = 4;
  }
  return policy;
}
