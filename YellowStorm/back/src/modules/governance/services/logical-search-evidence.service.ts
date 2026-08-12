import { BadRequestException, Injectable } from '@nestjs/common';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { ConnectorMcpRuntimeService } from '@modules/connector/services/connector-mcp-runtime.service';
import type { ValidityEvidence } from '../domain/document-validity';

const SEARCH_TOOLS = ['search_relevant_documents', 'search'] as const;
const MAX_RESULTS = 20;

@Injectable()
export class LogicalSearchEvidenceService {
  constructor(private readonly runtime: ConnectorMcpRuntimeService) {}

  async search(input: { connectorId: string; workspaceId: string; authorizationUserId: string; documentId: string; fileName: string }): Promise<ValidityEvidence[]> {
    const { connectorId } = input;
    const queries = ['effective start date publication date', 'expiry deadline valid until review duration'];
    const evidence: ValidityEvidence[] = [];
    for (const query of queries) {
      const response = await this.callSearch(connectorId, query, input.workspaceId, input.authorizationUserId);
      for (const row of this.collectObjects(response.value).slice(0, MAX_RESULTS)) {
        const fileName = this.readString(row, ['file_name', 'fileName', 'filename', 'name']);
        if (!fileName || fileName.trim().toLocaleLowerCase() !== input.fileName.trim().toLocaleLowerCase()) continue;
        const excerpt = this.readString(row, ['excerpt', 'text', 'content', 'snippet', 'chunk_text']);
        if (!excerpt) continue;
        const page = this.readNumber(row, ['page', 'page_number', 'pageNumber']);
        const sectionId = this.readString(row, ['section_id', 'sectionId']);
        const blockId = this.readString(row, ['block_id', 'blockId', 'chunk_id', 'chunkId']);
        evidence.push({ id: `${input.documentId}:${sectionId ?? blockId ?? page ?? evidence.length}`, field: 'effectiveFrom', origin: 'logical_search', documentId: input.documentId, page, sectionId, blockId, excerpt: excerpt.slice(0, 4000), confidence: Math.min(0.85, this.readNumber(row, ['score', 'similarity', 'confidence']) ?? 0.65), extractionMethod: 'connector-mcp-search-v1', capturedAt: new Date() });
      }
    }
    return Array.from(new Map(evidence.map((item) => [item.id, item])).values());
  }

  private async callSearch(connectorId: string, query: string, workspaceId: string, authorizationUserId: string) {
    try {
      return await this.runtime.callTool({ connectorId, workspaceId, authorizationUserId, toolName: 'search_relevant_documents', allowedTools: SEARCH_TOOLS, arguments: { query, workspace_id: workspaceId, top_k: 10 }, authoritativeHeaders: { 'Workspace-Id': workspaceId, 'X-Deep-Search': 'true', 'X-mistral': 'false' } });
    } catch (error) {
      if (!(error instanceof BadRequestException) || !String(error.message).includes('does not expose')) throw error;
      return this.runtime.callTool({ connectorId, workspaceId, authorizationUserId, toolName: 'search', allowedTools: SEARCH_TOOLS, arguments: { query, workspace_id: workspaceId }, authoritativeHeaders: { 'Workspace-Id': workspaceId, 'X-Deep-Search': 'true', 'X-mistral': 'false' } });
    }
  }

  private collectObjects(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) return value.flatMap((item) => this.collectObjects(item));
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    const nestedKeys = ['results', 'documents', 'items', 'data', 'matches', 'content'];
    const nested = nestedKeys.flatMap((key) => key in record ? this.collectObjects(record[key]) : []);
    return nested.length > 0 ? nested : [record];
  }
  private readString(record: Record<string, unknown>, keys: string[]): string | undefined { for (const key of keys) if (typeof record[key] === 'string' && record[key]) return record[key] as string; return undefined; }
  private readNumber(record: Record<string, unknown>, keys: string[]): number | undefined { for (const key of keys) if (typeof record[key] === 'number' && Number.isFinite(record[key])) return record[key] as number; return undefined; }
}
