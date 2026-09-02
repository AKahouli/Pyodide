import { WorkyTaskSchema } from './worky-task.schema';

describe('WorkyTask schema', () => {
  it('has an assigneeKey path defaulting to null', () => {
    const path = WorkyTaskSchema.path('assigneeKey');
    expect(path).toBeDefined();
    expect(path.options.default).toBeNull();
  });

  it('uses legacy-safe semantic field defaults without constraining kind', () => {
    expect(WorkyTaskSchema.path('kind').options.default).toBe('execute');
    expect(WorkyTaskSchema.path('kind').options.enum).toBeUndefined();
    expect(WorkyTaskSchema.path('question').options.default).toBeNull();
    expect(WorkyTaskSchema.path('interruptId').options.default).toBeNull();
    expect(WorkyTaskSchema.path('isPersona').options.default).toBe(false);
    expect(WorkyTaskSchema.path('isDynamicDelegate').options.default).toBe(false);
  });
});
