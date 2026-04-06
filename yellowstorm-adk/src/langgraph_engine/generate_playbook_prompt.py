from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from src.langgraph_engine.port_resolution import load_prompt_registry, resolve_prompt_template


def build_generate_playbook_prompt(
    agents_info: List[Dict[str, Any]],
    workspace_info: List[Dict[str, Any]],
    existing_playbook_json: str | None,
    prompt_overrides: Optional[Dict[str, str]] = None,
) -> str:
    """Build the system prompt for playbook generation."""

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
      "title": "Titre court de l'etape",
      "description": "Description detaillee de ce que l'agent doit faire",
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
      "output_key": "step_1_output"
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

### Playbook existant
{existing_playbook_json}"""

    return prompt
