/**
 * Sequential validation steps for template ZIP preview (NodePod today; more later).
 */
export type ValidationStepStatus = 'pending' | 'running' | 'confirmed' | 'failed';

export interface ValidationStepContext {
  signal: AbortSignal;
  setSessionId: (sessionId: string | null) => void;
  setStagingTemplateId: (stagingTemplateId: string | null) => void;
}

export interface ValidationStep {
  id: string;
  labelKey: string;
  run: (ctx: ValidationStepContext) => Promise<void>;
}

export interface StepProgress {
  id: string;
  labelKey: string;
  status: ValidationStepStatus;
  error?: string;
}

export async function runValidationPipeline(
  steps: ValidationStep[],
  ctx: ValidationStepContext,
  onProgress: (steps: StepProgress[]) => void,
): Promise<void> {
  const state: StepProgress[] = steps.map((s) => ({
    id: s.id,
    labelKey: s.labelKey,
    status: 'pending',
  }));
  onProgress([...state]);

  for (let i = 0; i < steps.length; i += 1) {
    if (ctx.signal.aborted) return;
    state[i] = { ...state[i], status: 'running' };
    onProgress([...state]);
    try {
      await steps[i].run(ctx);
      if (ctx.signal.aborted) return;
      state[i] = { ...state[i], status: 'confirmed' };
      onProgress([...state]);
    } catch (error) {
      state[i] = {
        ...state[i],
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
      onProgress([...state]);
      throw error;
    }
  }
}
