import type { RouterConfig } from '../../types';

export function cloneRouterConfig(routerConfig?: RouterConfig | null): RouterConfig {
  return {
    outputLabels: [...(routerConfig?.outputLabels ?? ['retry', 'done', '__error__'])],
    maxIterations: routerConfig?.maxIterations ?? 3,
    defaultLabel: routerConfig?.defaultLabel,
    conditions: routerConfig?.conditions?.map((condition) => ({ ...condition })),
    mode: routerConfig?.mode,
    prompt: routerConfig?.prompt,
  };
}

export function buildRouterOutputPorts(routerConfig: RouterConfig): Array<{ id: string; name: string; artifactKind: 'text' }> {
  return routerConfig.outputLabels.map((label) => ({ id: label, name: label, artifactKind: 'text' }));
}
