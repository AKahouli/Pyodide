import { BadRequestException, ErrorCode } from '../../exceptions';
import { sanitizeNativeInputSchema } from './native-input-schema';
import type { RootNativeState } from './root-work.types';

export function parseNativePendingInputs(rawValue: unknown): RootNativeState['pendingInputs'] {
    const rawInputs = rawValue ?? [];
    if (!Array.isArray(rawInputs) || rawInputs.length > 64) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid native pending inputs');
    }
    const seen = new Set<string>();
    const pendingInputs = rawInputs.map((input) => {
      if (!input || typeof input.input_id !== 'string' || !input.input_id || seen.has(input.input_id)
        || !['adk_request_input', 'adk_request_confirmation'].includes(input.function_name)) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid native pending input identity');
      }
      seen.add(input.input_id);
      if (input.input_version !== undefined && input.input_version !== 0
        && (!Number.isSafeInteger(input.input_version) || Number(input.input_version) < 1 || Number(input.input_version) > 1000000)) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid native input version');
      }
      let responseSchema = null;
      let responseSchemaUnsupported = input.response_schema_unsupported === true;
      if (input.function_name === 'adk_request_input' && input.response_schema_json) {
        if (typeof input.response_schema_json !== 'string' || Buffer.byteLength(input.response_schema_json) > 8192) {
          responseSchemaUnsupported = true;
        } else {
          try { responseSchema = sanitizeNativeInputSchema(JSON.parse(input.response_schema_json)); }
          catch { responseSchemaUnsupported = true; }
          if (!responseSchema) responseSchemaUnsupported = true;
        }
        if (input.response_schema_absent === true) responseSchemaUnsupported = true;
      } else if (input.function_name === 'adk_request_input' && input.response_schema_absent !== true) {
        // Missing fields from an old/unqualified sender do not establish that
        // the native request had no schema. Never downgrade unknown to Any.
        responseSchemaUnsupported = true;
      }
      return { inputId: input.input_id, functionName: input.function_name,
        ...(Number.isSafeInteger(input.input_version) && Number(input.input_version) > 0
          ? { inputVersion: Number(input.input_version) } : {}),
        ...(input.function_name === 'adk_request_input' && typeof input.message === 'string'
          ? { message: input.message.slice(0, 2000) } : {}),
        ...(responseSchema ? { responseSchema } : {}),
        ...(input.function_name === 'adk_request_input' && input.response_schema_absent === true && !input.response_schema_json
          ? { responseSchemaAbsent: true } : {}),
        ...(input.function_name === 'adk_request_input' && responseSchemaUnsupported ? { responseSchemaUnsupported: true } : {}),
      };
    });
  return pendingInputs;
}
