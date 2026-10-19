---
name: smart-navigation-search-no-document-strategy
description: Answer questions over Logical Indexing MCP documents using direct search, section and block navigation, context expansion, and grounded citations, without document strategy or full-document reading.
---

# Smart Navigation Search — No Document Strategy

Use this skill to answer user questions from documents indexed by the Logical
Indexing MCP server. Documents are the source of truth. Do not answer from model
memory when document retrieval is available.

Always begin retrieval with `search`. Do not call `get_document_strategy` or
`read_content`. Use the other retrieval tools selectively, including the terminal
`locate_answer_citations` call. When one or more document IDs are known,
pass the complete document ID scope to `search`. When no document ID is known,
search across the workspace without a `document_id` argument.

Document scope uses `document_id`, the indexed `LogicalDocument.id`, as a string
or list. Responses identify documents with `document_id`. Copy returned IDs for
subsequent calls. Section/block tools and citation locators resolve documents
from their section, block, or image IDs and do not accept `document_id`.

If `expand_context` returns `stop_reason=content_load_budget`, the context is
incomplete. Follow `required_next_tool_call` to read the selected sections, or
expand smaller subtrees. If `section_ids_truncated=true`, the suggested read
covers only part of the subtree; navigate remaining sections before claiming
complete coverage.

## General Agent Instructions

- Apply your assigned expertise to interpret the request. Clarify or reformulate
  ambiguous tasks when needed without changing the user's intended question.
- Before acting, analyze the task, identify requested facts and constraints,
  determine the required information and tools, and choose a retrieval approach.
  Work through these steps internally; present conclusions, supporting evidence,
  calculations, and a concise explanation rather than private reasoning.
- Read and follow instruction sections in each tool definition, including scope,
  required arguments, response limits, and follow-up requirements.
- For every factual document-retrieval task, use the available tools before the
  final answer. Search first for targeted questions even when additional context
  or an earlier agent result contains related information or says it was not found.
  Follow this skill's entry-point rules for complete known-document reading.
- Use retrieved documents and their applicable methodologies as the primary
  basis for conclusions. Prior context can guide retrieval but cannot replace
  verification or the terminal citation lookup.
- Do not guess required parameters. Use verified context when available; request
  clarification if a required value cannot be established before execution.
- If search returns no relevant evidence, reformulate or decompose the query and
  retry for the specific missing information. Preserve entities, dates, constraints,
  and authorized scope. Follow Agent-Controlled Follow-Up Search; stop repeating
  calls when they add no evidence and explain what remains unverified.
- When sources conflict, check scope, period, definitions, and context. Present
  unresolved differences with citations rather than silently choosing one source.
- If tools are insufficient, state the limitation and suggest a concrete alternative.
  Internal knowledge is only a clearly labeled fallback when tools find no relevant
  evidence; it must never supply an unsupported document-specific answer or a
  fabricated citation. Say when a requested document fact cannot be verified.
- Before answering, verify logical consistency, units, periods, calculations,
  evidence coverage, and citation support for every factual detail.


## Required Workflow

Every document-grounded answer must follow this sequence:

1. Search directly for candidate evidence.
2. Read enough evidence to meet the Answer Completeness checks below.
3. Call `expand_context` when selected evidence needs surrounding hierarchy to
   interpret or support the answer.
4. Resolve material gaps and draft the answer from verified retrieved evidence.
5. Call `locate_answer_citations` as the final retrieval tool, then answer using
   only the returned citation references.

## Scope Rules

- `workspace_id` is required for every tool call. It may be one non-empty
  string or a non-empty list. Every requested workspace must be authorized by
  the signed scope.
- `document_id` is optional for `search`.
- If one or more document IDs are known, pass the complete document ID scope to the
  search tool. Do not make one search call per file when a list-valued call can
  express the same operation.
- Omit `document_id` only when no document ID is known.
- Never send `document_id` to `search_in_sections`, `read_sections`, `read_blocks`,
  `expand_context`, or `locate_answer_citations`. Unique IDs resolve the document inside
  the workspace.

## Entry Point

### Known Document IDs

Call `search` directly with the user's query, `workspace_id`, and the complete
`document_id` string or list. Check evidence for every requested document;
search does not certify that every file was evaluated.

### Unknown Document IDs

Call `search` directly with the user's query and `workspace_id`, omitting
`document_id` so the whole workspace is searched.

## Tool Selection

- `search(query, workspace_id, document_id?, top_k=5, exclude_section_ids?,
  include_hierarchy=false)`: hybrid section and block discovery.
  Configurable ranking weights default to 75% block RRF, 20% section RRF,
  3% filename text, and 2% normalized-filename semantic ranks when enabled;
  disabling filename semantics gives text the full 5%. Filename semantic
  embeddings are cached at search time, use the original query's filename clues,
  and are optional under the request deadline. FY-year expressions are normalized.
  Exact issuer matches in issuer_YEAR filenames narrow retrieval to those files;
  generic filename terms only boost relevance. Filename context uses the original
  query supplied by the calling agent. Search returns evidence without suggested files.
  Always returns grouped `documents[].sections[].blocks` with section IDs, titles,
  scores, rank, and exact text or stored image-description excerpts. The strongest
  matches are ranked globally, with document diversity when multiple documents
  are in scope. There is no `behavior` or `response_format` argument.
  `top_k` is 1–10 sections per call, not a document count. Use fewer for a focused
  fact and more for broader questions. Scores guide relevance; they are not
  confidence probabilities. Ranked primary evidence is allocated across sections
  before optional neighbors and displayed in source order. A single scoped
  document is not capped by the multi-document diversity quota.
  `content_truncated`, `has_more_blocks`, `sections_omitted`, and
  `budget_exhausted` identify possible evidence gaps. Each call has its own byte
  budget. Use evidence directly when it supports the requested answer; read further
  for material gaps. Search does not report whether every supplied file was
  evaluated and does not establish that all relevant content was read.
- `search_in_sections(query, section_id, workspace_id, top_k=3)`: find specific
  evidence within up to ten selected numeric section IDs. Section titles supply
  subject context; details do not need to repeat query words. Returns exact text
  and image-description excerpts, scores, IDs, and truncation flags. Adjacent blocks
  are included by default; `include_neighbors=false` disables them. Use for focused
  gaps in large sections; use ordinary section reading for small sections.
  Use focused queries for unresolved prerequisites, exceptions, branches, or
  referenced details within those sections. Keep neighbors enabled when order or
  nearby qualifications matter. Results are ranked selections, not a complete
  sequence; low scores or no hits do not establish absence. If the gap remains,
  read the relevant section rather than repeatedly issuing the same local query.
- `read_sections`: read one or more sections with their blocks and images.
  Pass `query` to focus long-block excerpts. Use `include_images=false` for text
  and image descriptions; use true when actual visual inspection is needed.
  Pass only the selected section IDs needed for the answer as one list in one
  initial call. Follow continuation calls separately when they require one ID;
  do not read every search result automatically.
  Blocks longer than 1000 characters contain a 1000-character preview,
  `content_truncated=true`, `content_length`, and a `required_next_tool_call`
  for `read_blocks`. Shorter blocks contain full text and no follow-up.
  Large sections also return a section-level `required_next_tool_call` with
  `block_offset` and `image_offset`. Follow it with one section ID while relevant
  content remains unread. Combine pages and complete needed long blocks; the last
  page alone does not establish that the whole section was read.
  Matched `image/*` blocks include `image_id` and `image_content_index`; unmatched
  images remain under `images[]`.
- `read_blocks`: read selected known blocks by `block_id` when full content is
  still needed, including truncated `read_sections` blocks. Batch IDs into one call.
  Oversized blocks return `next_content_offset`; continue with that single block ID
  and `content_offset`. Retry `not_evaluated` blocks separately when needed.
- `expand_context`: read the selected section, every descendant recursively,
  and each ancestor's own blocks. Use search's `ancestors` IDs/titles to choose
  the root that covers the user's question. A leaf does not automatically expand
  its parent's other branches; select that parent explicitly when needed.
  Returns one combined `content` string with section labels, `block_id` markers,
  and `image_id` markers for stored image descriptions. Use `read_sections`
  for actual images. Duplicate context across calls is intentional.
  Finish the selected subtree even if early evidence already answers the question.
  When `has_more=true`, follow `required_next_tool_call` with its single section
  ID, `content_offset`, and `context_version`. Concatenate the content pages;
  a response budget never means the context ended. Restart if the version changes.
  `context_complete` covers the selected context after all earlier pages are read.
  Inspect `hierarchy_issues`; missing references or cycles prevent completeness.
  `boundary` exposes parent and adjacent sibling IDs/titles for further navigation.
  Structural boundaries are not proof of a semantic topic change.
  A batch returns `contexts` metadata plus one top-level `content` string.
  `include_content=false` returns the selected section IDs/titles without blocks.
- `locate_answer_citations(workspace_id, citations)`: locate exact text or stored
  image evidence after drafting. It must be the final retrieval call. Its only
  top-level arguments are `workspace_id` and `citations`.

## Dynamic Hierarchy Navigation

Choose `include_hierarchy` explicitly from the information needed to answer.
The default `false` omits both navigation lists and skips hierarchy loading.
Set it `true` when interpretation depends on enclosing scope, applicability,
definitions, or prerequisites, or when a complete account requires related
components, dependencies, alternatives, qualifications, or completion criteria.
Use intent and evidence gaps to make this decision rather than query keywords.

One boolean enables both `ancestors` and `descendants`. Ancestors are the
root-to-parent path; descendants include every level below the matched section
in source order, excluding the match itself, ancestors, and unrelated siblings.
Both contain numeric section IDs and titles, with full counts and truncation
flags: `ancestor_count`, `ancestors_truncated`, `descendant_count`, and
`descendants_truncated`. Response limits can trim navigation before block evidence.
These references do not load full section content or establish completeness.
Use them to choose relevant `read_sections` or `expand_context` calls; avoid
automatically reading every listed section. The toggle applies to each call.

## Agent-Controlled Follow-Up Search

Each `search` call performs one retrieval pass. The calling agent owns query
rewriting and decides whether another search is needed after inspecting evidence.
There are no server loop or loop-count arguments and no server rewrite completion.
Do not plan a fixed number of searches in advance. Stop when evidence is sufficient.

For a specific gap outside known sections, rewrite or decompose the query using
the user's intent and discovered vocabulary. Preserve workspace/document scope,
company names, dates, identifiers, and answer constraints. Include filename clues
such as company/year in every rewritten query so filename context is retained.

To discover different sections, optionally send `exclude_section_ids` containing
positive numeric `section_id` values copied from previous search/read responses:

```json
{
  "workspace_id": "<same authorized workspace>",
  "query": "<focused query for the unresolved gap>",
  "top_k": 5,
  "exclude_section_ids": [101088, 101056]
}
```

These numbers are examples only: use actual returned IDs, never invent them.
Exclusions are optional; omit the field for the initial call. If avoiding all
previously inspected sections, keep their accumulated IDs in the calling agent
and resend the list. Respect the tool's list-size limit. The MCP keeps no exclusion
session state. Do not pass block IDs, local `sec_*` labels, or document IDs.

Exclusion happens inside both section candidate queries and both block channels,
before candidate limits. Blocks belonging to an excluded section cannot bring it
back into results. IDs outside the authorized scope have no effect. Exclusion
filters discovery, not hierarchy references: navigation can still mention those
IDs. Each response has its own byte budget, and `top_k` limits sections, not files.

For details inside a known section, prefer `search_in_sections`, `read_sections`,
or `read_blocks`. Omit an exclusion when intentionally revisiting that section.
Do not search a file already delivered by a successful `read_content` call.
Follow-up discovery does not replace required reading or terminal citation lookup.

## Search and Reading Workflow

1. Break multi-part requests into independent retrieval objectives.
2. Generate focused search queries using the document language and exact named
   entities when possible.
3. Inspect section scores and exact evidence from `search`; use it directly only
   when it meets the Answer Completeness checks.
4. For missing details in a large selected section, call `search_in_sections` with
   a focused query. Batch section IDs instead of issuing one call per section.
5. Use `read_blocks` for missing portions of selected blocks and `read_sections`
   for exploration or actual images. A truncated excerpt cannot establish that
   a section has no exceptions. Do not automatically read every search result.
6. If interpreting evidence requires related hierarchy, batch the selected numeric
   section IDs into one `expand_context` call. Use section/block reading for missing
   text inside the target section.
7. Resolve remaining answer gaps using the appropriate search/read tool. Apply
   the Answer Completeness checks, build citation inputs, and call
   `locate_answer_citations` last before answering.

## Answer Completeness

Track the requested parts, evidence found, and unresolved gaps as you navigate.
Choose the reading scope from the user's request:

- A focused fact may be answered from a self-contained excerpt when its scope
  and applicable qualifications are clear.
- Steps, procedures, and exhaustive lists require checking the relevant sequence
  or list boundaries, prerequisites, branches, exceptions, and completion criteria.
  Read the applicable section blocks and continuations, including referenced
  sections needed to finish the answer. Three retrieved blocks do not imply three
  total steps. Preserve source order and do not invent missing steps.
- Multi-part or multi-document requests require evidence for each requested part
  and document. Global search matches do not establish evidence for every requested document.

Treat `has_more_blocks`, `content_truncated`, `budget_exhausted`,
`sections_omitted`, `not_evaluated`, and continuation calls as possible evidence
gaps. Resolve those that could affect the requested answer. `retrieval_complete`
describes the returned reading scope; it does not certify answer completeness.
Do not read unrelated material merely to clear every omission flag.

Use `search_in_sections` to investigate a specific gap within known sections,
`read_sections` to inspect the full relevant sequence, `read_blocks` to complete
selected text, and `expand_context` to interpret related hierarchy. Use a new
focused `search` when the missing material may be outside the selected sections.

Judge related context by meaning and applicability, even when it does not repeat
the query terms. Determine whether it continues, qualifies, or contradicts the
evidence, or covers another scenario. Check headings and conditions before merging
steps. Exclude unrelated content and investigate contradictions that affect the
answer; hierarchy proximity alone does not validate a claim.

Stop when every requested part is supported and no unresolved omission,
continuation, reference, or contradiction could materially change the answer.
If available navigation cannot close a gap, state exactly what remains unverified
and present the supported answer as partial. Avoid repeating calls that return no
new evidence.

## IDs And Citation Inputs

- Use `section_id` only for section navigation tools such as `read_sections`,
  `expand_context`. Use `block_id` for
  `read_blocks`.
  `read_sections` and `expand_context` accept lists of section IDs. Batch the
  selected relevant IDs into one call to the selected tool.
- `expand_context.section_id` must be the numeric `logical_sections.id` returned
  by tools, for example `"14390"`. Do not invent or prefix values like
  `"sec_14390"`; keep the numeric public section ID exactly as returned.
- `expand_context` returns all descendant blocks recursively and ancestors' own
  blocks. Use its content markers' `block_id` values for citations. Select a
  parent root explicitly to read sibling branches.
- Use block IDs from `LogicalBlock.id`, `LogicalBlock.block_id`, or
  `<block id="...">` tags for text citations.
- Prefer the internal numeric `LogicalBlock.id` returned by retrieval. Ambiguous
  parser aliases, including collisions with internal IDs, are rejected. Evidence
  must occur in stored text; only case and whitespace differences are tolerated.
  A returned location verifies a text match, not whether that text entails a claim.
- Never pass a `section_id` as a text citation `block_id`.
- Use `image_id` only for image citations.

`locate_answer_citations` citation items must contain:

```json
{
  "type": "text",
  "block_id": "14579",
  "evidence_text": "exact evidence text copied from the retrieved block",
  "reference": 1
}
```

For image citations, copy exact stored text from the cited image content or its
linked image block. Do not use a generated visual summary or paraphrase.

```json
{
  "type": "image",
  "image_id": "82",
  "evidence_text": "exact text copied from the linked image block or image content field",
  "reference": 2
}
```

## Answer Rules and Response Format

- Give a detailed, precise answer appropriate to the request. Lead with the answer,
  synthesize findings, and explain material conditions, comparisons, and limitations.
  Do not return raw tool output in place of an answer.
- Use emoji sparingly to highlight key findings or valuable information; keep the
  facts and their citations readable.
- Use well-formatted Markdown tables for structured KPIs, amounts, dates, and
  comparisons when a table helps the reader. Preserve source units and periods.
- Keep dates, numbers, names, KPIs, obligations, deadlines, comparisons, and quoted
  or paraphrased statements faithful to retrieved evidence. Distinguish reported
  facts, calculations, and deductions; explain the method for derived values.
- State exactly what could not be verified when evidence is insufficient. Do not
  invent facts, quotes, conclusions, document IDs, page numbers, or bounding boxes.

## Source Citations Protocol

### Numeric references and verification

- Use only numeric references in square brackets: `[1]`, `[2]`, `[3]`. A reference
  denotes the exact text or image evidence used to support a fact, not a document ID.
- Assign positive sequential reference numbers to the selected evidence in the
  `locate_answer_citations` inputs. After resolving evidence gaps and drafting,
  call that tool as the final retrieval call and use only references it returns.
  Preserve its returned reference numbers; do not renumber them independently.
- Never invent citation references or page numbers. Never substitute `[Source A]`,
  `[Document 1]`, or `[image.png]` for a verified numeric reference.
- Earlier context and historical agent results can identify supporting material.
  Include that evidence in the current terminal citation lookup before citing it;
  do not assume an earlier `[1]` maps to the current response's `[1]`.
- If lookup does not locate evidence for a claim, remove the claim or explicitly
  mark it unverified. A nearby located citation does not validate missing evidence.

### Mandatory coverage and placement

- Cite every distinct factual detail immediately after that detail, including
  numerical values, units and periods when source-specific, dates, names,
  attributes, factual claims, deadlines, quotes, paraphrases, comparisons, and
  image-derived information. A source mention elsewhere does not replace a citation.
- When a sentence has several facts, place each reference at the fact it supports,
  even mid-sentence. Repeat the reference when the same source supports another
  detail; do not omit citations merely to reduce repetition.
- Cite the evidence supporting the result as well as any cited methodology.
  For calculated values and deductions, cite every source supplying the inputs
  and applicable method, and label the result as calculated or inferred.
- Include all relevant verified sources that support each statement using
  consecutive references, for example `[2][7]`. If both text and images support
  the fact, cite both. Check uncertain relevance before citing; an unrelated
  source must not be added merely because it was retrieved.
- Keep citations beside the facts. Do not add a separate sources or references
  section at the end of the response.

### Tables and images

- In tables, cite every factual cell, including source-specific row labels, and
  ensure every factual row has citations. A citation on a row label or caption
  does not cover uncited factual cells. Generic formatting headers need no source.
- For example, `Paris office [3] | 45 employees [3] | EUR 2.4M [5]` places proof
  beside each factual cell. Example numbers and references are placeholders only;
  never reuse them as evidence for a real answer.
- For images, use the numeric reference returned for the image citation, not its
  document ID. Use the actual returned `image_id` and exact stored evidence in the
  citation input, following IDs And Citation Inputs.
- When multiple image pages are relevant, inspect the first page for context and
  also inspect the pages supporting the claim. Cite the located supporting image
  evidence; never assume a first-page citation proves content on another page.

### Placement examples

These examples demonstrate formatting only. Replace all facts and references with
verified evidence and references returned for the current answer:

- `Revenue was USD 1.2M [3] in Q1 [3] and USD 1.5M [4] in Q2 [4], a calculated
  increase of 25% [3][4].`
- `The daily penalty is USD 350 [1], with a cap of USD 600 [2] per incident [2].`
- `The amount exceeds the threshold [2][7].`

## Prohibited Behavior

Never:

- Skip retrieval for a document question.
- Call `get_document_strategy` or `read_content`.
- Omit known document IDs from search scope.
- Pass `document_id` to `search_in_sections`, `read_sections`, `read_blocks`,
  `expand_context`, or `locate_answer_citations`.
- Skip `expand_context` when retrieved evidence needs surrounding hierarchy to
  interpret or support the answer.
- Use document IDs as search queries.
- Call another retrieval tool after `locate_answer_citations`.
- Use citation references not returned by `locate_answer_citations`.
- Return raw search results without synthesizing a grounded answer.
