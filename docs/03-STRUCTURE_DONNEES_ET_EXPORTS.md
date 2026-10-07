# Structures de Données & Exports — Flux 2-Agents Ad-Hoc

---

## 1. DTO `PrepareAdhocDto` — Payload `POST /:id/prepare-adhoc`

```ts
interface PrepareAdhocDto {
  /** Agent Cible — génère la réponse brute à la question */
  agentId: string;                     // requis, ObjectId agent accessible

  /** Workspace de recherche (RAG / documents) */
  workspaceId: string;                 // requis, ObjectId workspace accessible

  /** Override modèle LLM pour l'Agent Cible (optionnel) */
  modelId?: string;                    // ObjectId modèle LiteLLM actif

  /** Restriction aux artifacts du workspace (optionnel) */
  fileScope?: string[];                // IDs artifacts (ex: ['doc-uuid-1', 'doc-uuid-2'])

  /** Agent Évaluateur (LLM Judge) — note la réponse */
  evaluatorAgentId: string;            // requis, ObjectId agent accessible

  /** Override modèle LLM pour l'Agent Judge (optionnel) */
  evaluatorModelId?: string;           // ObjectId modèle LiteLLM actif
}
```

### Exemple JSON
```json
{
  "agentId": "6a9adf730ca4edec140be1e7",
  "workspaceId": "6a9edcaee1ea25a8f0acd9c0",
  "modelId": "gpt-5.6-luna",
  "fileScope": [],
  "evaluatorAgentId": "6aaa6911d39ef132188aec00",
  "evaluatorModelId": "gpt-5.6-luna"
}
```

---

## 2. Schéma Réponse LLM Judge — `eval-judge` NodeCompleted

### Format Attendu (JSON dans `payload.output` / `raw_llm_output` / `text`)

```json
{
  "score": 0.85,
  "reasoning": "La réponse couvre les points clés (CAT, TEC10, Livret A) avec les bonnes procédures. Il manque la mention du Gap -2D pour le Livret A."
}
```

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `score` | `number` | ✅ | Note normalisée 0.0 – 1.0 (ou échelle custom, ex: 0-100 divisé par 100 côté back) |
| `reasoning` | `string` | ✅ | Justification textuelle, peut contenir retours ligne |

### Parsing Backend (`playbook-flow-execution.service.ts` l.1942-1958)

```ts
try {
  const parsed = JSON.parse(extracted);
  if (typeof parsed.score === 'number') judgeScore = parsed.score;
  if (typeof parsed.reasoning === 'string') judgeReasoning = parsed.reasoning;
} catch {
  judgeReasoning = extracted;  // fallback : texte brut si pas JSON valide
}
```

> **Tolérance** : Si le Judge renvoie du texte non-JSON, `judgeScore = undefined`, `judgeReasoning = texte brut`. L'export Excel aura colonne `judge_score` vide.

### Exemples Prompt Judge (côté Agent config)

> *Le prompt du Judge doit être configuré dans l'agent `evaluatorAgentId` pour sortir strictement :*
>
> ```text
> Tu es un évaluateur expert. Pour chaque question, tu reçois :
> - La question posée
> - La réponse attendue (ground truth)
> - La réponse générée par l'agent cible
>
> Renvoie UNIQUEMENT un JSON valide :
> { "score": <float 0-1>, "reasoning": "<string>" }
>
> Critères : exactitude factuelle, complétude, clarté, alignement avec la ground truth.
> ```

---

## 3. Structure Fichier Excel Export — `GET /:id/export`

### Génération
- **Endpoint** : `GET /evaluation/logical-search/:id/export` → `service.exportXlsx()` → `XLSX.write(buffer, { type: 'buffer', bookType: 'xlsx' })`
- **Nom fichier** : `logical_search_evaluation_{evaluationId}.xlsx`
- **Lib** : `xlsx` (SheetJS)

### Feuille 1 — **Global Summary** (Métriques agrégées)

| Colonne | Valeur / Source |
|---------|-----------------|
| `query_count` | `summary.query_count` (total queries) |
| `completed_queries` | `summary.completed_queries` |
| `failed_queries` | `summary.failed_queries` |
| `mean_answer_correctness` | `summary.mean_answer_correctness` |
| `mean_answer_token_recall` | `summary.mean_answer_token_recall` |
| `mean_answer_token_precision` | `summary.mean_answer_token_precision` |
| `mean_answer_f1` | `summary.mean_answer_f1` |
| `mean_semantic_similarity` | `summary.mean_semantic_similarity` |
| `mean_fact_recall` | `summary.mean_fact_recall` |
| `mean_fact_precision` | `summary.mean_fact_precision` |
| `mean_answer_quality` | `summary.mean_answer_quality` (score composite pondéré) |
| `answer_exact_match_rate` | `summary.answer_exact_match_rate` |
| `mean_file_recall` | `summary.mean_file_recall` |
| `mean_file_precision` | `summary.mean_file_precision` |
| `mean_page_hit` | `summary.mean_page_hit` |
| `retrieval_success_rate` | `summary.retrieval_success_rate` |
| `retrieval_exact_match_rate` | `summary.retrieval_exact_match_rate` |
| **`mean_judge_score`** | **NOUVEAU** : `mean(results.map(r => r.judge_score).filter(v => v !== undefined))` |
| `evaluation_id` | ID évaluation |
| `status` | Statut final (`completed` / `failed` / `stopped`) |
| `created_at` | `evaluation.createdAt` |
| `completed_at` | Date fin run (si completed) |

> **Note** : `mean_judge_score` absent si architecture mono-agent ou aucun `judge_score` parsé.

---

### Feuille 2 — **Detailed Results** (1 ligne par query)

| Colonne | Source | Description |
|---------|--------|-------------|
| `query_id` | `r.query_id` | Identifiant question (ex: `Q001`) |
| `query` | `r.query` | Texte de la question |
| `expected_answer` | `r.expected_answer` | Ground truth du benchmark |
| `generated_answer` | `r.generated_answer` | **Réponse Agent Cible** (`targetAnswer`) |
| `judge_score` | `r.judge_score` | **NOUVEAU** : Score Judge (float 0-1) |
| `judge_reasoning` | `r.judge_reasoning` | **NOUVEAU** : Justification Judge |
| `status` | `r.status` | `completed` / `failed` |
| `duration_ms` | `r.duration_ms` | Temps exécution query |
| `error` | `r.error` | Message erreur si failed |
| **Métriques Retrieval** | | |
| `retrieval_file_recall` | `r.metrics.retrieval.file_recall` | Rappel fichiers |
| `retrieval_file_precision` | `r.metrics.retrieval.file_precision` | Précision fichiers |
| `retrieval_page_hit` | `r.metrics.retrieval.page_hit_count` | % pages exactes |
| `retrieval_success` | `r.metrics.retrieval.retrieval_success` | Booléen succès global |
| `retrieval_exact_match` | `r.metrics.retrieval.exact_match` | Match exact sources |
| `retrieved_files` | `r.retrieved_files.join('; ')` | Liste fichiers récupérés (séparés `; `) |
| `retrieved_pages` | `r.retrieved_pages.join(', ')` | Pages citées |
| **Métriques Answer** | | |
| `answer_token_recall` | `r.metrics.answer.token_recall` | Rappel tokens |
| `answer_token_precision` | `r.metrics.answer.token_precision` | Précision tokens |
| `answer_f1` | `r.metrics.answer.f1` | F1 tokens |
| `answer_semantic_similarity` | `r.metrics.answer.semantic_similarity` | Similarité LCS normalisée |
| `answer_fact_recall` | `r.metrics.answer.fact_recall` | Rappel faits extraits |
| `answer_fact_precision` | `r.metrics.answer.fact_precision` | Précision faits |
| `answer_correctness` | `r.metrics.answer.answer_correctness` | Correctness déterministe |
| `answer_quality` | `r.metrics.answer.answer_quality` | Score composite (0.6 corr + 0.2 factR + 0.1 factP + 0.1 sim) |
| `answer_exact_match` | `r.metrics.answer.exact_match` | Booléen correctness ≥ 0.9 |
| `expected_facts` | `r.metrics.answer.expected_facts.join('; ')` | Faits attendus extraits |
| `generated_facts` | `r.metrics.answer.generated_facts.join('; ')` | Faits trouvés dans réponse |
| `matched_facts` | `r.metrics.answer.matched_facts.join('; ')` | Faits communs |

> **Compatibilité** : Colonnes `judge_score` / `judge_reasoning` vides si architecture mono-agent (pas d'`eval-judge`).

---

## 4. Artefacts Disque — `uploads/eval/{evaluationId}/`

| Fichier | Format | Description |
|---------|--------|-------------|
| `request_template.json` | JSON | Template `RunRequest` gRPC (snapshot 2 nœuds, `input_context` vide) |
| `config.json` | JSON | Orchestration : `answer_node_id: 'eval-judge'`, `target_node_id: 'eval-target'`, `query_path`, `additional_query_paths`, `timeout_seconds` |
| `adhoc-config.json` | JSON | Métadonnées : `agentId`, `evaluatorAgentId`, `workspaceId`, `modelId`, `evaluatorModelId`, `fileScope`, `createdAt` |
| `benchmark_queries.json` | JSON | `{ queries: BenchmarkQuery[] }` — 50 questions source |
| `dataset.zip` | ZIP | Archive `benchmark_queries.json` (traçabilité) |
| `results.json` | JSON | `EvaluationQueryResult[]` — écrit incrémental, base reprise |
| `summary.json` | JSON | `EvaluationRunSummary` — moyennes globales |
| `progress.json` | JSON | `{ done, total, currentIndex, currentQueryId, currentQuery, startedAt, updatedAt }` |
| `outputs/` | Dossier | (Réservé évaluateur Python standalone, vide en flux back) |

---

## 5. Modèles BDD — `LogicalSearchEvaluation` (Mongoose)

```ts
interface LogicalSearchEvaluation {
  _id: ObjectId;
  ownerId: ObjectId;
  name: string;                          // ex: "Benchmark Summit 2024-09-16"
  status: 'dataset_ready' | 'prepared' | 'running' | 'completed' | 'failed';
  sourceFileName: string;                // nom fichier uploadé
  queryCount: number;                    // 50
  queries: { queries: BenchmarkQuery[] }; // embedded
  agentId: ObjectId | null;              // Agent Cible (legacy + nouveau)
  flowId: string | null;                 // ex: "eval-flow-{id}"
  workspaceId: ObjectId | null;
  executionId: string | null;            // null pour ad-hoc
  modelId: string | null;                // Override modèle Cible
  answerNodeId: string | null;           // "eval-judge" (nouveau) ou "eval-answer" (legacy)
  summary: Record<string, unknown> | null; // dernier buildSummary()
  error: string | null;                  // dernier error si failed
  createdAt: Date;
  updatedAt: Date;
}
```

> **Index** : `{ ownerId: 1, createdAt: -1 }`, `{ ownerId: 1, status: 1 }`

---

## 6. `EvaluationQueryResult` — Structure Complète (Front/Back)

```ts
interface EvaluationQueryResult {
  // Identité
  query_id: string;                      // "Q001"
  query: string;                         // texte question
  expected_answer: string;               // ground truth
  required_file: string[];               // ["Fiche Produit CAT_v1.0.pdf", ...]
  page: number[];                        // [10, 11, 12, ...]

  // Réponses
  generated_answer: string;              // réponse Agent Cible (pour métriques TS)
  status: 'completed' | 'failed';
  duration_ms: number;
  error?: string | null;

  // Judge (NOUVEAU)
  judge_score?: number;                  // 0.0 - 1.0
  judge_reasoning?: string;              // justification texte

  // Métriques déterministes (port Python)
  metrics: {
    retrieval: RetrievalMetrics;
    answer: AnswerMetrics;
  };

  // Dénormalisés pour export Excel
  retrieved_files: string[];
  retrieved_pages: number[];
  retrieved_sources: { file: string; page: number }[];
}
```

---

## 7. Flux de Données — Résumé Visuel

```mermaid
flowchart TD
    A[Upload .xlsx/.csv] --> B[POST /upload]
    B --> C[Parse → logical_search_evaluations status=dataset_ready]
    C --> D[UI: Config 2 Agents + Workspace]
    D --> E[POST /:id/prepare-adhoc]
    E --> F[Validation 2 agents + workspace]
    F --> G[Génère snapshot 2 nœuds + controlEdge + dataBinding]
    G --> H[Écrit artefacts uploads/eval/{id}/]
    H --> I[BDD status=prepared answerNodeId=eval-judge]
    I --> J[UI: Clic Lancer]
    J --> K[POST /:id/run]
    K --> L[Lit config.json + template + benchmark_queries.json]
    L --> M[Boucle 50 queries]
    M --> N[Clone template + inject query + expected_answer]
    N --> O[runEvaluationQuery gRPC stream]
    O --> P[Résolution 2 agents via buildGrpcAgentsForPlaybook]
    P --> Q[Enrichissement nœuds + dataBindings sourceKind=node-output]
    Q --> R[Envoi RunRequest gRPC → ADK runtime :50051]
    R --> S[Stream RunEvent: NodeCompleted(eval-target) → targetAnswer]
    S --> T[NodeCompleted(eval-judge) → JSON parse → judgeScore/reasoning]
    T --> U[ExecutionCompleted → status=completed]
    U --> V[buildQueryResult + buildAnswerMetrics + buildRetrievalMetrics]
    V --> W[Écriture results.json + summary.json + progress.json]
    W --> X[Poll 2.5s → UI met à jour progression]
    X --> Y{Fin boucle?}
    Y -->|Non| M
    Y -->|Oui| Z[BDD status=completed + summary final]
    Z --> AA[Export XLSX dispo]
```