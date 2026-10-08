---
slug: yellowstorm-semantic-model
name: YellowStorm Semantic Model
description: Design YellowStorm semantic models and answer questions from their records (find, follow links, walk several links, connect two records, filter, count, summarise) through the Semantic Model MCP connector.
license: internal
compatibility: YellowStorm agents with the semantic-model-mcp connector enabled
metadata:
  connector: semantic-model-mcp
---
# YellowStorm Semantic Model

A semantic model holds business **concepts** (Message e-mail, Fait, Pièce jointe, Customer, Contract...) with
**fields**, **key fields** that identify one record, and **relationships** between concepts ("énonce",
"contient", "a pour participant"). Sources (spreadsheets, documents, workspaces) feed the concepts; a data
update reads them into **records** linked by those relationships (stored in tables and in a graph); publishing
makes the data usable in chat.

Use these tools when the user wants to design a model, or asks a question that a model's records answer.

## Core rules

- Answer only from what the tools return. Never invent a concept, field, relationship, record or value.
- Name models, concepts, fields, workspaces and files; never show ids. `model_id` also accepts the model's
  exact name. In a chat opened on a model, the model and its published data are already set: do not ask for it.
- Records are what the model stores, not documents. Quote a record's field (or a passage) as evidence.
- Use only the tools the agent has; its connector selection may expose part of them.
- Never claim a change, data update or publish happened unless the tool returned `ok: true` saying so.

## Answering from a model's data

### Pick the tool by the question

| The user asks... | Tool |
| --- | --- |
| What does the model hold? Which concepts, fields, relationships? | `describe_model` |
| Which record is this? (a name, a key, a vague description, words deep in an e-mail body) | `find_records` |
| What is this record linked to? Which links exist? | `get_related_records` |
| All X where..., how many, totals, averages, per month / per value, sorted, compared | `query_records` |
| The content of the records linked to a record (the facts an e-mail states, to summarise them) | `query_records` with `linked_to` |
| A question across several links, with conditions on the way (facts per correspondent, e-mails whose attachment states a penalty) | `traverse_records` |
| How are A and B related? | `connect_records` |

### describe_model: first, when the model is unknown

Gives each concept (key, label, record count), its fields (key, label, type, options) and the relationships
with their label, inverse label, the two concepts and cardinality. `query_records` and `find_records` accept
only these names. A field with `inData: false` has no value yet.

### find_records: find records by key, words and meaning

- Exact key or name first, then words and meaning. `concepts` narrows the search (`["Message e-mail"]`).
  A nearly right concept name (plural, typo) is read as the closest concept. Words match singular and
  plural (French and English), and an e-mail address or a reference (INV-2024-001) as written.
- A record is also found through the names of the records linked to it: an e-mail by its sender's or its
  attachment's name.
- With `concepts`, a search naming a record of another concept finds that record first, then the records
  asked for linked to it: "contrats de Carrefour" with `concepts=["Contrat"]` finds the customer
  Carrefour, then its contracts. `foundThrough` names that record (`linkedRecords`: how many are linked to
  it); each record found that way has `via` (the record, the links in between) and `match: linked` when
  only the link found it. For all of them, use `query_records` with `linked_to` its `entityId`.
- Each result has `entityId`: the handle for `get_related_records` and `linked_to`.
- `match` vector or hybrid means a likely candidate, not proof: check its fields. `passages` quote the part
  of a long field (an e-mail body) that matched: cite them.
- Report `status`: `index_not_ready` (records may be missing), `no_match`, `not_represented` (the model has no
  such concept). `hasMore: true` means more records match than were returned. Read `notes` (index
  incomplete or being rebuilt, records hidden from the user) and say so.

### get_related_records: walk the graph

Follows the stored links of the graph from records (1 to 25 `record_ids`) to the records linked to them.

- `relations` (names or keys) and `direction` (`outgoing`, `incoming`, `both`) choose the links; leave
  `relations` out to see every link of the records, one step away.
- `then_relations` adds a second step from the records reached by the first, e.g. from an e-mail:
  `relations=["a pour participant"], then_relations=["désigne"]` goes
  Message e-mail -> Participation -> Correspondant (who took part in this e-mail).
- `concepts` keeps only linked records of these concepts (last step). `max_records`: 1 to 100 (default 50).
- Each linked record comes with its `path` (through which relationship), its name and key fields, and with
  `fields=["*"]` (or named fields) its values. Values over 1500 characters are cut (`truncatedFields`).
- `linkCounts` gives, for one step, the **exact** number of records linked per relationship and concept
  (`count`, and `hidden` for those the user cannot see), even when fewer were returned.

Use it to explore links and to answer "who / what is linked to this record" with their values. When
`linkCounts` says more records exist than `max_records` allows, read them all with `query_records` and
`linked_to`. To count or filter across more links, use `traverse_records`; to explain how two given records
are related, `connect_records`.

### query_records: filter, count, group, list one concept

- `filters`: `[{"field": "Received", "op": "between", "value": "last_3_months"}]`. ops: eq, ne, contains,
  starts_with, ends_with, in, gt, gte, lt, lte, between, is_empty, not_empty. Dates take ISO dates, months,
  years or periods (today, last_7_days, this_month, last_year...). Amounts like "1,5 M€" or "10 k€" are read
  as numbers.
- A linked record's field: `"field": "<relationship>.<field>"`, e.g. `"envoyé par.domaine"`; further away,
  up to 4 relationships in a row: `"énoncé par.a pour participant.désigne.domaine"`. `"field":
  "<relationship>"` (or a chain) with is_empty / not_empty keeps records with no / some link.
- `linked_to`: `[{"relation": "énonce", "record_ids": ["<entityId>"]}]` keeps only the records linked
  through that relationship (either direction) to those exact records, on top of the filters;
  `"relation": "<relationship>.<relationship>"` reaches records further away.
- `group_by` (up to 2, date `bucket` day/week/month/quarter/year) with `aggregates` (count,
  count_distinct, sum, avg, min, max): exact totals over all the data. A linked field groups by linked
  records (`"envoyé par.name"`: per sender); a record linked to several counts in each of their groups
  (`groupsOverlap`), and `entityIds` names each group's record.
- Without `group_by`: `total` (exact) and a page of records `{entityId, name, keyFields, values}`;
  `fields` limits the fields returned; `limit` 0-200 (0: totals only); page with `offset = nextOffset`.
- `status` `invalid_query` / `not_represented` comes with errors naming the wrong part and the names
  available: fix the query from them. State the filter you used (`appliedQuery`). Report `notes`
  (unreadable values, hidden records, truncated values).
- When nothing matches, `diagnostics` gives the readable records of the concept, how many each filter or
  link keeps on its own, and `didYouMean`: stored values that look like a text value that matched nothing
  ("payed" -> "Payée"). Retry with the stored value or ask the user; never answer "none" before checking.

### traverse_records: walk several links with conditions

A walk: `start` records, then `steps`, each a relationship named as seen from the records the step before
reached, with optional `filters` on the records it reaches. The answer is about the records of the last
step, exactly as `query_records` gives it (total, page of records, groups, diagnostics).

- `start`: `{"concept": "Correspondant", "record_ids": [...]}` or `{"concept": ..., "filters": [...]}`
  (neither: every record of the concept).
- `steps`: `["désigné par", "participe à", {"relation": "énonce", "filters": [{"field": "texte", "op":
  "contains", "value": "pénalité"}]}]` goes Correspondant -> Participation -> Message -> Fait.
- `hops`: a relationship between records of one concept repeats, `{"relation": "rend compte à", "hops":
  "1..3"}`; `direction` picks which way to read it. A walk back to the start concept leaves out its start.
- `group_by` on the last step's fields, or `{"field": "name", "step": 0}` to group by start record (step k:
  the records reached at step k). A record reached from several start records counts in each group.
- Every record on the way must be visible to the user: a hidden record never links two others.
- Nothing reached: `diagnostics.startRecords` says whether the start matched anything, with `didYouMean`
  for its filters, and how many records each condition keeps.

### connect_records: how two records are related

The shortest chains of real links between two records (`from_record_id`, `to_record_id`), links read both
ways, up to `max_links` (1 to 6, default 4), optionally only through `relations`. Each path lists its
records and steps `{from, relation, direction, to}`: describe the connection from them only.
`not_connected` with `complete: true` means no chain of at most `max_links` exists; raise `max_links`
before concluding. `complete: false` (`search_cut`) means the search stopped early: say a connection may
exist.

### completeness: on every answer

Every read tool returns the same block, so you can tell whether you have everything:

| Field | Meaning |
| --- | --- |
| `complete` | every record the user may see that answers this call is in the result |
| `returned` / `total` | how many came back / how many exist (exact; `null` for find_records, which ranks) |
| `hasMore` | more records exist beyond the page, the limit or `max_records` |
| `hiddenRecords` | records left out because the user cannot see them (never counted, never shown) |
| `reasons` | `more_results`, `index_not_ready`, `index_partial`, `values_unreadable`, `values_cut`, `search_cut` |

Say "all" or "every" only when `complete` is true. Otherwise say how many were returned out of how many,
and why, or fetch the rest (page with `nextOffset`, use `linked_to`).

### Worked examples (e-mail model)

**"Les faits du mail « Relance contrat »." (a quick look)**
`find_records(query="faits du mail Relance contrat", concepts=["Fait"])`: the e-mail is found as
`foundThrough`, and its facts with `via`; `linkedRecords` says how many it states. To read them all,
continue as below.

**"Résume les faits énoncés dans le mail « Relance contrat »."**
1. `find_records(query="Relance contrat", concepts=["Message e-mail"])` -> the e-mail's `entityId`.
2. `query_records(concept="Fait", linked_to=[{"relation": "énonce", "record_ids": [<entityId>]}],
   fields=[<the fact's text and date fields>], limit=200)`; page with `nextOffset` until done.
3. Summarise from the returned values, give the total ("60 faits"), cite the facts you rely on.

**"Que dit chaque fait de ce mail ?" (a few facts)**
`get_related_records(record_ids=[<entityId>], relations=["énonce"], fields=["*"])`: the facts with their
values, and `linkCounts` with the exact number; if it is larger than what came back, switch to the
`query_records` + `linked_to` example above.

**"Qui a participé à ce mail ?"**
`get_related_records(record_ids=[<entityId>], relations=["a pour participant"], then_relations=["désigne"],
concepts=["Correspondant"])`.

**"Avec quoi ce mail est-il lié ?"**
`get_related_records(record_ids=[<entityId>])`: every link, one step, with its path.

**"Combien de mails par expéditeur ce trimestre ?"**
`query_records(concept="Message e-mail", filters=[{"field": "Received", "op": "between", "value":
"this_quarter"}], group_by=["Sender"])`.

**"Combien de faits par correspondant ?"**
`traverse_records(start={"concept": "Correspondant"}, steps=["désigné par", "participe à", "énonce"],
group_by=[{"field": "name", "step": 0}])`: one group per correspondent with its exact count of facts.

**"Les mails dont une pièce jointe parle de pénalités."**
`traverse_records(start={"concept": "Pièce jointe", "filters": [{"field": <text field>, "op": "contains",
"value": "pénalité"}]}, steps=["contenue dans"], fields=["Subject"])` (the relationship from the attachment
back to its e-mail, by its inverse name from describe_model).

**"Quel lien entre Alice et le contrat Acme ?"**
`find_records` for both, then `connect_records(from_record_id=<Alice>, to_record_id=<contract>)`.

**"Les pièces jointes du mail X, avec leur taille."**
`query_records(concept="Pièce jointe", linked_to=[{"relation": "contient", "record_ids": [<entityId>]}],
fields=["name", <size field>])`.

## Designing a model

1. Find the model with `list_semantic_models`, or create one with `create_semantic_model`; read it with
   `get_semantic_model`.
2. Make the whole design (concepts, fields, key fields, relationships) in one `apply_model_changes` call.
   Changes apply at once and can be undone with `undo_model_change` (`list_model_changes` shows them).
   `check_semantic_model` lists problems to fix.
3. Sources are the user's decision: call `suggest_sources` for the concepts that need data, with options
   only when a workspace or file name plainly matches; the user picks from a searchable list or skips.
4. Only when the user asks, or confirms the exact files: `profile_spreadsheet`, `map_spreadsheet`,
   `map_documents`, `run_data_update` (follow with `get_run_status`, stop with `stop_data_update`) and
   `publish_semantic_model`. Ask before `remove_source`, and before `delete_semantic_model` (it needs the
   exact model name and cannot be undone). `clone_semantic_model` copies a model.
5. Tell the user they can continue in the designer at any time.
