import { Injectable, Logger } from '@nestjs/common';
import type { NodeKind } from '../constants/node-kinds';
import type { PlaybookIntentBlueprintNodeKind } from '../interfaces/playbook-flow-intent-blueprint.interface';

export interface NodeBuildDescriptor {
  runtimeKind: NodeKind;
  recommendedPortsOnly: boolean;
  requireExplicitPorts: boolean;
  /** When true, the builder may auto-fill ports from the node template rather than the blueprint. */
  templatePortsOverride: boolean;
}

const DEFAULT_DESCRIPTOR: NodeBuildDescriptor = {
  runtimeKind: 'step',
  recommendedPortsOnly: false,
  requireExplicitPorts: false,
  templatePortsOverride: true,
};

const REGISTRY: Record<PlaybookIntentBlueprintNodeKind, NodeBuildDescriptor> = {
  agent: {
    runtimeKind: 'step',
    recommendedPortsOnly: true,
    requireExplicitPorts: false,
    templatePortsOverride: true,
  },
  action: {
    runtimeKind: 'step',
    recommendedPortsOnly: true,
    requireExplicitPorts: false,
    templatePortsOverride: true,
  },
  evaluation: {
    runtimeKind: 'step',
    recommendedPortsOnly: true,
    requireExplicitPorts: false,
    templatePortsOverride: true,
  },
  iterator: {
    runtimeKind: 'iterator',
    recommendedPortsOnly: false,
    requireExplicitPorts: false,
    templatePortsOverride: true,
  },
  router: {
    runtimeKind: 'router',
    recommendedPortsOnly: false,
    requireExplicitPorts: false,
    templatePortsOverride: true,
  },
  human_approval: {
    runtimeKind: 'human_approval',
    recommendedPortsOnly: false,
    requireExplicitPorts: false,
    templatePortsOverride: true,
  },
};

@Injectable()
export class PlaybookIntentNodeBuildRegistryService {
  private readonly logger = new Logger(PlaybookIntentNodeBuildRegistryService.name);

  describe(kind: PlaybookIntentBlueprintNodeKind | undefined | null): NodeBuildDescriptor {
    if (!kind) return DEFAULT_DESCRIPTOR;
    const descriptor = REGISTRY[kind];
    if (!descriptor) {
      this.logger.warn(`playbook_intent_node_kind_unsupported kind=${kind}`);
      return { ...DEFAULT_DESCRIPTOR, runtimeKind: 'step' };
    }
    return descriptor;
  }

  resolveRuntimeKind(kind: PlaybookIntentBlueprintNodeKind | undefined | null): NodeKind {
    return this.describe(kind).runtimeKind;
  }

  supportedKinds(): PlaybookIntentBlueprintNodeKind[] {
    return Object.keys(REGISTRY) as PlaybookIntentBlueprintNodeKind[];
  }
}
