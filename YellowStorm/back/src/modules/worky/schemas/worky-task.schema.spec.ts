import { WorkyTaskSchema } from './worky-task.schema';

describe('WorkyTask schema', () => {
  it('has an agentKey path defaulting to null', () => {
    const path = WorkyTaskSchema.path('agentKey');
    expect(path).toBeDefined();
    expect(path.options.default).toBeNull();
  });
});
