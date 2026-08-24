import { Injectable, Logger } from '@nestjs/common';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import type { SemanticGraph, SemanticNodeType, SemanticRecord } from '../domain/semantic-model.types';

export interface AgeGraphNode {
  id: string;
  label: string;
  properties: Record<string, unknown>;
}

export interface AgeGraphEdge {
  id: string;
  label: string;
  sourceId: string;
  targetId: string;
  properties: Record<string, unknown>;
}

export interface AgeGraphData {
  nodes: AgeGraphNode[];
  edges: AgeGraphEdge[];
}

@Injectable()
export class SemanticAgeGraphRepository {
  private readonly logger = new Logger(SemanticAgeGraphRepository.name);

  constructor(private readonly database: SemanticModelDatabaseService) {}

  async buildGraph(graph: SemanticGraph, modelId: string): Promise<{ vertexCount: number; edgeCount: number; failedVertexCount: number; failedEdgeCount: number }> {
    const graphName = this.database.graphName();
    const nodeTypeMap = new Map(graph.nodes.map((n) => [n.id, n]));
    const relationTypeMap = new Map(graph.relations.map((r) => [r.id, r]));

    let vertexCount = 0;
    let edgeCount = 0;
    let failedVertexCount = 0;
    let failedEdgeCount = 0;

    // AGE requires LOAD 'age' and search_path on the connection.
    // Use a dedicated client so a single Cypher failure does not abort subsequent statements.
    // ag_catalog.cypher() requires the Cypher to be a SQL string constant (not a $N parameter) —
    // AGE parses the query at plan time, before parameters are bound.
    const client = await this.database.acquireClient();
    try {
      await client.query(`LOAD 'age'`);
      await client.query(`SET search_path = ag_catalog, "$user", public`);

      // Ensure vertex labels exist before MERGE
      const uniqueVertexLabels = new Set(
        graph.records.map((r) => {
          const nt = nodeTypeMap.get(r.nodeTypeId);
          return nt ? sanitizeLabel(nt.key) : null;
        }).filter((l): l is string => l !== null),
      );
      for (const lbl of uniqueVertexLabels) {
        try {
          await client.query(`SELECT * FROM ag_catalog.create_vlabel($1, $2)`, [graphName, lbl]);
        } catch { /* label already exists — ignore */ }
      }

      for (const record of graph.records) {
        const nodeType = nodeTypeMap.get(record.nodeTypeId);
        if (!nodeType) continue;

        const label = sanitizeLabel(nodeType.key);
        const setClauses = buildSetClauses(record, nodeType);
        const sourceDocId = record.values['_source_document_id'];
        const sourceFileName = record.values['_source_file_name'];
        // n.record_label avoids the reserved Cypher keyword "label"
        const cypher =
          `MERGE (n:${label} {record_id: '${esc(record.id)}'}) ` +
          `SET n.model_id = '${esc(modelId)}', n.record_label = ${escVal(record.label)}, n.node_type_id = '${esc(record.nodeTypeId)}', n.status = '${esc(record.status)}', ` +
          `n.source_document_id = ${escVal(sourceDocId ?? null)}, n.source_file_name = ${escVal(sourceFileName ?? null)}` +
          `${setClauses ? `, ${setClauses}` : ''} RETURN n`;

        try {
          await client.query(ageCypherSql(graphName, cypher, 'v ag_catalog.agtype'));
          vertexCount++;
        } catch (err) {
          failedVertexCount++;
          this.logger.warn(`AGE vertex upsert failed record=${record.id}: ${(err as Error).message}`);
        }
      }

      // Ensure edge labels exist before MERGE
      const uniqueEdgeLabels = new Set(
        graph.recordRelations.map((r) => {
          const rt = relationTypeMap.get(r.relationTypeId);
          return rt ? sanitizeLabel(rt.key) : null;
        }).filter((l): l is string => l !== null),
      );
      for (const lbl of uniqueEdgeLabels) {
        try {
          await client.query(`SELECT * FROM ag_catalog.create_elabel($1, $2)`, [graphName, lbl]);
        } catch { /* label already exists — ignore */ }
      }

      for (const rel of graph.recordRelations) {
        const relType = relationTypeMap.get(rel.relationTypeId);
        if (!relType) continue;

        const edgeLabel = sanitizeLabel(relType.key);
        const cypher =
          `MATCH (s {record_id: '${esc(rel.sourceRecordId)}'}), (t {record_id: '${esc(rel.targetRecordId)}'}) ` +
          `MERGE (s)-[r:${edgeLabel} {rel_id: '${esc(rel.id)}'}]->(t) RETURN r`;

        try {
          await client.query(ageCypherSql(graphName, cypher, 'e ag_catalog.agtype'));
          edgeCount++;
        } catch (err) {
          failedEdgeCount++;
          this.logger.warn(`AGE edge upsert failed rel=${rel.id}: ${(err as Error).message}`);
        }
      }
    } finally {
      client.release();
    }

    return { vertexCount, edgeCount, failedVertexCount, failedEdgeCount };
  }

  async readGraph(modelId: string): Promise<AgeGraphData> {
    const graphName = this.database.graphName();
    const nodes: AgeGraphNode[] = [];
    const edges: AgeGraphEdge[] = [];

    const client = await this.database.acquireClient();
    try {
      await client.query(`LOAD 'age'`);
      await client.query(`SET search_path = ag_catalog, "$user", public`);

      try {
        const vRows = await client.query(
          ageCypherSql(
            graphName,
            `MATCH (n) WHERE n.model_id = '${esc(modelId)}' RETURN n`,
            'v ag_catalog.agtype',
          ),
        );
        for (const row of vRows.rows) {
          const parsed = parseAgtypeObj(String(row.v));
          if (parsed?.properties?.record_id) {
            nodes.push({
              id: String(parsed.properties.record_id),
              label: String(parsed.label ?? 'node'),
              properties: parsed.properties,
            });
          }
        }
      } catch (err) {
        this.logger.warn(`AGE read vertices failed: ${(err as Error).message}`);
      }

      try {
        const eRows = await client.query(
          ageCypherSql(
            graphName,
            `MATCH (s)-[r]->(t) WHERE s.model_id = '${esc(modelId)}' AND t.model_id = '${esc(modelId)}' RETURN r, s.record_id, t.record_id`,
            'r ag_catalog.agtype, src ag_catalog.agtype, tgt ag_catalog.agtype',
          ),
        );
        for (const row of eRows.rows) {
          const parsedEdge = parseAgtypeObj(String(row.r));
          const srcId = parseAgtypeScalar(String(row.src));
          const tgtId = parseAgtypeScalar(String(row.tgt));
          if (parsedEdge && srcId && tgtId) {
            edges.push({
              id: String(parsedEdge.properties?.rel_id ?? parsedEdge.id),
              label: String(parsedEdge.label ?? ''),
              sourceId: String(srcId),
              targetId: String(tgtId),
              properties: (parsedEdge.properties ?? {}) as Record<string, unknown>,
            });
          }
        }
      } catch (err) {
        this.logger.warn(`AGE read edges failed: ${(err as Error).message}`);
      }
    } finally {
      client.release();
    }

    return { nodes, edges };
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

// AGE requires the Cypher query to be a string constant at SQL parse time — NOT a $N parameter.
// Build the complete SQL with the Cypher inlined using a dollar-quote tag that cannot appear in our data.
function ageCypherSql(graphName: string, cypher: string, returnCols: string): string {
  const gn = graphName.replace(/'/g, "''");
  return `SELECT * FROM ag_catalog.cypher('${gn}', $agecypher$${cypher}$agecypher$) AS (${returnCols})`;
}

function parseAgtypeObj(raw: string): { id: unknown; label: string; properties: Record<string, unknown> } | null {
  try {
    const json = raw.replace(/::vertex$/, '').replace(/::edge$/, '').trim();
    return JSON.parse(json) as { id: unknown; label: string; properties: Record<string, unknown> };
  } catch {
    return null;
  }
}

function parseAgtypeScalar(raw: string): string | number | boolean | null {
  try { return JSON.parse(raw) as string | number | boolean | null; } catch { return null; }
}

// Builds SET clauses for all attributes.
// AGE cannot store null — use the sentinel '__missing__' for null/undefined values
// so the vertex always carries every attribute and the viewer can highlight missing ones.
const MISSING_SENTINEL = '__missing__';

function buildSetClauses(record: SemanticRecord, nodeType: SemanticNodeType): string {
  const parts: string[] = [];
  for (const attr of nodeType.attributes) {
    const val = record.values[attr.key];
    const colName = sanitizeKey(attr.key);
    const cyperVal = (val === null || val === undefined) ? `'${MISSING_SENTINEL}'` : escVal(val);
    parts.push(`n.${colName} = ${cyperVal}`);
  }
  return parts.join(', ');
}

function esc(val: string): string {
  return val
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function escVal(val: unknown): string {
  if (val === null || val === undefined) return "''";
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : "''";
  if (typeof val === 'boolean') return String(val);
  return `'${esc(String(val))}'`;
}

function sanitizeLabel(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9_]/g, '_');
  return /^[0-9]/.test(safe) ? `_${safe}` : safe || 'Node';
}

function sanitizeKey(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9_]/g, '_');
  return /^[0-9]/.test(safe) ? `_${safe}` : safe || 'attr';
}
