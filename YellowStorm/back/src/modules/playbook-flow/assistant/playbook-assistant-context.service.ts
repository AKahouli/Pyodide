import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import type { IFlowResponse } from '../interfaces/playbook-flow.interface';
import type { PlaybookAssistantContextEnvelope, PlaybookTaskDependenciesResult } from '../interfaces/playbook-assistant.interface';
import { PlaybookFlowExecutionService } from '../services/playbook-flow-execution.service';
import { PlaybookFlowService } from '../services/playbook-flow.service';
import { PlaybookFlowValidatorService } from '../services/playbook-flow-validator.service';

type AccessibleFlow = IFlowResponse & { accessLevel?: 'read' | 'write' | 'owner' };

@Injectable()
export class PlaybookAssistantContextService {
  constructor(
    private readonly flowService: PlaybookFlowService,
    private readonly validator: PlaybookFlowValidatorService,
    private readonly executionService: PlaybookFlowExecutionService,
  ) {}

  async open(
    playbookId: string,
    userId: string,
    options: { selectedTaskId?: string; executionId?: string } = {},
  ): Promise<PlaybookAssistantContextEnvelope> {
    const flow = await this.flowService.findOne(playbookId, userId) as AccessibleFlow;
    const selectedTask = options.selectedTaskId
      ? flow.nodes.find((task) => task.id === options.selectedTaskId) ?? null
      : null;
    if (options.selectedTaskId && !selectedTask) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_TASK_NOT_FOUND, 'Playbook task not found');
    }

    const diagnostics = this.validator.collectValidationErrors(
      flow.nodes,
      flow.controlEdges,
      flow.dataBindings,
      { allowDraftRouters: true, allowUnboundRequiredPorts: true },
    );
    const execution = options.executionId
      ? await this.executionService.findOne(options.executionId, userId)
      : null;
    if (execution && String(execution.flowId) !== String(playbookId)) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND, 'Execution not found');
    }
    const pendingApproval = execution?.pendingApproval ?? null;
    const accessLevel = flow.accessLevel ?? 'read';

    return {
      contextId: randomUUID(),
      playbookId: flow.id,
      definitionRevision: flow.definitionRevision ?? 0,
      generatedAt: new Date().toISOString(),
      access: {
        level: accessLevel,
        canUpdate: accessLevel === 'owner' || accessLevel === 'write',
        canExecute: accessLevel === 'owner' || accessLevel === 'write',
      },
      workflow: {
        name: flow.name,
        description: flow.description ?? '',
        taskCount: flow.nodes.length,
        edgeCount: flow.controlEdges.length,
        bindingCount: flow.dataBindings.length,
        workspaceIds: flow.workspaces.map(String),
        triggerSummary: flow.triggerConfig?.kind ? [flow.triggerConfig.kind] : [],
      },
      graph: {
        tasks: flow.nodes,
        controlEdges: flow.controlEdges,
        dataBindings: flow.dataBindings,
      },
      selectedTask,
      validation: {
        status: diagnostics.length > 0 ? 'blocked' : 'valid',
        diagnostics,
      },
      execution: {
        executionId: execution?.id ?? null,
        status: execution?.status ?? null,
        waitingForHumanInput: execution?.status === 'pending_approval',
        currentInterruptId: pendingApproval?.interruptId ?? null,
        currentInterruptTaskId: pendingApproval?.nodeId ?? null,
      },
    };
  }

  async getTask(playbookId: string, userId: string, taskId: string) {
    const context = await this.open(playbookId, userId, { selectedTaskId: taskId });
    return {
      playbookId,
      definitionRevision: context.definitionRevision,
      task: context.selectedTask,
    };
  }

  async getDependencies(playbookId: string, userId: string, taskId: string): Promise<PlaybookTaskDependenciesResult> {
    const context = await this.open(playbookId, userId, { selectedTaskId: taskId });
    return {
      playbookId,
      taskId,
      upstreamTaskIds: [...new Set(context.graph.controlEdges.filter((edge) => edge.target === taskId).map((edge) => edge.source))],
      downstreamTaskIds: [...new Set(context.graph.controlEdges.filter((edge) => edge.source === taskId).map((edge) => edge.target))],
      incomingBindings: context.graph.dataBindings.filter((binding) => binding.targetNode === taskId),
      outgoingBindings: context.graph.dataBindings.filter((binding) => binding.sourceNode === taskId),
    };
  }
}
