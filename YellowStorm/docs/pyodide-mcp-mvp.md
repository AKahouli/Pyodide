# Pyodide MCP — l'essentiel (MVP)

Ce document explique, **simplement**, comment on fait tourner du Python **dans le navigateur
de l'utilisateur** et comment les agents YellowMind peuvent l'utiliser.

---

## 1. L'idée en une phrase

> On ne fait **pas** tourner Python sur un serveur. On le fait tourner **dans le navigateur**
> de l'utilisateur (grâce à **Pyodide**), et on l'expose comme un **outil MCP** que les agents
> peuvent appeler.

Pourquoi ? Parce que le code s'exécute chez l'utilisateur : pas de serveur Python à maintenir,
et le navigateur fait le travail.

---

## 2. Les 4 acteurs

```
┌───────────────────┐   Socket.IO    ┌────────────────────┐   HTTP interne   ┌──────────────┐
│   NAVIGATEUR      │◀──────────────▶│  BACKEND (NestJS)   │◀────────────────▶│ mcp-pyodide  │
│  (Web Worker      │  /pyodide-     │  relais + registre  │                  │  (façade MCP)│
│   Pyodide)        │   runtime      │  des navigateurs    │                  └──────▲───────┘
└───────────────────┘                └──────────▲─────────┘                         │ MCP
                                                │ gRPC                              │
                                        ┌───────┴────────┐                 ┌─────────┴─────────┐
                                        │  ADK (agents)  │                 │  Agent / Playbook │
                                        │  Conversation  │                 └───────────────────┘
                                        │  & Playbook    │
                                        └────────────────┘
```

- **Navigateur** : exécute vraiment Python (dans un *Web Worker*).
- **Backend** : connaît les navigateurs connectés, fait le pont, autorise.
- **mcp-pyodide** : un « guichet » MCP. Il **ne calcule rien** : il transmet la demande.
- **ADK** : le moteur des agents. C'est lui qui décide d'appeler l'outil.

---

## 3. Le trajet d'un appel (exemple : `25 * 4`)

```
1. L'utilisateur parle à l'agent
2. L'agent (ADK) décide d'appeler l'outil "pyodide_execute_python"
3. L'appel MCP arrive à mcp-pyodide
4. mcp-pyodide appelle le BACKEND (HTTP interne)
5. Le BACKEND trouve le navigateur connecté de l'utilisateur
6. Il envoie "execution.request" au navigateur (Socket.IO)
7. Le Web Worker exécute le code dans Pyodide
8. Le résultat remonte le chemin inverse : navigateur → backend → mcp-pyodide → agent
```

Au final, l'agent reçoit un objet du type :
```json
{ "ok": true, "result": 100, "stdout": "", "stderr": "" }
```

---

## 4. Les 3 « clés » de sécurité (à comprendre)

Il y a **deux portes** à franchir et un **badge d'identité** :

| Nom | À quoi ça sert | Exemple |
|---|---|---|
| **Bearer** (`PYODIDE_MCP_INGRESS_TOKEN`) | Prouver qu'on a le droit d'utiliser le MCP | `Authorization: Bearer 684ecf…` |
| **Token interne** (`YELLOWSTORM_INTERNAL_SERVICE_TOKEN`) | Prouver au backend que l'appel vient d'un service de confiance | `X-Internal-Token: 24695d…` |
| **Identité** (`X-YellowStorm-User-Id`) | Dire **au nom de qui** on agit (pour router vers LE bon navigateur) | `X-YellowStorm-User-Id: 6a88…` |

> **« Bearer »** = « porteur ». C'est comme un badge : on le présente pour entrer.
> Ce badge n'est **jamais** contrôlé par le modèle.

Le backend **injecte automatiquement** ces identités — mais **uniquement** pour les connecteurs
dont l'URL MCP est dans la liste de confiance (`PYODIDE_MCP_SERVER_URL`). Un MCP tiers ne reçoit rien.

---

## 5. Comment un agent « voit » l'outil

On crée un **connecteur** dans l'admin (une fiche de configuration) :

```
Nom        : Pyodide
Transport  : Streamable HTTP
URL        : http://localhost:8027/mcp
Auth       : Bearer <PYODIDE_MCP_INGRESS_TOKEN>
Outil      : execute_python
```

Le backend transforme cette fiche en **« binding »** et le donne à l'agent.
L'agent voit alors un outil nommé **`pyodide_execute_python`** (slug du connecteur + action).

> Conversation et Playbook utilisent **le même connecteur** : parité assurée.

---

## 6. Lire/écrire des fichiers du workspace (le « plus »)

Le code Python peut lire un fichier du workspace et sauvegarder un résultat.

```
Le modèle fournit des NOMS de fichiers (jamais des chemins)
        │
        ▼
MCP relaie la demande au backend
        │
        ▼
Le backend AUTORISE (le fichier appartient bien à l'utilisateur) et LIMITE (tailles)
        │
        ▼
Le navigateur reçoit les données et les monte dans /workspace/input
        │
        ▼
Exécution... le code écrit ses résultats dans /workspace/output
        │
        ▼
Le backend persiste ces fichiers dans le workspace (comme de vrais documents)
        et renvoie des RÉFÉRENCES (pas le contenu)
```

Règles simples :
- **Entrées** : le modèle liste les noms (`inputs: ["data.csv"]`) → montés dans `/workspace/input/data.csv`.
- **Sorties** : tout ce qui est écrit dans `/workspace/output` est **automatiquement** sauvegardé
  dans le workspace.
- **Sécurité** : aucun chemin de stockage n'est accepté ; les tailles sont bornées.

**Cas particulier du Playbook** : le fichier attaché à une tâche est connu de la plateforme.
Le backend ajoute son nom dans un en-tête de confiance, donc il est monté **automatiquement**
sans que le modèle ait à le demander.

---

## 7. Limites du MVP (à connaître)

- **Un seul runtime par utilisateur** (le 2ᵉ onglet remplace le 1ᵉʳ).
- **1 exécution à la fois**, 3 en attente → sinon `PYODIDE_RUNTIME_BUSY`.
- **Timeouts** : 30 s par défaut, 90 s max. Une boucle infinie est arrêtée en **tuant le Worker**.
- **Tailles** : code 64 Kio, entrée 2 Mio, logs 256 Kio, résultat 512 Kio.
- **Packages** : uniquement ceux **fournis par Pyodide** (pas d'installation PyPI arbitraire).
- **Navigateur obligatoire** : sans navigateur connecté → `PYODIDE_RUNTIME_OFFLINE`.

---

## 8. Conversions : ce qui marche (Pyodide 314.0.7)

| ✅ Ça marche | ❌ Ça ne marche pas |
|---|---|
| txt → csv / json | → xlsx / xls / ods |
| csv → json / tsv / xml / html | xlsx → quoi que ce soit |
| json → csv / jsonl | → pdf / docx |
| xml / html → json | pdf → quoi que ce soit |
| **.xls** → csv / json (lecture) | vidéo / audio |
| images png ↔ jpg, redimensionnement | installer un package |
| graphiques (matplotlib) → png | |

> Pourquoi `.xlsx` échoue : Pyodide 314 n'embarque **pas** `openpyxl`/`xlsxwriter`.
> Pour produire un « Excel », le modèle doit écrire un **`.csv`** à la place.

---

## 9. Lancer et tester en local

Prérequis : 4 process + un onglet navigateur connecté.

1. **Backend** : `npm run start:dev` (dossier `YellowStorm/back`)
2. **mcp-pyodide** : `python server.py` (dossier `mcp/mcp-pyodide`)
3. **Frontend** : `npm run dev` (dossier `YellowStorm/front`)
4. **ADK** : `python -m main` (dossier `yellowstorm-adk`)
5. Ouvrir `http://localhost:5173`, se connecter, garder l'onglet ouvert.

Tests rapides (`code` = `25*4`) :
- **Conversation** : demander « Calcule 25*4 en Python ».
- **MCP Inspector** : URL `http://localhost:8027/mcp`, Auth **Bearer**, + header
  `X-YellowStorm-User-Id`.

Commandes de vérification :
```bash
# MCP
cd mcp/mcp-pyodide && python -m pytest tests -q
# Backend
cd YellowStorm/back && npm test -- pyodide-runtime && npm run build
# Frontend
cd YellowStorm/front && npx tsc --noEmit -p . && npm test -- pyodide-runtime
```

---

## 10. Variables d'environnement (résumé)

**Backend**
```
PYODIDE_RUNTIME_ENABLED=true
PYODIDE_MCP_SERVER_URL=http://localhost:8027/mcp
```

**mcp-pyodide**
```
YELLOWSTORM_BACKEND_URL=http://localhost:3000
YELLOWSTORM_INTERNAL_SERVICE_TOKEN=<INTERNAL_SERVICE_SECRET du back>
PYODIDE_MCP_INGRESS_TOKEN=<jeton choisi>
MCP_PORT=8027
```

**Frontend**
```
VITE_PYODIDE_RUNTIME_ENABLED=true
VITE_PYODIDE_INDEX_URL=https://cdn.jsdelivr.net/pyodide/v314.0.7/full/
```

> ⚠️ Si tu changes `INTERNAL_SERVICE_SECRET` dans le backend, mets à jour
> `YELLOWSTORM_INTERNAL_SERVICE_TOKEN` dans `mcp-pyodide/.env` **et redémarre** le MCP.

---

## 11. Où est quoi (carte rapide)

| Rôle | Dossier / fichier |
|---|---|
| Façade MCP | `mcp/mcp-pyodide/` |
| Relais navigateur (backend) | `YellowStorm/back/src/modules/pyodide-runtime/` |
| Confiance des URLs MCP | `YellowStorm/back/src/modules/connector/utils/trusted-mcp-server.util.ts` |
| Fichiers workspace (autorisation) | `pyodide-runtime/pyodide-file.resolver.ts` |
| Pont + Worker (frontend) | `YellowStorm/front/src/modules/pyodide-runtime/` |
| Montage global | `YellowStorm/front/src/App.tsx` |

---

## 12. En un schéma mental

```
Agent ──(MCP)──► mcp-pyodide ──(HTTP)──► Backend ──(Socket)──► Navigateur (Pyodide)
   ▲                                         │                        │
   └──────────────── résultat ◄──────────────┴────────────────────────┘
```
