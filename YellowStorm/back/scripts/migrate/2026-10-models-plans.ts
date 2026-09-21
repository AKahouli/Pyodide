/**
 * Step 1B.3.5 backfill — Mongo → Postgres:
 *   ai_models → catalog.ai_models (ids preserved; users and flows reference model ids)
 *   plans     → catalog.plans     (ids preserved; identity.users.plan_id references them)
 * Idempotent: ON CONFLICT (id) DO NOTHING.
 *
 * Usage: npx ts-node back/scripts/migrate/2026-10-models-plans.ts [--dry-run]
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { runBackfill, type MongoDoc } from './harness';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (v == null ? null : String(v));
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const dateOf = (v: unknown): Date => (v ? new Date(String(v)) : new Date());
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

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

  // ── ai_models ───────────────────────────────────────────────────────
  await runBackfill({
    collection: mdb.collection('models'),
    build: (doc: MongoDoc): Row => ({
      id: String(doc._id),
      model_id: String(doc.modelId),
      name: String(doc.name),
      chef: String(doc.chef ?? ''),
      chef_slug: String(doc.chefSlug ?? ''),
      litellm_model: String(doc.litellmModel ?? ''),
      providers: arr(doc.providers),
      type: String(doc.type ?? ''),
      types: arr(doc.types),
      is_active: doc.isActive !== false,
      is_default: doc.isDefault === true,
      is_conversation_v2_default: doc.isConversationV2Default === true,
      omit_temperature: doc.omitTemperature === true,
      input_modalities: arr(doc.inputModalities),
      max_input_tokens: n(doc.maxInputTokens),
      max_output_tokens: n(doc.maxOutputTokens),
      input_cost_per_token: n(doc.inputCostPerToken),
      output_cost_per_token: n(doc.outputCostPerToken),
      cached_input_cost_per_token: n(doc.cachedInputCostPerToken),
      supports_reasoning: typeof doc.supportsReasoning === 'boolean' ? doc.supportsReasoning : null,
      reasoning_efforts: JSON.stringify(Array.isArray(doc.reasoningEfforts) ? doc.reasoningEfforts : []),
      default_reasoning_effort: s(doc.defaultReasoningEffort),
      created_at: dateOf(doc.createdAt),
      updated_at: dateOf(doc.updatedAt),
    }),
    unitId: (unit) => String(unit.model_id),
    exists: async (modelId) => {
      const r = await pool.query('SELECT 1 FROM catalog.ai_models WHERE model_id = $1', [String(modelId)]);
      return r.rowCount! > 0;
    },
    insert: async (unit) => {
      await pool.query(
        `INSERT INTO catalog.ai_models (id, model_id, name, chef, chef_slug, litellm_model, providers, type, types,
          is_active, is_default, is_conversation_v2_default, omit_temperature, input_modalities,
          max_input_tokens, max_output_tokens, input_cost_per_token, output_cost_per_token, cached_input_cost_per_token,
          supports_reasoning, reasoning_efforts, default_reasoning_effort, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         ON CONFLICT (id) DO NOTHING`,
        [
          unit.id, unit.model_id, unit.name, unit.chef, unit.chef_slug, unit.litellm_model,
          unit.providers, unit.type, unit.types, unit.is_active, unit.is_default,
          unit.is_conversation_v2_default, unit.omit_temperature, unit.input_modalities,
          unit.max_input_tokens, unit.max_output_tokens, unit.input_cost_per_token,
          unit.output_cost_per_token, unit.cached_input_cost_per_token, unit.supports_reasoning,
          unit.reasoning_efforts, unit.default_reasoning_effort, unit.created_at, unit.updated_at,
        ],
      );
    },
    verify: async (units) => {
      const map = new Map<string, string>();
      for (const unit of units) {
        const modelId = String(unit.model_id);
        const r = await pool.query(
          'SELECT is_active, is_default, chef_slug FROM catalog.ai_models WHERE model_id = $1',
          [modelId],
        );
        if (r.rowCount === 0) map.set(modelId, 'missing in PG');
        else if (r.rows[0].is_active !== unit.is_active || r.rows[0].is_default !== unit.is_default || r.rows[0].chef_slug !== unit.chef_slug) {
          map.set(modelId, 'field mismatch');
        }
      }
      return map;
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM catalog.ai_models')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT model_id AS id FROM catalog.ai_models')).rows.map((r) => r.id),
  });

  // ── plans ───────────────────────────────────────────────────────────
  await runBackfill({
    collection: mdb.collection('plans'),
    build: (doc: MongoDoc): Row => ({
      id: String(doc._id),
      name: String(doc.name),
      slug: String(doc.slug),
      description: s(doc.description),
      token_limit: typeof doc.tokenLimit === 'number' ? doc.tokenLimit : 0,
      window_hours: typeof doc.windowHours === 'number' ? doc.windowHours : 24,
      requests_per_minute: typeof doc.requestsPerMinute === 'number' ? doc.requestsPerMinute : 60,
      max_tokens_per_request: typeof doc.maxTokensPerRequest === 'number' ? doc.maxTokensPerRequest : -1,
      features: arr(doc.features),
      priority: typeof doc.priority === 'number' ? doc.priority : 0,
      price_monthly: typeof doc.priceMonthly === 'number' ? doc.priceMonthly.toFixed(2) : '0',
      price_yearly: typeof doc.priceYearly === 'number' ? doc.priceYearly.toFixed(2) : '0',
      currency: String(doc.currency ?? 'USD').slice(0, 3),
      is_active: doc.isActive !== false,
      is_default: doc.isDefault === true,
      display_order: typeof doc.displayOrder === 'number' ? doc.displayOrder : 0,
      max_workspaces: typeof doc.maxWorkspaces === 'number' ? doc.maxWorkspaces : 3,
      workspace_storage_bytes: typeof doc.workspaceStorageBytes === 'number' ? doc.workspaceStorageBytes : 104857600,
      metadata: JSON.stringify((doc.metadata as Record<string, unknown>) ?? {}),
      created_at: dateOf(doc.createdAt),
      updated_at: dateOf(doc.updatedAt),
    }),
    unitId: (unit) => String(unit.slug),
    exists: async (slug) => {
      const r = await pool.query('SELECT 1 FROM catalog.plans WHERE slug = $1', [String(slug)]);
      return r.rowCount! > 0;
    },
    insert: async (unit) => {
      await pool.query(
        `INSERT INTO catalog.plans (id, name, slug, description, token_limit, window_hours, requests_per_minute,
          max_tokens_per_request, features, priority, price_monthly, price_yearly, currency, is_active, is_default,
          display_order, max_workspaces, workspace_storage_bytes, metadata, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21)
         ON CONFLICT (id) DO NOTHING`,
        [
          unit.id, unit.name, unit.slug, unit.description, unit.token_limit, unit.window_hours,
          unit.requests_per_minute, unit.max_tokens_per_request, unit.features, unit.priority,
          unit.price_monthly, unit.price_yearly, unit.currency, unit.is_active, unit.is_default,
          unit.display_order, unit.max_workspaces, unit.workspace_storage_bytes, unit.metadata,
          unit.created_at, unit.updated_at,
        ],
      );
    },
    verify: async (units) => {
      const map = new Map<string, string>();
      for (const unit of units) {
        const slug = String(unit.slug);
        const r = await pool.query(
          'SELECT token_limit, is_active, is_default, price_monthly FROM catalog.plans WHERE slug = $1',
          [slug],
        );
        if (r.rowCount === 0) map.set(slug, 'missing in PG');
        else if (
          r.rows[0].token_limit !== unit.token_limit ||
          r.rows[0].is_active !== unit.is_active ||
          r.rows[0].is_default !== unit.is_default ||
          Number(r.rows[0].price_monthly) !== Number(unit.price_monthly)
        ) {
          map.set(slug, 'field mismatch');
        }
      }
      return map;
    },
    pgCount: async () => (await pool.query('SELECT count(*)::int AS n FROM catalog.plans')).rows[0].n,
    pgIds: async () => (await pool.query('SELECT slug AS id FROM catalog.plans')).rows.map((r) => r.id),
  });

  // ── single-default sanity (partial unique indexes allow at most one) ─
  const defaults = await pool.query(
    `SELECT 'default' AS kind, count(*)::int AS n FROM catalog.ai_models WHERE is_default
     UNION ALL SELECT 'v2_default', count(*)::int FROM catalog.ai_models WHERE is_conversation_v2_default
     UNION ALL SELECT 'plan_default', count(*)::int FROM catalog.plans WHERE is_default`,
  );
  console.log('=== single-default counts (must each be 0 or 1) ===');
  console.log(JSON.stringify(defaults.rows, null, 2));

  await pool.end();
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
