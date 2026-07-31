import { WorkyTaskSchema } from './worky-task.schema';

describe('WorkyTask schema', () => {
  it('has an assigneeKey path defaulting to null', () => {
    const path = WorkyTaskSchema.path('assigneeKey');
    expect(path).toBeDefined();
    expect(path.options.default).toBeNull();
  });
});
