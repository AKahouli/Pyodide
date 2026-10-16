# Architecture Backend & Services — Flux 2-Agents Ad-Hoc

## 1. Endpoint `POST /evaluation/logical-search/:id/prepare-adhoc`

### Fichiers
- **Contrôleur** : `back/src/modules/evaluation-logical-search/controllers/logical-search-evaluation.ts` (l.62-73)
- **Service** : `back/src/modules/evaluation-logical-search/services/logical-search-evaluation.service.ts` (méthode `prepareAdhoc` l.301-481)

### DTO Entrée (`PrepareAdhocDto` implicite via `@Body()`)

```ts
{
  agentId: string;              // Agent Cible (requis)
  workspaceId?: string;         // Workspace (requis)
  modelId?: string;             // Override modèle Cible (optionnel)
  fileScope?: string[];         // IDs artifacts filtrés (optionnel)
  evaluatorAgentId: string;     // Agent Judge / LLM Judge (requis)
  evaluatorModelId?: string;    // Override modèle Judge (optionnel)
}
```

### Validation & Résolution Agents (l.313-324)

```ts
const targetAgentId = input.agentId?.trim() ?? '';
const evaluatorAgentId = input.evaluatorAgentId?.trim() ?? '';
if (!targetAgentId) throw BadRequestException('agentId is required.');
if (!evaluatorAgentId) throw BadRequestException('evaluatorAgentId is required.');

const accessible = await this.agentService.findByIds([targetAgentId, evaluatorAgentId], ownerId);
if (accessible.length < 2) throw BadRequestException('One or both agents not found or not accessible.');
```

> `findByIds` = agents possédés + partagés (authz propriétaire ou collaborateur).

### Génération du Snapshot Synthétique (l.331-378)

**Nœud 1 — Agent Cible (`eval-target`)**
```ts
{
  id: 'eval-target',
  kind: 'step',
  label: 'Target Answer',
  modelId: input.modelId?.trim() || undefined,  // override ou modèle par défaut de l'agent
  metadata: {
    assignedAgentId: targetAgentId,
    description: '',  // injecté au run via additional_query_paths
  }
}
```

**Nœud 2 — Agent Judge (`eval-judge`)**
```ts
{
  id: 'eval-judge',
  kind: 'step',
  label: 'LLM Judge',
  modelId: input.evaluatorModelId?.trim() || undefined,
  metadata: {
    assignedAgentId: evaluatorAgentId,
    description: '',
  }
}
```

**Liaison (ControlEdge + DataBinding)**
```ts
controlEdges: [{
  id: 'edge-target-to-judge',
  kind: 'default',
  source: 'eval-target',
  target: 'eval-judge',
  routerLabel: '',
  priority: 0,
  sourceOutputPortId: '',
  targetInputPortId: '',
}],
dataBindings: [{
  id: 'binding-target-output-to-judge-input',
  sourceKind: 'node-output',          // REQUIS par ADK parse_data_source
  sourceNodeId: 'eval-target',
  sourceOutputPortId: 'output',       // port de sortie du step (texte brut)
  targetNodeId: 'eval-judge',
  targetInputPortId: 'target_answer', // port d'entrée attendu côté Judge
}]
```

### Artefacts Écrits dans `uploads/eval/{evaluationId}/`

| Fichier | Contenu | Usage |
|---------|---------|-------|
| `request_template.json` | Template `RunRequest` gRPC : `execution_id`, `flow_id`, `owner_id`, `snapshot`, `input_context: {query:'', expected_answer:''}`, `settings` | Template cloné par query au run |
| `config.json` | `{ answer_node_id: 'eval-judge', target_node_id: 'eval-target', query_path: ['input_context','query'], additional_query_paths: [[...nodes,0,metadata,description], ['input_context','expected_answer']], timeout_seconds: 600, ... }` | Orchestrateur run |
| `adhoc-config.json` | `{ agentId, evaluatorAgentId, workspaceId, modelId, evaluatorModelId, fileScope, createdAt }` | Métadonnées archivage / audit |
| `benchmark_queries.json` | Copie `evaluation.queries` (array 50 questions) | Source de vérité au run |
| `dataset.zip` | Archive `benchmark_queries.json` | Traçabilité / standalone evaluator |

### Mise à jour BDD (l.419-436)

```ts
await this.repository.applyPrepare({
  id: evaluationId,
  agentId: targetAgentId,
  flowId: null,
  workspaceId,
  executionId: null,
  modelId: input.modelId ?? null,
  answerNodeId: 'eval-judge',     // nœud final = Judge
  status: 'prepared',
});
```

---

## 2. Endpoint `POST /evaluation/logical-search/:id/run`

### Fichiers
- **Contrôleur** : `.../controllers/logical-search-evaluation.ts` (l.75-79)
- **Service Orchestrateur** : `.../services/logical-search-evaluation.service.ts` (méthode `run` l.483-652)
- **Exécution gRPC** : `back/src/modules/playbook-flow/services/playbook-flow-execution.service.ts` (méthode `runEvaluationQuery` l.1754-1965)

### Flux `run()` — Boucle Queries (l.532-606)

```ts
const config = await readJson(join(runDir, 'config.json'));
const template = await readJson(join(runDir, 'request_template.json'));
const benchmark = await readJson(join(runDir, 'benchmark_queries.json'));
const queries = benchmark.queries;

for (let i = 0; i < queries.length; i++) {
  if (this.activeRuns.get(evaluationId) === true) { stopped = true; break; }
  if (doneQueryIds.has(queryId)) continue;  // reprise partielle

  // 1. Clone template + inject query + expected_answer
  const payload = JSON.parse(JSON.stringify(template));
  payload.execution_id = `eval-${evaluationId}-${queryId}`;
  setDeepPath(payload, config.query_path, queryText);                    // ['input_context','query']
  for (const path of config.additional_query_paths) {
    setDeepPath(payload, path, queryText);                               // description + expected_answer
  }

  // 2. Appel gRPC
  const runResult = await this.executionService.runEvaluationQuery({
    executionId: `eval-${evaluationId}-${queryId}`,
    flowId: template.flow_id,
    ownerId,
    snapshot: payload.snapshot,
    inputContext: { query: queryText },
    answerNodeId: 'eval-judge',   // nœud final = Judge
  });

  // 3. Extraction double réponse
  const targetAnswer = runResult.targetAnswer ?? runResult.generatedAnswer;
  const judgeScore = runResult.judgeScore;
  const judgeReasoning = runResult.judgeReasoning;

  // 4. Consolidation métriques (TS port of Python evaluator)
  results.push(buildQueryResult({
    queryId,
    query: queryText,
    expectedAnswer: benchmarkQuery.answer ?? '',
    requiredFile: benchmarkQuery.required_file ?? null,
    page: benchmarkQuery.page ?? null,
    generatedAnswer: targetAnswer,    // réponse Cible pour métriques TS
    status: runResult.status,
    durationMs: runResult.durationMs,
    error: runResult.error,
    toolCalls: runResult.toolCalls,
  }));
  // champs Judge ajoutés en extension
  if (judgeScore !== undefined) results[last].judgeScore = judgeScore;
  if (judgeReasoning !== undefined) results[last].judgeReasoning = judgeReasoning;

  // 5. Écriture incrémentale
  await writeFile(join(runDir, 'results.json'), JSON.stringify(results, null, 2));
  await writeFile(join(runDir, 'summary.json'), JSON.stringify(buildSummary(results), null, 2));
  await this.writeProgress(runDir, { done: results.length, total: queries.length, ... });
}
```

---

## 3. Exécution gRPC — `runEvaluationQuery` (`playbook-flow-execution.service.ts` l.1754-1965)

### Résolution Agents (l.1769-1801)

```ts
const agentIds = new Set<string>();
for (const node of nodes) {
  const assignedAgentId = node.metadata?.assignedAgentId;
  if (assignedAgentId) agentIds.add(assignedAgentId);
}
const resolved = await this.agentService.buildGrpcAgentsForPlaybook(
  normalizedOwnerId,
  [...agentIds],           // [targetAgentId, evaluatorAgentId]
  undefined,
  executionId,
  { userId: normalizedOwnerId, scopeType: 'playbook', scopeId: `playbook:${executionId}`, laneId: 'main' },
);
```

> Retourne `IGrpcAgent[]` avec `chatbot.model`, `skills`, `connector_bindings`, `brain_context` (knowledge bases).

### Enrichissement Nœuds (l.1804-1819)

Chaque nœud reçoit ses métadonnées runtime via `buildNodeRuntimeAgentMetadata` : `agent_model`, `agent_prompt`, `agent_tools`, `skills`, `connector_bindings`, `brain_context`.

### Construction Requête gRPC (l.1840-1886)

- `execution_id`, `flow_id`, `owner_id`
- `snapshot.nodes[]` → conversion camelCase → proto (`model_id`, `metadata` via `toGrpcStruct`)
- `control_edges` + `data_bindings` (via `buildDataBindingsProto` → `sourceKind: 'node-output'`)
- `input_context` enrichi : `__playbook_workspace_ids`, `__playbook_workspace_paths` (Ceph paths)

### Consommation Stream & Double Capture (l.1888-1964)

Variables d'état :
```ts
let targetAnswer = '';
let judgeScore: number | undefined;
let judgeReasoning: string | undefined;
```

Sur chaque `call.on('data', event)` :

| Node ID | Événement | Extraction |
|---------|-----------|------------|
| `eval-target` | `NodeCompleted` / `OUTPUT` / `ExecutionCompleted` | `payload.output` → `raw_llm_output` → `text` → `extractEvaluationAnswer()` → `targetAnswer` |
| `eval-judge` | `NodeCompleted` / `OUTPUT` / `ExecutionCompleted` | Même logique → texte brut → **`JSON.parse()`** → `{ score: number, reasoning: string }` → `judgeScore`, `judgeReasoning` |
| — | `ExecutionCompleted` | `status = 'completed'` |
| — | `ExecutionFailed` | `status = 'failed'`, `error = payload.error` |

**Parsing Judge (l.1942-1958)** :
```ts
const extracted = extractEvaluationAnswer(candidate);
if (extracted) {
  try {
    const parsed = JSON.parse(extracted);
    if (typeof parsed.score === 'number') judgeScore = parsed.score;
    if (typeof parsed.reasoning === 'string') judgeReasoning = parsed.reasoning;
  } catch {
    judgeReasoning = extracted;  // fallback texte brut
  }
}
```

### Retour `EvaluationQueryRunResult` (interface étendue l.90-96)

```ts
export interface EvaluationQueryRunResult {
  status: 'completed' | 'failed';
  generatedAnswer: string;      // = targetAnswer (compat)
  targetAnswer: string;         // réponse brute Agent Cible
  judgeScore?: number;          // 0..1 ou échelle custom
  judgeReasoning?: string;      // justification textuelle
  toolCalls: Array<{ nodeId, iteration, trace }>;
  durationMs: number;
  error: string | null;
}
```

---

## 4. Module Métriques — `evaluation-metrics.ts` (Port TS fidèle Python)

Conservation 100% des métriques déterministes :

| Catégorie | Fonctions clés | Sortie |
|-----------|----------------|--------|
| **Token overlap** | `tokenOverlapMetrics`, `semanticSimilarity` (LCS rolling) | `token_recall`, `token_precision`, `f1`, `semantic_similarity` |
| **Faits** | `extractFacts` (%, currency, durées, standards), `factMetrics` | `fact_recall`, `fact_precision`, `matched_facts[]` |
| **Correctness** | `deterministicAnswerCorrectness` (faits > tokens) | `answer_correctness`, `answer_quality` (pondéré 0.6/0.2/0.1/0.1) |
| **Récupération** | `buildRetrievalMetrics` (citations, file+page pairs, exact match) | `file_recall`, `file_precision`, `page_hit`, `retrieval_success` |

**Entrée** : `generatedAnswer` (Cible) + `expectedAnswer` + `toolCalls` (traces RAG) + `required_file[]` + `page[]`

**Sortie** : `EvaluationQueryResult.metrics { retrieval: RetrievalMetrics, answer: AnswerMetrics }` + champs plats `retrieved_files`, `retrieved_sources`, `judge_score`, `judge_reasoning`.

---

## 5. Persistance & Progression

| Fichier | Fréquence | Contenu |
|---------|-----------|---------|
| `results.json` | Après **chaque** query | Array complet `EvaluationQueryResult[]` |
| `summary.json` | Après chaque query + fin | `buildSummary(results)` → moyennes globales |
| `progress.json` | Après chaque query (atomic `.tmp` → `rename`) | `{ done, total, currentIndex, currentQueryId, currentQuery, startedAt, updatedAt }` |
| `progress.json` (poll) | Frontend 2.5s | `GET /:id/progress` → lit fichier |

**Reprise** : `run()` lit `results.json` au démarrage → `doneQueryIds` → saute queries traitées.

**Purge re-Prepare** : `prepareAdhoc` supprime `results.json`, `summary.json`, `progress.json`, `progress.json.tmp`, dossier `outputs/` avant ré-écriture.