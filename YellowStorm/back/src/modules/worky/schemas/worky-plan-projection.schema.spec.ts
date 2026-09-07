import { WorkyPlanProjectionSchema } from './worky-plan-projection.schema';
import { WorkyMessageSchema } from './worky-message.schema';

describe('WorkyPlanProjection schema', () => {
  it('has independent plan and session paths', () => {
    expect(WorkyPlanProjectionSchema.path('streamId')).toBeDefined();
    expect(WorkyPlanProjectionSchema.path('title')).toBeDefined();
    expect(WorkyPlanProjectionSchema.path('status')).toBeDefined();
    expect(WorkyPlanProjectionSchema.path('goal').options.default).toBe('');
    expect(WorkyPlanProjectionSchema.path('sessionStatus').options.default).toBeNull();
    expect(WorkyPlanProjectionSchema.path('activeInterruptId').options.default).toBeNull();
  });
});

describe('WorkyMessage schema (externalId)', () => {
  it('has an externalId path for idempotent Electric upserts', () => {
    expect(WorkyMessageSchema.path('externalId')).toBeDefined();
  });
});
