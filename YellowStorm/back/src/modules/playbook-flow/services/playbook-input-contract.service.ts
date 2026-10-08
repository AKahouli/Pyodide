import { Injectable, Optional } from '@nestjs/common';
import { BadRequestException } from '../../exceptions/exceptions/http.exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import type { IFlowResponse } from '../interfaces/playbook-flow.interface';
import type { DataBinding, FlowNodePort } from '../models/playbook-flow.model';
import {
  hasRequiredInputValue,
  isCompleteDataBinding,
  isManagedPlaybookInputPath,
  isRouterControlInput,
  readOwnPath,
} from '../utils/playbook-managed-input.util';
import { PlaybookFlowValidatorService } from './playbook-flow-validator.service';
import { WorkspaceShareService } from '@modules/workspace/workspace-share.service';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';

export type PlaybookInputScope = 'runtime' | 'configuration';
export type PlaybookInputSourceKind = 'upload' | 'workspace' | 'document' | 'folder' | 'url' | 'manual';
export type PlaybookInputReadiness = 'runtime_required' | 'configuration_required' | 'configured' | 'invalid';

export interface PlaybookInputDescriptor {
  id: string;
  taskId: string;
  taskTitle: string;
  portId: string;
  label: string;
  artifactKind: 'text' | 'document' | 'code' | 'image' | 'data' | 'dashboard';
  required: true;
  scope: PlaybookInputScope;
  binding: {
    kind: 'trigger' | 'constant' | 'state' | 'expression' | 'node-output' | 'missing';
    triggerPath?: string;
  };
  acceptedSources: PlaybookInputSourceKind[];
  readiness: PlaybookInputReadiness;
  configuredSource?: { kind: PlaybookInputSourceKind; label: string; resourceId?: string } | null;
}

export interface PlaybookInputContractResponse {
  playbookId: string;
  definitionRevision: number;
  graphValid: boolean;
  configurationReady: boolean;
  runtimeInputCount: number;
  invalidInputCount: number;
  inputs: PlaybookInputDescriptor[];
}

const CONFIGURATION_TERMS = [
  'destination workspace', 'output workspace', 'destination folder', 'output folder',
  'save location', 'archive location', 'recipient configuration',
];

@Injectable()
export class PlaybookInputContractService {
  constructor(
    private readonly validator: PlaybookFlowValidatorService = new PlaybookFlowValidatorService(),
    // Optional so the contract stays derivable without workspace providers;
    // resource preflight then rejects as inaccessible (same as before extraction).
    @Optional() private readonly workspaceShareService?: WorkspaceShareService,
    @Optional() private readonly workspaceDocumentService?: WorkspaceDocumentService,
  ) {}

  /**
   * Rejects execution when any required input is invalid, unconfigured, missing
   * at runtime, or points at a resource the owner cannot access.
   */
  async preflightRequiredInputs(
    flow: IFlowResponse,
    ownerId: string,
    inputContext: Record<string, unknown>,
    singleStepTaskId?: string,
  ): Promise<void> {
    const contract = this.derive(flow);
    const inputs = singleStepTaskId
      ? contract.inputs.filter((input) => input.taskId === singleStepTaskId)
      : contract.inputs;
    const invalid = inputs.find((input) => input.readiness === 'invalid');
    if (invalid) {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_INPUT_BINDING_INVALID,
        `Playbook input binding is invalid for ${invalid.taskTitle}.${invalid.label}.`,
      );
    }
    const configuration = inputs.find((input) => input.readiness === 'configuration_required');
    if (configuration) {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_CONFIGURATION_REQUIRED,
        `Playbook setting ${configuration.label} must be configured before execution.`,
      );
    }

    for (const input of inputs.filter((item) => item.readiness === 'configured')) {
      const binding = flow.dataBindings.find((candidate) => (
        candidate.targetNode === input.taskId
        && candidate.targetPort === input.portId
        && candidate.sourceKind === 'constant'
      ));
      if (binding) await this.validateInputResource(ownerId, input, binding.constantValue);
    }

    for (const input of inputs.filter((item) => item.readiness === 'runtime_required')) {
      const triggerPath = input.binding.triggerPath;
      const resolved = triggerPath ? readOwnPath(inputContext, triggerPath) : { found: false };
      if (!resolved.found || !hasRequiredInputValue(resolved.value)) {
        throw new BadRequestException(
          ErrorCode.PLAYBOOK_REQUIRED_INPUT_MISSING,
          `Required Playbook input ${input.label} is missing.`,
        );
      }
      await this.validateInputResource(ownerId, input, resolved.value);
    }
  }

  private async validateInputResource(
    ownerId: string,
    input: PlaybookInputDescriptor,
    value: unknown,
  ): Promise<void> {
    const configurationDestination = input.scope === 'configuration';
    const requiresResource = configurationDestination || input.artifactKind === 'document' || input.artifactKind === 'image';
    if (!value || typeof value !== 'object') {
      if (requiresResource) this.throwInputResourceInaccessible(input);
      return;
    }
    const resource = value as Record<string, unknown>;
    if (resource.kind !== 'workspace' && resource.kind !== 'document' && resource.kind !== 'folder') {
      if (requiresResource) this.throwInputResourceInaccessible(input);
      return;
    }
    if (configurationDestination && resource.kind !== 'workspace' && resource.kind !== 'folder') {
      this.throwInputResourceInaccessible(input);
    }
    const id = typeof resource.id === 'string' ? resource.id.trim() : '';
    const workspaceId = typeof resource.workspaceId === 'string' ? resource.workspaceId.trim() : '';
    if (!id || !workspaceId) this.throwInputResourceInaccessible(input);
    if (resource.kind === 'workspace' && id !== workspaceId) this.throwInputResourceInaccessible(input);
    const workspaceShareService = this.workspaceShareService;
    if (!workspaceShareService) this.throwInputResourceInaccessible(input);
    const workspaceDocumentService = this.workspaceDocumentService;
    if ((resource.kind === 'document' || resource.kind === 'folder') && !workspaceDocumentService) {
      this.throwInputResourceInaccessible(input);
    }

    try {
      if (input.scope === 'configuration') {
        await workspaceShareService.assertUserHasWriteAccess(ownerId, workspaceId);
      } else {
        await workspaceShareService.assertUserHasAccess(ownerId, [workspaceId]);
      }
      if (resource.kind === 'document' || resource.kind === 'folder') {
        const documents = await workspaceDocumentService!.findByIds([id]);
        const document = documents.find((candidate) => candidate.id === id);
        const expectedFolder = resource.kind === 'folder';
        if (!document || document.workspaceId !== workspaceId || document.isFolder !== expectedFolder) {
          this.throwInputResourceInaccessible(input);
        }
      }
    } catch {
      this.throwInputResourceInaccessible(input);
    }
  }

  private throwInputResourceInaccessible(input: PlaybookInputDescriptor): never {
    throw new BadRequestException(
      ErrorCode.PLAYBOOK_INPUT_RESOURCE_INACCESSIBLE,
      `The selected resource for ${input.label} is unavailable or inaccessible.`,
    );
  }

  derive(flow: Pick<IFlowResponse, 'id' | 'definitionRevision' | 'nodes' | 'controlEdges' | 'dataBindings'>): PlaybookInputContractResponse {
    const inputs: PlaybookInputDescriptor[] = [];
    for (const node of flow.nodes) {
      for (const port of node.input?.ports ?? []) {
        if (!port.required || isRouterControlInput(node.id, port.id, flow.nodes, flow.controlEdges)) continue;
        const bindings = flow.dataBindings.filter((binding) => binding.targetNode === node.id && binding.targetPort === port.id);
        const binding = bindings.length === 1 ? bindings[0] : undefined;
        const descriptor = this.toDescriptor(node, port, binding, bindings.length);
        if (descriptor) inputs.push(descriptor);
      }
    }

    const graphValid = this.validator.collectValidationErrors(
      flow.nodes,
      flow.controlEdges,
      flow.dataBindings,
    ).length === 0;
    return {
      playbookId: flow.id,
      definitionRevision: flow.definitionRevision,
      graphValid,
      configurationReady: inputs.every((input) => input.readiness !== 'configuration_required' && input.readiness !== 'invalid'),
      runtimeInputCount: inputs.filter((input) => input.readiness === 'runtime_required').length,
      invalidInputCount: inputs.filter((input) => input.readiness === 'invalid').length,
      inputs,
    };
  }

  private toDescriptor(
    node: IFlowResponse['nodes'][number],
    port: FlowNodePort,
    binding: DataBinding | undefined,
    bindingCount: number,
  ): PlaybookInputDescriptor | null {
    const scope = this.inferScope(node.label, node.description, port.id, port.label, binding);
    if (bindingCount === 1 && binding && isCompleteDataBinding(binding)) {
      if (binding.sourceKind === 'node-output' || binding.sourceKind === 'state' || binding.sourceKind === 'expression') return null;
      if (binding.sourceKind === 'trigger' && !isManagedPlaybookInputPath(binding.triggerPath)) return null;
    }

    const invalid = bindingCount !== 1 || !binding || !isCompleteDataBinding(binding);
    const artifactKind = port.type as PlaybookInputDescriptor['artifactKind'];
    const readiness: PlaybookInputReadiness = invalid
      ? 'invalid'
      : binding.sourceKind === 'constant'
        ? this.hasConfiguredConstant(binding.constantValue, scope) ? 'configured' : 'configuration_required'
        : scope === 'configuration' ? 'configuration_required' : 'runtime_required';
    const acceptedSources = this.acceptedSources(artifactKind, scope, node.label, node.description, port.id, port.label);
    return {
      id: `${node.id}:${port.id}`,
      taskId: node.id,
      taskTitle: node.label || node.id,
      portId: port.id,
      label: port.label || port.id,
      artifactKind,
      required: true,
      scope,
      binding: {
        kind: invalid ? 'missing' : binding.sourceKind as PlaybookInputDescriptor['binding']['kind'],
        ...(binding?.sourceKind === 'trigger' && binding.triggerPath ? { triggerPath: binding.triggerPath } : {}),
      },
      acceptedSources,
      readiness,
      ...(binding?.sourceKind === 'constant' ? { configuredSource: this.configuredSource(binding.constantValue) } : {}),
    };
  }

  private inferScope(...values: (string | undefined | DataBinding)[]): PlaybookInputScope {
    const binding = values.find((value): value is DataBinding => typeof value === 'object');
    const constant = binding?.sourceKind === 'constant' && binding.constantValue && typeof binding.constantValue === 'object'
      ? binding.constantValue as Record<string, unknown>
      : null;
    if (constant && (constant.kind === 'workspace' || constant.kind === 'folder')) return 'configuration';
    const text = values.filter((value): value is string => typeof value === 'string').join(' ').toLowerCase();
    return CONFIGURATION_TERMS.some((term) => text.includes(term)) ? 'configuration' : 'runtime';
  }

  private acceptedSources(
    artifactKind: PlaybookInputDescriptor['artifactKind'],
    scope: PlaybookInputScope,
    ...semanticValues: (string | undefined)[]
  ): PlaybookInputSourceKind[] {
    if (scope === 'configuration') {
      const text = semanticValues.filter(Boolean).join(' ').toLowerCase();
      return text.includes('folder') ? ['folder', 'workspace'] : ['workspace', 'folder'];
    }
    if (artifactKind === 'document' || artifactKind === 'image') return ['upload', 'document', 'workspace'];
    if (artifactKind === 'data') return ['manual', 'upload', 'document', 'workspace'];
    if (artifactKind === 'text' && semanticValues.filter(Boolean).join(' ').toLowerCase().includes('url')) return ['manual', 'url'];
    return ['manual'];
  }

  private hasConfiguredConstant(value: unknown, scope: PlaybookInputScope): boolean {
    if (value === null || value === undefined || value === '') return false;
    if (scope === 'configuration') {
      if (!value || typeof value !== 'object') return false;
      const resource = value as Record<string, unknown>;
      if (resource.kind !== 'workspace' && resource.kind !== 'folder') return false;
      const id = typeof resource.id === 'string' ? resource.id.trim() : '';
      const workspaceId = typeof resource.workspaceId === 'string' ? resource.workspaceId.trim() : '';
      return Boolean(id && workspaceId && (resource.kind !== 'workspace' || id === workspaceId));
    }
    if (!value || typeof value !== 'object') return true;
    const resource = value as Record<string, unknown>;
    return typeof resource.id === 'string' && resource.id.trim().length > 0;
  }

  private configuredSource(value: unknown): PlaybookInputDescriptor['configuredSource'] {
    if (!value || typeof value !== 'object') return { kind: 'manual', label: String(value ?? '') };
    const resource = value as Record<string, unknown>;
    const kind = resource.kind === 'document' || resource.kind === 'folder' || resource.kind === 'workspace'
      ? resource.kind
      : 'manual';
    return {
      kind,
      label: typeof resource.label === 'string' && resource.label ? resource.label : typeof resource.workspaceName === 'string' ? resource.workspaceName : String(resource.id ?? ''),
      ...(typeof resource.id === 'string' ? { resourceId: resource.id } : {}),
    };
  }
}
