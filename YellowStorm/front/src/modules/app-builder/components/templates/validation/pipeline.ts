/**
 * Template validation pipeline. A template is only published to users once
 * every step confirms. Today there is a single step (NodePod execution), but
 * the pipeline is sequential and data-driven so later steps (build, a11y,
 * lint, …) can be appended without touching the orchestration or the UI.
 */
export type ValidationStepStatus = 'pending' | 'running' | 'confirmed' | 'failed';

export interface ValidationStepContext {
  templateId: string;
  /** Aborts an in-flight run (dialog closed / retry). */
  signal: AbortSignal;
  /** Publishes the transient session id so the UI can bind the preview iframe. */
  setSessionId: (sessionId: string | null) => void;
}

export interface ValidationStep {
  id: string;
  /** i18n key for the step label. */
  labelKey: string;
  run: (ctx: ValidationStepContext) => Promise<void>;
}

export interface StepProgress {
  id: string;
  labelKey: string;
  status: ValidationStepStatus;
  error?: string;
}

/** Runs steps in order, reporting progress; rejects on the first failure. */
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
