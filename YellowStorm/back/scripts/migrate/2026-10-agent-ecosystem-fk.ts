/**
 * Step 4 FK pass — channels schema cross-references (plan: FKs 2026-10-agent-ecosystem-fk.ts).
 *   telegram_chat_bindings.conversation_id → conversation.conversations(id) ON DELETE SET NULL
 *   User/agent FKs, NO ACTION, only added when the orphan count is 0
 *     (orphans are reported and stay FK-less for P10):
 *     telegram_chat_bindings.user_id, telegram_chat_bindings.agent_id,
 *     telegram_integrations.user_id, widget_tokens.created_by
 * WhatsApp FKs are SKIPPED — Baileys WhatsApp channel is deprecated (stays Mongo, removed with worky in P7).
 *
 * Usage: npx ts-node back/scripts/migrate/2026-10-agent-ecosystem-fk.ts [--dry-run]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

interface FkSpec {
  name: string;
  table: string;
  ddl: string;
  orphanSql: string;
}

const FKS: FkSpec[] = [
  {
    name: 'fk_telegram_chat_bindings_conversation',
    table: 'channels.telegram_chat_bindings',
    ddl: `ADD CONSTRAINT fk_telegram_chat_bindings_conversation
          FOREIGN KEY (conversation_id) REFERENCES conversation.conversations(id)
          ON DELETE SET NULL
          NOT VALID`,
    orphanSql: `SELECT tcb.id, tcb.conversation_id FROM channels.telegram_chat_bindings tcb
                LEFT JOIN conversation.conversations c ON c.id = tcb.conversation_id
                WHERE tcb.conversation_id IS NOT NULL AND c.id IS NULL`,
  },
  {
    name: 'fk_telegram_chat_bindings_user',
    table: 'channels.telegram_chat_bindings',
    ddl: `ADD CONSTRAINT fk_telegram_chat_bindings_user
          FOREIGN KEY (user_id) REFERENCES identity.users(id)
          NOT VALID`,
    orphanSql: `SELECT tcb.id, tcb.user_id FROM channels.telegram_chat_bindings tcb
                LEFT JOIN identity.users u ON u.id = tcb.user_id
                WHERE u.id IS NULL`,
  },
  {
    name: 'fk_telegram_chat_bindings_agent',
    table: 'channels.telegram_chat_bindings',
    ddl: `ADD CONSTRAINT fk_telegram_chat_bindings_agent
          FOREIGN KEY (agent_id) REFERENCES public.agents(id)
          NOT VALID`,
    orphanSql: `SELECT tcb.id, tcb.agent_id FROM channels.telegram_chat_bindings tcb
                LEFT JOIN public.agents a ON a.id = tcb.agent_id
                WHERE a.id IS NULL`,
  },
  {
    name: 'fk_telegram_integrations_user',
    table: 'channels.telegram_integrations',
    ddl: `ADD CONSTRAINT fk_telegram_integrations_user
          FOREIGN KEY (user_id) REFERENCES identity.users(id)
          NOT VALID`,
    orphanSql: `SELECT ti.id, ti.user_id FROM channels.telegram_integrations ti
                LEFT JOIN identity.users u ON u.id = ti.user_id
                WHERE u.id IS NULL`,
  },
  {
    name: 'fk_widget_tokens_created_by',
    table: 'channels.widget_tokens',
    ddl: `ADD CONSTRAINT fk_widget_tokens_created_by
          FOREIGN KEY (created_by) REFERENCES identity.users(id)
          NOT VALID`,
    orphanSql: `SELECT wt.id, wt.created_by FROM channels.widget_tokens wt
                LEFT JOIN identity.users u ON u.id = wt.created_by
                WHERE u.id IS NULL`,
  },
  // ── remediation 2.6: shares / teams → identity.users (NO ACTION) ────
  {
    name: 'fk_shared_agents_shared_with',
    table: 'public.shared_agents',
    ddl: `ADD CONSTRAINT fk_shared_agents_shared_with
          FOREIGN KEY (shared_with) REFERENCES identity.users(id)
          NOT VALID`,
    orphanSql: `SELECT sa.id, sa.shared_with FROM public.shared_agents sa
                LEFT JOIN identity.users u ON u.id = sa.shared_with
                WHERE u.id IS NULL`,
  },
  {
    name: 'fk_shared_agents_shared_by',
    table: 'public.shared_agents',
    ddl: `ADD CONSTRAINT fk_shared_agents_shared_by
          FOREIGN KEY (shared_by) REFERENCES identity.users(id)
          NOT VALID`,
    orphanSql: `SELECT sa.id, sa.shared_by FROM public.shared_agents sa
                LEFT JOIN identity.users u ON u.id = sa.shared_by
                WHERE u.id IS NULL`,
  },
  {
    name: 'fk_shared_teams_shared_with',
    table: 'teams.shared_teams',
    ddl: `ADD CONSTRAINT fk_shared_teams_shared_with
          FOREIGN KEY (shared_with) REFERENCES identity.users(id)
          NOT VALID`,
    orphanSql: `SELECT st.id, st.shared_with FROM teams.shared_teams st
                LEFT JOIN identity.users u ON u.id = st.shared_with
                WHERE u.id IS NULL`,
  },
  {
    name: 'fk_shared_teams_shared_by',
    table: 'teams.shared_teams',
    ddl: `ADD CONSTRAINT fk_shared_teams_shared_by
          FOREIGN KEY (shared_by) REFERENCES identity.users(id)
          NOT VALID`,
    orphanSql: `SELECT st.id, st.shared_by FROM teams.shared_teams st
                LEFT JOIN identity.users u ON u.id = st.shared_by
                WHERE u.id IS NULL`,
  },
  {
    name: 'fk_teams_created_by',
    table: 'teams.teams',
    ddl: `ADD CONSTRAINT fk_teams_created_by
          FOREIGN KEY (created_by) REFERENCES identity.users(id)
          NOT VALID`,
    orphanSql: `SELECT t.id, t.created_by FROM teams.teams t
                LEFT JOIN identity.users u ON u.id = t.created_by
                WHERE u.id IS NULL`,
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
  const skipped: string[] = [];
  const validated: string[] = [];

  for (const fk of FKS) {
    console.log(`=== ${fk.name} ===`);
    const orphans = await pool.query(fk.orphanSql);
    console.log(JSON.stringify({ orphanDocs: orphans.rowCount ?? 0, sample: orphans.rows.slice(0, 10) }, null, 2));
    if (dryRun) continue;

    // Orphans stay FK-less and are listed for P10; the other FKs still proceed.
    if ((orphans.rowCount ?? 0) > 0) {
      console.error(`Orphans present for ${fk.name} — FK NOT added, reported for P10.`);
      skipped.push(fk.name);
      continue;
    }

    await pool.query(`ALTER TABLE ${fk.table} DROP CONSTRAINT IF EXISTS ${fk.name}`);
    await pool.query(`ALTER TABLE ${fk.table} ${fk.ddl}`);
    await pool.query(`ALTER TABLE ${fk.table} VALIDATE CONSTRAINT ${fk.name}`);
    const check = await pool.query<{ convalidated: boolean }>(
      'SELECT convalidated FROM pg_constraint WHERE conname = $1',
      [fk.name],
    );
    const convalidated = check.rows[0]?.convalidated ?? false;
    console.log(JSON.stringify({ validated: convalidated }, null, 2));
    if (convalidated) validated.push(fk.name);
    else skipped.push(`${fk.name} (validation failed)`);
  }

  console.log('=== summary ===');
  console.log(JSON.stringify({ validated, skipped }, null, 2));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
