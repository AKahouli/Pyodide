export const FLOW_READ_PORT = Symbol('FLOW_READ_PORT');

export interface FlowReadPort {
  /** Existence + owner lookup; null when the flow does not exist. */
  findById(id: string): Promise<{ id: string; ownerId: string } | null>;
  /**
   * Detach a workspace from every flow referencing it. Deleting the workspace row already does it
   * (the playbook.flow_workspaces foreign key cascades), so after a delete this is a no-op.
   */
  removeWorkspaceReference(workspaceId: string): Promise<void>;
}
