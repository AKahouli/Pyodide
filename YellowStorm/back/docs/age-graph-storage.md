# AGE Graph Storage — Flux complet

## Vue d'ensemble

YellowStorm utilise **deux couches de stockage** complémentaires pour le graphe sémantique :

| Couche | Schema PostgreSQL | Rôle |
|---|---|---|
| **Relationnelle** | `semantic_model` | Source de vérité — lecture/écriture CRUD |
| **Graph (AGE)** | `semantic_model_graph` | Copie secondaire — requêtes Cypher, traversée, graph viewer |

AGE (Apache AGE) est une extension PostgreSQL qui ajoute un moteur de graphe par-dessus PostgreSQL. Les deux schemas sont dans la **même base de données**.

---

## Tables relationnelles (`semantic_model`)

### Structure du modèle (ontologie)

```
semantic_model.node_types
  id, model_id, version_id, key, label, description,
  category, record_policy, attributes (JSONB), position (JSONB)

semantic_model.relation_types
  id, model_id, version_id, key, label, inverse_label,
  source_node_type_id, target_node_type_id, cardinality, attributes (JSONB)
```

Ces tables définissent le **schéma** du modèle : quels types de concepts existent et quelles relations sont possibles. Elles ne contiennent pas de données métier.

### Données instanciées (records)

```
semantic_model.records
  id, model_id, version_id, node_type_id, label, values (JSONB), status, position (JSONB)

semantic_model.record_relations
  id, model_id, version_id, relation_type_id,
  source_record_id, target_record_id, values (JSONB)
```

Ce sont les **vraies données** extraites par le mapping :
- `records` = instances de concepts (ex : "Amine", "Sarah", "PostgreSQL")
- `record_relations` = liens entre ces instances (ex : "Amine → has_skill → PostgreSQL")
- `values` = attributs de l'instance en JSONB (ex : `{"email": "amine@...", "phone": "__missing__"}`)

### Table de suivi des runs de mapping

```
semantic_model.mapping_runs
  id, model_id, status, started_at, completed_at,
  result (JSONB), search_summary (JSONB), error
```

Chaque lancement du pipeline crée une ligne ici. Le résultat brut du LLM (plan de mapping) est stocké dans `result`.

---

## Tables AGE (`semantic_model_graph`)

### Tables système AGE (ne pas modifier)

```
semantic_model_graph._ag_label_vertex   — registre interne des labels vertex
semantic_model_graph._ag_label_edge     — registre interne des labels edge
semantic_model_graph.INSTANCE_OF        — table AGE interne
semantic_model_graph.SCHEMA_RELATION    — table AGE interne
semantic_model_graph.SemanticNodeType   — table AGE interne
semantic_model_graph.SemanticRecord     — table AGE interne
```

### Tables de données AGE (une par label)

Ces tables sont créées **automatiquement** à partir des `key` des node types et relation types du modèle :

```
semantic_model_graph.employe            — vertices de type "employe"
semantic_model_graph.cv                 — vertices de type "cv"
semantic_model_graph.skill              — vertices de type "skill"
semantic_model_graph.has_technical_skill — edges de type "has_technical_skill"
semantic_model_graph.possede_cv          — edges de type "possede_cv"
```

**Chaque vertex stocke :**
```
record_id      → UUID du record dans semantic_model.records (clé de jointure)
model_id       → UUID du modèle (pour isoler les modèles dans le graphe partagé)
record_label   → label lisible (ex: "Amine Benali")
node_type_id   → UUID du type
status         → "active"
[attr_key]     → valeur de chaque attribut défini sur le node type
                 (valeur réelle OU '__missing__' si absent du mapping)
```

**Chaque edge stocke :**
```
rel_id         → UUID de la relation dans semantic_model.record_relations
```

### Isolation des modèles

Un seul graphe AGE (`semantic_model_graph`) est partagé entre tous les modèles.
L'isolation est assurée par le filtre `model_id` dans chaque requête Cypher :

```cypher
MATCH (n) WHERE n.model_id = 'fcd4472e-...' RETURN n
```

---

## Flux complet : du mapping au graphe AGE

### 1. Lancement du mapping

```
POST /semantic-models/:modelId/mapping/start
  → SemanticModelMappingProposalService.startAsync()
  → INSERT INTO semantic_model.mapping_runs (status='running')
  → appel HTTP au service ADK (LLM) avec le graph + documents
  → UPDATE mapping_runs SET status='completed', result={plan: {nodes, edges}}
```

Le `result.plan` contient les nœuds et edges proposés par l'IA avec leurs attributs extraits.

### 2. Apply to Graph

```
POST /semantic-models/:modelId/mapping/jobs/:jobId/apply
  → SemanticModelMappingProposalService.applyMappingPlan()
```

**Étape 1 — Nettoyage :** Suppression de tous les records et relations existants

```typescript
// DELETE de tous les records du modèle
graph.records.map(r => ({ type: 'record.delete', id: r.id }))
// DELETE de toutes les relations du modèle
graph.recordRelations.map(r => ({ type: 'record_relation.delete', id: r.id }))
```

→ `DELETE FROM semantic_model.records WHERE version_id=$1 AND id=$2`
→ `DELETE FROM semantic_model.record_relations WHERE version_id=$1 AND id=$2`

**Étape 2 — Insertion des nodes :** Pour chaque nœud du plan de mapping

```typescript
// Génération d'un vrai UUID pour remplacer l'ID temporaire du LLM
const realId = randomUUID()
tempToRealId.set(node.id, realId)  // garde la correspondance pour les edges

// Extraction des attributs
values = { email: "amine@...", phone: null, ... }

// Opération d'insertion
{ type: 'record.create', entity: { id: realId, nodeTypeId, label, values, status: 'active' } }
```

→ `INSERT INTO semantic_model.records (id, model_id, version_id, node_type_id, label, values, status, position)`

**Étape 3 — Insertion des edges :** Pour chaque relation du plan de mapping

```typescript
// Résolution des IDs temporaires → IDs réels
sourceRecordId = tempToRealId.get(edge.sourceNodeId)
targetRecordId = tempToRealId.get(edge.targetNodeId)

{ type: 'record_relation.create', entity: { id: randomUUID(), relationTypeId, sourceRecordId, targetRecordId } }
```

→ `INSERT INTO semantic_model.record_relations (id, model_id, version_id, relation_type_id, source_record_id, target_record_id, values)`

### 3. Construction du graphe AGE (`buildGraph`)

Après l'insertion relationnelle, le graphe est relu et copié dans AGE.

**Étape 1 — Connexion AGE**

```typescript
// AGE nécessite ces deux commandes sur la connexion avant tout Cypher
await client.query(`LOAD 'age'`)
await client.query(`SET search_path = ag_catalog, "$user", public`)
```

**Étape 2 — Création des labels vertex**

Pour chaque node type présent dans les records :

```sql
-- sanitizeLabel('employe') → 'employe'
-- sanitizeLabel('cv')      → 'cv'
SELECT * FROM ag_catalog.create_vlabel('semantic_model_graph', 'employe')
SELECT * FROM ag_catalog.create_vlabel('semantic_model_graph', 'cv')
-- → crée semantic_model_graph.employe, semantic_model_graph.cv
-- → erreur ignorée si le label existe déjà
```

**Étape 3 — Insertion des vertices**

Pour chaque record, un Cypher MERGE est exécuté :

```cypher
MERGE (n:employe {record_id: 'uuid-amine'})
SET n.model_id    = 'fcd4472e-...',
    n.record_label = 'Amine Benali',
    n.node_type_id = 'employe-type-uuid',
    n.status       = 'active',
    n.email        = 'amine@yellowsys.com',
    n.phone        = '__missing__'
RETURN n
```

> **Note `__missing__`** : AGE ne peut pas stocker `null` comme valeur de propriété.
> Les attributs absents du mapping sont stockés avec le sentinel `'__missing__'`
> pour que le vertex conserve tous ses attributs et que le graph viewer
> puisse les afficher en orange (données manquantes).

> **Note technique** : `ag_catalog.cypher()` exige que le Cypher soit une constante
> SQL au moment du parsing — pas un paramètre `$2`. La requête est construite avec
> dollar-quoting : `$agecypher$...cypher...$agecypher$`

**Étape 4 — Création des labels edge**

```sql
SELECT * FROM ag_catalog.create_elabel('semantic_model_graph', 'has_technical_skill')
SELECT * FROM ag_catalog.create_elabel('semantic_model_graph', 'possede_cv')
```

**Étape 5 — Insertion des edges**

```cypher
MATCH (s {record_id: 'uuid-amine'}), (t {record_id: 'uuid-postgresql'})
MERGE (s)-[r:has_technical_skill {rel_id: 'uuid-relation'}]->(t)
RETURN r
```

---

## Lecture du graphe (Graph Viewer)

```
GET /semantic-models/:modelId/age-graph
  → SemanticModelMappingProposalService.getAgeGraph()
```

**Étape 1 — Lecture AGE**

```cypher
-- Vertices filtrés par model_id
MATCH (n) WHERE n.model_id = 'fcd4472e-...' RETURN n

-- Edges filtrés par model_id des deux extrémités
MATCH (s)-[r]->(t)
WHERE s.model_id = 'fcd4472e-...' AND t.model_id = 'fcd4472e-...'
RETURN r, s.record_id, t.record_id
```

**Étape 2 — Enrichissement `_meta` (depuis les tables relationnelles)**

Les données AGE sont enrichies avec les définitions d'attributs et les valeurs depuis `semantic_model.records` :

```typescript
_meta: {
  nodeTypeLabel: "Employé",           // label lisible du type
  attributes: [
    { key: "email", label: "Email",   value: "amine@yellowsys.com" },
    { key: "phone", label: "Téléphone", value: null },  // null depuis relational
  ]
}
```

> Le panneau de détail du graph viewer utilise `_meta` (valeurs relationnelles)
> et non les propriétés AGE brutes — les vraies valeurs null sont donc préservées.

**Étape 3 — Filtrage des stale vertices**

Les vertices AGE de runs précédents (même `model_id`, anciens UUIDs) sont filtrés :

```typescript
// Seuls les nodes dont le record_id existe encore dans semantic_model.records sont retournés
nodes.filter(n => recordMap.has(n.id))
```

---

## Vérification en base

```sql
-- Données relationnelles (source de vérité)
SELECT label, values
FROM semantic_model.records
WHERE model_id = 'fcd4472e-d753-4b51-a71e-bb49a552e332';

-- Compter par type de vertex dans AGE
SELECT count(*) FROM semantic_model_graph.employe;
SELECT count(*) FROM semantic_model_graph.cv;
SELECT count(*) FROM semantic_model_graph.skill;

-- Lire les vertices AGE directement (nécessite LOAD 'age')
LOAD 'age';
SET search_path = ag_catalog, "$user", public;
SELECT * FROM ag_catalog.cypher('semantic_model_graph', $agecypher$
  MATCH (n) WHERE n.model_id = 'fcd4472e-d753-4b51-a71e-bb49a552e332' RETURN n
$agecypher$) AS (v ag_catalog.agtype);
```

---

## Règles importantes

| Règle | Raison |
|---|---|
| AGE exige `LOAD 'age'` + `SET search_path` sur chaque connexion | L'extension ne s'active pas automatiquement |
| Le Cypher doit être une constante SQL (pas `$2`) | AGE parse le Cypher au plan time, avant la liaison des paramètres |
| `null` → `'__missing__'` dans AGE | AGE ne peut pas stocker null comme valeur de propriété |
| `n.record_label` et non `n.label` | `label` est un mot réservé dans le parser Cypher d'AGE |
| Un seul graphe AGE pour tous les modèles | Isolation par `model_id` sur chaque vertex/edge |
| `create_vlabel` / `create_elabel` avant MERGE | AGE exige que les labels existent avant d'insérer |
