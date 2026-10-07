# Stockage objets — Ceph S3 ↔ Azure Data Lake Gen2

> **Objectif de ce document :** Décrire le double support de stockage (Ceph S3 et Azure
> Data Lake Gen2), les variables d'environnement de chaque service, les changements de
> code effectués, et les différences de comportement entre les deux backends.

---

## 1. Réponse courte

| Question | Réponse |
|---|---|
| Azure Data Lake parle-t-il l'API S3 ? | ❌ Non — ni nativement, ni en preview |
| Suffit-il de changer les variables d'env ? | ❌ Non — du code a dû être ajouté |
| Ceph reste-t-il utilisable ? | ✅ Oui — c'est toujours le défaut |
| Comment bascule-t-on ? | ✅ `STORAGE_PROVIDER=azure` |
| Combien de services à configurer pour le Semantic Model ? | ✅ Un seul — le back |
| Les données existantes sont-elles migrées ? | ❌ Non — à copier séparément |

---

## 2. Pourquoi du code et pas juste des variables

Azure Blob Storage / Data Lake Gen2 **n'expose pas d'API compatible S3**. C'est une
position assumée de Microsoft, documentée :

- Réponse officielle Microsoft : *« Azure and AWS use different interfaces, so most
  applications and libraries designed to work with Amazon S3 don't support Azure
  out-of-the-box »* — [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/1512015/compatibility-between-azure-blob-storage-and-s3-pr)
- Le guide officiel de migration AWS → Azure ne mentionne S3 nulle part dans les
  protocoles supportés, et mappe explicitement les *presigned URLs* S3 vers les
  *Shared Access Signatures* Azure — [Compare Storage Services](https://learn.microsoft.com/en-us/azure/architecture/aws-professional/storage)
- Protocoles réellement supportés par Azure : Blob REST, DFS REST, NFS 3.0, SFTP,
  HDFS/ABFS. **Jamais S3.**

> **Confusion fréquente :** le « multi-protocol access » d'ADLS Gen2 désigne *API Blob +
> API Data Lake sur les mêmes données*, pas une compatibilité S3.

### SDK retenu

`@azure/storage-blob`, et **pas** `@azure/storage-file-datalake`. Un compte Gen2
(hierarchical namespace activé) est entièrement accessible via l'API Blob, et nos clés
d'objets sont déjà des chemins plats (`userId/folder/file.pdf`) qui correspondent
exactement aux noms de blobs. Le SDK DataLake aurait ajouté une sémantique de
répertoires inutile.

**Authentification :** la connection string du compte, qui **doit porter une clé de
compte** — la génération de SAS en dépend, et toutes les URLs de download/upload
passent par là.

---

## 3. Architecture — qui touche au stockage

```
                         ┌─────────────────────────────┐
  front ──upload──▶      │   YellowStorm/back          │ ──▶  Ceph S3
                         │   (DocumentService)         │       ou
  semantic-model-runtime │   ◀── SEUL à toucher        │ ──▶  Azure Data Lake Gen2
     ──HTTP interne──▶   │       au stockage           │
                         └─────────────────────────────┘

  yellowstorm-code-runtime  ──▶  Ceph S3 ou Azure  (sandbox d'exécution de code)
  yellowstorm-adk           ──▶  Ceph S3 ou Azure  (RAG : images, pièces jointes)

  mcp/mcp-semantic-model    ──▶  aucun accès stockage
  semantic-model-runtime    ──▶  aucun accès stockage (passe par le back en HTTP)
```

### Le semantic-model-runtime ne lit jamais le stockage directement

Point important et **délibéré** : le runtime streame les octets **depuis le back**, il
ne contacte jamais Azure ni Ceph.

| Sens | Mécanisme |
|---|---|
| Lecture | `GET /api/workspaces/internal/semantic-asset` → le back fait `openReadStream()` et pipe les octets dans la réponse HTTP |
| Écriture | `PUT /api/workspaces/internal/semantic-derived-file` → le runtime POST les octets, le back écrit dans le stockage |

Son client HTTP est configuré `follow_redirects=False` et **rejette explicitement**
toute redirection (`if response.is_redirect: raise AssetFetchError("asset_redirected")`).
Il refuse par conception d'être renvoyé vers le stockage.

**Conséquences pour le déploiement :**

| Conséquence | Détail |
|---|---|
| Aucun credential Azure dans le runtime | Il n'a que `YELLOWSTORM_BACKEND_URL` + `YELLOWSTORM_INTERNAL_SERVICE_TOKEN` |
| Aucune route réseau vers Azure nécessaire | Il doit seulement atteindre le back |
| Un seul point de bascule | `STORAGE_PROVIDER=azure` sur le back, toute la chaîne suit |

> ⚠️ Comme les octets transitent par le back dans les deux sens, celui-ci est le goulot
> pour les gros datasets. C'était déjà vrai avec Ceph — la bascule ne dégrade rien, mais
> ne l'améliore pas. Colocaliser back et storage account dans la même région Azure.

---

## 4. Le switch

```bash
STORAGE_PROVIDER=ceph    # défaut — aucun impact sur les déploiements existants
STORAGE_PROVIDER=azure   # bascule sur Azure Data Lake Gen2
```

Côté back, un typo échoue **au démarrage** (`Joi.valid('ceph', 'azure')`) plutôt que de
retomber silencieusement sur Ceph en pointant le mauvais stockage.

---

## 5. Variables par service

### 5.1 `YellowStorm/back` — le seul à configurer pour le Semantic Model

```bash
STORAGE_PROVIDER=azure

# Azure (requis si STORAGE_PROVIDER=azure)
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=<compte>;AccountKey=<clé>;EndpointSuffix=core.windows.net
AZURE_STORAGE_CONTAINER_NAME=documents          # défaut : documents

# Ceph (requis si STORAGE_PROVIDER=ceph)
CEPH_S3_ENDPOINT=https://s3-v2.yellowsys.org
CEPH_S3_REGION=us-east-1                        # défaut : us-east-1
CEPH_S3_BUCKET=yellowstorm                      # défaut : documents
CEPH_S3_ACCESS_KEY_ID=<clé>
CEPH_S3_SECRET_ACCESS_KEY=<secret>
CEPH_S3_FORCE_PATH_STYLE=true                   # défaut : true
CEPH_S3_PUBLIC_URL=https://s3-v2.yellowsys.org
```

Indépendant du provider :

```bash
STORAGE_SAS_EXPIRY_MINUTES=60                            # durée des URLs signées
SEMANTIC_DATASET_STORAGE_PREFIX=semantic-model/datasets  # défaut
SEMANTIC_DATASET_MAX_SIZE_MB=200                         # défaut
STORAGE_HEALTH_CHECK_ENABLED=true
STORAGE_HEALTH_CHECK_INTERVAL_MS=60000
STORAGE_RECONNECT_ENABLED=true
```

### 5.2 `YellowStorm/semantic-model-runtime` — aucune variable de stockage

```bash
YELLOWSTORM_BACKEND_URL=http://back:3000
YELLOWSTORM_BACKEND_API_PREFIX=api              # défaut : api
YELLOWSTORM_INTERNAL_SERVICE_TOKEN=<token>
```

→ **Rien à changer pour Azure.**

### 5.3 `mcp/mcp-semantic-model` — aucune variable de stockage

→ **Rien à changer.**

### 5.4 `yellowstorm-code-runtime` *(hors Semantic Model)*

```bash
STORAGE_PROVIDER=azure

# Azure (les deux requises si azure)
AZURE_STORAGE_CONNECTION_STRING=<connection string>
AZURE_STORAGE_CONTAINER_NAME=<conteneur>

# Ceph (toutes requises si ceph — le service refuse de démarrer sinon)
CEPH_S3_ENDPOINT=<url>
CEPH_S3_REGION=<région>
CEPH_S3_BUCKET=<bucket>
CEPH_S3_ACCESS_KEY_ID=<clé>
CEPH_S3_SECRET_ACCESS_KEY=<secret>
CEPH_S3_FORCE_PATH_STYLE=true                   # défaut : true
```

### 5.5 `yellowstorm-adk` *(hors Semantic Model)* — ⚠️ noms différents

```bash
STORAGE_PROVIDER=azure

# Azure — ATTENTION : AZURE_DATALAKE_*, pas AZURE_STORAGE_*
AZURE_DATALAKE_CONNECTION_STRING=<connection string>   # TOUJOURS requis, même en mode ceph
AZURE_DATALAKE_FILE_SYSTEM_NAME=<conteneur>            # TOUJOURS requis, même en mode ceph

# Ceph (toutes optionnelles, deux alias acceptés pour chacune)
CEPH_S3_ENDPOINT           | CEPH_ENDPOINT
CEPH_S3_REGION             | CEPH_REGION
CEPH_S3_BUCKET             | CEPH_BUCKET_NAME
CEPH_S3_ACCESS_KEY_ID      | CEPH_ACCESS_KEY_ID
CEPH_S3_SECRET_ACCESS_KEY  | CEPH_SECRET_ACCESS_KEY
```

> ⚠️ `AZURE_STORAGE_CONTAINER_NAME` (back, code-runtime) et
> `AZURE_DATALAKE_FILE_SYSTEM_NAME` (adk) désignent **la même chose** : un conteneur.
> Si vous basculez plusieurs services, **faites-les pointer sur le même conteneur**,
> sinon le back écrit dans X et le RAG lit dans Y — les uploads marchent et le RAG
> échoue silencieusement.

---

## 6. Changements de code par service

### 6.1 `YellowStorm/back`

Un **port de stockage** a été introduit. `DocumentService` ne parle plus qu'à cette
interface : aucun type de SDK ni spécificité de provider ne remonte dans la logique
métier.

| Fichier | Rôle |
|---|---|
| `src/modules/document/storage/types.ts` | Le port `StorageBackend` + `StorageNotFoundError`, `StorageAmbiguousError` |
| `src/modules/document/storage/s3.backend.ts` | `S3StorageBackend` — implémentation Ceph S3 |
| `src/modules/document/storage/azure.backend.ts` | `AzureStorageBackend` — implémentation Azure |
| `src/modules/document/document-connection.service.ts` | Choisit le backend selon `STORAGE_PROVIDER`, garde la machinerie reconnect/healthcheck |
| `src/modules/document/document.service.ts` | Appelle le port au lieu du SDK AWS |
| `src/config/storage.config.ts` | `provider` + bloc `azure` |
| `src/config/config.schema.ts` | Validation `STORAGE_PROVIDER` + variables Azure |

Opérations du port : `connect`, `verify`, `destroy`, `head`, `getStream`, `put`,
`delete`, `list`, `copy`, `signedUrl`, `publicUrl`.

**Le quirk Ceph a déménagé.** Le retry sur `403 Unknown` de Ceph RGW vivait dans
`DocumentService` ; il est maintenant dans `s3.backend.ts`, sa vraie place — Azure n'a
pas ce comportement, et le métier n'a plus à le connaître. Le backend remonte un
`StorageAmbiguousError` plutôt que de deviner.

### 6.2 `yellowstorm-code-runtime`

L'interface `ObjectStore` **existait déjà** — il a suffi d'ajouter une implémentation à
côté de `CephS3Store`, sans toucher aux consommateurs.

| Fichier | Rôle |
|---|---|
| `src/workspace/azure-blob.ts` | `AzureBlobStore implements ObjectStore` *(nouveau)* |
| `src/config.ts` | Union discriminée `StorageConfig`, les variables Ceph ne sont plus requises en mode azure |
| `src/main.ts` | `createStore()` choisit l'implémentation |

### 6.3 `yellowstorm-adk`

| Fichier | Changement |
|---|---|
| `src/config/settings.py` | Ajout de `STORAGE_PROVIDER` (défaut `ceph`) |
| `src/smart_rag/tools/infrastructure/common_helpers.py` | Switch explicite + normalisation des clés sur la branche Azure |

Deux corrections :

1. **Le switch était implicite** — basé sur la présence de la config Ceph, donc Ceph
   gagnait silencieusement si les deux étaient configurés. `STORAGE_PROVIDER=azure`
   permet désormais de basculer **sans retirer d'abord les `CEPH_*`**.

2. **La branche Azure ne normalisait pas les clés.** La branche Ceph appelait
   `_normalize_ceph_object_key()` ; la branche Azure passait `file_path` brut à
   `FileClient`. Un chemin stocké portant un préfixe de conteneur échouait donc au
   téléchargement. La fonction, renommée `_normalize_object_key()`, est maintenant
   appelée par les **deux** branches et gère 4 formes :

   ```
   s3://<conteneur>/<clé>                        → <clé>
   https://<host>/<conteneur>/<clé>              → <clé>
   <conteneur>/<clé>                             → <clé>
   <clé>                                         → <clé>   (idempotent)
   ```

   Le bucket Ceph **et** le file system Azure comptent tous deux comme préfixes
   strippables : un chemin indexé sous Ceph reste résoluble après bascule.

---

## 7. Différences de comportement Azure vs Ceph

Toutes traitées dans le code, mais à connaître. Les quatre premières ont été
**découvertes en testant contre un vrai compte Gen2**, pas déduites de la doc.

| # | Différence | Traitement |
|---|---|---|
| 1 | **Répertoires fantômes.** Sur HNS, écrire `a/b/c.txt` crée des entrées `a` et `a/b` qui **survivent à la suppression de tous les blobs** et remontent dans `listBlobsFlat`. Sans filtrage, `list()` renvoie de faux documents de 0 octet. | Filtrées via la métadonnée `hdi_isfolder`, et `head()` renvoie `null` dessus. Nécessite `includeMetadata: true`. |
| 2 | **Pagination cassée par ce filtrage.** Une page ne contenant que des marqueurs de répertoire devenait vide alors qu'il restait des objets. Un appelant ne suivant pas le token voyait une liste vide. | Boucle qui saute les pages 100 % répertoires, sans jamais renvoyer deux fois la même page. |
| 3 | **`copy` exige une SAS sur la source**, même à l'intérieur d'un seul compte. L'auth par clé de compte ne suffit pas pour `syncCopyFromURL`. | SAS de lecture courte (10 min) générée sur la source. |
| 4 | **Métadonnées : Azure refuse les tirets.** Les noms doivent être des identifiants C# valides. Une clé comme `content-hash`, légale en S3, fait échouer tout l'upload en 400. | Tirets convertis en underscores. |
| 5 | **Format de range.** S3 prend `bytes=0-499` ; Azure veut un couple offset/count et **n'a pas d'équivalent de la forme suffixe** `bytes=-500`. | Traduction des 3 formes ; la forme suffixe est résolue contre la taille du blob. |
| 6 | **URLs signées.** S3 presigned URL → Azure SAS. Format d'URL différent, même fonction. | `generateSasUrl()`. Les méthodes s'appellent déjà `generateSasUrl` côté back par convention historique. |
| 7 | **Création du conteneur.** Ceph auto-créait le bucket au démarrage (`CreateBucketCommand`). | `createIfNotExists()` côté Azure. |
| 8 | **Suppression de répertoires.** Supprimer des blobs laisse les répertoires derrière, et les supprimer exige un ordre du plus profond au plus haut, sinon `DirectoryIsNotEmpty`. | Aucun chemin applicatif ne supprime de dossiers aujourd'hui. Si un « supprimer le dossier » est ajouté un jour, il faudra le SDK DataLake et son delete récursif. |

---

## 8. Validation

Testé contre un vrai compte Data Lake Gen2 (hierarchical namespace confirmé via la
métadonnée `hdi_isfolder`).

| Périmètre | Résultat |
|---|---|
| `back` — `AzureStorageBackend` contre compte réel | **22/22** |
| `code-runtime` — `AzureBlobStore` contre compte réel | **8/8** |
| `back` — tests unitaires module document | **125/125** |
| `back` — workspace / health / indexing | **164/164** (3 skipped pré-existants) |
| `code-runtime` — tests unitaires | **36/36** |
| `adk` — tests `common_helpers` | 20 passed (2 échecs **pré-existants**, voir ci-dessous) |

Validé en conditions réelles : SAS en lecture **et** écriture (URL réellement fetchée et
uploadée), `contentDisposition`, copy server-side, les 3 formes de range, upload par
stream, pagination avec token, sanitisation des métadonnées, filtrage des répertoires
HNS.

> **Les 2 échecs adk sont antérieurs à ces changements** (vérifié en stashant les
> modifications : 2 échecs avant, 2 échecs après). `test_has_ceph_config_false_by_default`
> et `test_async_download_from_storage_uses_azure_when_no_ceph` supposent une absence de
> config Ceph alors que le `.env` en contient une — et le second **effectue un vrai appel
> HTTP vers le Ceph de production**. À corriger indépendamment.

---

## 9. Checklist de bascule

1. **Créer le conteneur** sur le storage account (ou laisser `createIfNotExists()` le faire).
2. **Copier les données existantes** Ceph → Azure. Le conteneur Azure démarre vide : sans
   cette étape, l'application cherchera les anciens fichiers dans Azure et renverra 404.
   Le dépôt contient `YellowStorm/back/scripts/migrate-azure-to-ceph.ts`, réutilisable en
   inversant le sens.
3. **Poser les variables** du bloc §5.1 sur le back.
4. **Vérifier le log de démarrage** : `Azure Blob connection established`. En cas
   d'échec, le message est explicite et le healthcheck/reconnect prend le relais.
5. **Si vous basculez aussi l'adk** : aligner `AZURE_DATALAKE_FILE_SYSTEM_NAME` sur le
   même conteneur que `AZURE_STORAGE_CONTAINER_NAME` (§5.5).
6. **Régénérer la clé de compte** si la connection string a circulé hors d'un coffre.

### Ce qui ne nécessite rien

- La base de données : elle stocke la **clé** d'objet (`document.path`), pas l'URL
  complète — celle-ci est reconstruite à la volée. **Aucune migration SQL.**
- `semantic-model-runtime` et `mcp-semantic-model` : transparents.

### Point de vigilance

Les documents déjà indexés portent une URL Ceph complète dans le champ `source` du
vector store (produit par `getBlobUrl()`). La normalisation de clés du §6.3 couvre la
relecture, mais ces chaînes `source` continueront de désigner Ceph.

---

## 10. Points clés à retenir

1. **Azure ne parle pas S3** — ni nativement, ni en preview. Changer les variables ne
   suffisait pas, il fallait une implémentation.

2. **Ceph reste le défaut** — `STORAGE_PROVIDER` non défini ⇒ comportement inchangé.
   Aucun déploiement existant n'est impacté.

3. **Pour le Semantic Model, un seul service est à configurer** : le back. Le
   `semantic-model-runtime` passe par lui en HTTP et refuse par conception d'être
   redirigé vers le stockage — donc aucun credential Azure ni route réseau vers Azure
   de son côté.

4. **Même clé, même contrat** — l'upload écrit sous la même clé d'objet qu'avec Ceph.
   Seul le backend derrière change.

5. **Les noms de variables divergent entre l'adk et les services Node** — c'est le piège
   le plus coûteux : un désalignement de conteneur fait échouer le RAG en silence.

6. **Les données ne se migrent pas toutes seules** — copier Ceph → Azure est une étape
   à part entière.
