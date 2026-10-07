# Pyodide MCP — Vue d'ensemble du MVP

**En une phrase :** on fait tourner du **Python dans le navigateur de l'utilisateur**
(via Pyodide), et on l'expose comme un **outil MCP** que les agents YellowMind utilisent
depuis les **Conversations classiques** et les **Playbooks**.

---

## Résumé pour décideurs (TL;DR)

- **Pas de serveur Python à opérer** : le code s'exécute **chez l'utilisateur**, dans un *Web Worker* isolé du reste de la page.
- **Un seul point d'intégration** : un connecteur MCP (`Pyodide`) réutilisé par Conversation **et** Playbook → **même outil, même résultat**.
- **Sécurité par conception** : l'identité de l'utilisateur est **injectée par la plateforme**, jamais contrôlée par le modèle.
- **Fonctionne en local (validé)** : `25*4` en Conversation et en Playbook ; lecture d'un fichier du workspace → conversion → sauvegarde comme document.
- **Limites assumées du MVP** : uniquement les bibliothèques fournies par Pyodide (donc **pas de `.xlsx`/PDF/DOCX**), tailles bornées, **navigateur connecté obligatoire**.

---

## 1. Objectif

Fournir, le plus vite possible, une capacité d'**exécution Python côté navigateur** pour les agents,
accessible via un **MCP dédié**, avec parité Conversation / Playbook.

---

## 2. Périmètre

### Ce que le MVP fait
- Exécute du Python dans le navigateur (Pyodide, Web Worker dédié).
- Expose un service `mcp-pyodide` (outil unique `execute_python`).
- Réutilise le chemin **Connector → MCP** pour Conversation **et** Playbook.
- Gère `stdout`/`stderr`, résultats JSON, timeouts, tailles bornées.
- Lit/écrit des fichiers du **workspace** (autorisation + plafonds).
- Renvoie une erreur explicite si aucun navigateur n'est connecté.

### Ce que le MVP ne fait pas (volontairement)
- Pas d'exécution côté serveur (pas de Judge0, pas de runtime serveur).
- Pas de dépendance à Conversation V2 ni à l'app-runtime.
- Pas de packages PyPI arbitraires (seulement ceux fournis par Pyodide).
- Pas de montage de fichiers/artefacts avancés (reporté au MVP 1.1).
- Pas de bascule silencieuse vers un serveur.

---

## 3. Architecture (simple)

```
┌──────────────────────┐    Socket.IO     ┌─────────────────────┐   HTTP interne   ┌──────────────┐
│   NAVIGATEUR         │◀────────────────▶│  BACKEND (NestJS)   │◀────────────────▶│ mcp-pyodide  │
│  (Web Worker Pyodide)│  /pyodide-runtime│  relais + registre  │                  │ (façade MCP) │
└──────────────────────┘                  └──────────▲──────────┘                  └──────▲───────┘
                                                     │ gRPC                               │ MCP
                                             ┌───────┴────────┐                ┌──────────┴─────────┐
                                             │  ADK (agents)  │                │ Conversation /      │
                                             │                │                │ Playbook            │
                                             └────────────────┘                └────────────────────┘
```

- **Navigateur** : exécute Python pour de vrai (`Pyodide` dans un *Web Worker*).
- **Backend** : sait quels navigateurs sont connectés, route et autorise.
- **mcp-pyodide** : un « guichet » MCP. Il **ne calcule pas** : il transmet.
- **ADK** : le moteur des agents ; il décide d'appeler l'outil.

---

## 4. Flux d'un appel

### Conversation
```
Utilisateur → agent → outil "pyodide_execute_python" → mcp-pyodide
   → backend → navigateur (Worker) → résultat → agent
```

### Playbook
```
Nœud → agent de tâche → outil connecteur → mcp-pyodide
   → backend → même navigateur → résultat → nœud terminé
```

**Règle clé :** une tâche Pyodide n'est valide que si le **navigateur de l'utilisateur est connecté**.
Sinon → `PYODIDE_RUNTIME_OFFLINE` (pas de retry infini, pas de serveur de secours).

---

## 5. Sécurité — les 3 notions à retenir

| Notion | Rôle | Analogie |
|---|---|---|
| **Bearer token** (`PYODIDE_MCP_INGRESS_TOKEN`) | Prouver qu'on a le droit d'utiliser le MCP | Un **badge** à présenter à l'entrée |
| **Token interne** (`YELLOWSTORM_INTERNAL_SERVICE_TOKEN`) | Prouver au backend que l'appel vient d'un service de confiance | Un **cachet** interne |
| **Identité** (`X-YellowStorm-User-Id`) | Dire **au nom de qui** on agit (router vers LE bon navigateur) | La **carte d'identité** |

> L'identité est **injectée automatiquement** par la plateforme pour les connecteurs **de confiance**
> (URL MCP connue). Le modèle ne peut jamais la fournir. Un MCP tiers ne reçoit rien.

---

## 6. Comment un agent « voit » l'outil

On crée un **connecteur** (fiche de configuration) :

```
Nom        : Pyodide
Transport  : Streamable HTTP
URL        : http://localhost:8027/mcp
Auth       : Bearer <PYODIDE_MCP_INGRESS_TOKEN>
Outil      : execute_python
```

Le backend le transforme en **binding** ; l'agent voit un outil **`pyodide_execute_python`**.
Le **même connecteur** sert à la Conversation et au Playbook → parité.

---

## 7. Fichiers du workspace (le « plus » du MVP)

```
Le modèle donne des NOMS de fichiers (jamais des chemins)
        ↓
MCP relaie au backend
        ↓
Le backend AUTORISE (le fichier appartient à l'utilisateur) et LIMITE (tailles)
        ↓
Le navigateur monte les fichiers dans /workspace/input
        ↓
Le code lit /workspace/input et écrit ses résultats dans /workspace/output
        ↓
Le backend enregistre ces fichiers comme documents du workspace
   et renvoie des RÉFÉRENCES (pas le contenu)
```

- **Entrées** : `inputs: ["data.csv"]` → `/workspace/input/data.csv`.
- **Sorties** : tout ce qui est écrit dans `/workspace/output` est **sauvegardé automatiquement**.
- **Playbook** : le fichier attaché à une tâche est monté **automatiquement** (la plateforme connaît le nom).
- **Sécurité** : aucun chemin de stockage accepté ; tailles bornées.

---

## 8. Limites & conversions (Pyodide 314.0.7)

| ✅ Ça marche | ❌ Ça ne marche pas |
|---|---|
| txt → csv / json | → xlsx / xls / ods |
| csv → json / tsv / xml / html | xlsx → quoi que ce soit |
| json → csv / jsonl | → pdf / docx |
| xml / html → json | pdf → quoi que ce soit |
| **.xls** → csv / json (lecture) | vidéo / audio |
| images png ↔ jpg, graphiques (png) | installer un package PyPI |

**Pourquoi `.xlsx` échoue :** Pyodide 314 n'embarque **pas** `openpyxl`/`xlsxwriter`.
→ le modèle doit écrire un **`.csv`** à la place. (Un vrai `.xlsx` = étape MVP 1.1 via liste blanche.)

**Limites techniques :** 1 runtime/utilisateur ; 1 exécution à la fois (+3 en attente) ;
timeout 30 s (max 90 s) → boucle infinie stoppée en tuant le Worker ;
tailles : code 64 Kio, entrée 2 Mio, logs 256 Kio, résultat 512 Kio.

---

## 9. État d'avancement (validé en local)

- Conversation : `25*4` → `{ ok: true, result: 100 }` ✅
- Playbook : exécution via le même connecteur ✅
- Fichiers : `test.txt` lu depuis le workspace → `test.csv` sauvegardé comme document ✅
- Tests : MCP (36), backend `pyodide-runtime` + `playbook-execution-node-agent-metadata` (23), frontend (`tsc`, 7). Builds back/front OK.

---

## 10. Lancer & tester (local)

Prérequis : backend + mcp-pyodide + frontend (+ ADK), et un **onglet YellowMind connecté**.

```bash
# Backend
cd YellowStorm/back && npm run start:dev
# MCP
cd mcp/mcp-pyodide && python server.py
# Frontend
cd YellowStorm/front && npm run dev
# ADK
cd yellowstorm-adk && python -m main
```

Test rapide : en Conversation, « Calcule 25*4 en Python » → l'agent appelle l'outil → `100`.

---

## 11. Configuration (extrait)

**Backend** : `PYODIDE_RUNTIME_ENABLED=true`, `PYODIDE_MCP_SERVER_URL=http://localhost:8027/mcp`

**mcp-pyodide** :
```
YELLOWSTORM_BACKEND_URL=http://localhost:3000
YELLOWSTORM_INTERNAL_SERVICE_TOKEN=<INTERNAL_SERVICE_SECRET du back>
PYODIDE_MCP_INGRESS_TOKEN=<jeton choisi>
MCP_PORT=8027
```

**Frontend** : `VITE_PYODIDE_RUNTIME_ENABLED=true`, `VITE_PYODIDE_INDEX_URL=https://cdn.jsdelivr.net/pyodide/v314.0.7/full/`

> ⚠️ Changer `INTERNAL_SERVICE_SECRET` côté back impose de mettre à jour le token dans
> `mcp-pyodide/.env` **et de redémarrer** le MCP.

---

## 12. Suite (MVP 1.1+)

- Liste blanche `micropip` (ex. `openpyxl` → vrai `.xlsx`).
- Garde-fou « formats de sortie supportés » (éviter les faux fichiers).
- Montage d'artefacts avancés (Matplotlib/PNG), `/workspace/output` enrichi.
- Routage multi-réplicas (adaptateur Redis Socket.IO).
- Broker d'exécution générique (Pyodide / QuickJS / Python serveur).

---

## Où est quoi (carte rapide)

| Rôle | Emplacement |
|---|---|
| Façade MCP | `mcp/mcp-pyodide/` |
| Relais navigateur (backend) | `YellowStorm/back/src/modules/pyodide-runtime/` |
| Confiance des URLs MCP | `.../connector/utils/trusted-mcp-server.util.ts` |
| Fichiers workspace (autorisation) | `pyodide-runtime/pyodide-file.resolver.ts` |
| Pont + Worker (frontend) | `YellowStorm/front/src/modules/pyodide-runtime/` |
| Montage global | `YellowStorm/front/src/App.tsx` |
