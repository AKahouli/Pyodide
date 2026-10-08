# Hybrid Integration — App Builder (NodePod | Sandbox)

Plan d'intégration du mode d'exécution hybride par vagues. Chaque vague a un objectif unique et n'est terminée que lorsque ses critères sont atteints. Les vagues s'enchaînément dans l'ordre ; aucune ne commence avant la fin de la précédente.

## Règle directrice (non négociable)

> L'utilisateur peut choisir le mode d'exécution uniquement lorsque le mode Sandbox est actif. Dans ce cas, tout le streaming doit s'exécuter côté Sandbox, avec le flow Frontend → Backend YellowStorm → APImanus → Sandbox, et nous devons toujours remonter au Backend YellowStorm des events et des heartbeats fiables et cohérents afin de garantir un suivi précis de l'état de l'exécution et une expérience utilisateur fluide.

Conséquences de cette règle :

- Le switch `Execution: Browser (NodePod) | Sandbox` n'est proposable/actif que si le mode Sandbox est disponible et actif pour la session.
- En mode Sandbox, le streaming complet (tools, build, progression) s'exécute côté Sandbox — le browser n'est plus l'exécuteur.
- Chaîne imposée : `Frontend → Backend YellowStorm → gRPC → APImanus → Sandbox Manager → Sandbox`.
- Tous les events ET heartbeats du Sandbox remontent obligatoirement au Backend YellowStorm (source de vérité de l'état d'exécution), qui les relaie en SSE au Frontend.
- Le mode NodePod (browser) reste intact comme comportement par défaut.



## Références de code (ancrages)


| Cible                               | Chemin                                                                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Back module canonical               | `YellowStorm/back/src/modules/app-builder/` (routes `/app-builder/*`, alias legacy `/conversation-v2/*`)                                                   |
| Proto gRPC à synchroniser           | `YellowStorm/back/src/modules/app-builder/proto/conversation.proto` (service `yellostorm.manus.v1.ConversationV2`)                                         |
| gRPC client                         | `YellowStorm/back/src/modules/app-builder/services/app-builder.grpc-client.service.ts`                                                                     |
| Streaming / events                  | `services/app-builder-stream.service.ts`, `services/app-builder-stream-gateway.service.ts`, `utils/event-mapper.ts`                                        |
| Sessions (colonne `execution_mode`) | table `appBuilderSessions` (drizzle)                                                                                                                       |
| Tool dispatch (runtime)             | `YellowStorm/back/src/modules/app-runtime/` (broker, dispatcher, revision guard)                                                                           |
| Front hub                           | `YellowStorm/front/src/modules/app-builder/` (route `/app-builder`)                                                                                        |
| Front studio + runtime              | `YellowStorm/front/src/modules/app-builder-studio/` (route `/studio/:sessionId`, API `/app-builder/*`, SSE `GET /app-builder/stream`, runtime `runtime/*`) |
| APImanus (gRPC + sandbox)           | `APImanus/backend/app/interfaces/grpc/conversation.proto`, `.../external/sandbox/revision_sandbox_preview.py`                                              |
| Sandbox Manager                     | `SANDBOX/sandbox-manager/app/{routes.py,revision_routes.py,revision_service.py,sandbox_service.py}` (sandbox-v2)                                           |


---



## Vague 0 — Contrat & modèle (fondation)

**Objectif** : poser le contrat commun (proto, champ `execution_mode`, propagation) pour que les vagues suivantes aient une base stable. Sans cette vague, rien d'autre ne peut être testé.

- [x] Synchroniser `app-builder/proto/conversation.proto` avec le proto APImanus : ajouter `StartRevisionPreview`, `GetRevisionPreviewStatus`, `CaptureRevisionScreenshot`, `StopRevisionPreview` (+ messages `RevisionPreviewStatus`).
- [x] Ajouter les méthodes correspondantes dans `AppBuilderGrpcClientService` (deadlines, mapping d'erreurs gRPC).
- [x] Migration drizzle : colonne `execution_mode` (`'browser' | 'sandbox'`, défaut `'browser'`) sur `appBuilderSessions`.
- [x] Propager le mode : `POST /app-builder/sessions` (DTO) → `GET /app-builder/sessions/:id` → `POST /app-builder/sessions/:id/runtime-ticket` → `CreateSession`/`ChatRequest` gRPC (APImanus).
- [x] Côté front : champ `executionMode` sur `app-builder-studio/interfaces/session.ts` + `runtime-ticket` response, lu par le store studio.
- [x] Lire `BACKEND_GUIDELINES.md` §10/§23 et `FRONTEND_GUIDELINES.md` §6 (contrat cross-boundary) avant tout code.

**Terminée quand** : un appel `StartRevisionPreview` peut partir du back (test contractuel) et `execution_mode` est lisible/écrivable de bout en bout (front ↔ back).

---



## Vague 1 — Orchestration Sandbox & heartbeats côté Backend YellowStorm

**Objectif** : que le Backend YellowStorm devienne l'unique point de vérité de l'état d'exécution sandbox (events + heartbeats fiables et cohérents), même avant le rendu UI.

- [x] Orchestrateur dans `AppBuilderStreamService` : `StartRevisionPreview` → poll `GetRevisionPreviewStatus` → publication SSE d'un nouvel event `execution_status` (`queued {position} → creating → mounting {revisionId} → ready {previewUrl} → stale → error {code}`).
- [x] Heartbeat côté back : tick périodique lié au poll ; toute perte de contact sandbox → event `execution_status: error/stale` (jamais de gel silencieux de l'UX).
- [x] Mapper les positions de queue sandbox-manager en events exploitables (`execution_status.queue_position` : sandbox-manager `position` → proto `RevisionPreviewStatus.position` → back).
- [x] `StopRevisionPreview` à la teardown : delete session, switch de mode, inactivité, erreur fatale (`teardownSandboxPreview` branché sur stop/delete session ; idempotent best-effort).
- [x] Heartbeats runtime existants (`runtime.heartbeat` Socket.IO) restent réservés au mode browser ; contrat heartbeat sandbox équivalent défini (cadence = `sandboxPreviewPollIntervalMs`, timeout = `sandboxPreviewHeartbeatTimeoutMs`, observable = event `execution_status`) — config backend (pas de champ proto : heartbeat piloté serveur).
- [x] Tests : machine d'états sandbox (happy path, queue, crash, timeout, restart service) → autant d'événements SSE cohérents (sandbox-manager `tests/test_revision.py`, APImanus facade/servicer, back orchestrateur/heartbeat/teardown).

**Terminée quand** : un watcher SSE voit la vie complète d'un sandbox (création → prêt → mort) sans poll côté front, et un crash sandbox produit un event d'erreur dans les secondes qui suivent.

---



## Vague 2 — Switch UI & preview sandbox côté Frontend

**Objectif** : donner à l'utilisateur le choix `Execution: Browser (NodePod) | Sandbox`, uniquement lorsque le mode Sandbox est actif, avec un preview fluide.

- [x] Switch sur la page App Market **avant l'entrée en session** (`AppBuilderCreateWithAgent`, pattern `appViewMode`) : **affiché/actif seulement si le mode Sandbox est actif** (règle directrice) ; choix persisté côté client (`executionModePreference.ts`), envoyé à `POST /app-builder/sessions` en Vague 0 (le back rejette aujourd'hui tout champ non whitelisted).
- [ ] Rendu du preview : iframe sur `preview_url` (`/proxy/{sandbox_id}/preview`) en mode Sandbox ; inchangé (`/__virtual__/...`) en mode browser.
- [ ] Consommer `execution_status` (Vague 1) : spinner queued/creating/mounting, état ready, carte d'erreur avec action « repasser en Browser » (fallback).
- [ ] Capability gating : `preview_inspect` / `preview_action` déclarés non supportés en sandbox (`RuntimeCapabilities`) → refusal propre, pas de timeout outil agent.
- [ ] Vérifier/étendre le relay App Data / AI (`preview-wrapper.html`) pour l'origine proxy externe.
- [ ] Gate d'envoi : `waitForHostReady` mappé sur les statuts sandbox (pas de blocage du Send pendant le montage).
- [ ] i18n des nouveaux labels (FR/EN) + `frontend-qa`.

**Terminée quand** : un utilisateur avec le mode Sandbox actif bascule Browser↔Sandbox, voit le preview monter en sandbox avec statuts intermédiaires, et l'agent reste utilisable pendant le montage.

---



## Vague 3 — Streaming exécuté côté Sandbox (flow complet)

**Objectif** : implémenter la règle directrice à l'état pur — tout le streaming s'exécute côté Sandbox, events + heartbeats remontant au Backend YellowStorm.

- [ ] Brancher le tool dispatch serveur : `RuntimeBrokerService` → adapter sandbox (exécution via APImanus/Sandbox Manager) au lieu de `tool.invoke` Socket.IO browser, pour `executionMode = 'sandbox'`.
- [ ] Chaque résultat d'outil remonte au back : persistance tool calls, avancement `bindings.latest_revision_id` après persistance (invariant existant).
- [ ] Revisions côté sandbox : tout commit passe par `RuntimeRevisionService.commitWorkspaceRevision` avec `parentRevisionId` serveur (résout le lock optimiste client `WorkspaceRevisionStore`).
- [ ] Heartbeats sandbox → back à chaque étape de streaming ; perte heartbeat ⇒ marque la session `error` + propose fallback browser.
- [ ] Preview live : mount idempotent sur les commits (debounce), lever la gate finalize (`_require_finalize`) via flag `live` côté APImanus.
- [ ] Sync incrémentale des fichiers dans sandbox-manager (manifest diff → blobs Ceph), sans remount complet par commit.
- [ ] Invariants finalize inchangés : `finalized_revisions` + `release_bindings` après `finalize`.
- [ ] Tests bout-en-bout : génération complète d'une app en mode Sandbox sans navigateur exécuteur.

**Terminée quand** : une session en mode Sandbox génère, exécute et finalise une app entièrement côté sandbox, avec progression SSE continue (jamais de trou) et révisions Ceph identiques au mode browser.

---



## Vague 4 — Bascule de mode NodePod ↔ Sandbox sans casser le streaming

**Objectif** : permettre le changement de mode à chaud, sans perte de revision ni interruption visible du streaming.

- [ ] Protocole de switch : autorisé seulement au boundary d'étape (`done`/`wait`) ou run inactif ; confirmation sinon.
- [ ] Séquence : teardown host (`removeHost`) → maj `appBuilderSessions.execution_mode` → reset revision guard / re-register → boot de l'autre runtime sur la même revision Ceph.
- [ ] Côté sandbox→browser : `StopRevisionPreview` + cleanup, puis reprise NodePod sur la révision courante.
- [ ] Côté browser→sandbox : arrêt dev server browser, démarrage orchestrateur Vague 1 sur la révision courante.
- [ ] Le SSE chat ne doit jamais se couper pendant la bascule (events indépendants du runtime).
- [ ] Tests des deux sens + test « switch pendant streaming actif » (refus propre ou bascule au boundary).

**Terminée quand** : les deux directions fonctionnent sans `REVISION_CONFLICT`, sans père de révision, et sans re-génération.

---



## Vague 5 — Ressources, lifecycle & résilience

**Objectif** : rendre le mode Sandbox soutenable en production (capacité, quotas, auto-guérison).

- [ ] Quotas : 1 sandbox active par user + limite de sessions en queue ; fairness round-robin par user dans la queue (un user ne peut pas saturer la file).
- [ ] Capacité : rendre `MAX_RUNNING_MICROVMS` configurable ops, aligner les timeouts (queue APImanus 360 s vs manager 300 min), signal de saturation explicite dans les events.
- [ ] Lifecycle : create/ready/update/stop/destroy/crash/timeout couverts par la machine d'états Vague 1 ; destroy systématique à l'`stop_session`.
- [ ] Idle timeout (10 min) + lease revision (30 min) confirmés sous charge ; cleanup worker vérifié avec jobs actifs.
- [ ] Fallback automatique : queue timeout ou ready timeout → proposition de bascule vers browser sur la même révision.
- [ ] Mesurer le temps de création sandbox (k8s + SSH + restore Ceph) ; décider warm pool vs file d'attente affichée.

**Terminée quand** : la saturation produit un comportement prévisible (position, fallback) et aucun sandbox orphelin ne survit à un cycle idle/crash.

---



## Vague 6 — Hardening, sécurité & mise en production

**Objectif** : bloquer les risques identifiés dans l'audit avant exposition réelle.

- [ ] Sécurité sandbox-manager : token non codé en dur, auth sur les routes shell/file/supervisor/queue, tenancy dérivée du token (plus de `user_id` spoofable).
- [ ] Supprimer/démasquer les stubs (`/api/v1/file/download`, `/shell/{wait,write,kill}`, `/supervisor/*`).
- [ ] État durable sandbox-manager (fin des dicts mémoire + JSON perdus au restart ; jobs revision ne repartent plus en `error "service restarted"`).
- [ ] Contrat proto testé dans les deux repos (test de compat contractuelle pour éviter toute nouvelle dérive).
- [ ] Observabilité : métriques sandboxes actifs/queue/erreurs/latence mount, logs corrélés session/revision.
- [ ] Revue `reviewer` (Tier 3 : gRPC, auth, streaming, DB) + `frontend-qa` complet + `maintainer` (documentation durable).
- [ ] Recette finale : scénario complet Hybrid (création → streaming sandbox → preview → switch mode → deploy) validé.

**Terminée quand** : audit G1–G13 résolus ou explicitement acceptés, revue passée, et la recette finale passe sans intervention manuelle.

---



## Ordre et dépendances

```
Vague 0 (contrat) ──► Vague 1 (events/heartbeats back) ──► Vague 2 (UI switch + preview)
                                   │
                                   └────────────► Vague 3 (streaming sandbox complet)
                                                          │
                                              Vague 4 (switch de mode à chaud)
                                                          │
                                              Vague 5 (ressources/lifecycle)
                                                          │
                                              Vague 6 (hardening / prod)
```

Statut : chaque vague est cochée dans ce fichier uniquement après vérification de son critère « Terminée quand ».