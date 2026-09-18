# App Data — Architecture complète

> Référence unique de l'architecture App Data : le microservice standalone,
> l'intégration dans le backend YellowStorm (NestJS), les flux de communication
> (agent MCP, preview Nodepod, apps déployées, Data tab owner) et le dépannage.

---

## 1. Vue d'ensemble

App Data fournit un **stockage persistant par application** (PostgreSQL) aux apps
générées par l'App Builder. Le runtime d'exécution (Nodepod) n'exécute que du
code — jamais de credentials DB.

**Deux modes de fonctionnement** (variable `APP_DATA_REMOTE`, validée dans
`config/app-data.config.ts`) :

| Mode | Description | État |
|---|---|---|
| **Remote** (`true`) | Le backend délègue au microservice standalone : provisioning, schéma, rows, auth end-user, tickets. Les services tenant-schema locaux ne sont pas enregistrés. | **Mode de référence** |
| Local (legacy) | Tout dans le monolithe (schémas tenants `ymapp_<id>_dev/prod`). | Conservé comme rollback |

**Cutoff** : les endpoints publics CRUD/auth/invites ont été **supprimés**
du backend YellowStorm dans les deux modes. Les apps générées parlent
**exclusivement au microservice**. Seuls restent exposés côté YellowStorm :
**MCP (agent)**, **owner Data tab**, **ticket preview (owner)** et **health**.

---

## 2. Architecture

### 2.1 Composants

```
┌─────────────────────────────────────────────────────────────────────┐
│                        YellowStorm Backend (NestJS)                 │
│                                                                     │
│  ┌──────────────┐  ┌────────────────────┐  ┌──────────────────────┐│
│  │ McpController │  │ OwnerController    │  │ HealthController     ││
│  │ POST /mcp     │  │ /conversations/... │  │ /app-data/health     ││
│  └──────┬───────┘  └────────┬───────────┘  └──────────────────────┘│
│         │                   │                                       │
│  ┌──────▼───────────────────▼───────────────────────────────────┐  │
│  │              AppDataModule (APP_DATA_USE_REMOTE)              │  │
│  │                                                               │  │
│  │  Remote mode:                                                │  │
│  │    AppDataMcpDispatcherService → RemoteAppDataMcpDispatcher   │  │
│  │    AppDataDeploymentService    → RemoteAppDataDeployment      │  │
│  │    AppDataReleaseBindingService→ RemoteAppDataReleaseBinding  │  │
│  │                                                               │  │
│  │  Local mode: all services registered directly                 │  │
│  └──────────────────────────┬────────────────────────────────────┘  │
│                             │ HTTP (service token)                  │
└─────────────────────────────┼───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   app-data microservice (NestJS + Fastify)          │
│                   http://localhost:8443/v1/...                      │
│                                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Internal API │  │ Data Plane   │  │ End-user Auth            │  │
│  │ (svc token)  │  │ (ticket/JWT) │  │ (register/login/me)     │  │
│  └──────┬──────┘  └──────┬───────┘  └──────────────────────────┘  │
│         │                │                                          │
│  ┌──────▼────────────────▼─────────────────────────────────────┐   │
│  │              PostgreSQL                                      │   │
│  │  ┌─────────────────────┐  ┌──────────────────────────────┐  │   │
│  │  │ db-control (5433)   │  │ db-tenant-dev (5434)         │  │   │
│  │  │ app_data schema     │  │ app_<id>_dev                 │  │   │
│  │  │ apps, databases,    │  │ (une DB par app)             │  │   │
│  │  │ end_users, grants,  │  ├──────────────────────────────┤  │   │
│  │  │ audit_events        │  │ db-tenant-prod (5435)        │  │   │
│  │  └─────────────────────┘  │ app_<id>_prod                │  │   │
│  │                           └──────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Conteneurs (docker-compose)

| Conteneur | Rôle | Port host |
|---|---|---|
| `app-data-service` | API NestJS (Fastify) — préfixe `/v1` | 8443 |
| `app-data-db-control` | Control plane : registre apps, databases, end_users, grants, audit | 5433 |
| `app-data-db-tenant-dev` | Données DEV — **une database par app** (`app_<appDataId>_dev`) | 5434 |
| `app-data-db-tenant-prod` | Données PROD — une database par app | 5435 |

---

## 3. Backend YellowStorm — module AppData

### 3.1 Câblage (`app-data.module.ts`)

`APP_DATA_USE_REMOTE = appDataConfig().remote` sélectionne contrôleurs + providers :

| | LOCAL_CONTROLLERS | REMOTE_CONTROLLERS |
|---|---|---|
| MCP agent | `AppDataMcpController` | `AppDataMcpController` |
| Owner Data tab | `AppDataOwnerController` | `AppDataRemoteOwnerController` (proxy) |
| Health | `AppDataHealthController` (`remote: false`) | `AppDataRemoteHealthController` (`remote: true, remoteReady`) |

En remote, les tokens de services sont rebondis :

```
AppDataMcpDispatcherService     → RemoteAppDataMcpDispatcherService
AppDataDeploymentService        → RemoteAppDataDeploymentService
AppDataReleaseBindingService    → RemoteAppDataReleaseBindingService
```

Les consommateurs injectent les mêmes tokens — aucune duplication côté appelants.

> **Note** : `APP_DATA_REMOTE` est évalué via `appDataConfig().remote` dans le
> module, et la validation de la valeur est faite dans `config/app-data.config.ts`
> (IIFE dans `registerAs`). Un `import 'dotenv/config'` en tête de `main.ts`
> assure que `.env` est chargé avant le graphe d'imports.

### 3.2 Configuration (`config/app-data.config.ts`)

Toutes les variables d'environnement sont gérées via `registerAs('appData', ...)` :

| Variable | Défaut | Rôle |
|---|---|---|
| `APP_DATA_ENABLED` | `false` | Master switch |
| `APP_DATA_REMOTE` | `false` | Délégation au microservice (validé : `true`/`false`/vide) |
| `APP_DATA_SERVICE_URL` | `http://localhost:8443` | URL interne (server-to-server) |
| `APP_DATA_SERVICE_TOKEN` | (vide) | **Identique** à `SERVICE_TOKEN` du microservice |
| `APP_DATA_REMOTE_PUBLIC_BASE_URL` | `http://localhost:8443` | Base pour le preview |
| `APP_DATA_REMOTE_PUBLIC_BASE_URL_PROD` | (vide) | Base **HTTPS publique** pour apps déployées (requis en prod) |
| `APP_DATA_REMOTE_TIMEOUT_MS` | `15000` | Timeout HTTP microservice |
| `APP_DATA_REMOTE_BIND_TIMEOUT_MS` | `120000` | Timeout bind/schema |
| `APP_DATA_MCP_ENABLED` | `false` | Endpoint MCP |
| `APP_DATA_DATA_TAB_ENABLED` | `false` | Owner Data tab |
| `APP_BUILDER_STARTER_REVISION_ID` | `starter_react_vite_v4` | Starter des nouvelles sessions |

### 3.3 Endpoints backend restants

| Route | Garde | Rôle |
|---|---|---|
| `POST /api/v1/mcp/app-data` | MCP token (binding session) | JSON-RPC MCP — outils agent |
| `GET /api/v1/conversation-v2/sessions/:id/app-data/ticket` | `ConversationV2OwnerGuard` | Data ticket owner pour le preview |
| `GET /api/v1/conversation-v2/sessions/:id/app-data/status` | OwnerGuard | Statut provisioning (proxy remote) |
| `GET|PUT|PATCH /api/v1/conversation-v2/sessions/:id/app-data/end-users…` | OwnerGuard | Gestion end-users + grants (proxy remote) |
| `GET /api/v1/app-data/health` | Public | Health + marqueur de mode |

**Supprimés** : `/app-data/public/:id/:env/tables/...` (CRUD), `.../auth/*`,
`.../invites/*` — en local comme en remote.

---

## 4. Authentification & autorisation

### 4.1 Les quatre principaux

| Principal / token | Émis par | Utilisé par | Autorisation data-plane |
|---|---|---|---|
| **Service token** (`SERVICE_TOKEN`, statique) | Ops | Backend YellowStorm → microservice | N/A (routes internes) |
| **MCP token** (binding session) | Backend (`runtime-bind`) | Agent via MCP | Owner path — provisioning, schéma, rows |
| **Data ticket** (JWT court, `typ=data_ticket`) | Microservice `POST /internal/tickets` | **Preview Nodepod** | Bypass grants si `sub === apps.owner_user_id` |
| **End-user JWT** (register/login) | Microservice | Apps **déployées** (PROD) | Grants par end-user (deny-until-granted) |

**Fail-closed** : aucune requête sans Bearer n'est acceptée sur une route gardée.

### 4.2 Attribution owner (preview)

```
1. Frontend → GET /conversation-v2/sessions/:id/app-data/ticket
   (session YellowStorm authentifiée, owner-guardé)

2. Backend :
   → ensureApp(aiSessionId, name?, ownerUserId)  // lazy backfill owner_user_id
   → POST /internal/tickets { workspaceId, userId: owner, appDataId, env: 'dev' }

3. Relay parent injecte Authorization: Bearer <ticket> sur chaque appel relayé
   → le data-plane attribue owner_id = <ObjectId hex du propriétaire>

4. Sur 401 (ticket expiré) : refresh + retry ×1
```

Le bypass owner est vérifié contre `apps.owner_user_id` — pas de rows de grants.

### 4.3 Apps déployées (PROD)

End-users réels (register/login, bcrypt + JWT `APP_DATA_END_USER_JWT_TTL`),
grants **deny-until-granted** activés par l'owner dans le Data tab.

---

## 5. Communication — flux de bout en bout

### 5.1 Provision + schéma (agent, en session)

```
Agent (OpenCode)
  ──MCP appdata_*──▶ POST /api/v1/mcp/app-data (backend)
       │
       └─ AppDataMcpAuthService.resolveBinding(mcpToken)
            → binding { workspaceId, userId }
       │
       └─ RemoteAppDataMcpDispatcherService
            ├─ provision → ensureApp(workspace, owner=userId) + provision('dev')
            ├─ schema_apply → normalizeSchemaManifest → filtre colonnes réservées
            │                 → POST /internal/apps/:id/dev/schema
            └─ row_* → owner-access (internal API, service token)
```

**Notes** :
- Colonnes **réservées** (`id`, `owner_id`, `created_at`, `updated_at`) filtrées
  du manifeste avant DDL.
- `normalizeSchemaManifest` nettoie les erreurs LLM courantes (version imbriqué
  dans `tables`, entrées non-objet) et retourne des **warnings** si des entrées
  sont supprimées.
- `policy_apply` / `schema_plan` / `policy_get` sont des erreurs explicites en remote.

### 5.2 Seed (MCP)

```
Agent → seed MCP tool
  → validateSeedTables(rawTables)           // shared util
  → batchInsert(table, rows, ownerUserId)
       → une seule INSERT par table (ON CONFLICT DO NOTHING)
       → metadata fetch une seule fois (pas N×4 DB queries)
```

Le seed est **idempotent** : les rows portant un `id` existant sont ignorées.

### 5.3 Dev preview (Nodepod)

```
1. Runtime ticket (backend, owner-guardé)
   → { ticket, workspaceId, appDataRuntimeEnv { appDataId, publicUrl } }

2. Frontend BrowserRuntimeHost :
   → buildAppDataViteEnv() → VITE_YM_APP_DATA_URL/ID/ENV/PROXY
   → startDevServer(pod, env) — kill l'ancien process Vite
   → setAppDataTicketProvider(...) (cache 10 min, refresh sur 401)

 3. App générée (iframe)
    ──postMessage ym-app-data-fetch──▶ parent relay
     └─ filtre /v1/apps/
     └─ injecte Authorization: Bearer <dataTicket>  (+ retry ×1 sur 401)
     └─ fetch http://localhost:8443/v1/apps/{id}/dev/tables/...

 4. Réponse ──postMessage '*'──▶ iframe
```

Bypass login en preview : `isDevPreview()` (`import.meta.env.DEV &&
VITE_YM_APP_DATA_ENV === 'dev'`).

### 5.4 Deploy PROD

```
Deploy (backend) → AppDataDeploymentService.prepareProduction
  (local: gère le replay schema DEV→PROD en local ;
   remote: POST /internal/releases/bind côté microservice)
  → buildRuntimeEnv(appDataId, 'prod') → publicUrl PROD
     (pointe toujours sur le microservice : APP_DATA_REMOTE_PUBLIC_BASE_URL_PROD)
  → VITE_YM_APP_DATA_URL cuite au build
```

Split des bases :
- **dev** → `APP_DATA_REMOTE_PUBLIC_BASE_URL`
- **prod** → `APP_DATA_REMOTE_PUBLIC_BASE_URL_PROD` (HTTPS requis : mixed content)

### 5.5 Data tab owner (UI YellowStorm)

`AppDataRemoteOwnerController` : lit le mapping session→workspace localement,
proxifie vers l'internal API du microservice avec le service token.

---

## 6. Endpoints microservice (`http://localhost:8443/v1/...`)

| Groupe | Routes | Auth |
|---|---|---|
| **Internal** | `POST /internal/apps` (ensure, + owner), `POST .../provision`, `POST .../schema`, `POST /internal/tickets`, `GET .../by-workspace/:wid`, `/status`, `/end-users`, `PUT .../wildcard-grants`, `POST .../releases/bind` | `Bearer <SERVICE_TOKEN>` |
| **Data plane** | `GET|POST /apps/:id/:env/tables/:t/rows`, `GET|PATCH|DELETE .../rows/:id` | Data ticket ou end-user JWT |
| **End-user auth** | `POST /apps/:id/auth/register`, `POST .../auth/login`, `GET .../auth/me` | Public / Bearer |
| **MCP** | `POST /mcp` (JSON-RPC) | MCP token |
| **Health** | `GET /health/live`, `GET /health/ready` | Public |

**Contrat data-plane** : mutations → `{ row: … }` ; liste → `{ rows, total, page, pageSize }`.
Colonnes système : `id` (UUID PK), `owner_id`, `created_at`, `updated_at` — réservées.

---

## 7. Schéma de données

### Control plane (`app_data` sur db-control)

| Table | Colonnes clés | Notes |
|---|---|---|
| `apps` | `id UUID PK`, `workspace_id TEXT UNIQUE`, **`owner_user_id TEXT`**, `name`, `status` | Registre des apps |
| `databases` | `app_id`, `environment` (dev/prod), `database_name`, `connection_string` | Routage multi-DB |
| `end_users` | `id UUID`, `app_id`, `email`, `password_hash`, `display_name`, `status` | Comptes end-user |
| `end_user_grants` | `app_id`, `user_id UUID FK→end_users`, `resource`, `action`, `effect` | Grants deny-until-granted |
| `audit_events` | `app_id`, `event_type`, `user_id UUID`, `metadata` | Journal immuable |

### Tenants

**Une database PostgreSQL par app et environnement** :
`app_<appDataId>_dev` / `app_<appDataId>_prod`. Chaque table utilisateur reçoit
`id UUID PK`, `owner_id TEXT`, `created_at`, `updated_at` + **RLS**.

---

## 8. Shared utilities (`utils/app-data-sql.util.ts`)

Fonctions partagées entre les dispatchers local et remote :

| Fonction | Rôle |
|---|---|
| `safeSqlDefault(raw)` | Valide et normalise une expression SQL DEFAULT (littéraux, `now()`, `gen_random_uuid()`) — rejet des identifiants bruts |
| `validateSeedTables(rawTables)` | Valide la structure `tables` du seed MCP — retourne les entrées valides ou lève `INVALID_MANIFEST` |
| `normalizeSchemaManifest(manifest)` | Répare les erreurs LLM (version imbriqué, entrées non-objet) — retourne `{ manifest, changed, warnings }` |
| `quoteIdent(name)` | Quote un identifiant PostgreSQL (`"name"`) |
| `assertIdentifier(name)` | Valide contre `APP_DATA_IDENTIFIER_RE` |
| `validateManifest(manifest, limits)` | Validation complète d'un manifeste (types, PK, limites) |

Le module local `AppDataRowService` expose aussi `batchInsert()` pour des
insertions groupées idempotentes (ON CONFLICT DO NOTHING).

---

## 9. Starter React/Vite

Source de vérité : [`templates/sources/`](templates/sources/).
Starter courant : **`starter_react_vite_v4`**.

| Fichier | Contrat |
|---|---|
| `src/lib/yellowmind-data.ts` | Client data — mutations attendent `{ row }`, liste `{ rows }` |
| `src/lib/yellowmind-auth.tsx` | Register/login → `{ token, user }`, `me` → `{ user }` |
| `src/components/auth/ProtectedRoute.tsx` | Bypass login en dev preview |
| `preview-wrapper.html` (front `public/`) | Relay postMessage (accepte `/v1/apps/`) |

Le starter est **URL-agnifique** : construit tout à partir de `VITE_YM_APP_DATA_URL`.

---

## 10. Codes d'erreur

Voir `constants/app-data.errors.ts` :

| Code | Signification |
|---|---|
| `APP_DATA_DISABLED` | Module désactivé |
| `APP_DATA_REMOTE_UNAVAILABLE` | Microservice injoignable |
| `APP_DATA_NOT_PROVISIONED` | Environnement non provisionné |
| `APP_DATA_INVALID_IDENTIFIER` | Identifiant invalide (table, colonne, appDataId) |
| `APP_DATA_INVALID_MANIFEST` | Manifeste malformé |
| `APP_DATA_VERSION_CONFLICT` | Conflit de version (migration concurrente) |
| `APP_DATA_DESTRUCTIVE_BLOCKED` | Migration destructive non confirmée |
| `APP_DATA_POLICY_DENIED` | Accès refusé par la politique |
| `APP_DATA_ROW_NOT_FOUND` | Ligne introuvable |
| `APP_DATA_LIMIT_EXCEEDED` | Limite dépassée (tables, colonnes, body) |
| `APP_DATA_AUTH_REQUIRED` / `AUTH_INVALID` | Auth manquante ou invalide |
| `APP_DATA_GRANT_DENIED` | Grant refusé |
| `APP_DATA_DEPLOY_CONFIG_MISSING` | Config deploy manquante (PROD base) |
| `APP_DATA_INVITE_*` | Erreurs d'invitation |

---

## 11. Dépannage

| Symptôme | Cause | Fix |
|---|---|---|
| Health sans `"remote": true` | `APP_DATA_REMOTE` mal configuré | Vérifier `.env` ; valeur validée dans `config/app-data.config.ts` (warn si non reconnu) |
| `relation "tasks" does not exist` | Colonnes réservées re-déclarées dans le manifeste | Filtrées automatiquement ; re-jouer `schema_apply` |
| `Failed to fetch` depuis le preview | `ALLOWED_ORIGINS` du microservice incomplet | Ajouter les origines ; preflight OPTIONS 204 |
| `App Data proxy timeout` | Relay parent absent (onglet rechargé) | Hard-reload YellowStorm ; relay répond erreur immédiate |
| Écran blanc après ajout de données | Data-plane retournait row brute au lieu de `{ row }` | Contrat `{ row }` restauré sur POST/PATCH/DELETE |
| 401 partout dans le preview | Pas de data ticket (app non provisionnée ou endpoint absent) | Provisionner via l'agent ; vérifier `remote: true` |
| Preview en login screen | `isDevPreview()` false (`VITE_YM_APP_DATA_ENV` / `VITE_YM_AI_PROXY` absent) | Host injecte `VITE_YM_APP_DATA_ENV=dev` (+ AI proxy) ; `dev_server restart` après provision ; ne pas patcher `ProtectedRoute` |
| `normalizeSchemaManifest` drop des tables | Entrées non-objet dans le manifeste LLM | Vérifier la structure : `{ tables: { "name": { columns: {...} } } }` |
| `seed` inserting 0 rows | `ON CONFLICT DO NOTHING` sur IDs existants | IDs déjà présents ; changer les IDs ouvider les tables |

---

## 12. Santé du système

### 12.1 Backend YellowStorm

| Endpoint | Garde | Description |
|---|---|---|
| `GET /api/v1/app-data/health` | Public | Flags du module + indicateur `remote`/`remoteReady` |

**Réponse local** (`APP_DATA_REMOTE=false`) :
```json
{
  "enabled": true,
  "mcp": true,
  "publicApi": false,
  "dataTab": true,
  "remote": false
}
```

**Réponse remote** (`APP_DATA_REMOTE=true`) :
```json
{
  "enabled": true,
  "mcp": true,
  "publicApi": false,
  "dataTab": true,
  "remote": true,
  "remoteReady": true
}
```

Le champ `remoteReady` reflète la connectivité réelle vers le microservice
(`AppDataClientService.ready()` — `GET /v1/health/ready` avec timeout 3s).
Si `false`, le microservice est injoignable ou ne répond pas `{ status: "ok" }`.

### 12.2 Microservice app-data

| Endpoint | Auth | Description |
|---|---|---|
| `GET /v1/health/live` | Public | Liveness — le process tourne |
| `GET /v1/health/ready` | Public | Readiness — DB connectée + prête |

**Réponse readiness** :
```json
{ "status": "ok", "database": "connected" }
```

### 12.3 Supervision

```
┌─────────────────────────────┐
│  GET /api/v1/app-data/health│  ← YellowStorm backend
│    remoteReady: true/false  │
└──────────────┬──────────────┘
               │ appelle
               ▼
┌─────────────────────────────┐
│  GET :8443/v1/health/ready  │  ← Microservice app-data
│    status: "ok"             │
│    database: "connected"    │
└──────────────┬──────────────┘
               │ vérifie
               ▼
┌─────────────────────────────┐
│  PostgreSQL db-control:5433 │  ← Control plane DB
│  PostgreSQL db-tenant-*     │  ← Tenant DBs
└─────────────────────────────┘
```

**Commandes rapides** :
```bash
# Backend health (mode remote attendu)
curl -s http://localhost:3000/api/v1/app-data/health | jq .

# Microservice liveness
curl -s http://localhost:8443/v1/health/live | jq .

# Microservice readiness (DB check)
curl -s http://localhost:8443/v1/health/ready | jq .
```

---

## 13. Décisions d'architecture clés

1. **Cutoff des endpoints publics backend** — les apps ne passent jamais par
   YellowStorm ; supprime la surface d'attaque et la double implémentation.
2. **URL directe microservice** (preview = `localhost:8443`, deploy = base
   HTTPS publique) — choix utilisateur ; impose CORS + reverse proxy HTTPS.
3. **Fail-closed preview** — pas d'anonyme ; data ticket owner obligatoire.
4. **Grants end-user (deny-until-granted)** au lieu des policies par principal.
5. **`normalizeSchemaManifest`** — répare automatiquement les erreurs LLM
   fréquentes au lieu de faire échouer l'outil MCP.
6. **`batchInsert` idempotent** — seed en une seule INSERT par table avec
   ON CONFLICT DO NOTHING, metadata fetch unique (pas N×4 queries).
7. **Validation config en IIFE** — `APP_DATA_REMOTE` validé à l'initialisation
   du `registerAs` avec warning explicite pour valeurs non reconnues.
8. **Shared utils** — `safeSqlDefault`, `validateSeedTables`, `normalizeSchemaManifest`
   extraits dans `app-data-sql.util.ts` pour éviter la duplication.

---

## 14. Scripts utilitaires

| Script | Rôle |
|---|---|
| `publish-starter-to-ceph.ts` | Publie un starter dir → Ceph (blobs + manifest) |
| `download-starter-from-ceph.js` | Télécharge manifest + blobs (inspection) |
| `materialize-starter-v3.ts` | Reconstruit le starter v3 |
| `export-dev-db-to-md.js` (**microservice**) | Exporte les DB tenant DEV en Markdown |
| `reassign-anonymous-rows.js` (**microservice**) | Réattribue `owner_id='anonymous'` → owner |

---

## 15. Invariants

- Chaque workspace persistant reçoit un `appDataId` opaque ; `owner_user_id` = créateur.
- Aucune credential DB/JWT/MCP dans les apps générées — uniquement `VITE_YM_APP_DATA_*`.
- Destructive : confirmation explicite en DEV ; jamais auto en PROD.
- Les warnings de `normalizeSchemaManifest` et `mapManifestTables` sont retournés
  dans la réponse MCP mais ne bloquent pas l'opération.
