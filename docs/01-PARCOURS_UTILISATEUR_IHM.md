# Parcours Utilisateur — IHM (LogicalSearchEvaluationPage)

## Vue d'ensemble
L'interface `LogicalSearchEvaluationPage.tsx` (`YellowStorm/front/src/modules/evaluation-logical-search/pages/LogicalSearchEvaluationPage.tsx`) orchestre le flux ad-hoc **2-Agents** : **Agent Cible** (réponse brute) + **Agent Évaluateur / LLM Judge** (score + justification).

---

## Étape 1 — Importation du Dataset

| Action | Composant / Handler | Détail technique |
|--------|---------------------|------------------|
| **Drag & Drop** ou **Clic** sur la zone d'upload | Zone `<input type="file" accept=".xlsx,.csv" onChange={handleFileChange} />` | `handleFileChange` (l.118-133) lit le `File`, appelle `evaluationLogicalSearchApi.upload(file)` |
| **Parsing** | `evaluationLogicalSearchApi.upload()` → `POST /api/v1/evaluation/logical-search/upload` (multer + `xlsx-benchmark-parser.ts`) | Backend parse la feuille `Questions_Réponses`, extrait `query_id`, `query`, `answer`, `required_file[]`, `page[]`. Retourne `UploadResult { evaluationId, preview: BenchmarkQuery[] }` |
| **Aperçu immédiat** | `setUploadResult(result)` → affichage tableau `<table>` (l.274-301) | Colonnes : ID, Question, Réponse attendue, Fichiers requis. Validation visuelle avant config. |

> **Artefacts côté back** : création ligne `logical_search_evaluations` (statut `dataset_ready`), `evaluationId` retourné.

---

## Étape 2 — Configuration Directe (2 Agents)

| Champ IHM | Variable React | Requis | Source |
|-----------|----------------|--------|--------|
| **Agent Cible** | `selectedAgentId` | ✅ | `useAgents()` → `SearchSelect` options `{value: a.id, label: a.name}` |
| **Modèle Cible (optionnel)** | `selectedModelId` | ❌ | `getModels()` → `SearchSelect` options `{id: m.id, label: m.litellmModel \|\| m.name}` |
| **Agent Évaluateur (LLM Judge)** | `selectedEvaluatorAgentId` | ✅ | Même liste `agents` que Cible |
| **Modèle Judge (optionnel)** | `selectedEvaluatorModelId` | ❌ | Même liste `models` que Cible |
| **Workspace** | `selectedWorkspaceId` | ✅ | `API_ENDPOINTS.workspaces.list` + `sharedWithMe` merged |
| **Fichiers (optionnel, multi)** | `selectedFileIds[]` | ❌ | `listWorkspaceArtifacts(workspaceId)` → checkboxes natives |

**Validation UI** : Bouton "Lancer l'évaluation" **désactivé** tant que `!selectedAgentId || !selectedEvaluatorAgentId || !selectedWorkspaceId`.

**Locales (FR/EN)** : clés sous namespace `adhoc.*` — ex: `adhoc.agent`="Agent Cible", `adhoc.evaluatorAgent`="Agent Évaluateur (LLM Judge)".

---

## Étape 3 — Lancement de l'Évaluation

### Clic sur "Lancer l'évaluation" → `handleLaunch` (l.135-157)

```ts
await evaluationLogicalSearchApi.prepareAdhoc(targetId, {
  agentId: selectedAgentId,           // Agent Cible
  workspaceId: selectedWorkspaceId,
  modelId: selectedModelId,
  fileScope: selectedFileIds,
  evaluatorAgentId: selectedEvaluatorAgentId,  // Agent Judge
  evaluatorModelId: selectedEvaluatorModelId,
});
await evaluationLogicalSearchApi.run(targetId);
refreshEvaluations();
```

**Enchaînement automatique** :
1. `prepareAdhoc()` → backend génère snapshot 2-nœuds + artefacts dans `uploads/eval/{id}/`
2. `run()` → backend boucle sur `benchmark_queries.json`, stream gRPC vers ADK, écrit `results.json` / `progress.json`

**Feedback UI** :
- Bouton passe à "Lancement…" (`launching=true`, disabled)
- `runningEvalId = targetId` → démarrage polling 2.5s (`refreshEvaluations` + `refreshProgress`)
- Historique met à jour statut : `prepared` → `running` → `completed` / `failed`

---

## Étape 4 — Suivi et Actions en cours

### 4.1 Bouton "Arrêter" (`handleStop` l.172-183)

| Action | Endpoint | Effet |
|--------|----------|-------|
| Clic "Arrêter" sur ligne `running` | `POST /:id/stop` → `service.stop(ownerId, id)` | `activeRuns.set(id, true)` → flag lu en tête de boucle `run()` → sort proprement à la query suivante |
| Résultat | Statut `failed` avec `error: "Stopped by user; partial results kept."` | `results.json` conserve réponses déjà générées (reprise possible) |

> **Note** : Le stream gRPC en cours se termine (timeout ou complétion), aucune annulation brutale.

### 4.2 Bouton "Exporter les résultats" (`handleExport` l.185-200)

| Action | Endpoint | Fichier généré |
|--------|----------|----------------|
| Clic "Exporter" | `GET /:id/export` → `service.exportXlsx()` | `logical_search_evaluation_{id}.xlsx` |

**Contenu Excel** (2 feuilles) :
- **Global Summary** : `query_count`, `completed_queries`, `failed_queries`, moyennes (`mean_answer_correctness`, `mean_answer_quality`, `mean_file_recall`, etc.) + **Judge** : `mean_judge_score` (si dispo)
- **Detailed Results** : 1 ligne par query → `query_id`, `query`, `expected_answer`, `generated_answer`, `judge_score`, `judge_reasoning`, `status`, `duration_ms`, `retrieval_*`, `answer_*`, `retrieved_files`, `retrieved_pages`

> **Disponible** : dès que `status !== 'dataset_ready'` (même partiel / failed). Colonnes Judge absentes si architecture mono-agent ou parsing JSON échoué.

---

## États de l'évaluation (Historique)

| Statut | Signification | Actions possibles |
|--------|---------------|-------------------|
| `dataset_ready` | Upload OK, pas de config | — |
| `prepared` | `prepareAdhoc` OK, artefacts prêts | **Run**, **Re-prepare** |
| `running` | Boucle queries en cours | **Stop**, **Export** |
| `completed` | 100% queries traitées | **Run (reprise)**, **Export** |
| `failed` | Erreur ou Stop user | **Run (reprise partielle)**, **Export**, **Re-prepare** |

**Reprise partielle** : `run()` lit `results.json` existant → `doneQueryIds = Set(results.map(r=>r.query_id))` → saute les queries déjà faites → reprend au suivant. Purge auto si re-Prepare.