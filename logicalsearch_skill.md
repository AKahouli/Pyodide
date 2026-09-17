# Logical Indexing MCP Retrieval Skill

Answer document questions using evidence from the Logical Indexing MCP tools.
Do not substitute model memory for documentary evidence.

## Tool Names And Argument Contracts

Names below are operation names. Call the actual exposed tool, including its
prefix: for example, `search-local_search` for `search`. Use `read_sections`
(plural), not `read_section`. Never call a tool that is not exposed.

The exposed parameter schema controls argument types. Descriptions of server
batching capabilities do not override that schema.

- Include an authorized `workspace_id` in every retrieval call, even if the
  schema does not mark it required. Use the selected workspace; never invent one.
- Include `display_purpose` when exposed: a short explanation of the goal in
  the user's language, without IDs, paths, credentials, or hidden reasoning.
- Provide every argument needed by the operation, even when the schema's
  `required` list contains only `display_purpose`.
- If a filename or ID parameter is typed as `string`, pass one actual filename
  or ID. Do not pass an array, a comma-separated list, or a stringified list.
- Batch filenames or IDs only when the exposed schema accepts arrays and the
  tool supports batching. Otherwise make the necessary individual calls.
- `citations` is a structured citation list: when exposed as `string`, encode
  the list as a JSON string; when exposed as `array`, pass the list directly.
  If the tool rejects that representation, report the contract mismatch rather
  than repeatedly guessing argument formats.

## Choose The Entry Point

### No known filename

Call `search` directly with a non-empty `query` and `workspace_id`. Omit
`file_name`. Do not call `get_document_strategy` or invent a filename.

For a simple factual question, start with one focused search using the user's
terms and relevant domain abbreviations. Split into additional searches only
for genuinely distinct objectives or insufficient results.

### Known filename or filenames

1. Call `get_document_strategy` before other retrieval tools for those files.
   Batch known filenames only when the exposed schema permits it.
2. Follow the returned `next_tool_calls`; do not reclassify files yourself.
   Preserve the returned file selection, adapting grouped calls to individual
   calls only when required by the exposed schema.
3. For `read_all` files, call `read_content` with the selected filenames.
4. For `search` files, call `search` with the query and returned filename filter.
5. After successful `read_content`, that file is retrieval-complete: use its
   full content and proceed to citation lookup. Do not search, reread sections
   or blocks, or expand context for that file.

### Explicit whole-file outline or summary

When the user explicitly asks to summarize a known file, call `summarize`
directly. This is the exception to `get_document_strategy` first.

Use its `table_of_contents` to provide an outline-based summary. Do not imply
that headings or short previews provide the full document's detailed content.
Do not run strategy, context expansion, or citation lookup afterward for that
summary: this tool does not supply citation block IDs. For several requested
files, batch only when the schema permits it; otherwise summarize separately.

Do not use `summarize` for factual lookup, targeted topic questions, or detailed
evidence extraction. Use the normal retrieval workflow for those tasks.

## Retrieve And Verify Evidence

| Operation | Required task arguments and purpose |
|---|---|
| `get_document_strategy` | `workspace_id`, `file_name`: choose the retrieval strategy for known files. |
| `read_content` | `workspace_id`, `file_name`: read files selected by the strategy's `read_content` entry. |
| `search` | `workspace_id`, non-empty `query`: broad section/block retrieval; add `file_name` for known files selected for search. |
| `search_sections` | `workspace_id`, non-empty `query`: find relevant sections; use filename filters when applicable. |
| `search_blocks` | `workspace_id`, non-empty `query`: find precise evidence; optionally narrow by `file_name` or `section_id`. |
| `read_sections` | `workspace_id`, `section_id`: read complete sections, blocks, and available images. |
| `read_blocks` | `workspace_id`, `block_id`: read exact blocks, not all blocks in a section. |
| `expand_context` | `workspace_id`, `section_id`: retrieve bounded surrounding hierarchy for evidence sections. |
| `locate_answer_citations` | `workspace_id`, `citations`: resolve exact evidence into final citation references. |
| `summarize` | `workspace_id`, `file_name`: retrieve an outline for an explicit whole-file summary. |

After search:

1. Inspect relevant content. Use `read_sections` for full section context or
   visual evidence; use `read_blocks` for exact block IDs. Do not repeat a read
   if the retrieved content already provides the necessary evidence.
2. For each evidence section used in the answer, call `expand_context` before
   citation lookup, unless that evidence came from `read_content`.
3. Inspect the returned context for qualifications or contradictions. Do not
   assume it contains every sibling or descendant: expansion is bounded.
4. Once evidence is sufficient, select supported claims and call
   `locate_answer_citations` as the final retrieval tool.
5. Answer from the verified evidence and returned citation references.

Do not call `get_document_map`, `read_page`, `perform_document_search`, or
`perform_standard_search` unless those tools are actually exposed. They are
not prerequisites for this workflow.

## IDs And Citations

- Use returned section IDs for `read_sections` and `expand_context`, or to
  filter `search_blocks`. Preserve IDs exactly; do not invent `sec_` prefixes.
- Use returned block IDs for `read_blocks` and text citations. A section ID
  is not a block ID.
- Use returned image IDs for image citations.
- Never pass `file_name` to `read_sections`, `read_blocks`, `expand_context`,
  or `locate_answer_citations`. IDs resolve the document within the workspace.
- Copy evidence text exactly from the retrieved block or image content.

Logical citation items:

```json
[
  {
    "type": "text",
    "block_id": "14579",
    "evidence_text": "Exact text copied from the retrieved block.",
    "reference": 1
  },
  {
    "type": "image",
    "image_id": "82",
    "evidence_text": "Exact text copied from the retrieved image content.",
    "reference": 2
  }
]
```

Example for the currently exposed string-valued `citations` parameter:

```json
{
  "workspace_id": "workspace-id",
  "citations": "[{\"type\":\"text\",\"block_id\":\"14579\",\"evidence_text\":\"Exact text copied from the retrieved block.\",\"reference\":1}]",
  "display_purpose": "Je vérifie la référence du passage utilisé pour répondre."
}
```

The retrieval arguments are `workspace_id` and `citations`; `display_purpose`
is the exposed user-facing wrapper argument. Do not add `file_name`.
Examples illustrate structure only: replace all placeholder IDs and text with
actual retrieved evidence.

## Answer And Stopping Rules

- Answer the user's question directly and in their language. Keep simple
  factual answers short; do not turn them into a full procedure.
- Ground factual claims in retrieved evidence and place returned references,
  such as `[1]`, immediately after the supported claims.
- Never invent business rules, citations, page numbers, filenames, bounding
  boxes, or evidence text. Do not use citation references that lookup did not
  return successfully.
- If evidence is insufficient or citation lookup fails, state what could not
  be verified. Do not present unsupported claims as established facts.
- Stop retrieval after the terminal citation call. Do not restart searching
  merely to repeat an already supported answer.
- Inline citations remain required even if the agent's response format also
  requests a sources section. Such a section must contain only used sources.
