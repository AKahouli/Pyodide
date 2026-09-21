/**
 * Step 1B.4.9 backfill — Mongo → Postgres catalog, in dependency order:
 *   tool_categories → tools → skill_categories → skills (+skill_files)
 *   → agent_types (+agent_type_skills from skills[]) → agent_type_prompts
 * Unknown categoryId → NULL + report; unknown skill id in agent_types.skills
 * → dropped + report. Idempotent: ON CONFLICT (id) DO NOTHING.
 * Missing skill slugs are applied here (slug = name) — the onModuleInit
 * backfill was removed (plan 1B.4.2).
 *
 * Usage: npx ts-node back/scripts/migrate/2026-10-catalog.ts [--dry-run]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { runBackfill, type MongoDoc } from './harness';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v == null ? null : String(v));
const dateOf = (v: unknown): Date => (v ? new Date(String(v)) : new Date());
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

interface Report {
  toolsMissingCategory: string[];
  skillsMissingCategory: string[];
  droppedAgentTypeSkills: Array<{ agentType: string; skill: string }>;
}

const report: Report = { toolsMissingCategory: [], skillsMissingCategory: [], droppedAgentTypeSkills: [] };

async function main(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI);
  const mdb = mongoose.connection.db!;

  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 5,
  });

  // Pre-index existing PG category ids for the null-out reports.
  const pgToolCategoryIds = new Set(
    (await pool.query('SELECT id FROM catalog.tool_categories')).rows.map((r) => r.id),
  );
  const pgSkillCategoryIds = new Set(
    (await pool.query('SELECT id FROM catalog.skill_categories')).rows.map((r) => r.id),
  );
  const pgSkillIds = new Set(
    (await pool.query('SELECT id FROM catalog.skills')).rows.map((r) => r.id),
  );

  // ── tool_categories ─────────────────────────────────────────────────
  await runBackfill({
    collection: mdb.collection('tool_categories'),
    build: (doc: MongoDoc): Row => ({
      id: String(doc._id),
      name: String(doc.name),
      description: String(doc.description ?? ''),
      created_at: dateOf(doc.createdAt),
      updated_at: dateOf(doc.updatedAt),
    }),
    unitId: (unit) => String(unit.id),
    exists: async (id) => (await pool.query('SELECT 1 FROM catalog.tool_categories WHERE id = $1', [String(id)])).rowCount! > 0,
    insert: async (unit) => {
      await pool.query(
        `INSERT INTO catalog.tool_categories (id, name, description, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
        [unit.id, unit.name, unit.description, unit.created_at, unit.updated_at],
      );
    },
    verify: async (units) => {
      const map = new Map<string, string>();
      for (const unit of units) {
        const r = await pool.query('SELECT name FROM catalog.tool_categories WHERE id = $1', [String(unit.id)]);
        if (r.rowCount === 0) map.set(String(unit.id), 'missing in PG');
        else if (r.rows[0].name !== unit.name) map.set(String(unit.id), 'name mismatch');
      }
      return map;
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM catalog.tool_categories')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT id FROM catalog.tool_categories')).rows.map((r) => r.id),
  });

  // ── tools ───────────────────────────────────────────────────────────
  await runBackfill({
    collection: mdb.collection('tools'),
    build: (doc: MongoDoc): Row => {
      const categoryId = s(doc.categoryId);
      if (categoryId && !pgToolCategoryIds.has(categoryId)) {
        report.toolsMissingCategory.push(String(doc._id));
        doc.categoryId = null;
      }
      const attributes = Array.isArray(doc.attributes)
        ? doc.attributes.map((attr: Record<string, unknown>) => ({
            id: String(attr._id ?? new mongoose.Types.ObjectId()),
            name: String(attr.name),
            type: String(attr.type),
            value: attr.value,
            options: Array.isArray(attr.options) ? attr.options.map(String) : undefined,
          }))
        : [];
      return {
        id: String(doc._id),
        name: String(doc.name),
        description: String(doc.description ?? ''),
        icon: String(doc.icon ?? ''),
        color: String(doc.color ?? ''),
        icon_color: String(doc.iconColor ?? 'light'),
        category_id: s(doc.categoryId),
        default_agent_types: arr(doc.defaultAgentTypes),
        attributes: JSON.stringify(attributes),
        required_app_key: s(doc.requiredAppKey),
        is_active: doc.isActive !== false,
        created_at: dateOf(doc.createdAt),
        updated_at: dateOf(doc.updatedAt),
      };
    },
    unitId: (unit) => String(unit.id),
    exists: async (id) => (await pool.query('SELECT 1 FROM catalog.tools WHERE id = $1', [String(id)])).rowCount! > 0,
    insert: async (unit) => {
      await pool.query(
        `INSERT INTO catalog.tools (id, name, description, icon, color, icon_color, category_id, default_agent_types,
          attributes, required_app_key, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
        [unit.id, unit.name, unit.description, unit.icon, unit.color, unit.icon_color, unit.category_id,
         unit.default_agent_types, unit.attributes, unit.required_app_key, unit.is_active, unit.created_at, unit.updated_at],
      );
    },
    verify: async (units) => {
      const map = new Map<string, string>();
      for (const unit of units) {
        const r = await pool.query('SELECT name, is_active FROM catalog.tools WHERE id = $1', [String(unit.id)]);
        if (r.rowCount === 0) map.set(String(unit.id), 'missing in PG');
        else if (r.rows[0].name !== unit.name || r.rows[0].is_active !== unit.is_active) map.set(String(unit.id), 'field mismatch');
      }
      return map;
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM catalog.tools')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT id FROM catalog.tools')).rows.map((r) => r.id),
  });

  // ── skill_categories ────────────────────────────────────────────────
  await runBackfill({
    collection: mdb.collection('skill_categories'),
    build: (doc: MongoDoc): Row => ({
      id: String(doc._id),
      name: String(doc.name),
      description: String(doc.description ?? ''),
      is_system: doc.isSystem === true,
      created_at: dateOf(doc.createdAt),
      updated_at: dateOf(doc.updatedAt),
    }),
    unitId: (unit) => String(unit.id),
    exists: async (id) => (await pool.query('SELECT 1 FROM catalog.skill_categories WHERE id = $1', [String(id)])).rowCount! > 0,
    insert: async (unit) => {
      await pool.query(
        `INSERT INTO catalog.skill_categories (id, name, description, is_system, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
        [unit.id, unit.name, unit.description, unit.is_system, unit.created_at, unit.updated_at],
      );
    },
    verify: async (units) => {
      const map = new Map<string, string>();
      for (const unit of units) {
        const r = await pool.query('SELECT name, is_system FROM catalog.skill_categories WHERE id = $1', [String(unit.id)]);
        if (r.rowCount === 0) map.set(String(unit.id), 'missing in PG');
        else if (r.rows[0].name !== unit.name || r.rows[0].is_system !== unit.is_system) map.set(String(unit.id), 'field mismatch');
      }
      return map;
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM catalog.skill_categories')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT id FROM catalog.skill_categories')).rows.map((r) => r.id),
  });

  // ── skills (+files) ─────────────────────────────────────────────────
  await runBackfill({
    collection: mdb.collection('skills'),
    build: (doc: MongoDoc): Row => {
      const categoryId = s(doc.categoryId);
      if (categoryId && !pgSkillCategoryIds.has(categoryId)) {
        report.skillsMissingCategory.push(String(doc._id));
        doc.categoryId = null;
      }
      const slug = s(doc.slug) || String(doc.name);
      const files = Array.isArray(doc.files) ? doc.files : [];
      return {
        id: String(doc._id),
        slug: slug.slice(0, 64),
        name: String(doc.name),
        description: String(doc.description ?? ''),
        icon: String(doc.icon ?? ''),
        color: String(doc.color ?? ''),
        icon_color: String(doc.iconColor ?? 'light'),
        category_id: s(doc.categoryId),
        license: s(doc.license),
        compatibility: s(doc.compatibility),
        metadata: JSON.stringify((doc.metadata as Record<string, unknown>) ?? {}),
        allowed_tools: arr(doc.allowedTools),
        instructions: s(doc.instructions),
        is_active: doc.isActive !== false,
        created_by: String(doc.createdBy ?? '000000000000000000000000'),
        created_at: dateOf(doc.createdAt),
        updated_at: dateOf(doc.updatedAt),
        files: JSON.stringify(files.map((file: Record<string, unknown>, position: number) => {
          // Legacy docs stored folder names ('assets'/'references'/'scripts');
          // current code writes only reference|asset - normalize to that.
          const rawKind = String(file.kind ?? '');
          const kind = rawKind === 'reference' || rawKind === 'references' || String(file.path ?? '').startsWith('references/')
            ? 'reference'
            : 'asset';
          return {
            id: String(file._id ?? new mongoose.Types.ObjectId()),
            path: String(file.path ?? ''),
            kind,
            mime_type: s(file.mimeType),
            content: String(file.content ?? ''),
            position,
          };
        })),
      };
    },
    unitId: (unit) => String(unit.id),
    exists: async (id) => (await pool.query('SELECT 1 FROM catalog.skills WHERE id = $1', [String(id)])).rowCount! > 0,
    insert: async (unit) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO catalog.skills (id, slug, name, description, icon, color, icon_color, category_id, license,
            compatibility, metadata, allowed_tools, instructions, is_active, created_by, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17) ON CONFLICT (id) DO NOTHING`,
          [unit.id, unit.slug, unit.name, unit.description, unit.icon, unit.color, unit.icon_color, unit.category_id,
           unit.license, unit.compatibility, unit.metadata, unit.allowed_tools, unit.instructions, unit.is_active,
           unit.created_by, unit.created_at, unit.updated_at],
        );
        const files = JSON.parse(unit.files as string) as Array<Record<string, unknown>>;
        for (const file of files) {
          await client.query(
            `INSERT INTO catalog.skill_files (id, skill_id, path, kind, mime_type, content, position)
             VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
            [String(file.id), unit.id, String(file.path), String(file.kind), file.mime_type, String(file.content), Number(file.position)],
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    verify: async (units) => {
      const map = new Map<string, string>();
      for (const unit of units) {
        const r = await pool.query(
          `SELECT s.name, (SELECT count(*)::int FROM catalog.skill_files f WHERE f.skill_id = s.id) AS file_count
           FROM catalog.skills s WHERE s.id = $1`,
          [String(unit.id)],
        );
        if (r.rowCount === 0) map.set(String(unit.id), 'missing in PG');
        else if (r.rows[0].name !== unit.name) map.set(String(unit.id), 'name mismatch');
      }
      return map;
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM catalog.skills')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT id FROM catalog.skills')).rows.map((r) => r.id),
  });

  // Refresh known skill ids after the skills backfill.
  for (const row of (await pool.query('SELECT id FROM catalog.skills')).rows) pgSkillIds.add(row.id);

  // ── agent_types (+ junction) ────────────────────────────────────────
  await runBackfill({
    collection: mdb.collection('agent_types'),
    build: (doc: MongoDoc): Row => {
      const skills = arr(doc.skills);
      const dropped = skills.filter((id) => !pgSkillIds.has(id));
      for (const skill of dropped) report.droppedAgentTypeSkills.push({ agentType: String(doc._id), skill });
      return {
        id: String(doc._id),
        name: String(doc.name),
        slug: String(doc.slug ?? String(doc.name).toLowerCase().replace(/\s+/g, '_')),
        default_prompt: s(doc.defaultPrompt) ?? '',
        is_active: doc.isActive !== false,
        created_at: dateOf(doc.createdAt),
        updated_at: dateOf(doc.updatedAt),
        skills: JSON.stringify(skills.filter((id) => pgSkillIds.has(id))),
      };
    },
    unitId: (unit) => String(unit.id),
    exists: async (id) => (await pool.query('SELECT 1 FROM catalog.agent_types WHERE id = $1', [String(id)])).rowCount! > 0,
    insert: async (unit) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO catalog.agent_types (id, name, slug, default_prompt, is_active, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
          [unit.id, unit.name, unit.slug, unit.default_prompt, unit.is_active, unit.created_at, unit.updated_at],
        );
        const skills = JSON.parse(unit.skills as string) as string[];
        for (const [position, skillId] of skills.entries()) {
          await client.query(
            `INSERT INTO catalog.agent_type_skills (agent_type_id, skill_id, position)
             VALUES ($1,$2,$3) ON CONFLICT (agent_type_id, skill_id) DO NOTHING`,
            [unit.id, skillId, position],
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    verify: async (units) => {
      const map = new Map<string, string>();
      for (const unit of units) {
        const r = await pool.query('SELECT name FROM catalog.agent_types WHERE id = $1', [String(unit.id)]);
        if (r.rowCount === 0) map.set(String(unit.id), 'missing in PG');
        else if (r.rows[0].name !== unit.name) map.set(String(unit.id), 'name mismatch');
      }
      return map;
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM catalog.agent_types')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT id FROM catalog.agent_types')).rows.map((r) => r.id),
  });

  // ── agent_type_prompts ──────────────────────────────────────────────
  await runBackfill({
    collection: mdb.collection('agent_type_prompts'),
    build: (doc: MongoDoc): Row => ({
      id: String(doc._id),
      agent_type_id: String(doc.agentType),
      model_id: String(doc.modelId),
      prompt: String(doc.prompt ?? ''),
      created_at: dateOf(doc.createdAt),
      updated_at: dateOf(doc.updatedAt),
    }),
    unitId: (unit) => String(unit.id),
    exists: async (id) => (await pool.query('SELECT 1 FROM catalog.agent_type_prompts WHERE id = $1', [String(id)])).rowCount! > 0,
    insert: async (unit) => {
      await pool.query(
        `INSERT INTO catalog.agent_type_prompts (id, agent_type_id, model_id, prompt, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (agent_type_id, model_id) DO NOTHING`,
        [unit.id, unit.agent_type_id, unit.model_id, unit.prompt, unit.created_at, unit.updated_at],
      );
    },
    verify: async (units) => {
      const map = new Map<string, string>();
      for (const unit of units) {
        const r = await pool.query('SELECT prompt FROM catalog.agent_type_prompts WHERE id = $1', [String(unit.id)]);
        if (r.rowCount === 0) map.set(String(unit.id), 'missing in PG');
        else if (r.rows[0].prompt !== unit.prompt) map.set(String(unit.id), 'prompt mismatch');
      }
      return map;
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM catalog.agent_type_prompts')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT id FROM catalog.agent_type_prompts')).rows.map((r) => r.id),
  });

  console.log('=== backfill report ===');
  console.log(JSON.stringify(report, null, 2));

  await pool.end();
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
