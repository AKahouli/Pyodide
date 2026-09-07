# Stockage des données — Semantic Model

> **Objectif de ce document :** Expliquer précisément comment les données des Semantic Models
> sont stockées en base, combien de bases/tables sont créées, et comment plusieurs modèles
> coexistent sans se mélanger.

---

## 1. Réponse courte

| Question | Réponse |
|---|---|
| Une base PostgreSQL par modèle ? | ❌ Non |
| Une table PostgreSQL par modèle ? | ❌ Non |
| Comment les modèles sont isolés ? | ✅ Par colonne `model_id` (UUID) dans chaque table |
| Un graph Apache AGE par modèle ? | ✅ Oui — 1 graph dédié par modèle |
| Suppression d'un modèle efface tout ? | ✅ Oui — `ON DELETE CASCADE` en cascade |

---

## 2. Vue d'ensemble de l'architecture

```
PostgreSQL
└── database: yellowstorm (ou votre nom de DB)
    └── schema: semantic_model          ← UN seul schéma pour TOUS les modèles
        ├── models                      ← 1 ligne = 1 semantic model
        ├── versions                    ← N versions par modèle
        ├── node_types                  ← Concepts (Employé, Skill...) par version
        ├── relation_types              ← Relations (a_skill...) par version
        ├── records                     ← Instances de concepts par version
        ├── record_relations            ← Edges entre instances par version
        ├── knowledge_bindings          ← Documents/workspaces liés au modèle
        ├── workspace_links             ← Workspaces connectés au modèle
        ├── memberships                 ← Rôles utilisateurs (owner/editor/viewer)
        ├── ontology_artifacts          ← Ontologie générée par l'IA par modèle
        ├── mapping_runs                ← Historique des jobs de mapping
        └── events                      ← Journal des actions

Apache AGE (extension PostgreSQL)
└── graph: semantic_model_graph         ← UN seul graph pour TOUS les modèles
    ├── Vertices (= records PG)
    └── Edges (= record_relations PG)
```

---

## 3. Détail de chaque table

### 3.1 `semantic_model.models` — La table racine

C'est le point d'entrée. **Une ligne = un Semantic Model.**
Tous les autres objets (versions, concepts, records...) référencent cette table via `model_id`.

```sql
CREATE TABLE semantic_model.models (
  id                           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id                TEXT    NOT NULL,           -- ID de l'utilisateur propriétaire
  name                         TEXT    NOT NULL,           -- Nom du modèle (ex: "RH Model")
  description                  TEXT    NOT NULL DEFAULT '',
  kind                         TEXT    NOT NULL,           -- 'designed' ou 'workspace_default'
  status                       TEXT    NOT NULL DEFAULT 'draft', -- 'draft' | 'published' | 'archived'
  revision                     BIGINT  NOT NULL DEFAULT 0, -- Compteur de concurrence optimiste
  origin_workspace_id          TEXT,                       -- Workspace d'origine (si workspace_default)
  current_draft_version_id     UUID,                       -- → versions(id)
  current_published_version_id UUID,                       -- → versions(id)
  archived_at                  TIMESTAMPTZ,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Exemple avec 3 modèles :**

```
id      | name          | owner_user_id | kind              | status
--------+---------------+---------------+-------------------+---------
uuid-A  | RH Model      | user-1        | designed          | draft
uuid-B  | Finance Model | user-1        | designed          | published
uuid-C  | WS-1 Default  | user-2        | workspace_default | draft
```

---

### 3.2 `semantic_model.versions` — Le versioning

Chaque modèle peut avoir plusieurs versions (draft, published, archived).
**Contrainte forte : au plus 1 draft actif par modèle** (index unique filtré).

```sql
CREATE TABLE semantic_model.versions (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id        UUID    NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL,   -- 1, 2, 3...
  status          TEXT    NOT NULL,   -- 'draft' | 'published' | 'archived'
  revision        BIGINT  NOT NULL DEFAULT 0,
  base_version_id UUID    REFERENCES semantic_model.versions(id),
  created_by      TEXT    NOT NULL,
  published_by    TEXT,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Garantie : 1 seul draft par modèle
CREATE UNIQUE INDEX semantic_versions_one_draft_uidx
  ON semantic_model.versions (model_id) WHERE status = 'draft';
```

**Exemple — cycle de vie d'un modèle :**

```
model_id | version_number | status    | Signification
---------+----------------+-----------+----------------------------------
uuid-A   | 1              | published | Première version publiée
uuid-A   | 2              | published | Deuxième version publiée
uuid-A   | 3              | draft     | ← En cours de modification (actif)
uuid-B   | 1              | draft     | Jamais publié, encore en travail
uuid-C   | 1              | published | Publiée
uuid-C   | 2              | draft     | ← Modification en cours
```

**Quand on publie :**
1. Le draft `version 3` passe en `published`
2. Un nouveau draft `version 4` est créé (copie du contenu de v3)
3. `models.current_published_version_id` pointe vers v3
4. `models.current_draft_version_id` pointe vers v4

---

### 3.3 `semantic_model.node_types` — Les concepts

Contient les types de nœuds (Employé, Skill, Projet...) définis dans le designer.
**Clé composite `(version_id, id)`** — un concept appartient à une version précise.

```sql
CREATE TABLE semantic_model.node_types (
  id            UUID  NOT NULL DEFAULT gen_random_uuid(),
  model_id      UUID  NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  version_id    UUID  NOT NULL REFERENCES semantic_model.versions(id) ON DELETE CASCADE,
  key           TEXT  NOT NULL,   -- Identifiant technique (ex: "employe")
  label         TEXT  NOT NULL,   -- Libellé affiché (ex: "Employé")
  description   TEXT  NOT NULL DEFAULT '',
  category      TEXT  NOT NULL,   -- 'business_object' | 'classification' | 'system_collection'
  record_policy TEXT  NOT NULL DEFAULT 'none', -- 'none' | 'optional' | 'expected'
  system_key    TEXT,             -- Clé système réservée (ex: "workspace_documents")
  aliases       JSONB NOT NULL DEFAULT '[]',
  attributes    JSONB NOT NULL DEFAULT '[]',  -- Définition des champs du concept
  position      JSONB NOT NULL DEFAULT '{"x":0,"y":0}',
  PRIMARY KEY (version_id, id),
  UNIQUE (version_id, key)
);
```

**Exemple — même concept "Employé" dans 2 modèles différents :**

```
version_id | id   | key      | label    | category        | model_id
-----------+------+----------+----------+-----------------+---------
ver-A3     | nt-1 | employe  | Employé  | business_object | uuid-A   ← modèle A
ver-B1     | nt-2 | employee | Employee | business_object | uuid-B   ← modèle B
ver-C2     | nt-3 | skill    | Skill    | classification  | uuid-C   ← modèle C
```

> **Important :** `nt-1` et `nt-2` sont deux concepts totalement indépendants.
> Ils partagent la même sémantique "employé" mais leurs données n'interagissent jamais.

---

### 3.4 `semantic_model.relation_types` — Les relations

Définit les types de relations entre concepts (ex: "Employé **a** Skill").

```sql
CREATE TABLE semantic_model.relation_types (
  id                  UUID  NOT NULL DEFAULT gen_random_uuid(),
  model_id            UUID  NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  version_id          UUID  NOT NULL REFERENCES semantic_model.versions(id) ON DELETE CASCADE,
  key                 TEXT  NOT NULL,
  label               TEXT  NOT NULL,          -- "a skill"
  inverse_label       TEXT  NOT NULL DEFAULT '',-- "est la skill de"
  source_node_type_id UUID  NOT NULL,           -- → node_types(id) dans la même version
  target_node_type_id UUID  NOT NULL,           -- → node_types(id) dans la même version
  cardinality         TEXT  NOT NULL,           -- 'one_to_one' | 'one_to_many' | 'many_to_many'...
  traversable         BOOLEAN NOT NULL DEFAULT true,
  filterable          BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (version_id, id),
  FOREIGN KEY (version_id, source_node_type_id) REFERENCES semantic_model.node_types(version_id, id),
  FOREIGN KEY (version_id, target_node_type_id) REFERENCES semantic_model.node_types(version_id, id)
);
```

> La FK `(version_id, source_node_type_id)` garantit qu'une relation ne peut pas
> pointer vers un concept d'un autre modèle ou d'une autre version.

---

### 3.5 `semantic_model.records` — Les instances (données réelles)

C'est ici que vivent les données extraites par l'IA ou créées manuellement.
**Une ligne = une instance concrète** d'un concept (ex: "Alice" est un Employé).

```sql
CREATE TABLE semantic_model.records (
  id           UUID  NOT NULL DEFAULT gen_random_uuid(),
  model_id     UUID  NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  version_id   UUID  NOT NULL REFERENCES semantic_model.versions(id) ON DELETE CASCADE,
  node_type_id UUID  NOT NULL,   -- → node_types(id) dans la même version
  label        TEXT  NOT NULL,   -- "Alice", "Python", "Projet Alpha"...
  values       JSONB NOT NULL DEFAULT '{}', -- Attributs + métadonnées internes
  status       TEXT  NOT NULL DEFAULT 'active',
  position     JSONB NOT NULL DEFAULT '{"x":0,"y":0}',
  PRIMARY KEY (version_id, id),
  FOREIGN KEY (version_id, node_type_id) REFERENCES semantic_model.node_types(version_id, id)
);
```

**Structure du champ `values` (JSONB) :**

```json
{
  "nom": "Alice Martin",
  "poste": "Développeur Senior",
  "_entity_key": "550e8400-e29b-41d4-a716-446655440000",
  "_source_document_id": "doc-uuid-du-cv-alice",
  "_source_file_name": "CV_Alice_Martin.pdf",
  "_source_document_ids": ["doc-uuid-du-cv-alice"],
  "_source_file_names": ["CV_Alice_Martin.pdf"]
}
```

| Champ | Rôle |
|---|---|
| Champs métier (`nom`, `poste`...) | Données extraites du document |
| `_entity_key` | UUID stable pour la reconnaissance entre runs (delta incrémental) |
| `_source_document_id` | Document source principal |
| `_source_document_ids` | Tous les documents sources (si plusieurs) |

**Exemple — 3 modèles, records isolés :**

```
version_id | id    | node_type_id | label   | model_id
-----------+-------+--------------+---------+---------
ver-A3     | rec-1 | nt-1         | Alice   | uuid-A   ← Employé dans modèle RH
ver-A3     | rec-2 | nt-1         | Bob     | uuid-A   ← Employé dans modèle RH
ver-B1     | rec-3 | nt-2         | Charlie | uuid-B   ← Employee dans modèle Finance
ver-C2     | rec-4 | nt-3         | Python  | uuid-C   ← Skill dans modèle WS-1
ver-C2     | rec-5 | nt-3         | React   | uuid-C   ← Skill dans modèle WS-1
```

---

### 3.6 `semantic_model.record_relations` — Les edges

Relie deux instances entre elles via un type de relation.

```sql
CREATE TABLE semantic_model.record_relations (
  id               UUID  NOT NULL DEFAULT gen_random_uuid(),
  model_id         UUID  NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  version_id       UUID  NOT NULL REFERENCES semantic_model.versions(id) ON DELETE CASCADE,
  relation_type_id UUID  NOT NULL,
  source_record_id UUID  NOT NULL,
  target_record_id UUID  NOT NULL,
  values           JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (version_id, id),
  FOREIGN KEY (version_id, relation_type_id) REFERENCES semantic_model.relation_types(version_id, id),
  FOREIGN KEY (version_id, source_record_id)  REFERENCES semantic_model.records(version_id, id),
  FOREIGN KEY (version_id, target_record_id)  REFERENCES semantic_model.records(version_id, id)
);
```

**Exemple :**
```
version_id | relation_type_id | source_record_id | target_record_id | Lecture
-----------+------------------+------------------+------------------+------------------
ver-A3     | rt-1 (a_skill)   | rec-1 (Alice)    | rec-4 (Python)   | Alice a Skill Python
ver-A3     | rt-1 (a_skill)   | rec-2 (Bob)      | rec-5 (React)    | Bob a Skill React
```

> Les FKs `(version_id, source_record_id)` et `(version_id, target_record_id)`
> garantissent qu'une relation ne peut jamais relier des records de versions différentes.

---

### 3.7 Tables annexes

#### `semantic_model.knowledge_bindings` — Sources de données liées

Associe des workspaces ou documents à un modèle pour l'extraction IA.

```
model_id | resource_kind | workspace_id | document_id | inclusion_mode | retrieval_mode
---------+---------------+--------------+-------------+----------------+---------------
uuid-A   | workspace     | ws-rh        | null        | dynamic        | broad
uuid-A   | document      | ws-rh        | doc-cv-001  | explicit       | targeted
uuid-B   | workspace     | ws-finance   | null        | dynamic        | broad
```

#### `semantic_model.workspace_links` — Workspaces connectés

```
model_id | workspace_id | role      | enabled
---------+--------------+-----------+--------
uuid-A   | ws-rh        | origin    | true
uuid-A   | ws-marketing | connected | true
uuid-B   | ws-finance   | origin    | true
```

#### `semantic_model.memberships` — Droits utilisateurs

```
model_id | user_id | role
---------+---------+--------
uuid-A   | user-1  | owner
uuid-A   | user-3  | editor
uuid-B   | user-1  | owner
uuid-C   | user-2  | owner
```

#### `semantic_model.ontology_artifacts` — Ontologie générée

Une seule ligne par modèle (PRIMARY KEY = `model_id`). Contient l'ontologie JSON + TTL générée par l'IA.

```
model_id | ontology_definition (JSONB) | ontology_ttl (TEXT) | generated_at
---------+-----------------------------+---------------------+-------------
uuid-A   | { "classes": [...] }        | @prefix owl: ...    | 2026-08-24
uuid-B   | { "classes": [...] }        | @prefix owl: ...    | 2026-08-23
```

#### `semantic_model.mapping_runs` — Historique des jobs IA

```
id      | model_id | status    | started_at          | completed_at        | error
--------+----------+-----------+---------------------+---------------------+------
run-001 | uuid-A   | completed | 2026-08-24 10:00:00 | 2026-08-24 10:04:30 | null
run-002 | uuid-A   | failed    | 2026-08-24 11:00:00 | null                | "ADK timeout"
run-003 | uuid-B   | completed | 2026-08-24 09:00:00 | 2026-08-24 09:02:15 | null
```

---

## 4. Le graph Apache AGE

AGE est une extension PostgreSQL qui ajoute un moteur de graph sur la même instance.
Il y a **un seul graph** (`semantic_model_graph`) partagé entre tous les modèles.

### Pourquoi un seul graph ?

AGE ne supporte pas plusieurs graphs par connexion PostgreSQL de manière pratique.
La séparation se fait par les UUIDs : chaque vertex a un ID qui est l'UUID du record PostgreSQL.

### Structure des vertices

```cypher
// Alice (record rec-1 du modèle A)
(:Employé {
  id: "rec-1",
  label: "Alice",
  nom: "Alice Martin",
  _entity_key: "550e8400..."
})

// Python (record rec-4 du modèle C)
(:Skill {
  id: "rec-4",
  label: "Python",
  _entity_key: "660f9511..."
})
```

### Isolation côté application

Le graph viewer ne charge jamais "tous les vertices". Il procède en 2 étapes :

```
Étape 1 — PostgreSQL
  SELECT id FROM semantic_model.records
  WHERE version_id = 'ver-A3'   ← filtre sur le bon modèle
  → retourne [rec-1, rec-2]

Étape 2 — AGE
  MATCH (n) WHERE n.id IN ['rec-1', 'rec-2']
  RETURN n
  → retourne uniquement les vertices du modèle A
```

Les vertices des modèles B et C ne sont jamais retournés → isolation effective même avec un graph partagé.

---

## 5. Ce qui se passe quand on supprime un modèle

Grâce aux clauses `ON DELETE CASCADE` sur toutes les tables, une seule commande suffit :

```sql
DELETE FROM semantic_model.models WHERE id = 'uuid-A';
```

Cela supprime automatiquement en cascade :
- Toutes les versions du modèle A
- Tous les node_types, relation_types, records, record_relations de ces versions
- Tous les knowledge_bindings, workspace_links, memberships, events
- L'ontology_artifact et tous les mapping_runs
- Les vertices AGE correspondants (gérés séparément par le service applicatif)

---

## 6. Schéma de dépendances complet

```
models (uuid-A)
│
├── versions (ver-A1, ver-A2, ver-A3)
│   │
│   ├── node_types      (version_id = ver-A3)
│   │   ├── nt-1 : Employé
│   │   └── nt-2 : Skill
│   │
│   ├── relation_types  (version_id = ver-A3)
│   │   └── rt-1 : Employé → a_skill → Skill
│   │
│   ├── records         (version_id = ver-A3)
│   │   ├── rec-1 : Alice   (node_type = nt-1)
│   │   └── rec-2 : Python  (node_type = nt-2)
│   │
│   └── record_relations(version_id = ver-A3)
│       └── rr-1 : rec-1 →[rt-1]→ rec-2
│
├── knowledge_bindings  (model_id = uuid-A)
├── workspace_links     (model_id = uuid-A)
├── memberships         (model_id = uuid-A)
├── ontology_artifacts  (model_id = uuid-A)
├── mapping_runs        (model_id = uuid-A)
└── events              (model_id = uuid-A)

Apache AGE — semantic_model_graph
├── Vertex rec-1 (:Employé {label: "Alice"})
├── Vertex rec-2 (:Skill   {label: "Python"})
└── Edge   rr-1  (rec-1)-[:a_skill]->(rec-2)
```

---

## 7. Points clés à retenir

1. **Pas de base séparée** — tous les modèles partagent la même base PostgreSQL et le même schéma `semantic_model`

2. **Isolation par UUID** — chaque table a une colonne `model_id` et/ou `version_id`. Les contraintes FK rendent le mélange de données entre modèles impossible au niveau base de données

3. **Versioning natif** — un modèle peut avoir plusieurs versions. La version `draft` est l'espace de travail actif. On ne travaille jamais directement sur une version publiée

4. **AGE partagé** — un seul graph pour tous les modèles, mais l'application filtre toujours par les UUIDs du bon modèle avant d'interroger AGE

5. **Suppression propre** — `ON DELETE CASCADE` garantit qu'aucune donnée orpheline ne reste en base lors de la suppression d'un modèle

6. **Scalabilité** — pas de limite théorique sur le nombre de modèles, ce sont uniquement des lignes en base
