import { Injectable } from '@nestjs/common';
import { BadRequestException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { DECISION_FLOW_LIMITS } from '../constants/decision-flow.constants';

@Injectable()
export class DecisionFlowOutputParserService {
  parse(output: string): unknown {
    if (!output || Buffer.byteLength(output, 'utf8') > DECISION_FLOW_LIMITS.serializedBytes) throw new BadRequestException(ErrorCode.WORKSPACE_ARTIFACT_INVALID_OUTPUT, 'The generated decision flow is empty or too large');
    const trimmed = output.trim();
    const fenced = /^```json\s*([\s\S]+?)\s*```$/i.exec(trimmed);
    const candidate = fenced ? fenced[1] : trimmed;
    try { return JSON.parse(candidate); } catch { throw new BadRequestException(ErrorCode.WORKSPACE_ARTIFACT_INVALID_OUTPUT, 'The decision-flow agent returned invalid JSON'); }
  }
}
