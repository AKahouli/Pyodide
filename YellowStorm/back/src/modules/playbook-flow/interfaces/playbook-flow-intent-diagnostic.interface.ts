export type PlaybookIntentDiagnosticSeverity = 'info' | 'warning' | 'error';

export type PlaybookIntentDiagnosticStage =
  | 'parser'
  | 'template_resolver'
  | 'port_compiler'
  | 'graph_builder'
  | 'binding_resolver'
  | 'invariant_validator'
  | 'repair';

export type PlaybookIntentDiagnosticResolutionCode =
  | 'review_constant'
  | 'review_data_binding'
  | 'review_port'
  | 'review_connection'
  | 'review_router'
  | 'review_repair'
  | 'review_node'
  | 'review_workflow';

export interface PlaybookIntentDiagnosticReviewTarget {
  kind: 'workflow' | 'node' | 'port';
  nodeRef?: string;
  nodeLabel?: string;
  portId?: string;
}

export interface PlaybookIntentDiagnostic {
  severity: PlaybookIntentDiagnosticSeverity;
  stage: PlaybookIntentDiagnosticStage;
  code: string;
  path?: string;
  itemId?: string;
  message: string;
  repairable?: boolean;
  metadata?: Record<string, unknown>;
  reviewTarget?: PlaybookIntentDiagnosticReviewTarget;
  resolutionCode?: PlaybookIntentDiagnosticResolutionCode;
}
