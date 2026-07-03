import { WorkyStreamSchema } from './worky-stream.schema';
import { WorkyTaskSchema } from './worky-task.schema';

describe('worky schemas — sync fields', () => {
  it('WorkyStream has an indexed aiSessionId path', () => {
    expect(WorkyStreamSchema.path('aiSessionId')).toBeDefined();
  });
  it('WorkyTask has an externalId path', () => {
    expect(WorkyTaskSchema.path('externalId')).toBeDefined();
  });
});
