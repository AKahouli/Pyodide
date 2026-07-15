import { WorkyPlanProjectionSchema } from './worky-plan-projection.schema';
import { WorkyMessageSchema } from './worky-message.schema';

describe('WorkyPlanProjection schema', () => {
  it('has streamId/title/status paths', () => {
    expect(WorkyPlanProjectionSchema.path('streamId')).toBeDefined();
    expect(WorkyPlanProjectionSchema.path('title')).toBeDefined();
    expect(WorkyPlanProjectionSchema.path('status')).toBeDefined();
  });
});

describe('WorkyMessage schema (externalId)', () => {
  it('has an externalId path for idempotent Electric upserts', () => {
    expect(WorkyMessageSchema.path('externalId')).toBeDefined();
  });
});
