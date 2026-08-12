import { Injectable } from '@nestjs/common';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { ServiceUnavailableException } from '@modules/exceptions/exceptions/http.exceptions';
import { PlaybookFlowRuntimeClientService } from '../execution/grpc/playbook-flow-runtime-client.service';
import { toGrpcStruct } from '../execution/grpc/grpc-struct.mapper';

export interface ValidatePlanRequest {
  useCase: 'runtime-subgraph' | 'canonical-playbook' | 'task-generation';
  parentTask: Record<string, unknown>;
  resolvedPortCatalog: Record<string, unknown>;
  plan: Record<string, unknown>;
  policy: {
    maxWorkNodes: number;
    maxParallelism: number;
    maxDepth: number;
    maxRepairAttempts: number;
  };
  allowRepair?: boolean;
}

@Injectable()
export class PlaybookPlanValidationClientService {
  constructor(private readonly runtimeClient: PlaybookFlowRuntimeClientService) {}

  async validateAndRepair(request: ValidatePlanRequest): Promise<Record<string, unknown>> {
    if (!this.runtimeClient.isAvailable()) {
      throw new ServiceUnavailableException(ErrorCode.PLAYBOOK_FLOW_GRPC_UNAVAILABLE);
    }
    return this.runtimeClient.validateAndRepairPlan({
      use_case: request.useCase,
      parent_task: toGrpcStruct(request.parentTask),
      resolved_port_catalog: toGrpcStruct(request.resolvedPortCatalog),
      plan: toGrpcStruct(request.plan),
      policy: {
        max_work_nodes: request.policy.maxWorkNodes,
        max_parallelism: request.policy.maxParallelism,
        max_depth: request.policy.maxDepth,
        max_repair_attempts: request.policy.maxRepairAttempts,
      },
      allow_repair: request.allowRepair === true,
    });
  }
}
