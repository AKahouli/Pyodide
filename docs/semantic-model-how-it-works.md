# Comment fonctionne la feature Semantic Model

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Concepts clés](#2-concepts-clés)
3. [Le Designer — construire la structure](#3-le-designer--construire-la-structure)
4. [Knowledge Binding — connecter les documents](#4-knowledge-binding--connecter-les-documents)
5. [Génération de l'ontologie](#5-génération-de-lontologie)
6. [Evidence Search — chercher les preuves](#6-evidence-search--chercher-les-preuves)
7. [Mapping Proposal — extraire les données](#7-mapping-proposal--extraire-les-données)
8. [Apply Mapping Plan — construire le graphe](#8-apply-mapping-plan--construire-le-graphe)
9. [Delta incrémental — `_entity_key`](#9-delta-incrémental--_entity_key)
10. [Graph Viewer — visualiser le graphe AGE](#10-graph-viewer--visualiser-le-graphe-age)
11. [Architecture technique](#11-architecture-technique)
12. [Base de données — schéma `semantic_model`](#12-base-de-données--schéma-semantic_model)

---

## 1. Vue d'ensemble

Le Semantic Model est une feature qui permet de **structurer la connaissance métier** contenue dans des documents (CVs, contrats, rapports, etc.) et de la transformer en un **graphe de données structurées**.

Le flux complet se déroule en deux grandes phases :

```
Phase 1 — Design (manuel, par l'utilisateur)
┌─────────────────────────────────────────────────────────┐
│  Designer       →   Knowledge Binding   →   Ontologie   │
│  (concepts,         (connecter les           (règles     │
│   relations,         workspaces/docs)         métier)    │
│   attributs)                                            │
└─────────────────────────────────────────────────────────┘

Phase 2 — Pipeline LLM (automatique, déclenché par l'utilisateur)
┌─────────────────────────────────────────────────────────────────┐
│  Evidence Search  →  Mapping Proposal  →  Apply  →  AGE Graph  │
│  (trouver les        (LLM extrait les    (écrire   (graphe      │
│   passages           données des docs)   en DB)    visualisable)│
│   pertinents)                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Concepts clés

### Semantic Model
Un modèle sémantique est un **schéma métier** — il définit les types d'entités qui existent dans un domaine (ex : Employé, Contrat, Compétence) et leurs relations.

### Node Type (Concept)
Un **concept** est un type d'entité dans le modèle. Il a :
- Un **label** (nom métier, ex : "Employé")
- Une **catégorie** : `business_object` (entité riche avec beaucoup d'attributs), `classification` (catalogue de valeurs), `system_collection` (géré par le système)
- Des **attributs** : les champs que chaque instance peut avoir (ex : `nom`, `email`, `date_embauche`)
- Une **record policy** : `none` (structure uniquement, pas d'instances), `optional` (instances optionnelles), `expected` (instances attendues)

### Relation
Une **relation** connecte deux concepts. Elle a :
- Un **label** (ex : "travaille pour")
- Un **inverse label** (ex : "emploie")
- Une **cardinalité** : `one_to_one`, `one_to_many`, `many_to_one`, `many_to_many`

### Record (Business Record)
Un **record** est une **instance concrète** d'un concept. C'est une donnée réelle extraite des documents.

Exemple : si le concept est "Employé", un record sera "Amine Benali" avec ses attributs remplis (`email: a.benali@company.com`, `poste: Développeur Senior`).

### Knowledge Binding
Un **binding** est un lien entre un concept (ou une relation) et une source de données (workspace ou document). Il indique au moteur : "pour ce concept, cherche dans ces documents."

### Workspace
Un espace de travail contenant des documents indexés. Il peut être **connecté** à un ou plusieurs modèles sémantiques.

---

## 3. Le Designer — construire la structure

Le designer est le canvas visuel où l'utilisateur construit son modèle.

### Flux d'une opération (ex : ajouter un concept)

```
Utilisateur clique "Ajouter un concept"
         ↓
Formulaire (label, description, catégorie, attributs)
         ↓
store.commit({ type: 'node.create', entity: {...} })
         ↓
L'opération est ajoutée à `pending[]` dans le Zustand store
         ↓
Auto-save déclenché après 650ms (debounce)
         ↓
POST /semantic-models/:id/graph/operations
  { expectedRevision: N, operations: [...] }
         ↓
Backend valide la révision (optimistic concurrency)
  → Si révision incorrecte : 409 Conflict → UI affiche "Modifications à vérifier"
  → Si OK : révision incrémentée, opérations appliquées en DB
         ↓
Réponse { revision: N+1, operations: [...] }
         ↓
store.markSaved(revision+1)
```

### Optimistic Concurrency

Chaque modèle a un numéro de **révision**. Toute mutation doit envoyer la `expectedRevision` actuelle. Si deux utilisateurs modifient en même temps, le deuxième reçoit un conflit et peut :
- **Recharger** la dernière version (perd ses modifications)
- **Garder une copie** (fork)

### Undo / Redo

Les opérations sont stockées dans deux stacks dans le store Zustand (`undoStack`, `redoStack`). Un undo génère une opération inverse (ex : `node.delete` pour annuler un `node.create`) et la soumet comme une nouvelle opération — pas de "rollback" mais une nouvelle opération de compensation.

### Modes d'affichage

- **Structure** : le canvas montre les concepts et relations (schéma)
- **Données métier** : le canvas montre les records (instances)

---

## 4. Knowledge Binding — connecter les documents

Avant de pouvoir extraire des données, il faut dire au modèle **où chercher**. C'est le rôle des bindings.

### Types de cibles

Un binding peut cibler :
- `{ kind: "node_type", id: "uuid-du-concept" }` → cherche des instances de ce concept
- `{ kind: "relation", id: "uuid-de-la-relation" }` → cherche des exemples de cette relation

### Flux de création d'un binding

```
Utilisateur ouvre le panneau "Connaissances"
         ↓
Voit la liste des workspaces/documents disponibles
(ceux connectés au modèle via semantic_model.workspace_links)
         ↓
Glisse un document sur un concept
         ↓
POST /semantic-models/:id/bindings
  { workspaceId, documentId, target: { kind, id }, expectedRevision }
         ↓
Backend vérifie que le workspace est bien connecté au modèle
Backend récupère la révision courante du modèle
Insère dans semantic_model.knowledge_bindings
         ↓
Le binding apparaît dans le panneau avec son statut de disponibilité
(available / indexing / unavailable — basé sur l'index vectoriel du document)
```

### Disponibilité

Chaque binding a un statut de **disponibilité** calculé à partir de l'index vectoriel du document dans le workspace. Si le document n'est pas encore indexé (`indexing`) ou non disponible (`unavailable`), l'evidence search l'ignorera.

---

## 5. Génération de l'ontologie

L'ontologie est un ensemble de **règles métier formelles** (en langage Cypher ou RDF-like) générées automatiquement à partir du canvas designer par le LLM. Elle décrit les contraintes et propriétés du modèle en langage machine.

### Flux

```
Utilisateur clique "Valider" → Step 1: Générer l'ontologie
         ↓
POST /semantic-models/:id/ontology/generate
  { businessRequirements: ["Une personne ne peut avoir qu'un seul poste", ...] }
         ↓
Backend charge le graphe designer (concepts, relations, attributs)
         ↓
POST http://adk:8001/semantic-model/ontologies/generate
  { modelId, graphDesignerCanvas: {...}, businessRequirements: [...] }
  Headers: { x-api-key: ADK_API_KEY }
  Timeout: 120 secondes
         ↓
ADK appelle le LLM (via LiteLLM → modèle configuré)
Le LLM génère les règles ontologiques
         ↓
ADK retourne les artifacts ontologiques
Backend les stocke dans semantic_model.ontology_artifacts
         ↓
Réponse { modelId, generatedAt }
```

### Stockage

Les artifacts sont stockés dans la table `semantic_model.ontology_artifacts` avec le SQL dans `005_ontology_artifacts.sql`. Ils sont persistés par modèle et réutilisés dans le pipeline mapping.

---

## 6. Evidence Search — chercher les preuves

L'evidence search prépare le "corpus" — les passages de texte pertinents dans les documents — que le LLM utilisera pour extraire les données.

### Flux détaillé

```
Backend reçoit l'appel evidenceSearch (ou en amont du mapping)
         ↓
Charge tous les bindings du modèle avec statut 'available'
         ↓
Pour chaque binding :
  - Identifie la cible (concept ou relation)
  - Formule une requête de recherche sémantique
    (ex: "Employé : nom complet, email, poste, date d'embauche")
         ↓
POST http://adk:8001/semantic-model/evidence/search
  { modelId, searchTasks: [
    { bindingId, target: { kind, id }, sourceDocumentId, fileName }
  ]}
         ↓
ADK utilise le MCP "Logical Search" pour faire une recherche vectorielle
dans l'index du document
         ↓
Retourne pour chaque tâche :
  evidence: [{ quote: "...", reference: "ref_123", score: 0.87 }]
         ↓
Backend stocke les tâches avec leur evidence dans la réponse
(elles sont ensuite passées au mapping proposal)
```

### Structure d'une evidence task

```typescript
{
  bindingId: "uuid",
  target: { kind: "node_type", id: "uuid-concept" },
  sourceDocumentId: "uuid",
  fileName: "cv_amine_benali.pdf",
  evidence: [
    {
      quote: "Amine Benali, Développeur Senior avec 8 ans d'expérience...",
      reference: "ref_doc123_chunk_4",
      score: 0.92
    }
  ]
}
```

---

## 7. Mapping Proposal — extraire les données

C'est l'étape centrale : le LLM lit les passages de texte et **extrait des instances concrètes** pour chaque concept.

### Vue d'ensemble du pipeline ADK (3 stages)

```
searchTasks (passages de texte)
    + graphDesignerCanvas (schéma des concepts)
    + existingEntities (records déjà dans le graphe)
              ↓
┌─────────────────────────────────────────────────────────┐
│ Stage 1 — NodeExtractor                                 │
│   Pour chaque (concept × document) :                    │
│   → Appel LLM : "Extrait une instance de Employé        │
│     depuis ce texte, avec ces attributs"                │
│   → Retourne un node brut par appel                     │
│   (4 threads parallèles max)                            │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ Stage 2 — NodeResolver (déduplication)                  │
│   Étape 1 : merge des fragments du même document        │
│   Étape 2 : merge des nodes avec label identique        │
│   Étape 3 : merge par attribut partagé (ID, email)      │
│   Étape 4 : DuplicateDetector Semantica (fuzzy ≥ 0.80)  │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ Stage 3 — EdgeDetector                                  │
│   Semantica NERExtractor + RelationExtractor            │
│   → Détecte les relations entre les nodes résolus       │
└────────────────────┬────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────┐
│ Stage 4 — EntityKeyResolver (delta)                     │
│   Pour chaque node résolu :                             │
│   → Cherche un match dans existingEntities              │
│     (par attribut partagé, puis par label normalisé)    │
│   → Si trouvé : entityKey = UUID de l'entité existante  │
│   → Si nouveau : entityKey = null                       │
└────────────────────┬────────────────────────────────────┘
                     ↓
Plan final :
{
  nodes: [{ id, nodeTypeId, label, entityKey, attributes, confidence }],
  edges: [{ id, relationTypeId, sourceNodeId, targetNodeId, confidence }],
  mergeGroups: [{ canonicalNodeId, mergedNodeIds, reason }]
}
```

### Mode asynchrone (utilisé en production)

Le mapping est exécuté en **mode asynchrone avec polling** car il peut durer plusieurs minutes :

```
POST /semantic-models/:id/mapping/proposals
         ↓
Backend crée un job en DB (status: 'running')
Retourne immédiatement { jobId, status: 'running' }
         ↓
Background : lance generate() en arrière-plan
  → Appelle l'ADK (timeout 15 minutes)
  → Stocke le résultat dans mapping_runs.result
  → Update status: 'completed' ou 'failed'
         ↓
Frontend poll toutes les 5 secondes :
GET /semantic-models/:id/mapping/proposals/jobs/:jobId
         ↓
Quand status = 'completed' → affiche le résumé
Quand status = 'failed' → affiche l'erreur
```

---

## 8. Apply Mapping Plan — construire le graphe

Une fois le plan approuvé (ou déclenché automatiquement via le validate dialog), le backend applique le plan en base.

### Mode incrémental (défaut)

```
POST /semantic-models/:id/mapping/jobs/:jobId/apply?mode=incremental
         ↓
Backend charge le job et son plan depuis mapping_runs
         ↓
Charge le graphe actuel (records + relations existants)
         ↓
Construit deux index d'identité :
  currentByEntityKey : { "_entity_key value" → record }
  currentByLabelKey  : { "nodeTypeId:label" → record }
         ↓
Pour chaque node du plan :
  ┌─ node.entityKey présent ?
  │   → Cherche dans currentByEntityKey
  │   → Trouvé : UPDATE (label + values + _entity_key préservé)
  │   → Pas trouvé : fallback niveau 3
  └─ fallback : label normalisé
      → Trouvé dans currentByLabelKey : UPDATE
      → Pas trouvé : CREATE (nouveau UUID, values._entity_key = UUID)
         ↓
Records non vus → DELETE
         ↓
Relations : supprimer les stales, créer les nouvelles
         ↓
Applique toutes les opérations via graphCommands.apply()
(révision incrémentée, opérations persistées)
         ↓
Reconstruit le graphe AGE :
  → Crée/met à jour les vertices AGE (un par record)
  → Crée/met à jour les edges AGE (un par relation)
         ↓
Retourne { appliedNodeCount, updatedNodeCount, deletedNodeCount, appliedEdgeCount }
```

### Mode replace

Supprime tous les records et relations existants, puis recrée tout depuis le plan. Utile pour un reset complet.

### Résolution des documents source

Lors de l'apply, chaque record reçoit des **métadonnées de source** calculées à partir des `evidenceReferences` :

```typescript
values['_source_document_id']  = "uuid-du-doc"
values['_source_file_name']    = "cv_amine_benali.pdf"
values['_source_document_ids'] = ["uuid1", "uuid2"]  // si multi-doc
values['_source_file_names']   = ["cv1.pdf", "cv2.pdf"]
```

---

## 9. Delta incrémental — `_entity_key`

### Le problème

Le LLM n'est pas déterministe : sur le même document, il peut retourner "Amine Benali" au run 1 et "A. Benali" au run 2. Sans mécanisme d'identité stable, le backend crée un doublon à chaque run au lieu de mettre à jour l'existant.

### La solution

À la **création** de chaque record, le backend assigne un UUID stable :
```typescript
values['_entity_key'] = record.id  // ex: "550e8400-e29b-41d4-a716-446655440000"
```

Au **run suivant**, le backend envoie les entités existantes à l'ADK :
```typescript
existingEntities = graph.records.map(r => ({
  entityKey: String(r.values['_entity_key'] ?? r.id),
  nodeTypeId: r.nodeTypeId,
  label: r.label,
  attributes: [...]  // attributs non-privés
}))
```

L'ADK tente de **reconnaître** chaque node résolu dans la liste des entités existantes :
1. **Attribut partagé** (même clé + valeur normalisée, même type) → match fort
2. **Label normalisé** (même texte après `casefold() + strip()`, même type) → match moyen

Si reconnu → `entityKey = UUID existant` → backend fait un **UPDATE**
Si nouveau → `entityKey = null` → backend fait un **CREATE** avec un nouvel UUID

### Hiérarchie de fiabilité

```
Niveau 1 : entityKey retourné par l'ADK
  → Le LLM lui-même a reconnu l'entité
  → Fonctionne même si le label a changé (si un attribut identifiant est partagé)

Niveau 3 : label normalisé (fallback)
  → Si l'ADK ne retourne pas d'entityKey (première version, ou ADK non mis à jour)
  → Fonctionne si le label est identique entre runs
```

### Cas de suppression de concept

Si l'utilisateur supprime un concept du designer et relance le pipeline :
- L'ADK ne reçoit plus ce concept dans `graphDesignerCanvas` → n'extrait rien pour lui
- Le plan ne contient aucun node de ce type
- L'apply détecte que ces records ne sont plus dans `seenRecordIds` → DELETE automatique

---

## 10. Graph Viewer — visualiser le graphe AGE

### Deux couches de données

Le système maintient **deux bases parallèles** qui doivent toujours être synchrones :

| Couche | Base | Usage |
|--------|------|-------|
| Relationnelle | PostgreSQL `semantic_model` schema | Source de vérité, mutations |
| Graphe | Apache AGE (extension PostgreSQL) | Visualisation, requêtes Cypher |

### Apache AGE

AGE est une extension PostgreSQL qui implémente un modèle de graphe de propriétés (Property Graph) et supporte le langage **Cypher** (même syntaxe que Neo4j).

Chaque appel à `applyMappingPlan` reconstruit le graphe AGE depuis zéro :
```sql
-- Exemple de vertex créé dans AGE
MERGE (n:Employe {record_id: 'uuid-record'})
SET n.model_id = 'uuid-model',
    n.label = 'Amine Benali',
    n.email = 'a.benali@company.com',
    n.source_file_name = 'cv_amine.pdf'
```

### Lecture pour le viewer

```
GET /semantic-models/:id/age-graph
         ↓
Backend lit le graphe AGE via SELECT ag_catalog.cypher(...)
         ↓
Filtre les vertices par les records existants en DB relationnelle
(évite les vertices obsolètes d'anciens runs)
         ↓
Enrichit chaque node avec les métadonnées du type de concept
(attributs définis, labels)
         ↓
Retourne { nodes: [...], edges: [...] }
```

### Rendu D3

Le graph viewer utilise **D3 force simulation** pour le layout :
- Chaque node est une force qui repousse les autres
- Les edges sont des liens qui attirent leurs extrémités
- La simulation converge vers un layout stable après quelques secondes

Au clic sur un node, le panneau détail affiche :
- Le type de concept
- Tous les attributs avec leurs valeurs
- Le document source (`_source_file_name`) — en bleu si présent, orange/"Donnée manquante" si absent

---

## 11. Architecture technique

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React + Vite)                     │
│                                                                     │
│  SemanticModelEditorPage                                            │
│  ├── SemanticModelCanvas (ReactFlow-like, D3 pour le graph viewer)  │
│  ├── SemanticModelInspector (panneau détail droite)                 │
│  ├── KnowledgePanel (gestion des bindings)                          │
│  ├── VersionsPanel (historique des versions)                        │
│  ├── SemanticModelGraphViewer (D3 force graph)                      │
│  └── SemanticModelValidateDialog (pipeline complet)                 │
│                                                                     │
│  Store : Zustand (état local du canvas, pending operations)         │
│  Query : TanStack Query (cache des données serveur)                 │
│  i18n : fr.json / en.json par module                                │
└────────────────────┬────────────────────────────────────────────────┘
                     │ HTTP REST
┌────────────────────▼────────────────────────────────────────────────┐
│                    BACKEND (NestJS + TypeScript)                     │
│                                                                     │
│  SemanticModelController (routes REST)                              │
│  ├── SemanticModelService (CRUD modèles)                            │
│  ├── SemanticGraphCommandService (opérations graphe designer)       │
│  ├── SemanticKnowledgeBindingService (bindings)                     │
│  ├── SemanticModelWorkspaceService (connexion workspaces)           │
│  ├── SemanticModelVersionService (publish/restore)                  │
│  ├── SemanticModelOntologyGenerationService (→ ADK)                 │
│  ├── SemanticModelEvidenceSearchService (→ ADK)                     │
│  ├── SemanticModelMappingProposalService (→ ADK, async jobs)        │
│  └── SemanticAgeGraphRepository (→ Apache AGE)                      │
│                                                                     │
│  Base : PostgreSQL (schema semantic_model)                          │
│  AGE  : Apache AGE (extension PostgreSQL, même instance)            │
└────────────────────┬────────────────────────────────────────────────┘
                     │ HTTP + x-api-key
┌────────────────────▼────────────────────────────────────────────────┐
│                    ADK (FastAPI + Python)                            │
│                                                                     │
│  /semantic-model/ontologies/generate                                │
│  /semantic-model/evidence/search                                    │
│  /semantic-model/mappings/generate                                  │
│     ├── NodeExtractor (LLM par doc×concept, ThreadPoolExecutor)     │
│     ├── NodeResolver  (dédup : Semantica DuplicateDetector)          │
│     ├── EdgeDetector  (relations : Semantica NER + RelationExtractor)│
│     └── EntityKeyResolver (match vs existingEntities)               │
│                                                                     │
│  LLM : LiteLLM → modèle configurable (Azure OpenAI, etc.)          │
│  Semantica : bibliothèque interne (déduplication, NER, relations)   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 12. Base de données — schéma `semantic_model`

### Tables principales

| Table | Rôle |
|-------|------|
| `semantic_model.models` | Les modèles sémantiques (id, name, status, revision) |
| `semantic_model.versions` | Versions draft/published par modèle |
| `semantic_model.graphs` | Contenu du graphe designer (nodes, relations, records) stocké en JSONB |
| `semantic_model.workspace_links` | Workspaces connectés à un modèle |
| `semantic_model.knowledge_bindings` | Bindings concept/relation → document |
| `semantic_model.mapping_runs` | Jobs de mapping proposal (async, status, result, search_summary) |
| `semantic_model.ontology_artifacts` | Artifacts d'ontologie générés par le LLM |
| `semantic_model.events` | Audit trail de toutes les mutations |

### Structure d'un graphe (JSONB dans `graphs.content`)

```json
{
  "revision": 42,
  "versionId": "uuid",
  "nodes": [
    {
      "id": "uuid",
      "label": "Employé",
      "key": "employe",
      "category": "business_object",
      "recordPolicy": "expected",
      "attributes": [
        { "key": "email", "label": "Email", "type": "string" }
      ],
      "position": { "x": 120, "y": 80 }
    }
  ],
  "relations": [...],
  "records": [
    {
      "id": "uuid",
      "nodeTypeId": "uuid-concept",
      "label": "Amine Benali",
      "values": {
        "email": "a.benali@company.com",
        "_entity_key": "uuid-stable",
        "_source_file_name": "cv_amine.pdf"
      }
    }
  ],
  "recordRelations": [...]
}
```

### Clés privées dans `record.values`

Les valeurs préfixées par `_` sont réservées au système et ne sont pas exposées comme attributs métier :

| Clé | Rôle |
|-----|------|
| `_entity_key` | UUID stable pour le delta incrémental |
| `_source_document_id` | ID du document source principal |
| `_source_file_name` | Nom de fichier du document source |
| `_source_document_ids` | Liste de tous les documents sources |
| `_source_file_names` | Liste de tous les noms de fichiers sources |

---

## Résumé du flux complet (end-to-end)

```
1. L'utilisateur crée un modèle sémantique
2. Il dessine les concepts (Employé, Contrat, Compétence) et leurs relations
3. Il définit les attributs de chaque concept (email, date, poste...)
4. Il connecte un workspace et glisse des documents sur les concepts (bindings)
5. Il clique "Valider" → le pipeline se déclenche :

   a. [Ontologie] Le LLM génère les règles formelles du modèle
   b. [Evidence Search] Le moteur cherche les passages pertinents
      dans les documents indexés, pour chaque binding
   c. [Mapping Proposal] Le LLM lit les passages et extrait :
      - Des instances (records) pour chaque concept
      - Des relations entre ces instances
      - Il reconnaît les entités déjà connues via entityKey
   d. [Apply] Le backend :
      - UPDATE les records reconnus (même UUID, nouvelles valeurs)
      - CREATE les nouveaux records (nouvel UUID + _entity_key)
      - DELETE les records absents du plan
      - Reconstruit le graphe AGE

6. L'utilisateur ouvre le Graph Viewer → visualise le graphe en D3
   Chaque node affiche ses attributs et son document source
7. Il publie le modèle → snapshot versionné disponible
```
