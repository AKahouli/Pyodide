# Étude de Faisabilité — Approche Ad-hoc (sans Playbook)

**Branche** : `feature/eval-adhoc-config`  
**Date** : 15/09/2026  
**Statut** : Plan d'action validé, implémentation à venir

---

## 1. Contexte

L'approche actuelle de l'évaluation "logical search" dépend des **Playbooks** et de leurs **Snapshots** persistés en MongoDB. L'utilisateur doit :

1. Créer / sélectionner un playbook
2. Lancer le playbook pour générer une exécution (snapshot)
3. Sélectionner cette exécution dans la page d'évaluation
4. Cliquer "Préparer" (capture le snapshot dans `request_template.json`)
5. Cliquer "Lancer" (boucle sur les queries)

**Objectif** : supprimer cette dépendance aux playbooks pour permettre une configuration directe : l'utilisateur choisit un agent, un workspace, un modèle — et lance l'évaluation en un clic.

---

## 2. Faisabilité Technique

### 2.1. Ce que le runtime gRPC exige réellement

La méthode `runEvaluationQuery` (`playbook-flow-execution.service.ts:1754`) construit la payload gRPC `RunRequest` à partir d'un objet `snapshot`. En analysant le code, voici ce qui est **effectivement lu** :

| Besoin | Code qui lit | Champ source |
|---|---|---|
| Résoudre l'agent | Lignes 1770-1776 : scanne `snapshot.nodes[].metadata.assignedAgentId` | `metadata.assignedAgentId` |
| Résoudre le modèle | Ligne 1818 : `node.modelId` ou `agent.agent_model` | `node.model_id` |
| Résoudre les workspaces | Lignes 1822-1833 : lit `snapshot.workspaces` | `snapshot.workspaces: string[]` |
| Settings d'exécution | Lignes 1764-1766 : `snapshot.settings.recursionLimit` / `maxParallelism` | `snapshot.settings` |
| Node de réponse | Ligne 1768 : `answerNodeId` pour extraire la réponse | ID du node |

### 2.2. Ce que le runner ADK reçoit

Le proto `RunRequest` (playbook-flow.proto) :

```protobuf
message RunRequest {
  string execution_id = 1;
  string flow_id = 2;
  string owner_id = 3;
  FlowSnapshot snapshot = 4;
  google.protobuf.Struct input_context = 5;
  RunSettings settings = 6;
  repeated SeededTaskOutput seeded_task_outputs = 7;
}
```

Proto3 n'a pas de `required`. Le runner traite la requête quelle que soit la source du snapshot. **Le runner est agnostique** — il ne sait pas si le snapshot vient d'un vrai playbook ou d'un snapshot synthétique.

### 2.3. Conclusion de faisabilité

**OUI, c'est réalisable** sans aucun changement côté proto ni côté runner ADK. Il suffit de construire un `FlowSnapshot` minimal à la volée dans le backend NestJS.

Toute la chaîne d'enrichissement (résolution agent → connecteurs → skills → workspaces → modèle) se fait dans `runEvaluationQuery` **avant** l'envoi gRPC. Un snapshot synthétique avec le bon `assignedAgentId` suffit pour déclencher toute cette chaîne.

---

## 3. Snapshot Synthétique

Le snapshot minimal requis pour un agent unique sans arêtes ni liaisons :

```typescript
{
  nodes: [{
    id: 'eval-answer',
    kind: 'step',
    label: 'Answer',
    metadata: {
      assignedAgentId: '<agentId sélectionné>',
      description: '{{query}}'  // surchargé par additional_query_paths
    },
    model_id: '<modelId sélectionné>' || undefined
  }],
  controlEdges: [],
  dataBindings: [],
  settings: {
    recursionLimit: 25,
    maxParallelism: 5
  },
  workspaces: ['<workspaceId sélectionné>'] || []
}
```

- **`nodes`** : un seul node de type `step` portant l'agent assigné.
- **`controlEdges`** : vide (pas de routing, pas d'itérateur).
- **`dataBindings`** : vide (pas de flux de données entre nodes).
- **`workspaces`** : array d'IDs de workspace, résolu en chemins de fichiers par `workspaceService.getStoragePathMapByIds()`.
- **`model_id`** : override optionnel du modèle de l'agent (le runtime l'écrase à la ligne 1818 de `playbook-flow-execution.service.ts`).

---

## 4. Artefacts `uploads/eval/{id}/`

### 4.1. Fichiers existants (inchangés)

| Fichier | Source | Contenu |
|---|---|---|
| `benchmark_queries.json` | Upload CSV/XLSX | 50 questions + réponses attendues |
| `dataset.zip` | Upload CSV/XLSX | Archive du benchmark |
| `results.json` | Run | Résultats par query (métriques, durée, status) |
| `summary.json` | Run | Agrégats (mean F1, recall, etc.) |
| `progress.json` | Run | Progression en temps réel |
| `outputs/` | Run | Sorties brutes par query |

### 4.2. Nouveaux fichiers (ad-hoc)

| Fichier | Source | Contenu |
|---|---|---|
| `adhoc-config.json` | Prepare ad-hoc | `{ agentId, workspaceId?, modelId?, fileScope?, createdAt }` — traçabilité |
| `request_template.json` | Prepare ad-hoc | Contient le **snapshot synthétique** (remplace le snapshot playbook) |
| `config.json` | Prepare ad-hoc | Même structure, `answer_node_id = 'eval-answer'`, `flow_id` synthétique |

### 4.3. `request_template.json` (ad-hoc)

```json
{
  "execution_id": "eval-{evaluationId}-adhoc",
  "flow_id": "eval-flow-{evaluationId}",
  "owner_id": "{userId}",
  "snapshot": { "/* snapshot synthétique */" },
  "input_context": { "query": "" },
  "settings": { "recursion_limit": 25, "max_parallelism": 5 },
  "seeded_task_outputs": []
}
```

### 4.4. `config.json` (ad-hoc)

```json
{
  "grpc_target": "localhost:50051",
  "grpc_secure": false,
  "request_template_path": "uploads/eval/{id}/request_template.json",
  "answer_node_id": "eval-answer",
  "benchmark_zip_path": "uploads/eval/{id}/dataset.zip",
  "benchmark_queries_member": "benchmark_queries.json",
  "output_directory": "uploads/eval/{id}/outputs",
  "timeout_seconds": 600,
  "query_path": ["input_context", "query"],
  "additional_query_paths": [["snapshot", "nodes", "0", "metadata", "description"]]
}
```

---

## 5. Fichiers Impactés

### 5.1. Backend (6 fichiers)

| Fichier | Modification |
|---|---|
| `back/.../postgres/schema/evaluation.schema.ts` | Ajouter colonne `model_id` (text, nullable) |
| `back/.../repositories/logical-search-evaluation.repository.ts` | Ajouter `modelId` dans `CreateEvaluationInput` / `LinkExecutionInput` |
| `back/.../services/logical-search-evaluation.service.ts` | Nouvelle méthode `prepareAdhoc()` qui construit le snapshot synthétique + écrit les artefacts |
| `back/.../controllers/logical-search-evaluation.controller.ts` | Nouvel endpoint `POST :id/prepare-adhoc` |
| `yellowstorm-adk/` | **Aucun changement** |
| `back/.../playbook-flow/services/playbook-flow-execution.service.ts` | **Aucun changement** |

### 5.2. Frontend (5 fichiers)

| Fichier | Modification |
|---|---|
| `front/.../pages/LogicalSearchEvaluationPage.tsx` | Remplacer Playbook/Execution par config ad-hoc (Agent, Workspace, Modèle, Fichiers) |
| `front/.../api.ts` | Nouvelle méthode `prepareAdhoc(id, config)` |
| `front/.../types.ts` | Ajouter type `AdhocConfig` |
| `front/.../locales/fr.json` | Nouvelles clés `adhoc.*` |
| `front/.../locales/en.json` | Nouvelles clés `adhoc.*` |

---

## 6. Plan d'Implémentation Étape par Étape

### Étape 1 — Schéma BDD + DTO

- Ajouter `model_id` (text, nullable) dans `evaluation.schema.ts` via Drizzle
- Générer la migration : `npm run db:generate`
- Appliquer : `npm run db:migrate`
- Créer le type `AdhocPrepareInput` : `{ agentId: string; workspaceId?: string; modelId?: string; fileScope?: string[] }`

### Étape 2 — Backend : `prepareAdhoc()`

Nouvelle méthode dans `logical-search-evaluation.service.ts` :

1. Valider l'évaluation (statut `dataset_ready` ou `failed` ou `prepared`)
2. Construire le snapshot synthétique (1 node, 0 edges, 0 bindings)
3. Écrire `request_template.json` (snapshot synthétique)
4. Écrire `config.json` (`answer_node_id = 'eval-answer'`, `flow_id` synthétique)
5. Écrire `adhoc-config.json` (traçabilité)
6. Purger les artefacts run existants (`results.json`, `summary.json`, `progress.json`, `outputs/`)
7. Appeler `repository.applyPrepare()` avec `executionId: null`, `modelId: input.modelId`

### Étape 3 — Backend : Endpoint

```typescript
@Post(':id/prepare-adhoc')
@ApiOperation({ summary: 'Prepare evaluation with ad-hoc config (no playbook)' })
async prepareAdhoc(
  @CurrentUser() user: UserDocument,
  @Param('id') id: string,
  @Body() body: { agentId: string; workspaceId?: string; modelId?: string; fileScope?: string[] },
) {
  if (!body?.agentId) {
    throw new BadRequestException('agentId is required.');
  }
  return this.service.prepareAdhoc(user._id.toString(), id, body);
}
```

### Étape 4 — Frontend : Type + API

```typescript
// types.ts
export interface AdhocConfig {
  agentId: string;
  workspaceId?: string;
  modelId?: string;
  fileScope?: string[];
}

// api.ts
async prepareAdhoc(id: string, config: AdhocConfig): Promise<PrepareResult> {
  const res = await apiClient.post<{ data: PrepareResult }>(
    `${API_ENDPOINTS.logicalSearchEvaluation.base}/${id}/prepare-adhoc`,
    config,
  );
  return res.data.data;
},
```

### Étape 5 — Frontend : UI Config Ad-hoc

Remplacer la section Playbook/Execution par :

```
┌─────────────────────────────────────────────┐
│ Configuration                                │
│                                              │
│ Agent *                                      │
│ [SearchSelect avec recherche]                │
│                                              │
│ Workspace (optionnel)                        │
│ [SearchSelect avec recherche]                │
│                                              │
│ Modèle LLM (optionnel)                       │
│ [SearchSelect avec liste de modèles]         │
│                                              │
│ Fichiers (optionnel, scope restreint)        │
│ [SearchSelect multi-select]                  │
│                                              │
│ [Lancer l'évaluation]                        │
│ Évaluation cible : nom_eval.csv              │
└─────────────────────────────────────────────┘
```

Le bouton "Lancer" déclenche `prepareAdhoc()` → `run()` en séquence. Pas de "Préparer" séparé — tout est en un clic.

### Étape 6 — Locales

```json
// fr.json
"adhoc": {
  "agent": "Agent",
  "agentPlaceholder": "Sélectionner un agent…",
  "workspace": "Workspace",
  "workspacePlaceholder": "Sélectionner un workspace (optionnel)…",
  "model": "Modèle LLM",
  "modelPlaceholder": "Sélectionner un modèle (optionnel)…",
  "files": "Fichiers",
  "filesPlaceholder": "Restreindre aux fichiers…",
  "launch": "Lancer l'évaluation",
  "launching": "Lancement…"
}
```

### Étape 7 — Vérifications

1. `npx tsc --noEmit` (front)
2. `npm run build` (back)
3. `npx jest src/modules/evaluation-logical-search` (back — 17 tests existants)
4. Test E2E : upload CSV → sélection agent/workspace/modèle → Lancer → vérifier les queries
5. Test reprise : interrompre → Run → reprend à la bonne query
6. Test arrêt : Arrêter → statut `failed` → re-Prepare ad-hoc avec autre config → relancer

---

## 7. Points d'Attention

### 7.1. `flow_id` synthétique

Le proto exige un `flow_id` string. Utiliser `eval-flow-{evaluationId}` — le runner ADK l'accepte car proto3 ne contraint pas les strings. Pas d'état persistant côté runner pour ces IDs éphémères.

### 7.2. Compatibilité avec l'approche playbook

Les deux approches coexistent dans la même table `logical_search_evaluations` :

- `executionId` **présent** → approche playbook (le snapshot vient de MongoDB)
- `executionId` **null** → approche ad-hoc (le snapshot est synthétique)

Le statut, la reprise, l'arrêt et l'export fonctionnent identiquement — seule la source du snapshot change.

### 7.3. Fichiers scope

La restriction de fichiers (scope) nécessite de filtrer les `__playbook_workspace_paths` résolus par `workspaceService.getStoragePathMapByIds()`. Plus complexe — optionnel en V1, à implémenter en V2 si besoin.

### 7.4. Modèle

Le choix du modèle est un **override** du modèle par défaut de l'agent. Le node synthétique porte `model_id` qui écrase le modèle résolu (ligne 1818 de `playbook-flow-execution.service.ts`). Si aucun modèle n'est choisi, le modèle de l'agent est utilisé tel quel.

### 7.5. Migration BDD

La colonne `model_id` est nullable — pas de backfill nécessaire. Les évaluations playbook existantes continuent de fonctionner avec `model_id = null`.

---

## 8. Risques

| Risque | Impact | Mitigation |
|---|---|---|
| `flow_id` synthétique rejeté par le runner | Élevé | Tester avec un ID factice avant implémentation ; le proto3 n'a pas de validation stricte |
| Agent introuvable (ID invalide) | Moyen | `buildGrpcAgentsForPlaybook` lance une erreur si l'agent n'existe pas → 400 côté backend |
| Workspace inexistant | Moyen | `workspaceService.getStoragePathMapByIds()` retourne un map partiel → l'agent fonctionne sans fichiers |
| Modèle non disponible | Faible | Le runtime tombe back sur le modèle de l'agent → comportement dégradé mais fonctionnel |
| Coexistence playbook/ad-hoc dans l'historique | Faible | Champ `executionId` nullable suffit pour distinguer les deux modes |
