import { Types } from 'mongoose';
import { PgToolStore, PgToolCategoryStore } from './pg-tool.store';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';

describeIntegration('PgToolStore + PgToolCategoryStore (integration)', () => {
  const oid = (): string => new Types.ObjectId().toString();
  const { db, close } = makeTestDb();
  const tools = new PgToolStore(db as never);
  const categories = new PgToolCategoryStore(db as never);
  const created: string[] = [];
  const createdCategories: string[] = [];

  afterAll(async () => {
    if (created.length) await db.execute(`DELETE FROM catalog.tools WHERE id IN (${created.map((id) => `'${id}'`).join(',')})`);
    if (createdCategories.length) await db.execute(`DELETE FROM catalog.tool_categories WHERE id IN (${createdCategories.map((id) => `'${id}'`).join(',')})`);
    await close();
  });

  it('round-trips a tool with attributes and default agent types', async () => {
    const categoryId = oid();
    await db.execute(`INSERT INTO catalog.tool_categories (id, name, description) VALUES ('${categoryId}', 'spec-cat-${categoryId.slice(-6)}', '')`);
    createdCategories.push(categoryId);

    const created1 = await tools.insert({
      name: `spec-tool-${oid().slice(-6)}`,
      description: 'spec tool',
      icon: 'FaBolt',
      color: '#112233',
      iconColor: 'dark',
      categoryId,
      defaultAgentTypes: ['mono-agent'],
      attributes: [{ name: 'mode', type: 'string', value: 'fast', options: undefined }],
      requiredAppKey: null,
      isActive: true,
    });
    created.push(created1.id);

    const fetched = await tools.findById(created1.id);
    expect(fetched!.name).toBe(created1.name);
    expect(fetched!.categoryId).toBe(categoryId);
    expect(fetched!.attributes[0].name).toBe('mode');

    const found = await tools.findByAgentType('mono-agent');
    expect(found.map((t) => t.id)).toContain(created1.id);

    const updated = await tools.update(created1.id, { description: 'spec tool v2', isActive: false });
    expect(updated!.description).toBe('spec tool v2');
    expect(updated!.isActive).toBe(false);

    const removed = await tools.delete(created1.id);
    expect(removed!.id).toBe(created1.id);
    expect(await tools.findById(created1.id)).toBeNull();
  });

  it('categories CRUD with unique names', async () => {
    const created1 = await categories.insert({ name: `spec-tcat-${oid().slice(-6)}`, description: 'd' });
    createdCategories.push(created1.id);
    expect((await categories.findById(created1.id))!.name).toBe(created1.name);
    const updated = await categories.update(created1.id, { description: 'd2' });
    expect(updated!.description).toBe('d2');
    expect(await categories.delete(created1.id)).toBe(true);
    expect(await categories.findById(created1.id)).toBeNull();
  });
});
