import type { TaskTemplate } from '../types';

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'summarizer',
    type: 'summarizer',
    nodeType: 'agent',
    title: 'Summarizer',
    description: 'Takes text or documents and produces a structured summary.',
    icon: 'FileText',
    color: 'blue',
    category: 'content',
    inputPorts: [
      { id: 'source', name: 'Source Content', artifactKind: 'text', required: true },
      { id: 'source_doc', name: 'Source Document', artifactKind: 'document', required: false },
    ],
    outputPorts: [
      { id: 'summary', name: 'Summary', artifactKind: 'text' },
    ],
    promptTemplate:
      'Summarize the following content into a clear, structured overview. ' +
      'Highlight key points, decisions, and action items.\n\n{{content}}',
    recommendedAgentTypeSlug: 'researcher',
    requiredToolNames: [],
  },
  {
    id: 'docxgen',
    type: 'docxgen',
    nodeType: 'agent',
    title: 'Document Generator',
    description: 'Generates a professional Word document from structured input.',
    icon: 'FileType',
    color: 'indigo',
    category: 'generation',
    inputPorts: [
      { id: 'content', name: 'Content', artifactKind: 'text', required: true },
      { id: 'template', name: 'Template', artifactKind: 'document', required: false },
    ],
    outputPorts: [
      { id: 'document', name: 'Generated Document', artifactKind: 'document' },
    ],
    promptTemplate:
      'Generate a professional Word document based on the provided content. ' +
      'Use clear headings, proper formatting, and a professional tone.\n\n{{content}}',
    recommendedAgentTypeSlug: 'writer',
    requiredToolNames: ['document_generator'],
  },
  {
    id: 'slidegen',
    type: 'slidegen',
    nodeType: 'agent',
    title: 'Slide Generator',
    description: 'Creates presentation slide content from text or data.',
    icon: 'Presentation',
    color: 'orange',
    category: 'generation',
    inputPorts: [
      { id: 'content', name: 'Content', artifactKind: 'text', required: true },
      { id: 'template', name: 'Template', artifactKind: 'document', required: false },
    ],
    outputPorts: [
      { id: 'slides', name: 'Slide Deck', artifactKind: 'document' },
      { id: 'summary', name: 'Speaker Notes', artifactKind: 'text' },
    ],
    promptTemplate:
      'Create a professional presentation based on the following content. ' +
      'Structure slides with clear titles, bullet points, and speaker notes.\n\n{{content}}',
    recommendedAgentTypeSlug: 'writer',
    requiredToolNames: ['slide_generator'],
  },
  {
    id: 'codegen',
    type: 'codegen',
    nodeType: 'agent',
    title: 'Code Generator',
    description: 'Generates or reviews code based on specifications.',
    icon: 'Code',
    color: 'green',
    category: 'code',
    inputPorts: [
      { id: 'spec', name: 'Specification', artifactKind: 'text', required: true },
      { id: 'context', name: 'Existing Code', artifactKind: 'code', required: false },
    ],
    outputPorts: [
      { id: 'code', name: 'Generated Code', artifactKind: 'code' },
      { id: 'explanation', name: 'Explanation', artifactKind: 'text' },
    ],
    promptTemplate:
      'Generate production-ready code based on the following specification. ' +
      'Follow best practices, include error handling, and add inline comments.\n\n{{spec}}',
    recommendedAgentTypeSlug: 'researcher',
    requiredToolNames: ['code_interpreter'],
  },
  {
    id: 'analyzer',
    type: 'analyzer',
    nodeType: 'agent',
    title: 'Data Analyzer',
    description: 'Analyzes data and produces insights or dashboard descriptions.',
    icon: 'BarChart3',
    color: 'purple',
    category: 'analysis',
    inputPorts: [
      { id: 'data', name: 'Data', artifactKind: 'data', required: true },
      { id: 'context', name: 'Context', artifactKind: 'text', required: false },
    ],
    outputPorts: [
      { id: 'insights', name: 'Insights', artifactKind: 'text' },
      { id: 'dashboard', name: 'Dashboard', artifactKind: 'dashboard' },
    ],
    promptTemplate:
      'Analyze the following data and extract key insights, trends, and patterns. ' +
      'Provide actionable recommendations.\n\n{{data}}',
    recommendedAgentTypeSlug: 'researcher',
    requiredToolNames: [],
  },
  {
    id: 'evaluation',
    type: 'evaluation',
    nodeType: 'evaluation',
    title: 'Evaluation Task',
    description: 'Evaluates connected outputs against expected results and optional reference baselines.',
    icon: 'Scale',
    color: 'rose',
    category: 'evaluation',
    inputPorts: [
      { id: 'evidence', name: 'Evidence', artifactKind: 'text', required: false },
      { id: 'documents', name: 'Documents', artifactKind: 'document', required: false },
      { id: 'data', name: 'Structured Data', artifactKind: 'data', required: false },
      { id: 'dashboard', name: 'Dashboard', artifactKind: 'dashboard', required: false },
    ],
    outputPorts: [
      { id: 'evaluation', name: 'Evaluation Result', artifactKind: 'data' },
    ],
    promptTemplate:
      'Evaluate the connected workflow outputs against the configured expectation and optional baseline. Return a structured evaluation summary with score, verdict, and findings.',
    recommendedAgentTypeSlug: 'researcher',
    requiredToolNames: [],
  },
];

export const TEMPLATE_CATEGORIES = ['content', 'generation', 'analysis', 'code', 'evaluation'] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export function getTemplateById(id: string): TaskTemplate | undefined {
  return TASK_TEMPLATES.find((t) => t.id === id);
}

export function getTemplatesByCategory(category: TemplateCategory): TaskTemplate[] {
  return TASK_TEMPLATES.filter((t) => t.category === category);
}
