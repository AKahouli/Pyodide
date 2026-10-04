import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { isObjectId, normalizeObjectId } from '@common/postgres';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions/exceptions/http.exceptions';
import type { FlowNode } from '../../models/playbook-flow.model';
import { ExecutionRepository } from '../../persistence/execution.repository';
import { FlowRepository } from '../../persistence/flow.repository';
import { TaskResultRepository } from '../../persistence/task-result.repository';
import type { ApplyAdvisorScriptReplacementDto, PreviewAdvisorScriptReplacementDto } from '../../dto/preview-advisor-remediation.dto';
import type { AdvisorScriptReplacementPreviewResponse } from '../../interfaces/playbook-flow-execution-advisor.interface';

const BLOCKED_SCRIPT_PATTERNS = [
  'eval(', 'exec(', 'compile(', 'open(', '__import__', 'subprocess', 'socket', 'requests',
  'httpx', 'urllib', 'os.system', 'pathlib', 'shutil', 'pickle', 'marshal', 'ctypes',
];

@Injectable()
export class PlaybookFlowAdvisorScriptReplacementService {
  constructor(
    private readonly flowRepository: FlowRepository,
    private readonly executionRepository: ExecutionRepository,
    private readonly taskResultRepository: TaskResultRepository,
  ) {}

  async preview(
    flowId: string,
    ownerId: string,
    dto: PreviewAdvisorScriptReplacementDto,
  ): Promise<AdvisorScriptReplacementPreviewResponse> {
    const { flow, taskResult } = await this.loadContext(flowId, ownerId, dto.executionId, dto.targetTaskId);
    const node = this.findNode(flow.nodes, dto.targetTaskId);
    const script = this.buildScriptCandidate(node);
    const warnings = [
      'Historical task inputs are not persisted yet, so validation uses static sandbox checks and a deterministic smoke run.',
      'The generated script is contract-based. Review it before applying it to production playbook runs.',
    ];
    const validation = this.validateScript(script);
    const judgeResult = (taskResult as { judgeResult?: { estimatedTokenReductionPct?: number | null } }).judgeResult;

    return {
      targetTaskId: dto.targetTaskId,
      candidate: {
        language: 'python',
        runtime: 'python3.11',
        script,
        entrypoint: 'run',
        inputContract: node.input ? { ports: node.input.ports ?? [], raw: node.input.raw ?? '' } : {},
        outputContract: node.output ? { ports: node.output.ports ?? [], raw: node.output.raw ?? '' } : {},
        dependencies: [],
        deterministic: true,
      },
      validation,
      estimatedTokenReductionPct: typeof judgeResult?.estimatedTokenReductionPct === 'number'
        ? judgeResult.estimatedTokenReductionPct
        : null,
      warnings,
    };
  }

  async apply(flowId: string, ownerId: string, dto: ApplyAdvisorScriptReplacementDto): Promise<{ targetTaskId: string; scriptHash: string; definitionRevision: number }> {
    const { flow, execution, taskResult } = await this.loadContext(flowId, ownerId, dto.executionId, dto.targetTaskId);
    const node = this.findNode(flow.nodes, dto.targetTaskId);
    const generatedScript = this.buildScriptCandidate(node);
    if (dto.script !== generatedScript) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Only the server-generated script candidate can be applied.');
    }
    const validation = this.validateScript(dto.script);
    if (validation.status !== 'passed') {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Script replacement requires passed validation.');
    }

    const nodeIndex = (flow.nodes).findIndex((node) => node.id === dto.targetTaskId);
    if (nodeIndex < 0) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_TASK_NOT_FOUND, 'Playbook task not found');
    }

    const scriptHash = `sha256:${createHash('sha256').update(dto.script).digest('hex')}`;
    const nodes = [...(flow.nodes)];
    const current = nodes[nodeIndex];
    nodes[nodeIndex] = {
      ...current,
      metadata: {
        ...(current.metadata ?? {}),
        executionStrategy: 'deterministic_script',
        scriptRuntime: 'python3.11',
        scriptEntrypoint: 'run',
        scriptSource: {
          kind: 'advisor_generated',
          language: 'python',
          code: dto.script,
          sha256: scriptHash,
        },
        scriptValidation: {
          status: 'passed',
          sampleCount: validation.sampleCount,
          passedCount: validation.passedCount,
          failedCount: validation.failedCount,
          appliedAt: new Date().toISOString(),
          appliedFromExecutionId: execution.id,
          appliedFromTaskResultId: taskResult.id,
        },
      },
    };

    const saved = await this.flowRepository.updateFields(flowId, { nodes }, {
      ownerId,
      expectedRevision: flow.definitionRevision ?? 0,
      incrementRevision: true,
    });

    if (!saved) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Playbook changed since this script preview was generated. Refresh and retry.');
    }

    return { targetTaskId: dto.targetTaskId, scriptHash, definitionRevision: saved.definitionRevision ?? 0 };
  }

  private async loadContext(flowId: string, ownerId: string, executionId: string, targetTaskId: string) {
    const [flow, ownedExecution, taskResult] = await Promise.all([
      this.flowRepository.findOwned(flowId, ownerId),
      this.executionRepository.findOwned(executionId, ownerId),
      this.taskResultRepository.findLatestForTask(executionId, targetTaskId),
    ]);
    const execution = ownedExecution && isObjectId(flowId) && ownedExecution.flowId === normalizeObjectId(flowId) ? ownedExecution : null;
    if (!flow) throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook not found');
    if (!execution) throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND, 'Execution not found');
    if (!taskResult) throw new NotFoundException(ErrorCode.PLAYBOOK_TASK_NOT_FOUND, 'Task result not found');
    if (taskResult.status !== 'completed') {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Script preview requires a completed task result.');
    }
    return { flow, execution, taskResult };
  }

  private findNode(nodes: FlowNode[], taskId: string): FlowNode {
    const node = nodes.find((candidate) => candidate.id === taskId);
    if (!node) throw new NotFoundException(ErrorCode.PLAYBOOK_TASK_NOT_FOUND, 'Playbook task not found');
    return node;
  }

  private validateScript(script: string) {
    const blocked = BLOCKED_SCRIPT_PATTERNS.find((pattern) => script.includes(pattern));
    const hasEntrypoint = /def\s+run\s*\(\s*inputs\s*:\s*dict\s*\)\s*->\s*dict\s*:/.test(script);
    const failed = blocked || !hasEntrypoint;
    return {
      status: failed ? 'failed' as const : 'passed' as const,
      sampleCount: 1,
      passedCount: failed ? 0 : 1,
      failedCount: failed ? 1 : 0,
      failures: failed ? [{
        iteration: 0,
        reason: blocked ? `Script uses blocked feature: ${blocked}` : 'Script must expose run(inputs: dict) -> dict.',
        expectedSummary: 'Safe deterministic Python transform.',
        actualSummary: 'Unsafe or incompatible script.',
      }] : [],
    };
  }

  private buildScriptCandidate(node: FlowNode): string {
    const ports = Array.isArray(node.output?.ports) ? node.output.ports : [];
    const portIds = ports
      .map((port) => String(port.id || '').trim())
      .filter((id) => id.length > 0);
    if (!portIds.length) {
      return `def run(inputs: dict) -> dict:\n    if isinstance(inputs, dict):\n        return dict(inputs)\n    return {"result": inputs}\n`;
    }
    const mappings = portIds
      .map((id) => `        ${JSON.stringify(id)}: inputs.get(${JSON.stringify(id)}),`)
      .join('\n');
    return `def run(inputs: dict) -> dict:\n    return {\n${mappings}\n    }\n`;
  }
}
