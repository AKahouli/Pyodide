import { WorkyElectricCursorSchema } from './worky-electric-cursor.schema';

describe('WorkyElectricCursor schema', () => {
  it('has a unique shape path plus handle/offset', () => {
    expect(WorkyElectricCursorSchema.path('shape')).toBeDefined();
    expect(WorkyElectricCursorSchema.path('handle')).toBeDefined();
    expect(WorkyElectricCursorSchema.path('offset')).toBeDefined();
  });
});
