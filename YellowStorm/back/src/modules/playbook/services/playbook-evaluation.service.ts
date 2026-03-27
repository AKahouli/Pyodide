import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../logger';
import { PlaybookGrpcService } from './playbook-grpc.service';

interface SemanticEvaluationRequest {
  userId?: string;
  baselineOutput: string;
  currentOutput: string;
  taskTitle?: string;
  taskDescription?: string;
  baselineToolSummaries?: string[];
  currentToolSummaries?: string[];
}

interface SemanticEvaluationResult {
  matchScore: number;
  semanticSimilarityScore: number;
  evidenceConsistencyScore: number;
  judgeScore: number;
  reason: string;
  missingPoints: string[];
  changedPoints: string[];
  model: string;
  judgeUsed: boolean;
}

@Injectable()
export class PlaybookEvaluationService {
  constructor(
    private readonly playbookGrpcService: PlaybookGrpcService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('PlaybookEvaluationService');
  }

  isConfigured(): boolean {
    return this.playbookGrpcService.isAvailable;
  }

  async evaluateSemanticMatch(
    request: SemanticEvaluationRequest,
  ): Promise<SemanticEvaluationResult | null> {
    if (!request.baselineOutput?.trim() || !request.currentOutput?.trim()) {
      return null;
    }

    if (!this.isConfigured()) {
      this.logger.warn('Skipping semantic evaluation: ADK gRPC service is not available');
      return null;
    }

    const response = await this.playbookGrpcService.evaluateSemanticMatch({
      user_context: {
        user_id: request.userId || 'playbook-evaluation',
        username: request.userId || 'playbook-evaluation',
      },
      baseline_output: request.baselineOutput,
      current_output: request.currentOutput,
      task_title: request.taskTitle || '',
      task_description: request.taskDescription || '',
      baseline_tool_summaries: request.baselineToolSummaries || [],
      current_tool_summaries: request.currentToolSummaries || [],
    });

    if (!response?.has_match || !response.semantic_match) {
      return null;
    }

    const data = response.semantic_match as {
      match_score?: number;
      semantic_similarity_score?: number;
      evidence_consistency_score?: number;
      judge_score?: number;
      reason?: string;
      missing_points?: string[];
      changed_points?: string[];
      model?: string;
      judge_used?: boolean;
    };

    return {
      matchScore: Number(data.match_score ?? 0),
      semanticSimilarityScore: Number(data.semantic_similarity_score ?? 0),
      evidenceConsistencyScore: Number(data.evidence_consistency_score ?? data.semantic_similarity_score ?? 0),
      judgeScore: Number(data.judge_score ?? 0),
      reason: String(data.reason || ''),
      missingPoints: Array.isArray(data.missing_points) ? data.missing_points.map(String) : [],
      changedPoints: Array.isArray(data.changed_points) ? data.changed_points.map(String) : [],
      model: String(data.model || ''),
      judgeUsed: Boolean(data.judge_used),
    };
  }
}
