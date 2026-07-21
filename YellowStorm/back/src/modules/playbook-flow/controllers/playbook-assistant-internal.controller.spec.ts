import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { PlaybookAssistantInternalController } from './playbook-assistant-internal.controller';

describe('PlaybookAssistantInternalController', () => {
  it('reads the canonical trusted identity header on every internal endpoint', () => {
    const methods = [
      'openContext',
      'getSummary',
      'getTask',
      'getTaskDependencies',
      'validate',
      'startConstruction',
      'getConstruction',
      'streamConstruction',
      'cancelConstruction',
      'analyzeTaskOptimization',
      'startAdvisorRemediationConstruction',
    ] as const;

    for (const method of methods) {
      const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, PlaybookAssistantInternalController, method) as Record<string, { data?: string }>;

      expect(Object.values(metadata).some((parameter) => parameter.data === 'x-yellowstorm-user-id')).toBe(true);
    }
  });
});
