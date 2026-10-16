# mail_model graph-search evaluation set

`mail_model_graph_queries.jsonl`: 20 queries (6 simple, 7 medium, 7 complex/cross-mail) for the
mcp-semantic-model graph tools. Model: `mail_model` (`61ce5cd7-...`, published version `2d66224e-...`).

Schema (from `semantic_model.node_types` / `relation_types`):
- Concepts: Message e-mail (objet, date_envoi, date_reception, nom_expediteur, adresse_expediteur,
  domaine_expediteur, fil, nombre_pieces_jointes, corps...), Participation (role, adresse, nom_affiche),
  Correspondant (adresse, nom_affiche, domaine), Fait (date_fait, type_fait, statut, description,
  citation, impliques...), Pièce jointe (nom_fichier, type_fichier, taille, statut_lecture...).
- Relations: a pour participant / participe à (Message->Participation), désigne / a participé via
  (Participation->Correspondant), énonce / est énoncé dans (Message->Fait), contient / est jointe à
  (Message->Pièce jointe), documente / est documenté par (Pièce jointe->Fait). No hierarchy relation.

Data (latest published revision dr_a650eb1b..., read-only SELECTs, e-mail addresses not read):
- 25,000 mails received 2026-01-05..2026-06-30 (4793/4857/4485/3888/3720/3257 per month), 9 sender domains,
  300 dossiers "AV-2026-NNNN" of about 83 mails each ("Etape 01 - Position et preuves", then "Re: ..." replies), 14 themes.
- Only the 300 opening mails carry graph links (participants, facts, one PDF). Replies have none.
- 50 correspondents, 150 participations (no role value stored), 471 facts (statut: signalé 296, réalisé 96, prévu 38,
  contesté 37; 4 without), 1,000 PDF attachments of about 51 KB.
- The relation "documente" (Pièce jointe -> Fait) exists in the model but has no links in this revision.
- Several facts have an empty description: their text is in the record label.

Expected answers marked "measured on the first run" are frozen after the first execution.
