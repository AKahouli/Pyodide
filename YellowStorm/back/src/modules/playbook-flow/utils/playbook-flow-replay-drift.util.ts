import type { FlowTaskPublicReasoningTraceItem, FlowTaskSemanticMatch } from '../models/playbook-flow-task-result.model';
import type { FlowReplayToolCall } from '../models/playbook-flow-validated-replay.model';
import type { ReplayDriftPolicy, ReplayReasoningStage } from '../interfaces/playbook-flow-replay-template.interface';
import type { FlowToolTraceItem } from '../interfaces/playbook-flow-observability.interface';

export type ReplayDriftFindingCategory =
  | 'context'
  | 'reasoning'
  | 'tool_sequence'
  | 'argument_shape'
  | 'output_contract'
  | 'semantic';

export interface ReplayDriftFinding {
  category: ReplayDriftFindingCategory;
  severity: 'info' | 'warning' | 'fail';
  reason: string;
}

export interface ReplayFlexDriftAssessment {
  replayConfidence: number | null;
  toolSequenceMatch: number | null;
  argumentShapeMatch: number | null;
  reasoningMatch: number | null;
  outputFormatMatch: number | null;
  dataDrift: number | null;
  driftFindings: ReplayDriftFinding[];
  blockedBy: string[];
}

export interface ReplayMergedFinding {
  category: string;
  severity: 'info' | 'warning' | 'fail';
  reason: string;
}

const FAIL_THRESHOLD = 60;
const WARNING_THRESHOLD = 80;
const REASONING_WARNING_THRESHOLD = 85;
const ARGUMENT_WARNING_THRESHOLD = 75;

export function normalizeReplayScore(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }
  const normalized = value > 0 && value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, normalized));
}

export function averageReplayScores(scores: (number | null | undefined)[]): number | null {
  const valid = scores.filter((score): score is number => typeof score === 'number' && !Number.isNaN(score));
  if (valid.length === 0) {
    return null;
  }
  return Math.round((valid.reduce((sum, score) => sum + score, 0) / valid.length) * 10) / 10;
}

export function deriveReplayFlexDriftAssessment(params: {
  driftPolicy: ReplayDriftPolicy | null;
  baselineIntentKey: string | null;
  observedIntentKey: string | null;
  baselineToolCalls: FlowReplayToolCall[];
  observedToolTrace: FlowToolTraceItem[];
  baselineReasoningOutline: ReplayReasoningStage[];
  baselineReasoningChain: FlowTaskPublicReasoningTraceItem[];
  observedReasoningChain: FlowTaskPublicReasoningTraceItem[];
  outputContractEvaluated: boolean;
  outputContractPassed: boolean;
  outputFormatMatch: number | null;
  structuralDriftReasons: string[];
  semanticMatch: FlowTaskSemanticMatch | null;
}): ReplayFlexDriftAssessment {
  const dataDrift = normalizeReplayScore(params.semanticMatch?.matchScore ?? null);
  const alignedObservedTools = alignObservedToolCalls(params.baselineToolCalls, params.observedToolTrace);
  const toolSequenceMatch = scoreToolSequenceMatch(
    params.baselineToolCalls,
    params.observedToolTrace,
    params.driftPolicy?.allowAdditionalTools ?? true,
  );
  const argumentShapeMatch = scoreArgumentShapeMatch(
    params.baselineToolCalls,
    alignedObservedTools,
    params.driftPolicy?.allowArgumentValueChanges ?? true,
  );
  const reasoningMatch = scoreReasoningMatch(
    params.baselineReasoningOutline,
    params.baselineReasoningChain,
    params.observedReasoningChain,
  );
  const findings: ReplayDriftFinding[] = [];

  addIntentFinding(findings, params.baselineIntentKey, params.observedIntentKey, params.driftPolicy?.requireSameIntent ?? false);
  addAdditionalToolsFinding(
    findings,
    params.baselineToolCalls,
    params.observedToolTrace,
    params.driftPolicy?.allowAdditionalTools ?? true,
  );

  addScoreFinding(findings, 'reasoning', reasoningMatch, 'reasoning_match_below_threshold', {
    failWhenBelow: params.driftPolicy?.requireSameReasoningStages ? FAIL_THRESHOLD : null,
    warnWhenBelow: REASONING_WARNING_THRESHOLD,
  });
  addScoreFinding(findings, 'tool_sequence', toolSequenceMatch, 'tool_sequence_match_below_threshold', {
    failWhenBelow: params.driftPolicy?.requireSameToolOrder ? FAIL_THRESHOLD : null,
    warnWhenBelow: WARNING_THRESHOLD,
  });
  addScoreFinding(findings, 'argument_shape', argumentShapeMatch, 'argument_shape_match_below_threshold', {
    failWhenBelow: params.driftPolicy && !params.driftPolicy.allowArgumentValueChanges ? FAIL_THRESHOLD : null,
    warnWhenBelow: ARGUMENT_WARNING_THRESHOLD,
  });

  if (params.outputContractEvaluated && !params.outputContractPassed) {
    findings.push({
      category: 'output_contract',
      severity: params.driftPolicy?.enforceOutputContract === false ? 'warning' : 'fail',
      reason: 'output_contract_failed',
    });
  }
  for (const reason of params.structuralDriftReasons) {
    findings.push({ category: 'output_contract', severity: 'warning', reason });
  }

  addScoreFinding(findings, 'semantic', dataDrift, 'semantic_match_below_threshold', {
    failWhenBelow: FAIL_THRESHOLD,
    warnWhenBelow: WARNING_THRESHOLD,
  });
  if (params.semanticMatch?.missingPoints?.length) {
    findings.push({ category: 'semantic', severity: 'warning', reason: 'semantic_missing_points' });
  }
  if (params.semanticMatch?.changedPoints?.length) {
    findings.push({ category: 'semantic', severity: 'warning', reason: 'semantic_changed_points' });
  }

  const replayConfidence = averageReplayScores([
    toolSequenceMatch,
    argumentShapeMatch,
    reasoningMatch,
    normalizeReplayScore(params.outputFormatMatch),
    dataDrift,
  ]);
  const blockedBy = findings
    .filter((finding) => finding.severity === 'fail')
    .map((finding) => finding.reason)
    .filter((reason, index, reasons) => reasons.indexOf(reason) === index);

  return {
    replayConfidence,
    toolSequenceMatch,
    argumentShapeMatch,
    reasoningMatch,
    outputFormatMatch: normalizeReplayScore(params.outputFormatMatch),
    dataDrift,
    driftFindings: findings,
    blockedBy,
  };
}

export function mergeReplayDriftFindings<T extends ReplayMergedFinding>(
  base: T[],
  extra: T[],
): T[] {
  const merged = new Map<string, T>();
  for (const finding of [...base, ...extra]) {
    const existing = merged.get(finding.reason);
    if (!existing || severityRank(finding.severity) > severityRank(existing.severity)) {
      merged.set(finding.reason, finding);
    }
  }
  return Array.from(merged.values());
}

export function uniqueReplayStrings(values: string[]): string[] {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

function addScoreFinding(
  findings: ReplayDriftFinding[],
  category: ReplayDriftFindingCategory,
  score: number | null,
  reason: string,
  thresholds: { failWhenBelow: number | null; warnWhenBelow: number },
): void {
  if (score === null) {
    return;
  }
  if (thresholds.failWhenBelow !== null && score < thresholds.failWhenBelow) {
    findings.push({ category, severity: 'fail', reason });
    return;
  }
  if (score < thresholds.warnWhenBelow) {
    findings.push({ category, severity: 'warning', reason });
  }
}

function scoreToolSequenceMatch(
  baselineToolCalls: FlowReplayToolCall[],
  observedToolTrace: FlowToolTraceItem[],
  allowAdditionalTools: boolean,
): number | null {
  const expected = baselineToolCalls.map((item) => normalizeText(item.toolName)).filter(Boolean);
  const observed = observedToolTrace
    .filter((item) => item.status !== 'skipped')
    .sort((left, right) => (left.callIndex ?? 0) - (right.callIndex ?? 0))
    .map((item) => normalizeText(item.toolName))
    .filter(Boolean);
  return scoreOrderedOverlap(expected, observed, allowAdditionalTools);
}

function scoreArgumentShapeMatch(
  baselineToolCalls: FlowReplayToolCall[],
  alignedObservedTools: (FlowToolTraceItem | null)[],
  allowArgumentValueChanges: boolean,
): number | null {
  if (baselineToolCalls.length === 0) {
    return null;
  }

  const perCallScores = baselineToolCalls.map((expectedCall, index) => {
    const actualCall = alignedObservedTools[index];
    if (!actualCall) {
      return 0;
    }
    return scoreArgumentMap(expectedCall.args ?? {}, actualCall.args ?? {}, allowArgumentValueChanges);
  });

  return averageReplayScores(perCallScores);
}

function scoreReasoningMatch(
  baselineReasoningOutline: ReplayReasoningStage[],
  baselineReasoningChain: FlowTaskPublicReasoningTraceItem[],
  observedReasoningChain: FlowTaskPublicReasoningTraceItem[],
): number | null {
  const expected = (baselineReasoningOutline.length > 0
    ? baselineReasoningOutline.map((item) => `${normalizeText(item.stageType)}:${normalizeText(item.label)}`)
    : baselineReasoningChain.map((item) => `${normalizeText(item.type)}:${normalizeText(item.label)}`))
    .filter(Boolean);
  const observed = observedReasoningChain
    .map((item) => `${normalizeText(item.type)}:${normalizeText(item.label)}`)
    .filter(Boolean);
  return scoreOrderedOverlap(expected, observed, true);
}

function scoreOrderedOverlap(expected: string[], observed: string[], allowAdditionalTools: boolean): number | null {
  if (expected.length === 0) {
    return null;
  }
  const aligned = alignObservedToolNames(expected, observed);
  const matches = aligned.filter((item) => item !== null).length;
  const denominator = allowAdditionalTools ? expected.length : Math.max(expected.length, observed.length);
  return Math.round(((matches / denominator) * 100) * 10) / 10;
}

function alignObservedToolCalls(
  baselineToolCalls: FlowReplayToolCall[],
  observedToolTrace: FlowToolTraceItem[],
): (FlowToolTraceItem | null)[] {
  const observed = observedToolTrace
    .filter((item) => item.status !== 'skipped')
    .sort((left, right) => (left.callIndex ?? 0) - (right.callIndex ?? 0));
  const expected = baselineToolCalls.map((item) => normalizeText(item.toolName)).filter(Boolean);
  const observedNames = observed.map((item) => normalizeText(item.toolName));
  const alignedIndexes = alignObservedToolNames(expected, observedNames);
  return alignedIndexes.map((name, index) => {
    if (name === null) {
      return null;
    }
    const expectedName = expected[index];
    const observedIndex = observed.findIndex((item, itemIndex) => observedNames[itemIndex] === expectedName && isAlignedAtIndex(expected, observedNames, index, itemIndex));
    return observedIndex >= 0 ? observed[observedIndex] : null;
  });
}

function alignObservedToolNames(expected: string[], observed: string[]): (string | null)[] {
  const aligned: (string | null)[] = [];
  let observedIndex = 0;
  for (const expectedItem of expected) {
    while (observedIndex < observed.length && observed[observedIndex] !== expectedItem) {
      observedIndex += 1;
    }
    if (observedIndex < observed.length) {
      aligned.push(observed[observedIndex]);
      observedIndex += 1;
    } else {
      aligned.push(null);
    }
  }
  return aligned;
}

function isAlignedAtIndex(expected: string[], observed: string[], expectedIndex: number, observedIndex: number): boolean {
  let currentObservedIndex = 0;
  for (let index = 0; index <= expectedIndex; index += 1) {
    while (currentObservedIndex < observed.length && observed[currentObservedIndex] !== expected[index]) {
      currentObservedIndex += 1;
    }
    if (currentObservedIndex >= observed.length) {
      return false;
    }
    if (index === expectedIndex) {
      return currentObservedIndex === observedIndex;
    }
    currentObservedIndex += 1;
  }
  return false;
}

function addIntentFinding(
  findings: ReplayDriftFinding[],
  baselineIntentKey: string | null,
  observedIntentKey: string | null,
  requireSameIntent: boolean,
): void {
  if (!requireSameIntent || !baselineIntentKey) {
    return;
  }
  if (!observedIntentKey) {
    findings.push({ category: 'context', severity: 'warning', reason: 'intent_not_evaluated' });
    return;
  }
  if (normalizeText(baselineIntentKey) !== normalizeText(observedIntentKey)) {
    findings.push({ category: 'context', severity: 'fail', reason: 'intent_mismatch' });
  }
}

function addAdditionalToolsFinding(
  findings: ReplayDriftFinding[],
  baselineToolCalls: FlowReplayToolCall[],
  observedToolTrace: FlowToolTraceItem[],
  allowAdditionalTools: boolean,
): void {
  if (allowAdditionalTools) {
    return;
  }

  const expected = baselineToolCalls.map((item) => normalizeText(item.toolName)).filter(Boolean);
  const observed = observedToolTrace
    .filter((item) => item.status !== 'skipped')
    .sort((left, right) => (left.callIndex ?? 0) - (right.callIndex ?? 0))
    .map((item) => normalizeText(item.toolName))
    .filter(Boolean);
  const alignedMatches = alignObservedToolNames(expected, observed).filter((item) => item !== null).length;
  const extraToolsCount = Math.max(observed.length - alignedMatches, 0);

  if (extraToolsCount > 0) {
    findings.push({ category: 'tool_sequence', severity: 'fail', reason: 'additional_tools_not_allowed' });
  }
}

function scoreArgumentMap(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  allowArgumentValueChanges: boolean,
): number {
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(actual);
  const unionKeys = Array.from(new Set([...expectedKeys, ...actualKeys]));
  if (unionKeys.length === 0) {
    return 100;
  }

  let matched = 0;
  for (const key of unionKeys) {
    if (!(key in expected) || !(key in actual)) {
      continue;
    }
    const expectedType = resolveValueType(expected[key]);
    const actualType = resolveValueType(actual[key]);
    if (expectedType !== actualType) {
      continue;
    }
    if (!allowArgumentValueChanges && JSON.stringify(expected[key]) !== JSON.stringify(actual[key])) {
      continue;
    }
    matched += 1;
  }

  return Math.round(((matched / unionKeys.length) * 100) * 10) / 10;
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

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
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
