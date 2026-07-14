import type { AssessmentDimension, AssessmentFactor, AssessmentStatus } from '@modules/knowledge-intelligence/domain/knowledge-steward';

export function dimension(score: number, factors: AssessmentFactor[], forcedStatus?: AssessmentStatus): AssessmentDimension {
  const normalized = Math.max(0, Math.min(100, Math.round(score)));
  return { score: normalized, status: forcedStatus ?? (normalized >= 80 ? 'pass' : normalized >= 40 ? 'warning' : 'fail'), factors };
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function unknownFactor(code: string, message: string): AssessmentFactor {
  return { code, contribution: 0, message };
}
