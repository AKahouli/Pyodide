/**
 * Single source of truth for the cross-schema FK constraints (remediation 5.1).
 *
 * Consumed by:
 *  - scripts/migrate/generate-0025.ts  → renders drizzle/0025_cross_schema_fks.sql
 *  - the thin scripts/migrate/*-fk.ts  → add-or-verify runners
 *  - src drift test (fk-specs.spec.ts) → 0025 stays in sync with this list
 *
 * The three FKs already carried by drizzle/0020 (fk_conv_ws_workspace,
 * fk_conversations_system_workspace, fk_conversations_project) are NOT listed.
 */

export interface FkSpec {
  name: string;
  /** schema-qualified table */
  table: string;
  /** Constraint body as pg_get_constraintdef() renders it, without NOT VALID. */
  definition: string;
  /** SQL returning exactly one row with `n` = orphan count. */
  orphanCheck: string;
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
  },
  {
    name: 'fk_agent_connector_actions_connector',
    table: 'public.agent_connector_actions',
    definition: 'FOREIGN KEY (connector_id) REFERENCES integrations.connectors(id) ON DELETE CASCADE',
    orphanCheck: `SELECT count(*)::int AS n FROM public.agent_connector_actions aca
                  LEFT JOIN integrations.connectors c ON c.id = aca.connector_id
                  WHERE c.id IS NULL`,
  },
];
