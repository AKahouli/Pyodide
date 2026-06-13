export interface PlaybookIntentClarificationQuestion {
  id: string;
  question: string;
  reason: string;
  category: 'datasource' | 'trigger' | 'input' | 'output' | 'business_rule' | 'approval' | 'scope';
  required: boolean;
  choices: string[];
}

export interface PlaybookIntentWorkflowBrief {
  goal: string;
  trigger: string;
  datasources: string[];
  steps: string[];
  outputs: string[];
  hitlRules: string[];
}

export type PlaybookIntentDesignResponse =
  | {
    status: 'needs_clarification';
    detectedIntent: string;
    questions: PlaybookIntentClarificationQuestion[];
    missingRequirements: string[];
    riskFlags: string[];
  }
  | {
    status: 'ready_for_review';
    detectedIntent: string;
    brief: PlaybookIntentWorkflowBrief;
    assumptions: string[];
    riskFlags: string[];
  }
  | {
    status: 'ready_to_generate';
    detectedIntent: string;
    assumptions: string[];
    riskFlags: string[];
  };
