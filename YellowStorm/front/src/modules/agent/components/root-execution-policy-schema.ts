import { z } from 'zod';

/**
 * Shared root-execution policy form schema (WP02) — used by the personal and
 * administrative agent editors. Mirrors the backend RootExecutionPolicyV1
 * contract and its ceilings; the backend re-validates every value.
 */
export const rootExecutionPolicySchema = z.object({
  version: z.literal(1).default(1),
  delegation: z
    .object({
      enabled: z.boolean().default(true),
      defaultConfigurationMode: z.enum(['native', 'root_constrained']).default('native'),
    })
    .default({ enabled: true, defaultConfigurationMode: 'native' }),
  temporaryWorkers: z
    .object({
      enabled: z.boolean().default(true),
      maxPerWorkGroup: z.number().int().min(0).max(8).default(4),
    })
    .default({ enabled: true, maxPerWorkGroup: 4 }),
  fanout: z
    .object({
      enabled: z.boolean().default(false),
      maxItems: z.number().int().min(1).max(50).default(20),
      allowBackground: z.boolean().default(false),
    })
    .default({ enabled: false, maxItems: 20, allowBackground: false }),
  background: z
    .object({
      enabled: z.boolean().default(false),
      maxOutstandingPerConversation: z.number().int().min(1).max(5).default(2),
      taskTimeoutSeconds: z.number().int().min(30).max(3600).default(900),
      maxAttempts: z.number().int().min(1).max(5).default(3),
    })
    .default({ enabled: false, maxOutstandingPerConversation: 2, taskTimeoutSeconds: 900, maxAttempts: 3 }),
  limits: z
    .object({
      maxDepth: z.literal(1).default(1),
      maxParallelWorkers: z.number().int().min(1).max(8).default(2),
      maxChildExecutionsPerWorkGroup: z.number().int().min(1).max(64).default(32),
      maxWorkGroupDurationSeconds: z.number().int().min(60).max(3600).default(1800),
    })
    .default({
      maxDepth: 1,
      maxParallelWorkers: 2,
      maxChildExecutionsPerWorkGroup: 32,
      maxWorkGroupDurationSeconds: 1800,
    }),
  perAgentModeOverrides: z
    .array(
      z.object({
        agentId: z.string().min(1),
        configurationMode: z.enum(['native', 'root_constrained']),
      }),
    )
    .default([]),
});

export type RootExecutionPolicyFormValues = z.infer<typeof rootExecutionPolicySchema>;

export const defaultRootExecutionPolicy: RootExecutionPolicyFormValues = {
  version: 1,
  delegation: { enabled: true, defaultConfigurationMode: 'native' },
  temporaryWorkers: { enabled: true, maxPerWorkGroup: 4 },
  fanout: { enabled: false, maxItems: 20, allowBackground: false },
  background: { enabled: false, maxOutstandingPerConversation: 2, taskTimeoutSeconds: 900, maxAttempts: 3 },
  limits: { maxDepth: 1, maxParallelWorkers: 2, maxChildExecutionsPerWorkGroup: 32, maxWorkGroupDurationSeconds: 1800 },
  perAgentModeOverrides: [],
};

/** Normalize an unknown stored policy into the form shape (backend version 1 only). */
export function toRootPolicyFormValues(raw: unknown): RootExecutionPolicyFormValues {
  if (!raw || typeof raw !== 'object') return { ...defaultRootExecutionPolicy };
  const parsed = rootExecutionPolicySchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...defaultRootExecutionPolicy };
}
