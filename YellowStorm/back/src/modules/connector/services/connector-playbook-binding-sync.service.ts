import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { stripNul, withTransaction } from '@common/postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { LoggerService } from '@modules/logger';
import {
  ConnectorActionSchemaContract,
  connectorActionContractsEqual,
  getAllowedFixedParamKeys,
} from '../utils/connector-fixed-params.util';

type Json = Record<string, unknown>;

const flows = schema.playbookFlows;

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Key-order-independent JSON, to tell a rewrite that changes nothing (jsonb reorders keys). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * The connector's bindings in every node rewritten: `actions` replaced and, when the new schemas
 * close the parameter set, `fixedParams` reduced to the allowed keys (a missing or non-object
 * `fixedParams` becomes {}). Other bindings and nodes are left as they are.
 */
export function rewriteConnectorBindings(
  nodes: unknown[],
  connectorId: string,
  actions: Json[],
  allowedFixedParamKeys: string[] | null,
): unknown[] {
  return nodes.map((node) => {
    if (!isObject(node) || !isObject(node.metadata) || !Array.isArray(node.metadata.toolBindings)) return node;
    const toolBindings = node.metadata.toolBindings.map((binding: unknown) => {
      if (!isObject(binding) || binding.connectorId !== connectorId) return binding;
      const next: Json = { ...binding, actions };
      if (allowedFixedParamKeys !== null) {
        const fixedParams = isObject(binding.fixedParams) ? binding.fixedParams : {};
        next.fixedParams = Object.fromEntries(Object.entries(fixedParams).filter(([key]) => allowedFixedParamKeys.includes(key)));
      }
      return next;
    });
    return { ...node, metadata: { ...node.metadata, toolBindings } };
  });
}

@Injectable()
export class ConnectorPlaybookBindingSyncService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ConnectorPlaybookBindingSyncService.name);
  }

  async syncConnectorActions(
    connectorId: string,
    previousActions: ConnectorActionSchemaContract[],
    nextActions: ConnectorActionSchemaContract[],
  ): Promise<void> {
    if (connectorActionContractsEqual(previousActions, nextActions)) {
      return;
    }

    const actions = stripNul(nextActions.map((action) => ({ actionKey: action.key, isEnabled: true })));
    const allowedFixedParamKeys = getAllowedFixedParamKeys(nextActions);
    // Served by the GIN index idx_playbook_flows_nodes (jsonb_path_ops).
    const bindsConnector = JSON.stringify([{ metadata: { toolBindings: [{ connectorId }] } }]);

    // A system-side rewrite, like the raw Mongo update it replaces: updated_at and the definition
    // revision are left alone, so it neither reorders the flow lists nor conflicts with an open editor.
    const result = await withTransaction(this.db, async (tx) => {
      const candidates = await tx
        .select({ id: flows.id, nodes: flows.nodes })
        .from(flows)
        .where(sql`${flows.nodes} @> ${bindsConnector}::jsonb`)
        .orderBy(asc(flows.id))
        .for('update');
      let modified = 0;
      for (const flow of candidates) {
        const nodes = rewriteConnectorBindings(flow.nodes, connectorId, actions, allowedFixedParamKeys);
        if (canonical(nodes) === canonical(flow.nodes)) continue;
        await tx.update(flows).set({ nodes: nodes as Json[] }).where(eq(flows.id, flow.id));
        modified += 1;
      }
      return { matched: candidates.length, modified };
    });

    this.logger.log('Synchronized playbook connector action bindings', {
      connectorId,
      matchedFlowCount: result.matched,
      modifiedFlowCount: result.modified,
      currentActionKeys: nextActions.map((action) => action.key),
    });
  }
}
