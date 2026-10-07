import type { RootContinuationRequest } from '../interfaces/message.interface';
import type { RootNativeState } from './root-work.types';
import { BadRequestException, ErrorCode } from '../../exceptions';
import { decodeNativeInputResponse, matchesNativeInputSchema } from './native-input-schema';

export function validateNativeInputResponses(pendingInputs: RootNativeState['pendingInputs'], inputResponses: RootContinuationRequest['inputResponses']) {
    const seen = new Set<string>();
    if (!inputResponses?.length || inputResponses.length > 64
      || Buffer.byteLength(JSON.stringify(inputResponses)) > 65536) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid native input responses');
    }
    for (const input of inputResponses) {
      if (seen.has(input.inputId) || !pendingInputs.some((pending) => pending.inputId === input.inputId)
        || !input.response || typeof input.response !== 'object' || Array.isArray(input.response)) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Response does not match a pending native input');
      }
      seen.add(input.inputId);
      const pending = pendingInputs.find((entry) => entry.inputId === input.inputId)!;
      if (pending.responseSchemaUnsupported || pending.functionName === 'adk_request_input'
        && !pending.responseSchema && pending.responseSchemaAbsent !== true) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'This native input format is not supported');
      }
      if ((input.inputVersion ?? 1) !== (pending.inputVersion ?? 1)) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Response refers to a stale native input request');
      }
      if (pending.functionName === 'adk_request_confirmation'
        && (typeof input.response.confirmed !== 'boolean' || Object.keys(input.response).length !== 1)) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid native confirmation');
      }
      if (pending.responseSchema && !matchesNativeInputSchema(decodeNativeInputResponse(input.response), pending.responseSchema)) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Response does not match the requested input format');
      }
    }
}
