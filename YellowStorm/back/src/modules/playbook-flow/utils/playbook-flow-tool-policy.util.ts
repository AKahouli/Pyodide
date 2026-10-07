import type { FlowTaskToolTraceItem } from '../models/playbook-flow-task-result.model';
import type { FlowReplayToolPolicy } from '../models/playbook-flow-validated-replay.model';
import type {
  ReplayContextMappingEntry,
  ReplayPlanToolStep,
  ReplayToolCallComparison,
  ReplayToolEnforcementAssessment,
} from '../interfaces/playbook-flow-replay-plan.interface';
import type { FlowToolTraceItem } from '../interfaces/playbook-flow-observability.interface';

export interface ToolPolicyComplianceResult {
  evaluated: boolean;
  passed: boolean;
  score: number | null;
  missingRequiredTools: string[];
  forbiddenToolsUsed: string[];
  orderMatched: boolean | null;
}

type ReplayToolMode = 'replay_strict' | 'replay_flex' | 'replay_adaptive';

export function scoreToolPolicyCompliance(params: {
  toolPolicy: FlowReplayToolPolicy | null;
  toolTrace: FlowTaskToolTraceItem[];
}): ToolPolicyComplianceResult {
  const policy = params.toolPolicy;
  if (!policy) {
    return emptyResult();
  }

  const requiredTools = uniqueStrings(policy.requiredTools || []);
  const forbiddenTools = uniqueStrings(policy.forbiddenTools || []);
  const checkOrder = Boolean(policy.requireSameOrder && requiredTools.length > 1);
  const hasConstraints = requiredTools.length > 0 || forbiddenTools.length > 0 || checkOrder;
  if (!hasConstraints) {
    return emptyResult();
  }

  const observedTools = params.toolTrace
    .filter((item) => item?.toolName && item.status !== 'skipped')
    .sort((left, right) => (left.callIndex || 0) - (right.callIndex || 0))
    .map((item) => item.toolName.trim())
    .filter(Boolean);

  const missingRequiredTools = requiredTools.filter((tool) => !observedTools.includes(tool));
  const forbiddenToolsUsed = forbiddenTools.filter((tool) => observedTools.includes(tool));
  const orderMatched = checkOrder ? hasOrderedSubsequence(observedTools, requiredTools) : null;

  const scoredChecks: number[] = [];
  if (requiredTools.length > 0) {
    scoredChecks.push(((requiredTools.length - missingRequiredTools.length) / requiredTools.length) * 100);
  }
  if (forbiddenTools.length > 0) {
    scoredChecks.push(((forbiddenTools.length - forbiddenToolsUsed.length) / forbiddenTools.length) * 100);
  }
  if (checkOrder) {
    scoredChecks.push(orderMatched ? 100 : 0);
  }

  const score = scoredChecks.length > 0
    ? Math.round((scoredChecks.reduce((sum, value) => sum + value, 0) / scoredChecks.length) * 10) / 10
    : null;

  return {
    evaluated: true,
    passed: missingRequiredTools.length === 0 && forbiddenToolsUsed.length === 0 && (orderMatched ?? true),
    score,
    missingRequiredTools,
    forbiddenToolsUsed,
    orderMatched,
  };
}

export function evaluateToolReplayEnforcement(params: {
  mode: ReplayToolMode;
  expectedSteps: ReplayPlanToolStep[];
  observedToolTrace: FlowToolTraceItem[];
  contextMapping: ReplayContextMappingEntry[];
  allowAdditionalTools: boolean;
}): ReplayToolEnforcementAssessment {
  const observed = params.observedToolTrace
    .filter((item) => item.status !== 'skipped')
    .sort((left, right) => (left.callIndex ?? 0) - (right.callIndex ?? 0));
  const consumed = new Set<number>();
  const comparisons: ReplayToolCallComparison[] = [];
  const findings = new Map<string, { category: 'tool_sequence' | 'argument_shape'; severity: 'info' | 'warning' | 'fail'; reason: string }>();
  let sequenceMatches = 0;
  let argumentMatches = 0;

  params.expectedSteps.forEach((expectedStep, expectedIndex) => {
    const observedIndex = findObservedMatchIndex(params.mode, expectedStep, observed, consumed);
    if (observedIndex < 0) {
      comparisons.push({
        expectedStepIndex: expectedStep.stepIndex,
        expectedToolName: expectedStep.toolName,
        expectedPurpose: expectedStep.purpose || null,
        expectedArgs: expectedStep.expectedArgs,
        observedCallIndex: null,
        observedToolName: null,
        observedArgs: {},
        status: 'missing',
        reasons: ['missing_required_tool'],
      });
      addFinding(findings, 'tool_sequence', severityForReason(params.mode, 'missing_required_tool'), 'missing_required_tool');
      return;
    }

    consumed.add(observedIndex);
    const observedCall = observed[observedIndex];
    const reasons: string[] = [];
    let status: ReplayToolCallComparison['status'] = 'matched';
    if (observedIndex === expectedIndex) {
      sequenceMatches += 1;
    } else {
      reasons.push('wrong_tool_order');
      status = escalateStatus(status, severityForReason(params.mode, 'wrong_tool_order'));
      addFinding(findings, 'tool_sequence', severityForReason(params.mode, 'wrong_tool_order'), 'wrong_tool_order');
    }

    if (params.mode === 'replay_flex' && !matchesPurpose(expectedStep, observedCall)) {
      reasons.push('tool_purpose_mismatch');
      status = escalateStatus(status, severityForReason(params.mode, 'tool_purpose_mismatch'));
      addFinding(findings, 'tool_sequence', severityForReason(params.mode, 'tool_purpose_mismatch'), 'tool_purpose_mismatch');
    }

    const argumentShapeScore = scoreArgumentShape(expectedStep.argumentShape, observedCall.args ?? {});
    if (argumentShapeScore === 100) {
      argumentMatches += 1;
    } else {
      reasons.push('argument_shape_mismatch');
      status = escalateStatus(status, severityForReason(params.mode, 'argument_shape_mismatch'));
      addFinding(findings, 'argument_shape', severityForReason(params.mode, 'argument_shape_mismatch'), 'argument_shape_mismatch');
    }

    if (hasStaleContextValue(expectedStep.expectedArgs, observedCall.args ?? {}, params.contextMapping)) {
      reasons.push('stale_context_value_in_tool_args');
      status = escalateStatus(status, severityForReason(params.mode, 'stale_context_value_in_tool_args'));
      addFinding(findings, 'argument_shape', severityForReason(params.mode, 'stale_context_value_in_tool_args'), 'stale_context_value_in_tool_args');
    }

    comparisons.push({
      expectedStepIndex: expectedStep.stepIndex,
      expectedToolName: expectedStep.toolName,
      expectedPurpose: expectedStep.purpose || null,
      expectedArgs: expectedStep.expectedArgs,
      observedCallIndex: observedCall.callIndex ?? null,
      observedToolName: observedCall.toolName,
      observedPurpose: observedCall.purpose ?? null,
      observedArgs: observedCall.args ?? {},
      status,
      reasons,
    });
  });

  observed.forEach((observedCall, observedIndex) => {
    if (consumed.has(observedIndex)) {
      return;
    }
    const reasons = ['additional_tools_not_allowed'];
    const severity = params.allowAdditionalTools || params.mode === 'replay_adaptive'
      ? 'warning'
      : 'fail';
    comparisons.push({
      expectedStepIndex: null,
      expectedToolName: null,
      expectedPurpose: null,
      expectedArgs: {},
      observedCallIndex: observedCall.callIndex ?? null,
      observedToolName: observedCall.toolName,
      observedPurpose: observedCall.purpose ?? null,
      observedArgs: observedCall.args ?? {},
      status: severity === 'fail' ? 'extra' : 'warning',
      reasons,
    });
    addFinding(findings, 'tool_sequence', severity, 'additional_tools_not_allowed');
  });

  const toolSequenceMatch = params.expectedSteps.length > 0
    ? Math.round((sequenceMatches / params.expectedSteps.length) * 1000) / 10
    : null;
  const argumentShapeMatch = params.expectedSteps.length > 0
    ? Math.round((argumentMatches / params.expectedSteps.length) * 1000) / 10
    : null;
  const scores = [toolSequenceMatch, argumentShapeMatch].filter((value): value is number => value !== null);
  const toolPolicyScore = scores.length > 0
    ? Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 10) / 10
    : null;
  const findingValues = Array.from(findings.values());
  const blockedBy = findingValues
    .filter((finding) => finding.severity === 'fail')
    .map((finding) => finding.reason);

  return {
    toolPolicyScore,
    toolSequenceMatch,
    argumentShapeMatch,
    findings: findingValues,
    blockedBy,
    comparisons,
  };
}

function emptyResult(): ToolPolicyComplianceResult {
  return {
    evaluated: false,
    passed: true,
    score: null,
    missingRequiredTools: [],
    forbiddenToolsUsed: [],
    orderMatched: null,
  };
}

function findObservedMatchIndex(
  mode: ReplayToolMode,
  expectedStep: ReplayPlanToolStep,
  observed: FlowToolTraceItem[],
  consumed: Set<number>,
): number {
  for (let index = 0; index < observed.length; index += 1) {
    if (consumed.has(index)) {
      continue;
    }
    const observedCall = observed[index];
    if (mode === 'replay_flex') {
      if (matchesPurpose(expectedStep, observedCall) || normalizeText(expectedStep.toolName) === normalizeText(observedCall.toolName)) {
        return index;
      }
      continue;
    }
    if (normalizeText(expectedStep.toolName) === normalizeText(observedCall.toolName)) {
      return index;
    }
  }
  return -1;
}

function matchesPurpose(expectedStep: ReplayPlanToolStep, observedCall: FlowToolTraceItem): boolean {
  if (!observedCall.purpose) {
    return false;
  }
  return normalizeText(expectedStep.purpose) === normalizeText(observedCall.purpose);
}

function scoreArgumentShape(expectedShape: Record<string, unknown>, actualArgs: Record<string, unknown>): number {
  const expectedKeys = Object.keys(expectedShape);
  if (expectedKeys.length === 0) {
    return 100;
  }
  let matched = 0;
  for (const key of expectedKeys) {
    if (!(key in actualArgs)) {
      continue;
    }
    if (resolveValueType(expectedShape[key]) === resolveValueType(actualArgs[key])) {
      matched += 1;
    }
  }
  return Math.round((matched / expectedKeys.length) * 1000) / 10;
}

function resolveValueType(value: unknown): string {
  if (Array.isArray(value)) {
    return 'array';
  }
  if (value === null) {
    return 'null';
  }
  return typeof value;
}

function hasStaleContextValue(
  expectedArgs: Record<string, unknown>,
  actualArgs: Record<string, unknown>,
  contextMapping: ReplayContextMappingEntry[],
): boolean {
  return contextMapping.some((entry) => {
    if (!entry.matched || entry.baselineValue === null || entry.currentValue === null) {
      return false;
    }
    const actualContainsBaseline = containsExactValue(actualArgs, entry.baselineValue);
    if (!actualContainsBaseline) {
      return false;
    }
    return containsExactValue(expectedArgs, entry.currentValue);
  });
}

function containsExactValue(target: unknown, expectedValue: unknown): boolean {
  if (target === expectedValue) {
    return true;
  }
  if (Array.isArray(target)) {
    return target.some((entry) => containsExactValue(entry, expectedValue));
  }
  if (target && typeof target === 'object') {
    return Object.values(target as Record<string, unknown>).some((entry) => containsExactValue(entry, expectedValue));
  }
  return false;
}

function severityForReason(
  mode: ReplayToolMode,
  reason: 'missing_required_tool' | 'wrong_tool_order' | 'tool_purpose_mismatch' | 'argument_shape_mismatch' | 'stale_context_value_in_tool_args',
): 'warning' | 'fail' {
  if (mode === 'replay_adaptive') {
    return 'warning';
  }
  if (mode === 'replay_flex') {
    return reason === 'tool_purpose_mismatch' ? 'warning' : 'fail';
  }
  return 'fail';
}

function escalateStatus(
  current: ReplayToolCallComparison['status'],
  severity: 'warning' | 'fail',
): ReplayToolCallComparison['status'] {
  if (severity === 'fail') {
    return 'failed';
  }
  return current === 'matched' ? 'warning' : current;
}

function addFinding(
  findings: Map<string, { category: 'tool_sequence' | 'argument_shape'; severity: 'info' | 'warning' | 'fail'; reason: string }>,
  category: 'tool_sequence' | 'argument_shape',
  severity: 'info' | 'warning' | 'fail',
  reason: string,
): void {
  const existing = findings.get(reason);
  if (!existing || severityRank(severity) > severityRank(existing.severity)) {
    findings.set(reason, { category, severity, reason });
  }
}

function severityRank(value: 'info' | 'warning' | 'fail'): number {
  if (value === 'fail') {
    return 2;
  }
  if (value === 'warning') {
    return 1;
  }
  return 0;
}

function uniqueStrings(values: string[]): string[] {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function hasOrderedSubsequence(observedTools: string[], requiredTools: string[]): boolean {
  let currentIndex = 0;
  for (const tool of observedTools) {
    if (tool === requiredTools[currentIndex]) {
      currentIndex += 1;
      if (currentIndex === requiredTools.length) {
        return true;
      }
    }
  }

  return requiredTools.length === 0;
}
