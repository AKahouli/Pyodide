# App Data — Architecture complète (microservice + backend YellowStorm + communication)

> Référence unique de l'architecture App Data après la migration vers le
> microservice standalone (`C:\Users\bader\Desktop\YellowSys\app-data`).
> Couvre : le microservice, l'intégration dans le backend YellowStorm (NestJS),
> les flux de communication (agent MCP, preview Nodepod, apps déployées,
> Data tab owner) et le dépannage.

---

## 1. Vue d'ensemble

App Data fournit un **stockage persistant par application** (PostgreSQL) aux apps
générées par l'App Builder. Le runtime d'exécution (Nodepod) n'exécute que du
code — jamais de credentials DB.

**Deux modes de fonctionnement** (variable `APP_DATA_REMOTE`) :

| Mode | Description | État |
|---|---|---|
| **Remote** (`APP_DATA_REMOTE=true`) | Le backend délègue au microservice standalone : provisioning, schéma, rows, auth end-user, tickets. Les services tenant-schema locaux ne sont pas enregistrés. | **Mode de référence** |
| Local (legacy) | Tout dans le monolithe (schémas tenants `ymapp_<id>_dev/prod`). | Conservé comme rollback |

**Cutoff assumé** : les endpoints publics CRUD/auth/invites ont été **supprimés**
du backend YellowStorm dans les deux modes. Les apps générées parlent
**exclusivement au microservice** — plus jamais au port 3000 pour l'app-data.
Seuls restent exposés côté YellowStorm : **MCP (agent)**, **owner Data tab**,
**ticket preview (owner)** et **health**.

### Composants (docker-compose du microservice)

| Conteneur | Rôle | Port host |
|---|---|---|
| `app-data-service` | API NestJS (Fastify) — préfixe global `/v1` | 8443 |
| `app-data-db-control` | Control plane : registre apps, databases, end_users, grants, audit | 5433 |
| `app-data-db-tenant-dev` | Données DEV — **une database par app** (`app_<appDataId>_dev`) | 5434 |
| `app-data-db-tenant-prod` | Données PROD — une database par app | 5435 |

---

## 2. Backend YellowStorm — mode remote

### 2.1 Câblage du module (`app-data.module.ts`)

`APP_DATA_USE_REMOTE = process.env.APP_DATA_REMOTE === 'true'` sélectionne
contrôleurs + providers :

| | LOCAL_CONTROLLERS | REMOTE_CONTROLLERS |
|---|---|---|
| MCP agent | `AppDataMcpController` | `AppDataMcpController` |
| Owner Data tab | `AppDataOwnerController` | `AppDataRemoteOwnerController` (proxy) |
| Health | `AppDataHealthController` (`remote: false`) | `AppDataRemoteHealthController` (`remote: true, remoteReady`) |

En remote, les tokens de services sont rebondis vers les implémentations
remote : `AppDataDeploymentService → RemoteAppDataDeploymentService`,
`AppDataReleaseBindingService → Remote…`, `AppDataMcpDispatcherService →
RemoteAppDataMcpDispatcherService`. Les consommateurs injectent les mêmes
tokens — aucune duplication côté appelants.

> ⚠️ **Piège résolu** : le flag est lu **au chargement statique du module**,
> avant que `ConfigModule.forRoot()` ne charge le `.env`. `main.ts` commence
> donc par `import 'dotenv/config';` (premier import, ordre préservé par la
> compilation TS→CJS). Sans lui, le mode remote ne s'active jamais depuis le
> `.env` — symptôme : health sans le champ `remote: true`.

### 2.2 Endpoints backend restants

| Route | Garde | Rôle |
|---|---|---|
| `POST /api/v1/mcp/app-data` | MCP token (binding session) | JSON-RPC MCP — outils agent (`provision`, `schema_apply`, `row_*`…) |
| `GET /api/v1/conversation-v2/sessions/:id/app-data/ticket` | `ConversationV2OwnerGuard` | **Data ticket owner** pour le preview (voir §4) |
| `GET /api/v1/conversation-v2/sessions/:id/app-data/status` | OwnerGuard | Statut provisioning (proxy remote) |
| `GET|PUT|PATCH /api/v1/conversation-v2/sessions/:id/app-data/end-users…` | OwnerGuard | Gestion end-users + grants (proxy remote) |
| `GET /api/v1/app-data/health` | Public | Health + **marqueur de mode** (`remote`, `remoteReady`) |

**Supprimés définitivement** : `/app-data/public/:id/:env/tables/...` (CRUD),
`.../auth/*` (register/login/me), `.../invites/*` — en local comme en remote.
Toute requête sur ces chemins renvoie 404.

### 2.3 Endpoints du microservice (`http://localhost:8443/v1/...`)

| Groupe | Routes | Auth |
|---|---|---|
| **Internal** (service-to-server) | `POST /internal/apps` (ensure, + owner), `POST /internal/apps/:id/:env/provision`, `POST /internal/apps/:id/:env/schema`, `POST /internal/tickets`, `GET /internal/apps/by-workspace/:wid`, `/status`, `/end-users`, `PUT .../wildcard-grants`, `POST /internal/releases/bind` | `Authorization: Bearer <SERVICE_TOKEN>` |
| **Data plane** (apps générées + tickets) | `GET|POST /apps/:appDataId/:env/tables/:t/rows`, `GET|PATCH|DELETE .../rows/:id` | **Data ticket** ou **end-user JWT** (fail-closed) |
| **End-user auth** | `POST /apps/:id/auth/register` → `{token, user}`, `POST .../auth/login` → `{token, user}`, `GET .../auth/me` → `{user}` | Public / Bearer |
| **MCP** | `POST /mcp` (JSON-RPC) | MCP token |
| **Health** | `GET /health/live`, `GET /health/ready` (`{status:'ok', database}`) | Public |

**Contrat data-plane** (aligné sur le starter v4) : mutations → **`{ row: … }`**
; liste → `{ rows, total, page, pageSize }` ; get → row brute. Colonnes
système gérées par le service : `id` (UUID PK), `owner_id`, `created_at`,
`updated_at` — **réservées**, filtrées des manifestes et rejetées dans les rows.

---

## 3. Authentification & autorisation

### 3.1 Les quatre principaux

| Principal / token | Émis par | Utilisé par | Autorisation data-plane |
|---|---|---|---|
| **Service token** (`SERVICE_TOKEN`, statique) | Ops | Backend YellowStorm → microservice (internal API) | N/A (routes internes) |
| **MCP token** (binding session) | Backend (`runtime-bind`) | Agent OpenCode via MCP | Owner path — provisioning, schéma, rows via `owner-access` |
| **Data ticket** (JWT court, `typ=data_ticket`) | Microservice `POST /internal/tickets` (appelé par YellowStorm, owner-guardé) | **Preview Nodepod** (relay parent) | **Bypass grants si `sub === apps.owner_user_id`** — le créateur owns ses données |
| **End-user JWT** (register/login) | Microservice | Apps **déployées** (PROD) | Grants par end-user — **deny-until-granted** (owner active via Data tab) |

**Fail-closed** : aucune requête sans Bearer n'est acceptée sur une route
gardée (le fallback `anonymous` qui a existé transitoirement a été retiré).

### 3.2 Attribution owner (preview)

1. Le frontend demande `GET /conversation-v2/sessions/:id/app-data/ticket`
   (session YellowStorm authentifiée, owner-guardé).
2. Le backend : `ensureApp(aiSessionId, name?, ownerUserId)` sur le
   microservice (**remplit `apps.owner_user_id` si null** — lazy backfill des
   apps existantes) puis `POST /internal/tickets { workspaceId, userId:
   <owner>, appDataId, env: 'dev' }`.
3. Le relay parent injecte `Authorization: Bearer <ticket>` sur chaque appel
   relayé → le data-plane attribue **`owner_id = <ObjectId hex du
   propriétaire>`** (l'ObjectId hex YellowStorm brut).
4. Sur **401** (ticket expiré), le relay force un refresh du ticket et rejoue
   **une fois**.

Le bypass owner est vérifié contre `apps.owner_user_id` (chargé par
`catalogService.getApp` dans query/mutate) — pas de rows de grants à créer.

### 3.3 Apps déployées (PROD) — inchangé

End-users réels (register/login, bcrypt + JWT `APP_DATA_END_USER_JWT_TTL`),
grants **deny-until-granted** activés par l'owner dans le Data tab. Le ticket
owner n'existe qu'en preview (`env: 'dev'`).

---

## 4. Communication — flux de bout en bout

### 4.1 Provision + schéma (agent, en session)

```
Agent (OpenCode) ──MCP yellowappdata_*──▶ POST /api/v1/mcp/app-data (backend)
  └─ AppDataMcpAuthService.resolveBinding(mcpToken) → binding {workspaceId, userId}
  └─ RemoteAppDataMcpDispatcherService
       ├─ provision → ensureApp(workspace, owner=userId) + provision('dev')
       ├─ schema_apply → filtre colonnes réservées → POST /internal/apps/:id/dev/schema
       └─ row_* → owner-access (internal API, service token)
```

Notes :
- Colonnes **réservées** (`id`, `owner_id`, `created_at`, `updated_at`)
  filtrées du manifeste avant DDL — les manifestes d'agents qui re-déclarent
  `id` ne cassent plus la migration.
- `policy_apply` / `schema_plan` / `policy_get` / `schema_get` : non supportés
  en remote (erreur `UNSUPPORTED_CAPABILITY` explicite) — le modèle microservice
  est grants par end-user, pas policies par principal.

### 4.2 Dev preview (Nodepod) — données attribuées au owner

```
1. Runtime ticket (backend, owner-guardé)
   → { ticket, workspaceId, appDataRuntimeEnv { appDataId, publicUrl } }
2. Frontend BrowserRuntimeHost :
   → buildAppDataViteEnv() → VITE_YM_APP_DATA_URL/ID/ENV/PROXY
   → startDevServer(pod, env) — kill l'ancien process Vite (restart déterministe)
   → setAppDataTicketProvider(...) (cache 10 min, refresh sur 401)
3. App générée (iframe) ──postMessage ym-app-data-fetch──▶ parent relay
   └─ filtre /app-data/public/ OU /v1/apps/  (sinon erreur immédiate explicite)
   └─ injecte Authorization: Bearer <dataTicket>  (+ retry ×1 sur 401)
   └─ fetch http://localhost:8443/v1/apps/{id}/dev/tables/...
4. Réponse ──postMessage '*'──▶ iframe (survit aux navigations d'iframe)
```

Bypass login en preview : `isDevPreview()` (`import.meta.env.DEV &&
VITE_YM_APP_DATA_ENV === 'dev'`) — l'app n'affiche pas son login, les appels
sont attribués au owner par le ticket.

### 4.3 Deploy PROD

```
Deploy (backend) → RemoteAppDataDeploymentService.prepareProduction
  → client.bindRelease(workspaceId, revisionId)   // copie DEV→PROD + registre
  → buildRuntimeEnv(appDataId, 'prod') → publicUrl PROD
  → VITE_YM_APP_DATA_URL cuite au build du bundle déployé
```

Split des bases publiques (`RemoteAppDataDeploymentService.resolvePublicUrl`) :
- **dev** → `APP_DATA_REMOTE_PUBLIC_BASE_URL` (`http://localhost:8443`)
- **prod** → `APP_DATA_REMOTE_PUBLIC_BASE_URL_PROD` (**HTTPS public requis** :
  page `https://` + appel `http://` = mixed content bloqué ; `localhost`
  n'atteint jamais les visiteurs). Si vide et `NODE_ENV=production` → throw
  `DEPLOY_CONFIG_MISSING`. Sinon (deploys sur host de dev) fallback base dev.

### 4.4 Data tab owner (UI YellowStorm)

`AppDataRemoteOwnerController` (`conversation-v2/sessions/:id/app-data/*`,
`ConversationV2OwnerGuard` — owner **ou partagé**) : lit le mapping
session→workspace localement, puis proxifie vers l'internal API du
microservice avec le service token.

---

## 5. Configuration

### 5.1 Backend YellowStorm (`.env` de `YellowStorm/back`)

| Variable | Défaut | Rôle |
|---|---|---|
| `APP_DATA_ENABLED` | `false` | Master switch |
| `APP_DATA_REMOTE` | `false` | Délégation au microservice (**lu au chargement module**) |
| `APP_DATA_SERVICE_URL` | `http://localhost:8443` | URL interne (server-to-server) |
| `APP_DATA_SERVICE_TOKEN` | (vide) | Doit être **identique** à `SERVICE_TOKEN` du microservice |
| `APP_DATA_REMOTE_PUBLIC_BASE_URL` | `http://localhost:8443` | Base injectée dans le **preview** |
| `APP_DATA_REMOTE_PUBLIC_BASE_URL_PROD` | (vide) | Base **HTTPS publique** pour les apps déployées (requis en NODE_ENV=production) |
| `APP_DATA_REMOTE_TIMEOUT_MS` | `15000` | Timeout HTTP microservice |
| `APP_DATA_REMOTE_BIND_TIMEOUT_MS` | `120000` | Timeout bind/schema (doit rester < idle timeout du stream) |
| `APP_DATA_MCP_ENABLED` | `false` | Endpoint MCP |
| `APP_DATA_DATA_TAB_ENABLED` | `false` | Owner Data tab |
| `APP_BUILDER_STARTER_REVISION_ID` / `_MANIFEST_KEY` | `starter_react_vite_v4` | Starter des nouvelles sessions |

### 5.2 Microservice (`.env` de `app-data/`)

| Variable | Rôle |
|---|---|
| `PORT` | 8443 |
| `SERVICE_TOKEN` | Token interne (**= `APP_DATA_SERVICE_TOKEN` du backend**) |
| `APP_DATA_SERVICE_JWT_SECRET` | Secret des JWT end-user + data tickets |
| `APP_DATA_DATA_TICKET_TTL_SECONDS` | TTL des data tickets (preview) |
| `APP_DATA_END_USER_JWT_TTL` | TTL des JWT end-user (ex. `7d`) |
| `APP_DATA_CONTROL_DATABASE_URL` | Control plane (`db-control:5432/app_data_control`) |
| `APP_DATA_TENANT_DEV_ADMIN_URL` / `_PROD_` | Bases tenants (admin) |
| `ALLOWED_ORIGINS` | CORS — liste CSV. Dev : `http://localhost:5173,http://localhost,http://127.0.0.1:5173,http://127.0.0.1,http://localhost:8443` + **`https://apps.yellowsys.org`** pour les apps déployées |
| `NODE_ENV` | `production` → `resolvePublicUrl('prod')` exige la base PROD |

---

## 6. Schéma de données

### Control plane (`app_data` sur db-control)

| Table | Colonnes clés | Notes |
|---|---|---|
| `apps` | `id UUID PK`, `workspace_id TEXT UNIQUE` (id de session Mongo), **`owner_user_id TEXT`**, `name`, `status` | Registre des apps |
| `databases` | `app_id`, `environment` (dev/prod), `database_name`, `connection_string` | Routage multi-DB — une DB par app+env |
| `end_users` | `id UUID`, `app_id`, `email`, `password_hash`, `display_name`, `status` | Comptes end-user des apps |
| `end_user_grants` | `app_id`, `user_id UUID FK→end_users`, `resource ('*' ou table)`, `action (read/write)`, `effect` | Autorisations des end-users (deny-until-granted) |
| `audit_events` | `app_id`, `event_type`, `user_id UUID` (non-UUID → NULL), `metadata` | Journal immuable |

### Tenants

Une **database PostgreSQL par app et environnement** :
`app_<appDataId>_dev` / `app_<appDataId>_prod` (sur les instances
`db-tenant-dev` / `db-tenant-prod`). Chaque table utilisateur reçoit
automatiquement `id UUID PK`, `owner_id TEXT`, `created_at`, `updated_at` +
**RLS** (`owner_id = current_setting('app.user_id')`, bypass par le propriétaire
de la table — le pool).

---

## 7. Starter React/Vite (Ceph)

Source de vérité des fichiers app-data : [`templates/sources/`](templates/sources/).
Starter courant : **`starter_react_vite_v4`**
(`appbuilder/manifests/_system/starter_react_vite_v4.json` en Ceph, hashés
embeddés dans `constants/starter-react-vite-v4.ts`).

Fichiers consommés par les apps générées :

| Fichier | Contrat |
|---|---|
| `src/lib/yellowmind-data.ts` | Client data — `Authorization: Bearer` (session end-user ou ticket preview) ; proxy postMessage si `VITE_YM_APP_DATA_PROXY=true` ; **mutations attendent `{ row }`**, liste `{ rows }` |
| `src/lib/yellowmind-auth.tsx` | Register/login (→ `{ token, user }`), `me` (→ `{ user }`), root auth = `VITE_YM_APP_DATA_URL` sans suffixe `/(dev|prod|auth)$/` + `/auth` |
| `src/components/auth/ProtectedRoute.tsx` | Bypass login en dev preview |
| `preview-wrapper.html` (front `public/`) | Onglet séparé — relay postMessage (accepte `/app-data/public/` **et** `/v1/apps/`) |

Le starter est **URL-agnifique** : il construit tout à partir de
`VITE_YM_APP_DATA_URL` — aucune URL codée en dur.

### Synchroniser un starter vers Ceph

```bash
cd YellowStorm/back
npx ts-node scripts/materialize-starter-v3.ts          # v3 (historique)
npx ts-node scripts/publish-starter-to-ceph.ts --dir ../starters/starter-react-vite-v4 \
  --revision starter_react_vite_v4                      # upload blobs + manifest + constantes
node scripts/download-starter-from-ceph.js starter_react_vite_v4 [outDir]  # inspection
```

Après publication : mettre à jour `constants/starter-revisions.ts` (ou
`APP_BUILDER_STARTER_*`) — les sessions existantes gardent leur révision
(jamais de migration automatique du starter).

---

## 8. Scripts utilitaires (`YellowStorm/back/scripts/` et `app-data/scripts/`)

| Script | Rôle |
|---|---|
| `publish-starter-to-ceph.ts` | Publie un starter dir → Ceph (blobs sha256 + manifest) + génère les constantes |
| `download-starter-from-ceph.js` | Télécharge manifest + blobs d'une révision (inspection/materialisation) |
| `materialize-starter-v3.ts` | Reconstruit le starter v3 depuis v1 + templates |
| `export-dev-db-to-md.js` (**microservice**) | Exporte toutes les DB tenant DEV (tables + rows) en Markdown — lancer **dans le conteneur** (`docker exec -e NODE_PATH=/app/node_modules …`) |
| `reassign-anonymous-rows.js` (**microservice**) | Réattribue `owner_id='anonymous'` → owner (apps avec `owner_user_id` renseigné) |
| `migrate-workspace-id-to-text.js` (**microservice**) | Migration one-shot `apps.workspace_id` UUID→TEXT (historique) |

---

## 9. Dépannage (problèmes réels rencontrés)

| Symptôme | Cause | Fix |
|---|---|---|
| Health backend sans `"remote": true` | `APP_DATA_USE_REMOTE` lu **avant** le chargement du `.env` | `import 'dotenv/config'` en tête de `main.ts` ; redémarrer |
| `workspaceId must be a valid UUID` au provision | Colonne `apps.workspace_id UUID` vs id de session Mongo (hex) | Colonne → **TEXT** (migration appliquée) ; script `migrate-workspace-id-to-text.js` |
| `relation "tasks" does not exist` + `column "id" specified more than once` | Manifeste agent re-déclarant des colonnes réservées → ROLLBACK du DDL | Filtrage des colonnes réservées dans `createOrUpdateTable` ; re-jouer `schema_apply` |
| `Failed to fetch` depuis le preview | `ALLOWED_ORIGINS` du microservice sans l'origine du parent (`localhost:5173`) ou du preview (`localhost`) | Ajouter les origines ; preflight OPTIONS doit répondre 204 + `Access-Control-Allow-Origin` |
| `App Data proxy timeout (30 s)` | Relay parent absent (onglet rechargé) ou URL droppée silencieusement | Hard-reload de l'onglet YellowStorm ; le relay répond maintenant une erreur immédiate ; filtre accepte `/v1/apps/` |
| Écran blanc après ajout de données | Data-plane retournait la row brute au lieu de `{ row }` | Contrat `{ row }` restauré sur POST/PATCH/DELETE |
| `Database not found … env prod` (Data tab) | Data tab interrogée avant tout provision PROD | Transitoire — provisionner (le deploy crée PROD) ; durcissement possible : 404 → liste vide |
| 401 partout dans le preview | **Fail-closed** : pas de data ticket (app non provisionnée, backend local, ou endpoint ticket absent) | Provisionner via l'agent ; vérifier `remote: true` ; ouvrir le preview pour rafraîchir le ticket |
| Preview en login screen | `VITE_YM_APP_DATA_ENV` absent → env Vite périmé | Restart du dev server (`yellowruntime_dev_server restart`) — désormais déterministe (kill de l'ancien process) |
| Auth échouée depuis le host sur 5433/5434 | Postgres **locaux** squatte les ports (concurrence IPv4/IPv6 avec Docker) | Exécuter les scripts DB **dans le conteneur** ; ou cibler l'IP exacte de Docker |

---

## 10. Décisions d'architecture clés

1. **Cutoff des endpoints publics backend** — les apps générées ne passent
   jamais par YellowStorm ; supprime la surface d'attaque et la double
   implémentation. (Les contrôleurs proxy remote ont été supprimés avec.)
2. **URL directe microservice** (preview = `localhost:8443`, deploy = base
   PROD HTTPS publique) vs passerelle — choix utilisateur ; impose CORS
   microservice + origins explicites + reverse proxy HTTPS en prod.
3. **Fail-closed preview** — pas d'anonyme : data ticket owner obligatoire.
   `owner_id` = ObjectId hex YellowStorm réel du créateur.
4. **Grants end-user (deny-until-granted)** au lieu des policies par principal
   — le modèle local (policies `anonymous/yellowmind_owner`) n'est pas porté ;
   `policy_apply`/`policy_get`/`schema_plan` sont des erreurs explicites en
   remote.
5. **Invites non supportées en remote** (503 documenté) — share-deploy invités
   à repenser quand le besoin revient.
6. **dotenv avant le graphe d'imports** (`main.ts`) — tout flag lu au
   chargement statique d'un module est fiable.
7. **Restart dev server déterministe** — l'ancien process Vite est tué avant
   chaque respawn (sinon l'env périmé gagne la course de port).

---

## 11. Invariants (rappel)

- Chaque workspace persistant reçoit un `appDataId` opaque généré par le
  microservice ; `owner_user_id` = créateur YellowStorm.
- Aucune credential DB/JWT/MCP dans les apps générées — uniquement
  `VITE_YM_APP_DATA_*` (URL publique, id, env) + end-user JWT de session.
- Destructive : confirmation explicite en DEV ; jamais auto en PROD.
- Error codes : voir `constants/app-data.errors.ts`
  (`APP_DATA_POLICY_DENIED`, `APP_DATA_GRANT_DENIED`, `AUTH_*`,
  `DEPLOY_CONFIG_MISSING`, `REMOTE_UNAVAILABLE`, …).
