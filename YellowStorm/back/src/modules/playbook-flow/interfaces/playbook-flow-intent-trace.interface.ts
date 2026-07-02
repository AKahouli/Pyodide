export type PlaybookIntentTraceStage = 'intent.analyze' | 'intent.design_assessment';

export interface PlaybookIntentTraceEntry {
  stage: PlaybookIntentTraceStage;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  rawOutput: string;
  createdAt: string;
}

export interface PlaybookIntentTraceResponse {
  intentAnalyze: PlaybookIntentTraceEntry[];
  designAssessment: PlaybookIntentTraceEntry[];
}