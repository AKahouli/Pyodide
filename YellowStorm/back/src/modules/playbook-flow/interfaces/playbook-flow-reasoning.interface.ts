export interface PublicReasoningTraceItem {
  id: string;
  type: string;
  label: string;
  description: string;
  confidence?: number | null;
}

export interface ParsedPublicReasoning {
  output: string;
  reasoningChain: PublicReasoningTraceItem[];
  markerFound: boolean;
  parseError?: string;
}
