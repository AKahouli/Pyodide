import { ConnectorActionSafety } from '../connector.types';

/**
 * Hidden system connector exposing the record search tools of the
 * mcp-semantic-model server. It is bound to chat agents only when a message
 * carries a semantic model, with `model_id` and `data` fixed by the back.
 */
export const SEMANTIC_MODEL_SEARCH_MCP_CONNECTOR_SLUG = 'semantic-model-search-mcp';

export const SEMANTIC_MODEL_SEARCH_MCP_RUNTIME_AUTH_SECRET_KEY = 'semantic_model_mcp_ingress';

export const SEMANTIC_MODEL_SEARCH_ACTION_KEYS = ['find_records', 'get_related_records'] as const;

interface ActionSeed {
  key: string;
  label: string;
  description: string;
  parameterSchema: Record<string, unknown>;
  safety: ConnectorActionSafety;
}

const stringList = (description: string) => ({ type: 'array', items: { type: 'string' }, description });

const MODEL_ID_PROPERTY = { type: 'string', description: 'Semantic model id.' };
const DATA_PROPERTY = {
  type: 'string',
  enum: ['published', 'draft'],
  default: 'published',
  description: 'Which data of the model to read.',
};

/** Snapshot of the read-only search tools of mcp-semantic-model (mcp/mcp-semantic-model/server.py). */
export const SEMANTIC_MODEL_SEARCH_MCP_ACTIONS: ActionSeed[] = [
  {
    key: 'find_records',
    label: 'Find records',
    description:
      'Find the records of a semantic model that match a question: by exact key or name first, then by words and meaning. '
      + 'Use it first, then get_related_records with the entityId of the records found. '
      + 'Results are records stored in the model (a customer, a contract, an invoice...), NOT documents. '
      + 'match says how a record was found (exact, lexical, vector, hybrid); a vector or hybrid match is a likely candidate, not proof: check its fields. '
      + 'Status index_not_ready means records may be missing, not_represented means the model has no such concept, no_match means no record matches.',
    parameterSchema: {
      type: 'object',
      properties: {
        model_id: MODEL_ID_PROPERTY,
        query: { type: 'string', description: 'What to look for, in natural language or an exact identifier.' },
        concepts: stringList('Optional concept names (or keys) to search in, e.g. ["Contract"].'),
        data: DATA_PROPERTY,
        limit: { type: 'integer', minimum: 1, maximum: 25, default: 10, description: 'Maximum number of records to return (1 to 25).' },
      },
      required: ['model_id', 'query'],
    },
    safety: ConnectorActionSafety.READ,
  },
  {
    key: 'get_related_records',
    label: 'Get related records',
    description:
      'Follow the real links (relationships of the model) from records returned by find_records (their entityId) to the records linked to them. '
      + 'A related record is included because it is linked, NOT because it matched anything: its path says through which relationship. '
      + 'then_relations adds an optional second step from the records reached by the first, and must name its relationships. '
      + 'truncated=true means more linked records exist than were returned.',
    parameterSchema: {
      type: 'object',
      properties: {
        model_id: MODEL_ID_PROPERTY,
        record_ids: stringList('entityId of the records to start from, as returned by find_records (1 to 25).'),
        relations: stringList('Relationships to follow (names or keys); omitted means every relationship of these records, one step away.'),
        direction: {
          type: 'string',
          enum: ['outgoing', 'incoming', 'both'],
          default: 'both',
          description: 'Direction of the relations to follow.',
        },
        then_relations: stringList('Relationships of an optional second step, followed from the records reached by the first.'),
        concepts: stringList('Keep only related records of these concepts (applied to the last step).'),
        data: DATA_PROPERTY,
        max_records: { type: 'integer', minimum: 1, maximum: 100, default: 50, description: 'Maximum number of records to return (1 to 100).' },
      },
      required: ['model_id', 'record_ids'],
    },
    safety: ConnectorActionSafety.READ,
  },
];
