import { PLATFORM_KIT_VERSION } from './platform-kit';
import {
  planPlatformBaseline,
  type BaselineSource,
  type PlatformBaselinePlan,
} from './platform-baseline.planner';

/**
 * `ready`: nothing to inject.
 * `needs_normalization`: the template works once the Platform Kit is injected
 * at session creation — the normal case for an admin upload.
 * `incompatible`: the template has a shape the normalizer cannot fix (its own
 * data router, unparsable package.json or Vite config).
 */
export type TemplatePlatformStatus = 'ready' | 'needs_normalization' | 'incompatible';

export interface TemplatePlatformReport {
  kitVersion: number;
  analyzedAt: string;
  status: TemplatePlatformStatus;
  /** Files the baseline will add or replace when a session is created. */
  injectedFiles: string[];
  violations: string[];
  warnings: string[];
  entry: string;
  appRoot: string;
}

/**
 * Tells the admin, at upload time, whether a template will survive the
 * Template → App Builder → Deployment path — instead of discovering it
 * when a user's deploy fails.
 */
export async function analyzeTemplatePlatform(
  source: BaselineSource,
): Promise<TemplatePlatformReport> {
  return buildTemplatePlatformReport(await planPlatformBaseline(source, 'seed'));
}

/** Derive the admin-facing report from an already-computed seed plan. */
export function buildTemplatePlatformReport(plan: PlatformBaselinePlan): TemplatePlatformReport {
  const status: TemplatePlatformStatus = plan.violations.length
    ? 'incompatible'
    : plan.files.length
      ? 'needs_normalization'
      : 'ready';

  return {
    kitVersion: PLATFORM_KIT_VERSION,
    analyzedAt: new Date().toISOString(),
    status,
    injectedFiles: plan.files.map((file) => file.path),
    violations: plan.violations,
    warnings: plan.warnings,
    entry: plan.entry,
    appRoot: plan.appRoot,
  };
}
