/**
 * Steps 1B.3.4 + 1B.4.8 — cross-schema FK passes for the catalog phase.
 *
 * Adds, once backfills have landed:
 *   - identity.users.plan_id → catalog.plans(id)
 *   - agents.agent_type_id → catalog.agent_types(id)          (NO ACTION)
 *   - agent_tools.tool_id → catalog.tools(id)                 (CASCADE)
 *   - agent_skills.skill_id → catalog.skills(id)              (CASCADE)
 *   - agent_disabled_skills.skill_id → catalog.skills(id)     (CASCADE)
 * Each FK is created NOT VALID and then validated; orphan reports run first.
 *
 * Usage: npx ts-node back/scripts/migrate/2026-10-catalog-fk.ts [--dry-run]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

interface FkSpec {
  name: string;
  sql: string;
  orphanSql: string;
}

const FKS: FkSpec[] = [
  {
    name: 'fk_users_plan',
    sql: `ALTER TABLE identity.users
            ADD CONSTRAINT fk_users_plan
            FOREIGN KEY (plan_id) REFERENCES catalog.plans(id)
            NOT VALID`,
    orphanSql: `SELECT u.id, u.plan_id FROM identity.users u
                LEFT JOIN catalog.plans p ON p.id = u.plan_id
                WHERE u.plan_id IS NOT NULL AND p.id IS NULL`,
  },
  {
    name: 'fk_agents_agent_type',
    sql: `ALTER TABLE agents
            ADD CONSTRAINT fk_agents_agent_type
            FOREIGN KEY (agent_type_id) REFERENCES catalog.agent_types(id)
            NOT VALID`,
    orphanSql: `SELECT a.id, a.agent_type_id FROM agents a
                LEFT JOIN catalog.agent_types t ON t.id = a.agent_type_id
                WHERE a.agent_type_id IS NOT NULL AND t.id IS NULL`,
  },
  {
    name: 'fk_agent_tools_tool',
    sql: `ALTER TABLE agent_tools
            ADD CONSTRAINT fk_agent_tools_tool
            FOREIGN KEY (tool_id) REFERENCES catalog.tools(id)
            ON DELETE CASCADE
            NOT VALID`,
    orphanSql: `SELECT at.agent_id, at.tool_id FROM agent_tools at
                LEFT JOIN catalog.tools t ON t.id = at.tool_id
                LEFT JOIN agents a ON a.id = at.agent_id
                WHERE t.id IS NULL OR a.id IS NULL`,
  },
  {
    name: 'fk_agent_skills_skill',
    sql: `ALTER TABLE agent_skills
            ADD CONSTRAINT fk_agent_skills_skill
            FOREIGN KEY (skill_id) REFERENCES catalog.skills(id)
            ON DELETE CASCADE
            NOT VALID`,
    orphanSql: `SELECT asx.agent_id, asx.skill_id FROM agent_skills asx
                LEFT JOIN catalog.skills s ON s.id = asx.skill_id
                LEFT JOIN agents a ON a.id = asx.agent_id
                WHERE s.id IS NULL OR a.id IS NULL`,
  },
  {
    name: 'fk_agent_disabled_skills_skill',
    sql: `ALTER TABLE agent_disabled_skills
            ADD CONSTRAINT fk_agent_disabled_skills_skill
            FOREIGN KEY (skill_id) REFERENCES catalog.skills(id)
            ON DELETE CASCADE
            NOT VALID`,
    orphanSql: `SELECT ads.agent_id, ads.skill_id FROM agent_disabled_skills ads
                LEFT JOIN catalog.skills s ON s.id = ads.skill_id
                LEFT JOIN agents a ON a.id = ads.agent_id
                WHERE s.id IS NULL OR a.id IS NULL`,
  },
];

async function main(): Promise<void> {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });

  const dryRun = process.argv.includes('--dry-run');

  for (const fk of FKS) {
    console.log(`=== ${fk.name} ===`);
    const orphans = await pool.query(fk.orphanSql);
    console.log(JSON.stringify({ orphanDocs: orphans.rowCount ?? 0, sample: orphans.rows.slice(0, 10) }, null, 2));
    if ((orphans.rowCount ?? 0) > 0) {
      console.error(`Orphans present for ${fk.name} — resolve before adding the FK.`);
      await pool.end();
      process.exit(1);
    }
    if (dryRun) continue;

    await pool.query(`ALTER TABLE ${fk.sql.match(/ALTER TABLE (\S+)/)![1]} DROP CONSTRAINT IF EXISTS ${fk.name}`);
    await pool.query(fk.sql);
    await pool.query(`ALTER TABLE ${fk.sql.match(/ALTER TABLE (\S+)/)![1]} VALIDATE CONSTRAINT ${fk.name}`);
    const check = await pool.query<{ convalidated: boolean }>(
      `SELECT convalidated FROM pg_constraint WHERE conname = $1`,
      [fk.name],
    );
    console.log(JSON.stringify({ validated: check.rows[0]?.convalidated ?? false }, null, 2));
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
