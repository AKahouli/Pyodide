/**
 * Ports for the Conversation V2 `application_component` event.
 *
 * App Runtime both publishes the event (after a finalize OpenCode did not
 * relay) and replays it (to rebuild finalized revisions). The wire payload is
 * snake_case, so the adapters translate to and from these camelCase shapes.
 */
export const APPLICATION_COMPONENT_EVENT_PUBLISHER = Symbol(
  'APPLICATION_COMPONENT_EVENT_PUBLISHER',
);
export const APPLICATION_COMPONENT_EVENT_SOURCE = Symbol('APPLICATION_COMPONENT_EVENT_SOURCE');

export interface ApplicationComponentTreeNode {
  name: string;
  type: 'file' | 'directory';
  path?: string;
  size?: number;
  children?: ApplicationComponentTreeNode[];
}

export interface ApplicationComponentPublishInput {
  eventId: string;
  timestamp: number;
  url: string;
  title?: string;
  cephPath?: string;
  filesTree?: ApplicationComponentTreeNode | null;
  fileCount?: number;
  revisionId: string;
}

export interface ApplicationComponentEventPublisher {
  publishApplicationComponent(
    userId: string,
    sessionOrWorkspaceId: string,
    input: ApplicationComponentPublishInput,
  ): Promise<void>;
}

export interface ApplicationComponentStoredEvent {
  eventId: string;
  /** Event emission time, seconds since epoch. */
  emittedAt: number;
  payload: Record<string, unknown>;
}

export interface ApplicationComponentEventSource {
  listApplicationComponents(sessionId: string): Promise<ApplicationComponentStoredEvent[]>;
}