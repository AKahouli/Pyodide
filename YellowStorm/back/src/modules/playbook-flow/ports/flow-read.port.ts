export const FLOW_READ_PORT = Symbol('FLOW_READ_PORT');

export interface FlowReadPort {
  /** Existence + owner lookup; null when the flow does not exist. */
  findById(id: string): Promise<{ id: string; ownerId: string } | null>;
  /**
   * Detach a workspace from every flow referencing it. Preserves the legacy
   * quirk verbatim: Flow.workspaces is string[] but the old model code queried
   * and pulled with ObjectId values — the Mongo adapter must do the same.
   */
  removeWorkspaceReference(workspaceId: string): Promise<void>;
}
