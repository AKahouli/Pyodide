export type PlaybookIntentDiagnosticSeverity = 'info' | 'warning' | 'error';

export type PlaybookIntentDiagnosticStage =
  | 'parser'
  | 'template_resolver'
  | 'port_compiler'
  | 'graph_builder'
  | 'binding_resolver'
  | 'invariant_validator'
  | 'repair';

export interface PlaybookIntentDiagnostic {
  severity: PlaybookIntentDiagnosticSeverity;
  stage: PlaybookIntentDiagnosticStage;
  code: string;
  path?: string;
  itemId?: string;
  message: string;
  repairable?: boolean;
  metadata?: Record<string, unknown>;
}
