import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import semanticModelConfig from '@config/semantic-model.config';
import type { AgentTaskExecutionService } from '@modules/agent/services/agent-task-execution.service';
import { AGENT_TASK_EXECUTION } from '@modules/agent/agent-task-execution.token';
import { ServiceUnavailableException, TooManyRequestsException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import {
  identityKeyOf,
  type ConceptResolutionInput,
  type ConceptResolutionResult,
  type ConceptResolver,
  type ResolvedEntity,
} from '../domain/semantic-source-mapping.types';
import { SemanticModelNativeSearchClient, type SemanticModelNativeSearchSection } from './semantic-model-native-search-client.service';

interface EvidenceItem {
  reference: string;
  page?: string;
  quote: string;
}

const MAX_EVIDENCE_ITEMS = 20;
const DOCUMENT_SEARCH_TIMEOUT_MS = 30_000;

@Injectable()
export class DocumentExtractionConceptResolver implements ConceptResolver {
  readonly kind = 'document' as const;
  private readonly inFlightUsers = new Set<string>();

  constructor(
    @Inject(semanticModelConfig.KEY) private readonly config: ConfigType<typeof semanticModelConfig>,
    private readonly nativeSearch: SemanticModelNativeSearchClient,
    private readonly moduleRef: ModuleRef,
  ) {}

  async preview(input: ConceptResolutionInput): Promise<ConceptResolutionResult> {
    const active = input.fieldMappings.filter((mapping) => mapping.mode !== 'ignore');
    const extract = active.filter((mapping) => mapping.mode === 'extract');
    const evidence = extract.length ? await this.searchEvidence(input, extract.map((mapping) => mapping.targetAttribute)) : [];
    const extracted = extract.length ? await this.extract(input, evidence) : new Map<string, { value: unknown; evidence: EvidenceItem; confidence: number }>();
    const values: Record<string, unknown> = {};
    const provenance: NonNullable<ResolvedEntity['provenance']['fields']> = {};
    for (const mapping of active) {
      if (mapping.mode === 'constant') {
        values[mapping.targetAttribute] = mapping.constantValue;
        provenance[mapping.targetAttribute] = { method: 'fixed_value' };
      } else if (mapping.mode === 'metadata') {
        values[mapping.targetAttribute] = this.metadataValue(mapping.sourceField, input);
        provenance[mapping.targetAttribute] = { method: 'document_metadata' };
      } else if (mapping.mode === 'extract') {
        const field = extracted.get(mapping.targetAttribute);
        if (!field) continue;
        values[mapping.targetAttribute] = field.value;
        provenance[mapping.targetAttribute] = {
          method: 'semantic_extraction',
          page: field.evidence.page,
          quote: field.evidence.quote,
          reference: field.evidence.reference,
          confidence: field.confidence,
        };
      }
    }
    const identityRow = Object.fromEntries(input.identityFields.map((field) => [field, values[field]]));
    const identityKey = identityKeyOf(identityRow, input.identityFields);
    const firstValue = Object.values(values).find((value) => value !== null && value !== undefined && String(value).trim());
    const entity: ResolvedEntity = {
      entityKey: identityKey || `document:${input.documentId}`,
      label: String((input.identityFields.map((field) => values[field]).find(Boolean) ?? firstValue) || input.documentName),
      values,
      provenance: { fields: provenance },
    };
    const warnings: string[] = [];
    if (!input.identityFields.length) warnings.push('No identity field selected: this document cannot be reconciled with other sources.');
    else if (!identityKey) warnings.push('The selected identity field was not populated by this document.');
    for (const mapping of extract) {
      if (!extracted.has(mapping.targetAttribute)) warnings.push(`No traceable value was found for ${mapping.targetAttribute}.`);
    }
    return {
      entities: [entity],
      stats: { scannedRows: 1, resolvedEntities: 1, duplicateKeysSkipped: 0, nullIdentitySkipped: identityKey || !input.identityFields.length ? 0 : 1 },
      identityEvidence: [],
      warnings,
      complete: true,
    };
  }

  private async searchEvidence(input: ConceptResolutionInput, fields: string[]): Promise<EvidenceItem[]> {
    const requests = [{
      query: `${input.concept.label}: exact values and surrounding evidence for ${[...new Set(fields)].join(', ')}`,
      workspace_id: input.workspaceId,
      file_name: input.documentName,
    }];
    const sections: SemanticModelNativeSearchSection[] = [];
    for (let index = 0; index < requests.length; index += 10) {
      const results = await this.nativeSearch.searchBatch(requests.slice(index, index + 10), DOCUMENT_SEARCH_TIMEOUT_MS, 1);
      for (const result of results) if (!result.error) sections.push(...result.sections);
    }
    const unique = new Map<string, EvidenceItem>();
    sections.forEach((section, index) => {
      if (section.workspace_id !== input.workspaceId || section.file_name !== input.documentName) return;
      const quote = String(section.content ?? '').trim().slice(0, 3_000);
      if (!quote) return;
      const reference = String(section.section_id ?? `evidence-${index + 1}`);
      unique.set(reference, { reference, page: section.page_range ? String(section.page_range) : undefined, quote });
    });
    return [...unique.values()].slice(0, MAX_EVIDENCE_ITEMS);
  }

  private async extract(input: ConceptResolutionInput, evidence: EvidenceItem[]) {
    if (!this.config.documentExtractionAgentId) {
      throw new ServiceUnavailableException(ErrorCode.SERVICE_UNAVAILABLE, 'SEMANTIC_MODEL_DOCUMENT_EXTRACTION_AGENT_ID is not configured');
    }
    if (!evidence.length) return new Map<string, { value: unknown; evidence: EvidenceItem; confidence: number }>();
    const fields = input.fieldMappings
      .filter((mapping) => mapping.mode === 'extract')
      .map((mapping) => input.concept.attributes.find((attribute) => attribute.key === mapping.targetAttribute))
      .filter(Boolean);
    if (this.inFlightUsers.has(input.userId)) throw new TooManyRequestsException('A document extraction is already running');
    this.inFlightUsers.add(input.userId);
    try {
      const agentTasks = this.moduleRef.get<AgentTaskExecutionService>(AGENT_TASK_EXECUTION, { strict: false });
      const result = await agentTasks.runSingleAgentTask({
        userId: input.userId,
        agentId: this.config.documentExtractionAgentId,
        correlationId: `semantic-document:${randomUUID()}`,
        query: [
          `Extract fields for one ${input.concept.label}.`,
          `Fields: ${JSON.stringify(fields)}.`,
          'Return only JSON: {"fields":[{"targetAttribute":"field_key","value":"verbatim value","reference":"evidence reference","confidence":0.0}]}.',
          'Use only supplied evidence. Omit a field when no evidence supports it. Never invent references.',
          `Evidence: ${JSON.stringify(evidence)}`,
        ].join('\n'),
        attachedFiles: [],
        workspaceContext: [{ workspace_id: input.workspaceId }],
        timeoutMs: this.config.documentExtractionTimeoutMs,
        usageEndpoint: 'semantic-model-document-extraction',
      });
      return this.validateExtraction(result.text, evidence, new Set(fields.map((field) => field!.key)));
    } finally {
      this.inFlightUsers.delete(input.userId);
    }
  }

  private validateExtraction(text: string, evidence: EvidenceItem[], allowedFields: Set<string>) {
    const output = new Map<string, { value: unknown; evidence: EvidenceItem; confidence: number }>();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return output;
    let parsed: unknown;
    try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { return output; }
    const fields = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as { fields?: unknown }).fields : undefined;
    if (!Array.isArray(fields)) return output;
    const byReference = new Map(evidence.map((item) => [item.reference, item]));
    for (const candidate of fields) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      const item = candidate as Record<string, unknown>;
      const targetAttribute = typeof item.targetAttribute === 'string' ? item.targetAttribute : '';
      const reference = typeof item.reference === 'string' ? item.reference : '';
      const source = byReference.get(reference);
      const value = item.value;
      if (!allowedFields.has(targetAttribute) || !source || output.has(targetAttribute)) continue;
      if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'string' && !value.trim())) continue;
      if (!source.quote.includes(String(value).trim())) continue;
      const rawConfidence = typeof item.confidence === 'number' && Number.isFinite(item.confidence) ? item.confidence : 0;
      output.set(targetAttribute, { value, evidence: source, confidence: Math.min(1, Math.max(0, rawConfidence)) });
    }
    return output;
  }

  private metadataValue(sourceField: string | null, input: ConceptResolutionInput): string {
    if (sourceField === 'document_id') return input.documentId;
    if (sourceField === 'workspace_id') return input.workspaceId;
    return input.documentName;
  }
}
