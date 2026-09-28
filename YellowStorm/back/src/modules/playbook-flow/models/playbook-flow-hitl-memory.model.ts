

export class FlowHitlMemory {
  /** Persistent, user-approved HITL guidance that can be injected into future workflow runs. */
  ownerId!: string;

  flowId!: string;

  nodeId?: string | null;

  memoryType!: string;

  source!: string;

  title!: string;

  content!: string;

  normalizedInstruction!: string;

  appliesTo!: string;

  status!: string;

  sensitivity!: string;

  createdFromExecutionId?: string;

  createdFromInterruptId?: string;

  createdAt?: Date;

  updatedAt?: Date;
}

