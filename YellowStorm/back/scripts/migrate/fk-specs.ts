/**
 * Single source of truth for the cross-schema FK constraints (remediation 5.1).
 *
 * Consumed by:
 *  - scripts/migrate/generate-0025.ts  → renders drizzle/0025_cross_schema_fks.sql
 *  - every scripts/migrate/*-fk.ts     → thin add-or-verify runners (fk-helper.ts)
 *  - src drift test (fk-specs.spec.ts) → 0025 / 0020 stay in sync with this file
 *
 * The three FKs carried by drizzle/0020 (fk_conv_ws_workspace,
 * fk_conversations_system_workspace, fk_conversations_project) live in
 * FK_SPECS_IN_0020: they are verified by the scripts but NOT rendered into 0025.
 */

/**
 * Opt-in orphan cleanup (`--delete-orphans`): the dangling rows are exported to
 * scripts/migrate/out/<exportStem>-<timestamp>.json BEFORE they are deleted.
 * Never delete without an export.
 */
export interface FkCleanup {
  exportStem: string;
  /** SELECT of the dangling rows (exported as JSON). */
  selectSql: string;
  /** DELETE of exactly those rows. */
  deleteSql: string;
}

export interface FkSpec {
  name: string;
  /** schema-qualified table */
  table: string;
  /** Constraint body as pg_get_constraintdef() renders it, without NOT VALID. */
  definition: string;
  /** SQL returning exactly one row with `n` = orphan count. */
  orphanCheck: string;
  /** Present on junction tables whose dangling rows are safe to remove. */
  cleanup?: FkCleanup;
}

export const FK_SPECS: FkSpec[] = [
  {
    name: 'fk_artifacts_workspace',
    table: 'workspace.workspace_artifacts',
    definition: 'FOREIGN KEY (workspace_id) REFERENCES workspace.workspaces(id) ON DELETE CASCADE',
    orphanCheck: `SELECT count(*)::int AS n FROM workspace.workspace_artifacts a
                  LEFT JOIN workspace.workspaces w ON w.id = a.workspace_id
                  WHERE w.id IS NULL`,
  },
  {
    name: 'fk_gov_bindings_workspace',
    table: 'governance.governance_workspace_bindings',
    definition: 'FOREIGN KEY (workspace_id) REFERENCES workspace.workspaces(id) ON DELETE CASCADE',
    orphanCheck: `SELECT count(*)::int AS n FROM governance.governance_workspace_bindings b
                  LEFT JOIN workspace.workspaces w ON w.id = b.workspace_id
                  WHERE w.id IS NULL`,
  },
  {
    name: 'fk_agents_agent_type',
    table: 'public.agents',
    definition: 'FOREIGN KEY (agent_type_id) REFERENCES catalog.agent_types(id)',
    orphanCheck: `SELECT count(*)::int AS n FROM public.agents a
                  LEFT JOIN catalog.agent_types t ON t.id = a.agent_type_id
                  WHERE a.agent_type_id IS NOT NULL AND t.id IS NULL`,
  },
  {
    name: 'fk_agent_tools_tool',
    table: 'public.agent_tools',
    definition: 'FOREIGN KEY (tool_id) REFERENCES catalog.tools(id) ON DELETE CASCADE',
    orphanCheck: `SELECT count(*)::int AS n FROM public.agent_tools at
                  LEFT JOIN catalog.tools t ON t.id = at.tool_id
                  WHERE t.id IS NULL`,
  },
  {
    name: 'fk_agent_skills_skill',
    table: 'public.agent_skills',
    definition: 'FOREIGN KEY (skill_id) REFERENCES catalog.skills(id) ON DELETE CASCADE',
    orphanCheck: `SELECT count(*)::int AS n FROM public.agent_skills s
                  LEFT JOIN catalog.skills k ON k.id = s.skill_id
                  WHERE k.id IS NULL`,
  },
  {
    name: 'fk_agent_disabled_skills_skill',
    table: 'public.agent_disabled_skills',
    definition: 'FOREIGN KEY (skill_id) REFERENCES catalog.skills(id) ON DELETE CASCADE',
    orphanCheck: `SELECT count(*)::int AS n FROM public.agent_disabled_skills s
                  LEFT JOIN catalog.skills k ON k.id = s.skill_id
                  WHERE k.id IS NULL`,
  },
  {
    name: 'fk_users_plan',
    table: 'identity.users',
    definition: 'FOREIGN KEY (plan_id) REFERENCES catalog.plans(id)',
    orphanCheck: `SELECT count(*)::int AS n FROM identity.users u
                  LEFT JOIN catalog.plans p ON p.id = u.plan_id
                  WHERE u.plan_id IS NOT NULL AND p.id IS NULL`,
  },
  {
    name: 'fk_user_app_connections_app_key',
    table: 'integrations.user_app_connections',
    definition: 'FOREIGN KEY (app_key) REFERENCES integrations.connected_app_definitions(app_key) ON DELETE CASCADE',
    orphanCheck: `SELECT count(*)::int AS n FROM integrations.user_app_connections uac
                  LEFT JOIN integrations.connected_app_definitions d ON d.app_key = uac.app_key
                  WHERE d.id IS NULL`,
  },
  {
    name: 'fk_connector_skills_skill',
    table: 'integrations.connector_skills',
    definition: 'FOREIGN KEY (skill_id) REFERENCES catalog.skills(id) ON DELETE CASCADE',
    orphanCheck: `SELECT count(*)::int AS n FROM integrations.connector_skills cs
                  LEFT JOIN catalog.skills s ON s.id = cs.skill_id
                  WHERE s.id IS NULL`,
    cleanup: {
      exportStem: 'connector_skills',
      selectSql: `SELECT cs.* FROM integrations.connector_skills cs
                  WHERE NOT EXISTS (SELECT 1 FROM catalog.skills r WHERE r.id = cs.skill_id)`,
      deleteSql: `DELETE FROM integrations.connector_skills cs
                  WHERE NOT EXISTS (SELECT 1 FROM catalog.skills r WHERE r.id = cs.skill_id)`,
    },
  },
  {
    name: 'fk_telegram_chat_bindings_conversation',
    table: 'channels.telegram_chat_bindings',
    definition: 'FOREIGN KEY (conversation_id) REFERENCES conversation.conversations(id) ON DELETE SET NULL',
    orphanCheck: `SELECT count(*)::int AS n FROM channels.telegram_chat_bindings tcb
                  LEFT JOIN conversation.conversations c ON c.id = tcb.conversation_id
                  WHERE tcb.conversation_id IS NOT NULL AND c.id IS NULL`,
  },
  {
    name: 'fk_telegram_chat_bindings_user',
    table: 'channels.telegram_chat_bindings',
    definition: 'FOREIGN KEY (user_id) REFERENCES identity.users(id)',
    orphanCheck: `SELECT count(*)::int AS n FROM channels.telegram_chat_bindings tcb
                  LEFT JOIN identity.users u ON u.id = tcb.user_id
                  WHERE u.id IS NULL`,
  },
  {
    name: 'fk_telegram_chat_bindings_agent',
    table: 'channels.telegram_chat_bindings',
    definition: 'FOREIGN KEY (agent_id) REFERENCES public.agents(id)',
    orphanCheck: `SELECT count(*)::int AS n FROM channels.telegram_chat_bindings tcb
                  LEFT JOIN public.agents a ON a.id = tcb.agent_id
                  WHERE a.id IS NULL`,
  },
  {
    name: 'fk_telegram_integrations_user',
    table: 'channels.telegram_integrations',
    definition: 'FOREIGN KEY (user_id) REFERENCES identity.users(id)',
    orphanCheck: `SELECT count(*)::int AS n FROM channels.telegram_integrations ti
                  LEFT JOIN identity.users u ON u.id = ti.user_id
                  WHERE u.id IS NULL`,
  },
  {
    name: 'fk_widget_tokens_created_by',
    table: 'channels.widget_tokens',
    definition: 'FOREIGN KEY (created_by) REFERENCES identity.users(id)',
    orphanCheck: `SELECT count(*)::int AS n FROM channels.widget_tokens wt
                  LEFT JOIN identity.users u ON u.id = wt.created_by
                  WHERE u.id IS NULL`,
  },
  {
    name: 'fk_shared_agents_shared_with',
    table: 'public.shared_agents',
    definition: 'FOREIGN KEY (shared_with) REFERENCES identity.users(id)',
    orphanCheck: `SELECT count(*)::int AS n FROM public.shared_agents sa
                  LEFT JOIN identity.users u ON u.id = sa.shared_with
                  WHERE u.id IS NULL`,
  },
  {
    name: 'fk_shared_agents_shared_by',
    table: 'public.shared_agents',
    definition: 'FOREIGN KEY (shared_by) REFERENCES identity.users(id)',
    orphanCheck: `SELECT count(*)::int AS n FROM public.shared_agents sa
                  LEFT JOIN identity.users u ON u.id = sa.shared_by
                  WHERE u.id IS NULL`,
  },
  {
    name: 'fk_shared_teams_shared_with',
    table: 'teams.shared_teams',
    definition: 'FOREIGN KEY (shared_with) REFERENCES identity.users(id)',
    orphanCheck: `SELECT count(*)::int AS n FROM teams.shared_teams st
                  LEFT JOIN identity.users u ON u.id = st.shared_with
                  WHERE u.id IS NULL`,
  },
  {
    name: 'fk_shared_teams_shared_by',
    table: 'teams.shared_teams',
    definition: 'FOREIGN KEY (shared_by) REFERENCES identity.users(id)',
    orphanCheck: `SELECT count(*)::int AS n FROM teams.shared_teams st
                  LEFT JOIN identity.users u ON u.id = st.shared_by
                  WHERE u.id IS NULL`,
  },
  {
    name: 'fk_teams_created_by',
    table: 'teams.teams',
    definition: 'FOREIGN KEY (created_by) REFERENCES identity.users(id)',
    orphanCheck: `SELECT count(*)::int AS n FROM teams.teams t
                  LEFT JOIN identity.users u ON u.id = t.created_by
                  WHERE u.id IS NULL`,
  },
  {
    name: 'fk_agent_connectors_connector',
    table: 'public.agent_connectors',
    definition: 'FOREIGN KEY (connector_id) REFERENCES integrations.connectors(id) ON DELETE CASCADE',
    orphanCheck: `SELECT count(*)::int AS n FROM public.agent_connectors ac
                  LEFT JOIN integrations.connectors c ON c.id = ac.connector_id
                  WHERE c.id IS NULL`,
    cleanup: {
      exportStem: 'agent_connectors',
      selectSql: `SELECT ac.* FROM public.agent_connectors ac
                  WHERE NOT EXISTS (SELECT 1 FROM integrations.connectors r WHERE r.id = ac.connector_id)`,
      deleteSql: `DELETE FROM public.agent_connectors ac
                  WHERE NOT EXISTS (SELECT 1 FROM integrations.connectors r WHERE r.id = ac.connector_id)`,
    },
  },
  {
    name: 'fk_agent_connector_actions_connector',
    table: 'public.agent_connector_actions',
    definition: 'FOREIGN KEY (connector_id) REFERENCES integrations.connectors(id) ON DELETE CASCADE',
    orphanCheck: `SELECT count(*)::int AS n FROM public.agent_connector_actions aca
                  LEFT JOIN integrations.connectors c ON c.id = aca.connector_id
                  WHERE c.id IS NULL`,
    cleanup: {
      exportStem: 'agent_connector_actions',
      selectSql: `SELECT aca.* FROM public.agent_connector_actions aca
                  WHERE NOT EXISTS (SELECT 1 FROM integrations.connectors r WHERE r.id = aca.connector_id)`,
      deleteSql: `DELETE FROM public.agent_connector_actions aca
                  WHERE NOT EXISTS (SELECT 1 FROM integrations.connectors r WHERE r.id = aca.connector_id)`,
    },
  },
];

/** Carried by drizzle/0020 — verified by the scripts, not rendered into 0025. */
export const FK_SPECS_IN_0020: FkSpec[] = [
  {
    name: 'fk_conv_ws_workspace',
    table: 'conversation.conversation_workspaces',
    definition: 'FOREIGN KEY (workspace_id) REFERENCES workspace.workspaces(id) ON DELETE CASCADE',
    orphanCheck: `SELECT count(*)::int AS n FROM conversation.conversation_workspaces cw
                  WHERE NOT EXISTS (SELECT 1 FROM workspace.workspaces w WHERE w.id = cw.workspace_id)`,
  },
  {
    name: 'fk_conversations_system_workspace',
    table: 'conversation.conversations',
    definition: 'FOREIGN KEY (system_workspace_id) REFERENCES workspace.workspaces(id) ON DELETE SET NULL',
    orphanCheck: `SELECT count(*)::int AS n FROM conversation.conversations c
                  WHERE c.system_workspace_id IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM workspace.workspaces w WHERE w.id = c.system_workspace_id)`,
  },
  {
    name: 'fk_conversations_project',
    table: 'conversation.conversations',
    definition: 'FOREIGN KEY (project_id) REFERENCES project.projects(id) ON DELETE SET NULL',
    orphanCheck: `SELECT count(*)::int AS n FROM conversation.conversations c
                  WHERE c.project_id IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM project.projects p WHERE p.id = c.project_id)`,
  },
];

/**
 * Carried by drizzle/0037 (GENERATED by scripts/migrate/generate-0037.ts): the references of
 * conversation-v2 and app-runtime, added once their data was complete. Unlike 0025 the migration never
 * fails on dirty data: it adds each constraint NOT VALID (already enforced for new writes) and validates
 * it only when no orphan remains; the runner script validates the rest after `--delete-orphans`.
 */
export const FK_SPECS_IN_0037: FkSpec[] = [
  {
    name: 'fk_c2_sessions_owner',
    table: 'conversation_v2.sessions',
    definition: 'FOREIGN KEY (owner_id) REFERENCES identity.users(id)',
    orphanCheck: `SELECT count(*)::int AS n FROM conversation_v2.sessions s
                  WHERE NOT EXISTS (SELECT 1 FROM identity.users u WHERE u.id = s.owner_id)`,
    // Deleting the session takes its events with it (cascade): exported first, and only with --delete-orphans.
    cleanup: {
      exportStem: 'conversation_v2_sessions_without_owner',
      selectSql: `SELECT s.* FROM conversation_v2.sessions s
                  WHERE NOT EXISTS (SELECT 1 FROM identity.users u WHERE u.id = s.owner_id)`,
      deleteSql: `DELETE FROM conversation_v2.sessions s
                  WHERE NOT EXISTS (SELECT 1 FROM identity.users u WHERE u.id = s.owner_id)`,
    },
  },
  {
    name: 'fk_c2_sessions_system_workspace',
    table: 'conversation_v2.sessions',
    definition: 'FOREIGN KEY (system_workspace_id) REFERENCES workspace.workspaces(id) ON DELETE SET NULL',
    orphanCheck: `SELECT count(*)::int AS n FROM conversation_v2.sessions s
                  WHERE s.system_workspace_id IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM workspace.workspaces w WHERE w.id = s.system_workspace_id)`,
    // The session stays: only the dangling pointer is cleared, which is exactly what ON DELETE SET NULL does.
    cleanup: {
      exportStem: 'conversation_v2_sessions_dangling_system_workspace',
      selectSql: `SELECT s.id, s.owner_id, s.system_workspace_id, s.deleted_at FROM conversation_v2.sessions s
                  WHERE s.system_workspace_id IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM workspace.workspaces w WHERE w.id = s.system_workspace_id)`,
      deleteSql: `UPDATE conversation_v2.sessions s SET system_workspace_id = NULL
                  WHERE s.system_workspace_id IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM workspace.workspaces w WHERE w.id = s.system_workspace_id)`,
    },
  },
  {
    name: 'fk_c2_app_shares_owner',
    table: 'conversation_v2.app_shares',
    definition: 'FOREIGN KEY (owner_id) REFERENCES identity.users(id)',
    orphanCheck: `SELECT count(*)::int AS n FROM conversation_v2.app_shares a
                  WHERE NOT EXISTS (SELECT 1 FROM identity.users u WHERE u.id = a.owner_id)`,
  },
  {
    name: 'fk_c2_app_shares_recipient',
    table: 'conversation_v2.app_shares',
    definition: 'FOREIGN KEY (recipient_user_id) REFERENCES identity.users(id) ON DELETE CASCADE',
    orphanCheck: `SELECT count(*)::int AS n FROM conversation_v2.app_shares a
                  WHERE a.recipient_user_id IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM identity.users u WHERE u.id = a.recipient_user_id)`,
  },
  {
    name: 'fk_ar_bindings_user',
    table: 'app_runtime.bindings',
    definition: 'FOREIGN KEY (user_id) REFERENCES identity.users(id)',
    orphanCheck: `SELECT count(*)::int AS n FROM app_runtime.bindings b
                  WHERE NOT EXISTS (SELECT 1 FROM identity.users u WHERE u.id = b.user_id)`,
    // A binding without its user is unreachable; its tickets, tool calls and revisions go with it (cascade).
    cleanup: {
      exportStem: 'app_runtime_bindings_without_user',
      selectSql: `SELECT b.* FROM app_runtime.bindings b
                  WHERE NOT EXISTS (SELECT 1 FROM identity.users u WHERE u.id = b.user_id)`,
      deleteSql: `DELETE FROM app_runtime.bindings b
                  WHERE NOT EXISTS (SELECT 1 FROM identity.users u WHERE u.id = b.user_id)`,
    },
  },
  {
    name: 'fk_ar_tickets_binding',
    table: 'app_runtime.tickets',
    definition: 'FOREIGN KEY (binding_id) REFERENCES app_runtime.bindings(binding_id) ON DELETE CASCADE',
    orphanCheck: `SELECT count(*)::int AS n FROM app_runtime.tickets t
                  WHERE NOT EXISTS (SELECT 1 FROM app_runtime.bindings b WHERE b.binding_id = t.binding_id)`,
  },
  {
    name: 'fk_ar_tickets_user',
    table: 'app_runtime.tickets',
    definition: 'FOREIGN KEY (user_id) REFERENCES identity.users(id)',
    orphanCheck: `SELECT count(*)::int AS n FROM app_runtime.tickets t
                  WHERE NOT EXISTS (SELECT 1 FROM identity.users u WHERE u.id = t.user_id)`,
  },
  {
    name: 'fk_ar_tool_calls_binding',
    table: 'app_runtime.tool_calls',
    definition: 'FOREIGN KEY (binding_id) REFERENCES app_runtime.bindings(binding_id) ON DELETE CASCADE',
    orphanCheck: `SELECT count(*)::int AS n FROM app_runtime.tool_calls t
                  WHERE NOT EXISTS (SELECT 1 FROM app_runtime.bindings b WHERE b.binding_id = t.binding_id)`,
  },
  {
    name: 'fk_ar_ai_preview_tickets_binding',
    table: 'app_runtime.ai_preview_tickets',
    definition: 'FOREIGN KEY (binding_id) REFERENCES app_runtime.bindings(binding_id) ON DELETE CASCADE',
    orphanCheck: `SELECT count(*)::int AS n FROM app_runtime.ai_preview_tickets t
                  WHERE NOT EXISTS (SELECT 1 FROM app_runtime.bindings b WHERE b.binding_id = t.binding_id)`,
  },
  {
    name: 'fk_ar_ai_preview_tickets_billable_user',
    table: 'app_runtime.ai_preview_tickets',
    definition: 'FOREIGN KEY (billable_user_id) REFERENCES identity.users(id)',
    orphanCheck: `SELECT count(*)::int AS n FROM app_runtime.ai_preview_tickets t
                  WHERE NOT EXISTS (SELECT 1 FROM identity.users u WHERE u.id = t.billable_user_id)`,
  },
  {
    name: 'fk_ar_source_revisions_binding',
    table: 'app_runtime.source_revisions',
    definition: 'FOREIGN KEY (workspace_id) REFERENCES app_runtime.bindings(workspace_id) ON DELETE CASCADE',
    orphanCheck: `SELECT count(*)::int AS n FROM app_runtime.source_revisions r
                  WHERE NOT EXISTS (SELECT 1 FROM app_runtime.bindings b WHERE b.workspace_id = r.workspace_id)`,
  },
  {
    name: 'fk_ar_finalized_revisions_binding',
    table: 'app_runtime.finalized_revisions',
    definition: 'FOREIGN KEY (workspace_id) REFERENCES app_runtime.bindings(workspace_id) ON DELETE CASCADE',
    orphanCheck: `SELECT count(*)::int AS n FROM app_runtime.finalized_revisions r
                  WHERE NOT EXISTS (SELECT 1 FROM app_runtime.bindings b WHERE b.workspace_id = r.workspace_id)`,
  },
];

/** Leading indexes the 0037 foreign keys need (db:verify check4); the other referencing columns already have one. */
export const INDEXES_IN_0037: string[] = [
  'CREATE INDEX IF NOT EXISTS idx_c2_sessions_system_workspace ON conversation_v2.sessions (system_workspace_id);',
  'CREATE INDEX IF NOT EXISTS idx_c2_app_shares_owner ON conversation_v2.app_shares (owner_id);',
  'CREATE INDEX IF NOT EXISTS idx_ar_tickets_binding ON app_runtime.tickets (binding_id);',
  'CREATE INDEX IF NOT EXISTS idx_ar_tickets_user ON app_runtime.tickets (user_id);',
];

/** Select specs by name from every FK group; throws on an unknown name. */
export function fkSpecs(...names: string[]): FkSpec[] {
  const all = new Map([...FK_SPECS, ...FK_SPECS_IN_0020, ...FK_SPECS_IN_0037].map((spec) => [spec.name, spec]));
  return names.map((name) => {
    const spec = all.get(name);
    if (!spec) throw new Error(`Unknown FK spec: ${name}`);
    return spec;
  });
}

/**
 * Canonical form for comparing a spec definition with pg_get_constraintdef():
 * whitespace collapsed, NOT VALID dropped, and the `public.` prefix removed because
 * Postgres omits the schema for names on the search_path.
 */
export function normalizeFkDefinition(def: string): string {
  return def
    .replace(/[\s]+/g, ' ')
    .replace(/ NOT VALID$/, '')
    .replace(new RegExp('(^|[^a-z0-9_])public[.]', 'g'), '$1')
    .trim();
}
