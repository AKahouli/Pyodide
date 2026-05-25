import { Injectable } from '@nestjs/common';
import type { ResolvedReplayArtifacts } from '../interfaces/playbook-flow-replay-artifact.interface';
import { FlowReplayOutputContractType, type ReplayMode } from '../schemas/playbook-flow-validated-replay.schema';
import type { ReplayEligibilityResult } from '../interfaces/playbook-flow-replay-eligibility.interface';
import type { ReplayPlanningSummary } from '../interfaces/playbook-flow-replay-plan.interface';

@Injectable()
export class PlaybookFlowReplayPromptService {
  buildReplayPromptSection(params: {
    artifacts: ResolvedReplayArtifacts;
    mode?: ReplayMode;
    eligibility?: ReplayEligibilityResult;
    planning?: ReplayPlanningSummary | null;
  }): string {
    const { artifacts } = params;
    if (params.eligibility && !params.eligibility.applied) {
      return '';
    }
    const mode = params.mode ?? artifacts.mode;
    const sections: string[] = [];

    const planningSection = this.buildPlanningSection(params.planning ?? null, mode);
    if (planningSection) {
      sections.push(planningSection);
    }

    const behaviorSection = this.buildBehaviorSection(artifacts);
    if (behaviorSection) {
      sections.push(behaviorSection);
    }
    if (artifacts.replayConfig.replayReasoningChain && artifacts.reasoningChain.length > 0) {
      sections.push(this.buildReasoningSection(artifacts));
    }

    const toolPolicySection = this.buildToolPolicySection(artifacts, mode);
    if (toolPolicySection) {
      sections.push(toolPolicySection);
    } else if (artifacts.replayConfig.replayToolTrace && artifacts.toolCalls.length > 0) {
      sections.push(this.buildToolTraceSection(artifacts));
    }

    const outputContractSection = this.buildOutputContractSection(artifacts);
    if (outputContractSection) {
      sections.push(outputContractSection);
    } else if (artifacts.replayConfig.replayOutputFormat && artifacts.outputFormatGuide) {
      sections.push(this.buildOutputFormatSection(artifacts));
    }

    const qualityChecksSection = this.buildBulletSection('### Quality Checks', artifacts.behaviorBaseline?.qualityChecks ?? []);
    if (qualityChecksSection) {
      sections.push(qualityChecksSection);
    }

    const failureModesSection = this.buildBulletSection('### Known Failure Modes', artifacts.behaviorBaseline?.knownFailureModes ?? []);
    if (failureModesSection) {
      sections.push(failureModesSection);
    }

    if (!sections.length) return '';

    return [
      '## Validated Replay Baseline',
      `Replay version ${artifacts.validationVersion}.`,
      `Replay mode: ${mode}.`,
      'This baseline is metadata from a prior validated execution. Do not copy prior wording. Use it only to preserve validated structure, constraints, and execution decisions.',
      '',
      '### Replay Intent',
      'Reproduce the validated behavior class for the current task, not the exact prior answer.',
      '',
      ...sections,
    ].join('\n');
  }

  private buildReasoningSection(artifacts: ResolvedReplayArtifacts): string {
    const items = artifacts.reasoningChain
      .map((item, i) => {
        const confidence = item.confidence != null ? ` (confidence: ${Math.round(item.confidence * 100)}%)` : '';
        return `${i + 1}. [${item.type}] ${item.label}${confidence}\n   ${item.description}`;
      })
      .join('\n');

    return `### Baseline Reasoning Chain\n${items}`;
  }

  private buildToolTraceSection(artifacts: ResolvedReplayArtifacts): string {
    const items = artifacts.toolCalls
      .map((call) => `${call.callIndex}. ${call.toolName}`)
      .join('\n');

    return `### Baseline Tool Calls\n${items}`;
  }

  private buildOutputFormatSection(artifacts: ResolvedReplayArtifacts): string {
    return `### Output Format Guide\n${artifacts.outputFormatGuide}`;
  }

  private buildBehaviorSection(artifacts: ResolvedReplayArtifacts): string {
    const invariants = [
      ...(artifacts.behaviorBaseline?.decisionInvariants ?? []),
      ...(artifacts.stableReasoningRules ?? []),
    ];
    return this.buildBulletSection('### Decision Invariants', invariants);
  }

  private buildPlanningSection(planning: ReplayPlanningSummary | null, mode: ReplayMode): string {
    if (!planning) {
      return '';
    }

    const lines: string[] = [];
    if (planning.intentLabel) {
      lines.push(`Preserve intent: ${planning.intentLabel}`);
    } else if (planning.intentKey) {
      lines.push(`Preserve intent key: ${planning.intentKey}`);
    }
    if (mode === 'replay_strict') {
      lines.push('Preserve the validated tool names and order. Do not add extra tools.');
    } else if (mode === 'replay_flex') {
      lines.push('Preserve validated tool purposes and argument shapes using current substituted context values.');
    } else if (mode === 'replay_adaptive') {
      lines.push('Use validated tools as guidance; alternative tools are allowed but will be scored.');
    }
    for (const entry of planning.contextMapping) {
      if (!entry.matched) {
        lines.push(`Context variable ${entry.label}: unresolved (${entry.reason})`);
        continue;
      }
      const formattedCurrentValue = this.formatContextValue(entry.currentValue);
      if (entry.baselineValue && formattedCurrentValue !== null && formattedCurrentValue !== entry.baselineValue) {
        lines.push(`Context variable ${entry.label}: ${entry.baselineValue} -> ${formattedCurrentValue}`);
      }
    }
    for (const stage of planning.executionPlan.requiredStageLabels) {
      lines.push(`Required stage: ${stage}`);
    }
    for (const step of planning.executionPlan.plannedToolSteps) {
      const argumentKeys = step.argumentShapeKeys.length > 0 ? ` (${step.argumentShapeKeys.join(', ')})` : '';
      lines.push(`Tool step ${step.stepIndex}: ${step.toolName} for ${step.purpose || 'validated purpose'}${argumentKeys}`);
    }
    for (const check of planning.executionPlan.requiredOutputChecks) {
      lines.push(check);
    }
    return this.buildBulletSection('### Replay Plan', lines);
  }

  private formatContextValue(value: ReplayPlanningSummary['contextMapping'][number]['currentValue']): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return JSON.stringify(value);
  }

  private buildToolPolicySection(artifacts: ResolvedReplayArtifacts, mode: ReplayMode): string {
    const toolPolicy = artifacts.toolPolicy;
    if (!toolPolicy) {
      return '';
    }

    const lines = [
      ...toolPolicy.requiredTools.map((toolName) => `Use tool: ${toolName}`),
      ...toolPolicy.forbiddenTools.map((toolName) => `Do not use tool: ${toolName}`),
      ...toolPolicy.sequencingRules,
      ...(toolPolicy.requireSameOrder && mode === 'replay_strict' ? ['Preserve the validated tool order.'] : []),
    ];
    return this.buildBulletSection('### Validated Tool Policy', lines);
  }

  private buildOutputContractSection(artifacts: ResolvedReplayArtifacts): string {
    const outputContract = artifacts.outputContract;
    if (!outputContract) {
      return '';
    }

    if (artifacts.outputFormatGuide && outputContract.type === FlowReplayOutputContractType.FREEFORM) {
      return this.buildOutputFormatSection(artifacts);
    }

    const lines: string[] = [];
    if (outputContract.type === FlowReplayOutputContractType.JSON_SCHEMA && outputContract.jsonSchema) {
      lines.push(`Return JSON matching schema keys: ${Object.keys((outputContract.jsonSchema.properties as Record<string, unknown>) ?? {}).join(', ') || 'validated schema'}`);
    }
    if (outputContract.type === FlowReplayOutputContractType.MARKDOWN_SECTIONS && outputContract.requiredSections.length > 0) {
      lines.push(`Include sections: ${outputContract.requiredSections.join(', ')}`);
    }
    lines.push(...outputContract.forbiddenSections.map((section) => `Do not include section: ${section}`));
    if (outputContract.citationPolicy === 'required') {
      lines.push('Citations or source references are required.');
    }
    if (outputContract.citationPolicy === 'forbidden') {
      lines.push('Do not include citations or source references.');
    }

    return this.buildBulletSection('### Output Contract', lines);
  }

  private buildBulletSection(title: string, items: string[]): string {
    const lines = items.filter(Boolean);
    if (lines.length === 0) {
      return '';
    }

    return `${title}\n${lines.map((line) => `- ${line}`).join('\n')}`;
  }
}
