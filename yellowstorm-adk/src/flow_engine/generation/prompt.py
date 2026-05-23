"""Playbook generation prompt builders."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional


def load_prompt_registry(
    prompt_overrides: Optional[Dict[str, str]],
) -> Dict[str, Dict[str, Any]]:
    registry: Dict[str, Dict[str, Any]] = {}
    for key, value in (prompt_overrides or {}).items():
        if not key:
            continue
        if isinstance(value, dict):
            registry[key] = value
            continue
        if not value:
            continue
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                registry[key] = parsed
                continue
        except Exception:
            pass
        registry[key] = {"systemTemplate": str(value)}
    return registry


def resolve_prompt_template(
    prompt_registry: Optional[Dict[str, Dict[str, Any]]],
    key: str,
    *,
    field: str = "systemTemplate",
    fallback: str = "",
) -> str:
    entry = (prompt_registry or {}).get(key) or {}
    value = str(entry.get(field) or "").strip()
    return value or fallback


def build_generation_prompt(
    user_query: str,
    available_agents: List[Dict[str, Any]],
    workspace_context: Optional[List[Dict[str, Any]]] = None,
    existing_playbook: Optional[Dict[str, Any]] = None,
    prompt_overrides: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    """Build system and user prompts for playbook generation.

    Args:
        user_query: The user's natural language request.
        available_agents: List of agent configs with id, name, role, tools.
        workspace_context: Optional workspace document context.
        existing_playbook: Optional existing flow to modify.
        prompt_overrides: Optional prompt template overrides.

    Returns:
        Dict with 'system_prompt' and 'user_prompt' keys.
    """
    sys_lines = [
        "You are an expert playbook architect.",
        "Produce a valid, actionable workflow as a FlowSnapshot.",
        "Use only the provided agents. Do not invent agent names or tool names.",
    ]

    prompt_registry = load_prompt_registry(prompt_overrides)
    resolved_system = resolve_prompt_template(
        prompt_registry,
        "playbook.generation_new",
        field="systemTemplate",
        fallback="\n".join(sys_lines),
    )

    if existing_playbook:
        sys_lines.append("Modify the existing workflow to match the user's request.")

    agent_list = "\n".join(
        f"- {a.get('name', 'Unknown')} ({a.get('role', 'no role')}): {a.get('id', '')}"
        for a in available_agents[:20]
    )

    user_lines = [
        f"User request: {user_query}",
        "",
        "Available agents:",
        agent_list,
    ]

    if existing_playbook:
        user_lines.append(f"\nExisting workflow: {existing_playbook}")

    return {
        "system_prompt": resolved_system,
        "user_prompt": "\n".join(user_lines),
    }


def build_generate_playbook_prompt(
    agents_info: List[Dict[str, Any]],
    workspace_info: List[Dict[str, Any]],
    existing_playbook_json: str | None,
    prompt_overrides: Optional[Dict[str, str]] = None,
) -> str:
    """Build the system prompt for legacy playbook generation."""

    prompt_registry = load_prompt_registry(prompt_overrides)
    agents_block = json.dumps(agents_info, indent=2)
    workspace_block = json.dumps(workspace_info, indent=2)
    preprompt = resolve_prompt_template(
        prompt_registry,
        "playbook.generate",
        field="systemTemplate",
        fallback="Tu es un architecte de workflows. Ton role est de generer un playbook sous forme de DAG (Directed Acyclic Graph).",
    )

    prompt = f"""{preprompt}

## Format de sortie attendu (JSON strict)
{{
  "nodes": [
    {{
      "id": "step_1",
      "title": "Titre court de l'étape",
      "description": "Description détaillée de ce que l'agent doit faire",
      "assigned_agent_id": "agent_id_here",
      "execution_order": 1,
      "x": 0,
      "y": 0,
      "interrupt_before": false,
      "interrupt_after": false,
      "allow_clarification": false,
      "clarification_prompt": "",
      "max_clarifications": 0,
      "input_keys": [],
      "output_key": "step_1_output",
      "task_type": "generic",
      "inputPorts": [
        {{
          "id": "default",
          "name": "Input",
          "artifactKind": "text",
          "required": false,
          "description": ""
        }}
      ],
      "outputPorts": [
        {{
          "id": "default",
          "name": "Output",
          "artifactKind": "text",
          "description": ""
        }}
      ]
    }}
  ],
  "edges": [
    {{
      "source_id": "step_1",
      "target_id": "step_2"
    }}
  ]
}}

## Regles de layout (positions x, y) — TRES IMPORTANT
Les coordonnees x et y determinent la position visuelle de chaque node dans l'interface graphique.
Tu DOIS calculer x et y pour CHAQUE node selon la structure du DAG.

### Principe
- x = position horizontale (colonnes). Chaque colonne parallele est espacee de 300.
- y = position verticale (lignes). Chaque ligne successive est espacee de 200.
- Le premier node commence toujours a x=0, y=0.

### Cas 1 : Workflow sequentiel (A -> B -> C)
Tous les nodes sont sur la meme colonne (x=0), avec y qui augmente :
  A: x=0, y=0
  B: x=0, y=200
  C: x=0, y=400

### Cas 2 : Branches paralleles (A -> B, A -> C, puis B -> D, C -> D)
Le node source est seul, puis les branches paralleles se repartissent sur des colonnes :
  A: x=0,   y=0       (source unique)
  B: x=0,   y=200     (branche gauche)
  C: x=300, y=200     (branche droite, decalee en x)
  D: x=0,   y=400     (convergence, retour a x=0)

### Cas 3 : 3 branches paralleles (A -> B, A -> C, A -> D, puis B/C/D -> E)
  A: x=0,   y=0
  B: x=0,   y=200
  C: x=300, y=200
  D: x=600, y=200
  E: x=0,   y=400     (convergence)

### Regle de centrage
Pour N branches paralleles, les positions x sont : 0, 300, 600, 900, ...
Le node de convergence revient a x=0.

## Regles des ports (inputPorts / outputPorts) — OBLIGATOIRE
Chaque node DOIT avoir au minimum un inputPort et un outputPort.
Les ports sont les points de connexion visuels entre les nodes.

### Format des ports
- inputPorts : tableau avec au moins un port d'entree
  - id : identifiant unique du port (ex: "default", "in-pdf", "in-data")
  - name : nom court du port (ex: "Input", "PDF Input", "Data")
  - artifactKind : type parmi "text", "document", "code", "image", "data", "dashboard"
  - required : boolean (true si le port doit obligatoirement etre connecte)
  - description : description optionnelle

- outputPorts : tableau avec au minimum un port de sortie
  - id : identifiant unique du port (ex: "default", "out-report")
  - name : nom court du port (ex: "Output", "Report", "Analysis")
  - artifactKind : type parmi "text", "document", "code", "image", "data", "dashboard"
  - description : description optionnelle

### Regles
- Le premier node (sans predecesseur) DOIT avoir un inputPort avec "required": false
- Tous les nodes DOIVENT avoir au moins un outputPort
- Par defaut, chaque node a un seul inputPort {{ "id": "default", "name": "Input", "artifactKind": "text", "required": false }} et un seul outputPort {{ "id": "default", "name": "Output", "artifactKind": "text" }}
- Tu PEUX ajouter des ports supplementaires si l'etape traite des types de donnees distincts (ex: un node qui prend un PDF en entree et produit un rapport en sortie aurait inputPorts: [{{ "id": "in-pdf", "name": "PDF Input", "artifactKind": "document", "required": true }}])

## Regles d'assignation d'agents
- Chaque node DOIT avoir un assigned_agent_id correspondant a un agent disponible
- Choisis l'agent le plus pertinent en fonction de sa description et de ses tools
- Si un seul agent est disponible, assigne-le a tous les nodes

## Regles generales
- Les ids des nodes doivent etre uniques (ex: "step_1", "step_2", ...)
- Les edges doivent former un DAG valide (pas de cycles)
- output_key de chaque node = "<node_id>_output"
- input_keys d'un node = les output_keys des nodes dont il depend
- Le premier node n'a pas d'input_keys
- task_type de chaque node = "generic" par defaut

## Agents disponibles
{agents_block}

## Workspace context
{workspace_block}"""

    if existing_playbook_json:
        prompt += f"""

## Mode modification — IMPORTANT
Tu dois modifier le playbook existant ci-dessous en fonction de la demande de l'utilisateur.

### Regles de modification des coordonnees
- Les nodes existants qui ne sont PAS modifies gardent leurs coordonnees x, y actuelles.
- Si tu ajoutes un nouveau node entre deux nodes existants, tu dois recalculer les coordonnees y de tous les nodes en dessous pour faire de la place (+200 en y).
- Si tu supprimes un node, tu dois recalculer les coordonnees y des nodes en dessous pour combler le trou (-200 en y).
- Si tu ajoutes une branche parallele, decale les nouveaux nodes en x (+300 par branche).
- Retourne TOUJOURS le playbook complet (nodes modifies + non modifies) avec les coordonnees mises a jour.

### Regles de modification des ports
- Les nodes existants conservent leurs inputPorts et outputPorts tels quels.
- Les nouveaux nodes DOIVENT avoir au minimum un inputPort et un outputPort par defaut.
- Ne supprime JAMAIS les ports existants d'un node non modifie.

### Playbook existant
{existing_playbook_json}"""

    return prompt
