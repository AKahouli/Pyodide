import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AgentRepository } from '@modules/agent/repositories/agent.repository';
import { SEMANTIC_EXTRACTION_AGENT_NAME } from '@modules/agent/constants/semantic-extraction.constants';
import { ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

export interface AttributeExtractionAttribute {
  key: string;
  label?: string;
  description?: string;
  type?: string;
}

export interface AttributeExtractionSection {
  sectionPk: string | number;
  blockPk: string | number;
  content: string;
}

/** Identity of the extractor bound into the job's execution fingerprint. */
export interface AiExtractionIdentity {
  agentSlug: string;
  model: string | null;
  contractVersion: string;
}

export interface AttributeExtractionRequest {
  modelId: string;
  conceptId: string;
  conceptLabel?: string;
  documentId?: string;
  fileName?: string;
  attributes: AttributeExtractionAttribute[];
  sections: AttributeExtractionSection[];
  /** Required: execution must run the exact extractor the revision was built for. */
  aiExtraction?: AiExtractionIdentity | null;
}

const ADK_TIMEOUT_MS = 240_000;

export interface AttributeExtractionResult {
  model?: string | null;
  extractorVersion: string;
  values: Array<{ key: string; value: unknown; evidenceReferences: string[] }>;
  failed: string[];
}

/**
 * Trusted bridge between the semantic-model runtime and the ADK attribute
 * extraction agent. The agent is resolved from the admin-managed agent library,
 * so disabling it (or changing its model) takes effect here without a deploy.
 */
@Injectable()
export class SemanticAttributeExtractionService {
  constructor(
    private readonly config: ConfigService,
    private readonly agents: AgentRepository,
  ) {}

  /** The admin-managed default extraction agent; fails closed when unusable. */
  async resolveAgent() {
    const agent = await this.agents.findDefaultByNameActive(SEMANTIC_EXTRACTION_AGENT_NAME);
    if (!agent) {
      throw new ServiceUnavailableException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `The '${SEMANTIC_EXTRACTION_AGENT_NAME}' default agent is missing or inactive`,
      );
    }
    return agent;
  }

  async extract(request: AttributeExtractionRequest): Promise<AttributeExtractionResult> {
    const bound = request.aiExtraction;
    if (!bound || !bound.agentSlug || !bound.model || !bound.contractVersion) {
      throw new ServiceUnavailableException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'AI extraction requires the extractor identity bound at job admission',
      );
    }
    const agent = await this.resolveAgent();
    // The bound identity is authoritative: an agent edited after admission must
    // not silently run under the old revision's fingerprint.
    if (agent.slug !== bound.agentSlug || (agent.llmModel ?? null) !== bound.model) {
      throw new ServiceUnavailableException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'The extraction agent changed after this job was admitted; re-run the build',
      );
    }
    const adkUrl = (this.config.get<string>('indexing.apiAdk') || 'http://localhost:8001').replace(/\/$/, '');
    const apiKey = this.config.get<string>('indexing.adkApiKey') || '';
    if (!apiKey) {
      throw new ServiceUnavailableException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'ADK_API_KEY is not configured for attribute extraction',
      );
    }
    try {
      const { data } = await axios.post<AttributeExtractionResult>(
        `${adkUrl}/semantic-model/attributes/extract`,
        { ...request, model: bound.model },
        // Bounded below the runtime's 300s budget so a stalled ADK cannot pin
        // backend sockets: the runtime always receives a definite failure.
        { headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey }, timeout: ADK_TIMEOUT_MS },
      );
      if (data?.extractorVersion !== bound.contractVersion) {
        throw new ServiceUnavailableException(
          ErrorCode.SERVICE_UNAVAILABLE,
          `The extraction agent reports version '${data?.extractorVersion}', expected '${bound.contractVersion}'`,
        );
      }
      return data;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const detail = axios.isAxiosError(error)
        ? (typeof error.response?.data === 'object'
          ? JSON.stringify(error.response?.data)
          : String(error.response?.data ?? error.message))
        : error instanceof Error ? error.message : String(error);
      throw new ServiceUnavailableException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `Attribute extraction failed${status ? ` (HTTP ${status})` : ''}: ${detail}`,
      );
    }
  }
}
