import type { RouterConfig } from '../../types';

export function cloneRouterConfig(routerConfig?: RouterConfig | null): RouterConfig {
  return {
    outputLabels: [...(routerConfig?.outputLabels ?? ['retry', 'done', '__error__'])],
    maxIterations: routerConfig?.maxIterations ?? 3,
    defaultLabel: routerConfig?.defaultLabel,
    conditions: routerConfig?.conditions?.map((condition) => ({ ...condition })),
  };
}
