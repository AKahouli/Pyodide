/** Browser console tracer for the App Builder Publish/Deploy path. */
const LOG = '[c2-deploy]';

export function deployLog(phase: string, details?: Record<string, unknown>): void {
  if (details) {
    console.log(`${LOG} [${phase}]`, details);
  } else {
    console.log(`${LOG} [${phase}]`);
  }
}

export function deployWarn(phase: string, details?: Record<string, unknown>): void {
  if (details) {
    console.warn(`${LOG} [${phase}]`, details);
  } else {
    console.warn(`${LOG} [${phase}]`);
  }
}

export function deployError(phase: string, err: unknown, details?: Record<string, unknown>): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`${LOG} [${phase}]`, { ...details, message, err });
}
