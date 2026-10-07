# Pyodide MCP — Architecture & Implémentation du MVP

**Objectif :** exécuter du Python **dans le navigateur de l'utilisateur** (Pyodide/WebAssembly)
et l'exposer comme un **outil MCP** utilisable depuis les **Conversations classiques** et les
agents de tâches des **Playbooks**.

---

## 1. Résumé

- Le Python s'exécute **côté client** dans un **Web Worker dédié** (pas de serveur Python à opérer).
- Un service MCP dédié (`mcp-pyodide`) sert de **façade** : il ne calcule rien, il relaie.
- Un seul connecteur MCP (`Pyodide` / `execute_python`) est partagé par Conversation **et** Playbook → **parité garantie**.
- L'identité de l'acteur est **injectée par la plateforme** (jamais par le modèle).
- Résultat validé en local : `25*4` en Conversation et Playbook ; lecture d'un fichier du workspace → conversion → sauvegarde.

---

## 2. Périmètre

### Le MVP fait
- Exécute du Python dans le navigateur (Pyodide, Web Worker).
- Expose `mcp/mcp-pyodide` (outil unique `execute_python`).
- Réutilise le chemin **Connector → MCP** (Conversation + Playbook).
- Gère `stdlib` + packages Pyodide, `stdout`/`stderr`, résultats JSON, timeouts, tailles bornées.
- Lit/écrit des fichiers du **workspace** (autorisation + limites).
- Renvoie une erreur explicite si aucun navigateur n'est connecté.

### Le MVP ne fait pas (volontairement)
- Pas d'exécution côté serveur (ni Judge0, ni `app-runtime`, ni `yellowstorm-code-runtime`/QuickJS).
- Pas de dépendance à `conversation-v2`.
- Pas de packages PyPI arbitraires (uniquement ceux fournis par Pyodide).
- Pas de montage avancé de fichiers/artefacts (reporté au MVP 1.1).
- Pas de bascule silencieuse vers un serveur.

---

## 3. Architecture

```
┌───────────────────────┐   Socket.IO /pyodide-runtime   ┌──────────────────────┐   HTTP interne   ┌──────────────┐
│  NAVIGATEUR YellowMind │◀─────────────────────────────▶│  BACKEND (NestJS)    │◀────────────────▶│ mcp-pyodide  │
│  PyodideRuntimeBridge  │                               │  Gateway + Registry  │                  │ (façade MCP) │
│   └─ Web Worker         │                               │  Dispatcher          │                  └──────▲───────┘
│       (Pyodide 314.x)   │                               │  Internal Controller │                         │ MCP
└───────────────────────┘                               └──────────▲───────────┘                         │
                                                                    │ gRPC                    ┌──────────┴─────────┐
                                                            ┌───────┴────────┐                │ Conversation /      │
                                                            │  ADK (agents)  │                │ Playbook            │
                                                            └────────────────┘                └────────────────────┘
```

- **Navigateur** : exécute réellement Python (Web Worker isolé du thread React).
- **Backend** : connaît les navigateurs connectés, route et autorise.
- **mcp-pyodide** : guichet MCP ; ne calcule pas.
- **ADK** : moteur des agents ; décide d'appeler l'outil.

---

## 4. Composants (fichiers clés)

### 4.1 MCP — `mcp/mcp-pyodide/`
| Fichier | Rôle |
|---|---|
| `server.py` | FastMCP, outil `execute_python`, `/health/live`, `/health/ready` |
| `auth.py` | Middleware Bearer + extraction de l'identité de confiance |
| `contracts.py` | Contrat de résultat + `artifacts` |
| `clients/yellowstorm_pyodide_client.py` | POST vers le backend (headers internes + identité) |
| `config.py` | Réglages/limites |

### 4.2 Backend — `YellowStorm/back/src/modules/pyodide-runtime/`
| Fichier | Rôle |
|---|---|
| `pyodide-runtime.gateway.ts` | Namespace `/pyodide-runtime`, handshake JWT (`userId` = `sub`) |
| `pyodide-runtime.registry.ts` | 1 runtime par utilisateur ; éviction du précédent |
| `pyodide-runtime.dispatcher.ts` | 1 exécution active + file ≤ 3 ; timeout ; cache de résultats |
| `pyodide-runtime-internal.controller.ts` | `POST /internal/pyodide-runtime/execute` |
| `pyodide-file.resolver.ts` | Autorisation workspace + lecture bornée + persistance des sorties |
| `dto/execute-pyodide.dto.ts` | Validation de l'entrée |
| `guards/pyodide-actor.guard.ts` | Identité d'acteur obligatoire (`X-YellowStorm-User-Id`) |

### 4.3 Frontend — `YellowStorm/front/src/modules/pyodide-runtime/`
| Fichier | Rôle |
|---|---|
| `PyodideRuntimeBridge.tsx` | Monté globalement dans `App.tsx` (indépendant de Conversation) |
| `PyodideRuntimeClient.ts` | Client Socket.IO (token résolu à chaque reconnexion) |
| `PyodideWorkerController.ts` | Worker paresseux ; timeout = `terminate()` ; arrêt si inactif |
| `pyodide.worker.ts` | Pyodide, globals neufs, packages depuis imports, capture logs, fichiers |
| `protocol.ts` | Types de messages/contrat |

---

## 5. Flux de bout en bout

### Conversation
```
Utilisateur → Conversation → agent (connecteur Pyodide) → ADK
  → mcp-pyodide → backend → Socket.IO execution.request → Worker Pyodide
  → execution.completed → backend → MCP → agent
```

### Playbook
```
Nœud → agent de tâche → flow_engine (StructuredTool connecteur) → mcp-pyodide
  → backend → même navigateur → Worker Pyodide → résultat → nœud terminé
```

**Règle MVP :** une tâche Pyodide n'est valide que si le **navigateur du propriétaire est connecté** ;
sinon `PYODIDE_RUNTIME_OFFLINE` (pas de retry infini, pas de serveur de secours).

---

## 6. Sécurité

| Notion | Rôle | En-tête / variable |
|---|---|---|
| **Bearer** | Autorise l'entrée dans le MCP | `Authorization: Bearer <PYODIDE_MCP_INGRESS_TOKEN>` |
| **Token interne** | Autorise le MCP auprès du backend | `X-Internal-Token: <YELLOWSTORM_INTERNAL_SERVICE_TOKEN>` |
| **Identité d'acteur** | Dit **au nom de qui** (routage) | `X-YellowStorm-User-Id` (+ Agent/Conversation/Correlation) |

- **Confiance par URL** : l'identité n'est injectée que si l'URL MCP du connecteur ∈
  `trusted-mcp-server.util.ts` (`PYODIDE_MCP_SERVER_URL`), pas selon le slug.
- Le modèle ne contrôle **jamais** ces valeurs.
- Le JWT et les secrets ne transitent **pas** vers le Worker / le code Python.

---

## 7. Contrats

### 7.1 Outil MCP
```python
execute_python(
    code: str,
    input: Any = None,
    timeout_seconds: int = 30,
    inputs: list[str] = [],   # noms exacts de fichiers du workspace → /workspace/input/<name>
    outputs: list[str] = [],  # optionnel : restreint les fichiers capturés depuis /workspace/output
) -> PyodideExecutionResultV1
```

### 7.2 Résultat
```ts
interface PyodideExecutionResultV1 {
  ok: boolean;
  result?: unknown;
  stdout: string;
  stderr: string;
  logsTruncated?: boolean;
  artifacts?: { name: string; sizeBytes: number; contentType?: string; documentId?: string; artifactUrl?: string }[];
  execution: {
    runtime: "pyodide";
    pythonVersion?: string;
    pyodideVersion?: string;
    durationMs: number;
    coldStart: boolean;
    loadedPackages: string[];
  };
  error?: { code: string; message: string };
}
```

### 7.3 Événements Socket (`/pyodide-runtime`)
- Navigateur → backend : `runtime.register`, `runtime.heartbeat`, `execution.progress`, `execution.completed`, `execution.failed`
- Backend → navigateur : `execution.request`, `execution.cancel`, `runtime.replaced`

### 7.4 Endpoint interne
```
POST /api/v1/internal/pyodide-runtime/execute
Headers : X-Internal-Token, X-YellowStorm-User-Id (obligatoire),
          X-YellowStorm-Workspace-Id (optionnel), X-YellowStorm-Input-Files (optionnel)
```

---

## 8. Fichiers du workspace (§27)

```
MCP → autorisation YellowStorm → le navigateur reçoit des données autorisées/limitées → Pyodide FS
```
- **Entrées** : références **logiques** (noms) ; résolues + autorisées côté backend (propriétaire/public/share).
- **Défaut Playbook** : les noms des fichiers d'entrée du nœud sont injectés dans le binding du connecteur
  de confiance (`X-YellowStorm-Input-Files`) par le backend, transmis par le MCP. Le `inputs` du modèle reste prioritaire.
- **Sorties** : tout fichier écrit dans `/workspace/output` est capturé puis persisté comme document du workspace
  (MIME déduit de l'extension ; écrasement si même nom).
- **Sécurité** : aucun chemin Ceph/URL fourni par le LLM ; tailles bornées ; transfert géré par l'hôte.

---

## 9. Limites & erreurs

| Limite | Valeur |
|---|---|
| Code | 64 Kio |
| Entrée (`input`) / fichiers | 2 Mio |
| Logs (`stdout`+`stderr`) | 256 Kio |
| Résultat / sorties | 512 Kio |
| Timeout | 30 s par défaut, 90 s max |
| Concurrence | 1 active + 3 en file |
| Runtime | 1 par utilisateur |

Codes d'erreur : `PYODIDE_RUNTIME_OFFLINE`, `PYODIDE_RUNTIME_BUSY`, `PYODIDE_BOOT_FAILED`,
`PYODIDE_REQUEST_TOO_LARGE`, `PYODIDE_UNSUPPORTED_PACKAGE`, `PYODIDE_EXECUTION_TIMEOUT`,
`PYODIDE_EXECUTION_ERROR`, `PYODIDE_RESULT_TOO_LARGE`, `PYODIDE_CONNECTION_LOST`.

---

## 10. Packages & conversions (Pyodide 314.0.7)

- **Disponibles** : pandas, numpy, scipy, scikit-learn, matplotlib, xlrd (`.xls`), lxml, beautifulsoup4,
  Pillow, pyyaml, sympy, pyarrow, imageio…
- **Absents** : openpyxl/xlsxwriter/xlwt (Excel write), pypdf/reportlab/fpdf2 (PDF), python-docx, markdown, opencv.

| ✅ Ça marche | ❌ Ça ne marche pas |
|---|---|
| txt → csv / json | → xlsx / xls / ods |
| csv → json / tsv / xml / html | xlsx → quoi que ce soit |
| json → csv / jsonl | → pdf / docx |
| xml / html → json | pdf → quoi que ce soit |
| `.xls` → csv / json (lecture) | vidéo / audio |
| images png ↔ jpg, graphiques (png) | installer un package PyPI |

> `.xlsx` impossible car `openpyxl`/`xlsxwriter` ne sont **pas** fournis → sortie `.csv` recommandée.
> Un vrai `.xlsx` = étape MVP 1.1 (liste blanche `micropip`).

---

## 11. Configuration

**Backend**
```
PYODIDE_RUNTIME_ENABLED=true
PYODIDE_MCP_SERVER_URL=http://localhost:8027/mcp
PYODIDE_RUNTIME_EXECUTION_TIMEOUT_MS=90000
PYODIDE_RUNTIME_HEARTBEAT_TIMEOUT_MS=30000
PYODIDE_RUNTIME_MAX_QUEUE=3
PYODIDE_RUNTIME_MAX_INPUT_FILE_BYTES=2097152
PYODIDE_RUNTIME_MAX_OUTPUT_FILE_BYTES=524288
```
**mcp-pyodide**
```
YELLOWSTORM_BACKEND_URL=http://localhost:3000
YELLOWSTORM_INTERNAL_SERVICE_TOKEN=<INTERNAL_SERVICE_SECRET du back>
PYODIDE_MCP_INGRESS_TOKEN=<jeton choisi>
PYODIDE_MCP_TIMEOUT_SECONDS=100
MCP_PORT=8027
```
**Frontend**
```
VITE_PYODIDE_RUNTIME_ENABLED=true
VITE_PYODIDE_INDEX_URL=https://cdn.jsdelivr.net/pyodide/v314.0.7/full/
```
Flags par défaut à `false` hors dev.

---

## 12. État & tests

**Validé en local**
- Conversation : `25*4` → `{ ok: true, result: 100 }` (Pyodide 314.0.7).
- Playbook : exécution via le même connecteur.
- Fichiers : `test.txt` lu → `test.csv` persisté comme document du workspace.

**Commandes**
```bash
# MCP
cd mcp/mcp-pyodide && python -m pytest tests -q
# Backend
cd YellowStorm/back && npm test -- pyodide-runtime && npm run build
# Frontend
cd YellowStorm/front && npx tsc --noEmit -p . && npm test -- pyodide-runtime
```

---

## 13. Suite (MVP 1.1+)

- Liste blanche `micropip` (ex. `openpyxl` → vrai `.xlsx`).
- Garde-fou « formats de sortie productibles » (éviter les faux fichiers).
- Artefacts avancés (Matplotlib/PNG), `/workspace/output` enrichi.
- Routage multi-réplicas (adaptateur Redis Socket.IO).
- Broker d'exécution générique (Pyodide / QuickJS / Python serveur).
