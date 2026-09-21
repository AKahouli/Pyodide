import { Types } from 'mongoose';
import { PgSkillStore, PgSkillCategoryStore } from './pg-skill.store';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';

describeIntegration('PgSkillStore + PgSkillCategoryStore (integration)', () => {
  const oid = (): string => new Types.ObjectId().toString();
  const { db, close } = makeTestDb();
  const skills = new PgSkillStore(db as never);
  const categories = new PgSkillCategoryStore(db as never);
  const owner = oid();
  const createdSkills: string[] = [];
  const createdCategories: string[] = [];

  afterAll(async () => {
    if (createdSkills.length) await db.execute(`DELETE FROM catalog.skills WHERE id IN (${createdSkills.map((id) => `'${id}'`).join(',')})`);
    if (createdCategories.length) await db.execute(`DELETE FROM catalog.skill_categories WHERE id IN (${createdCategories.map((id) => `'${id}'`).join(',')})`);
    await close();
  });

  const newSkill = (name: string) => ({
    slug: name,
    name,
    description: 'spec skill',
    icon: '',
    color: '',
    iconColor: 'light',
    categoryId: null as string | null,
    license: '',
    compatibility: '',
    metadata: {},
    allowedTools: [],
    instructions: 'do it',
    files: [{ path: 'references/r.md', kind: 'reference', mimeType: 'text/markdown', content: 'R' }],
    isActive: true,
    createdBy: owner,
  });

  it('insert with files, detail read includes content, list read does not', async () => {
    const created1 = await skills.insert(newSkill(`spec-skill-${oid().slice(-6)}`));
    createdSkills.push(created1.id);

    const detail = await skills.findById(created1.id);
    expect(detail!.files).toHaveLength(1);
    expect(detail!.files[0].content).toBe('R');

    const listed = await skills.list({ page: 1, limit: 100 });
    const row = listed.rows.find((r) => r.id === created1.id);
    expect(row).toBeDefined();
    expect(row!.files).toEqual([]);

    const deleted = await skills.delete(created1.id);
    expect(deleted!.id).toBe(created1.id);
    createdSkills.pop();
    expect(await skills.findById(created1.id)).toBeNull();
  });

  it('replaceSkills-on-update swaps file rows wholesale', async () => {
    const created1 = await skills.insert(newSkill(`spec-skill-${oid().slice(-6)}`));
    createdSkills.push(created1.id);

    const updated = await skills.update(created1.id, {
      files: [{ path: 'assets/a.md', kind: 'asset', mimeType: 'text/markdown', content: 'A' }],
    });
    expect(updated!.files).toHaveLength(1);
    expect(updated!.files[0].path).toBe('assets/a.md');
  });

  it('ensureSystem flips is_system idempotently', async () => {
    const name = `spec-scat-${oid().slice(-6)}`;
    await categories.insert({ name, description: 'plain' });
    await categories.ensureSystem({ name, description: 'system now' });
    const row = await categories.findByNameInsensitive(name);
    expect(row!.isSystem).toBe(true);
    createdCategories.push(row!.id);
  });
});
