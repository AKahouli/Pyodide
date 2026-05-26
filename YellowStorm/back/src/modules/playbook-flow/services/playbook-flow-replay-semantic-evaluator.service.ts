import type { FlowTaskSemanticMatch } from '../schemas/playbook-flow-task-result.schema';
import type { ReplayPlanningSummary } from '../interfaces/playbook-flow-replay-plan.interface';

export class PlaybookFlowReplaySemanticEvaluatorService {
  evaluate(params: {
    output: string;
    planning: ReplayPlanningSummary | null;
  }): FlowTaskSemanticMatch | null {
    if (!params.planning || params.planning.executionPlan.semanticChecklist.length === 0) {
      return null;
    }

    const output = params.output || '';
    const normalizedOutput = output.toLowerCase();
    const preservedPoints: string[] = [];
    const missingPointFindings: NonNullable<FlowTaskSemanticMatch['missingPointFindings']> = [];
    const staleContextReferenceFindings: NonNullable<FlowTaskSemanticMatch['staleContextReferenceFindings']> = [];

    for (const item of params.planning.executionPlan.semanticChecklist) {
      const descriptionMatched = item.source === 'output_contract'
        ? this.matchesOutputContractExpectation(normalizedOutput, item.description)
        : this.containsMeaningfulText(normalizedOutput, item.description);
      const contextValues = item.variables
        .map((variableKey) => params.planning?.contextMapping.find((entry) => entry.variableKey === variableKey))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      const currentValuesMatched = contextValues.length > 0
        && contextValues.every((entry) => entry.currentValue === null || normalizedOutput.includes(String(entry.currentValue).toLowerCase()));
      const staleValuesPresent = contextValues
        .filter((entry) => entry.baselineValue && entry.currentValue !== entry.baselineValue)
        .filter((entry) => normalizedOutput.includes(String(entry.baselineValue).toLowerCase()));

      if (descriptionMatched || currentValuesMatched) {
        preservedPoints.push(item.key);
      } else if (item.severity !== 'info') {
        missingPointFindings.push({
          key: item.key,
          expected: item.description,
          observed: null,
          severity: item.severity,
        });
      }

      for (const stale of staleValuesPresent) {
        staleContextReferenceFindings.push({
          key: stale.variableKey,
          expected: String(stale.currentValue),
          observed: stale.baselineValue,
          severity: 'fail',
        });
      }
    }

    const missingPoints = missingPointFindings.map((item) => item.expected ?? item.key ?? '').filter(Boolean);
    const changedPoints = staleContextReferenceFindings.map((item) => item.key ?? '').filter(Boolean);
    const penalty = (missingPointFindings.length * 20) + (staleContextReferenceFindings.length * 25);
    const matchScore = Math.max(0, 100 - penalty);

    return {
      matchScore,
      semanticSimilarityScore: matchScore,
      evidenceConsistencyScore: matchScore,
      judgeScore: matchScore,
      reason: this.buildReason(missingPointFindings.length, staleContextReferenceFindings.length),
      missingPoints,
      changedPoints,
      preservedPoints,
      missingPointFindings,
      changedPointFindings: [],
      extraPointFindings: [],
      staleContextReferenceFindings,
      unsupportedClaimFindings: [],
      model: 'deterministic-replay-semantic-evaluator',
      judgeUsed: false,
      evaluationSource: 'instantiated_replay',
    };
  }

  private containsMeaningfulText(output: string, description: string): boolean {
    const tokens = description
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4)
      .slice(0, 4);
    if (tokens.length === 0) {
      return false;
    }
    return tokens.some((token) => output.includes(token));
  }

  private matchesOutputContractExpectation(output: string, description: string): boolean {
    const requiredSection = description.match(/include section:\s*(.+?)\.?$/i)?.[1]?.trim();
    if (!requiredSection) {
      return this.containsMeaningfulText(output, description);
    }
    return output.includes(requiredSection.toLowerCase());
  }

  private buildReason(missingCount: number, staleCount: number): string {
    if (missingCount === 0 && staleCount === 0) {
      return 'Instantiated replay expectations were preserved.';
    }
    if (staleCount > 0) {
      return 'Replay output still references stale baseline context.';
    }
    return 'Replay output is missing instantiated expected points.';
  }
}
