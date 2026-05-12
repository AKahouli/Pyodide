---
name: rag-search-agent
description: Use when answering from workspace RAG documents and you need the most relevant, complete chunks using document, section, block, page, and hierarchy search tools.
---

# RAG Search Agent

Use this skill whenever the answer must be grounded in retrieved workspace documents.

The goal is not just to find high-scoring blocks. The goal is to return the smallest complete evidence set that answers the user's question with enough surrounding context to avoid misleading isolated chunks.

## Core Principles

- Treat `search_blocks` as the primary discovery tool for unknown sources.
- Never rely on one isolated matching block when the answer depends on surrounding context.
- Expand from relevant hits into their document, section, page, ancestors, children, or descendants until the retrieved material is complete.
- Prefer exact document-scoped search after identifying likely `external_id` values.
- Preserve provenance: keep `external_id`, block IDs, section IDs, page numbers, titles, and relevance scores where available.
- Retrieve tables, figures, and images explicitly when the answer depends on structured data or visual evidence.
- Stop when additional retrieval is redundant, not merely when the first plausible hit appears.

## Retrieval Workflow

Follow this sequence for most tasks.

### 1. Clarify Scope Internally

Identify:

- the user's core question
- required entities, terms, acronyms, dates, metrics, and constraints
- whether the answer likely needs a definition, procedure, comparison, evidence, table, figure, or exhaustive coverage
- any provided `brain_ids` or `external_ids`

If the user gave `external_ids`, skip global discovery and start with document-scoped tools.

### 2. Broad Discovery

Use `search_blocks` first:

```text
search_blocks(query=<focused query>, limit=10-20, brain_ids=<if provided>, external_ids=<if provided>)
```

For broad, ambiguous, or multi-document questions, also use:

- `search_documents` to identify likely source documents by metadata, overview, and table of contents
- `search_sections` to find matching section titles across documents

Use multiple query formulations when needed:

- exact user wording
- expanded synonyms
- acronym and full-name variants
- key entity plus action or metric
- quoted phrase or keyword-heavy version for exact terms

### 3. Select Candidate Documents

Group hits by `external_id` and prioritize documents that have:

- multiple independent matching blocks
- matching section titles
- matching document metadata, overview, or table of contents
- high relevance scores across different query variants
- direct matches for required entities or constraints

For each strong candidate document, fetch orientation context when useful:

```text
get_document(external_id=<id>)
get_document_overview(external_id=<id>)
get_document_toc(external_id=<id>)
```

Use overview and TOC to decide where to drill down. Do not cite overview text as primary evidence if concrete blocks or sections are available.

### 4. Drill Down Within Documents

Once a likely `external_id` is known, use document-scoped search:

```text
search_document_blocks(external_id=<id>, query=<focused query>, limit=10-20)
search_document_sections(external_id=<id>, query=<focused query>, limit=10-50)
```

Then retrieve complete local context using the most appropriate expansion path.

## Context Expansion Rules

Use these rules to make chunks complete.

### For Any Matching Block

Fetch hierarchy context:

```text
get_block(external_id=<id>, block_id=<block_id>)
get_block_ancestors(external_id=<id>, block_id=<block_id>)
get_block_children(external_id=<id>, block_id=<block_id>)
```

Use ancestors to recover headings and section framing. Use children when the hit is a heading, list parent, figure caption, table container, or any parent-like block.

### For Heading Hits

If a matching block is a heading, retrieve its section-like content:

```text
get_block_descendants(external_id=<id>, block_id=<block_id>, max_depth=3-5)
```

Increase `max_depth` only when lower depths omit necessary nested details.

### For Section Hits

When a section title matches, fetch the section and its blocks:

```text
get_section(external_id=<id>, section_id=<section_id>)
get_section_blocks(external_id=<id>, section_id=<section_id>)
get_section_children(external_id=<id>, section_id=<section_id>)
```

Use `get_section_tree` when the TOC is not enough to understand where the section sits in the document.

### For Page-Bound Content

If results include or imply page numbers and the meaning depends on nearby material, fetch the page:

```text
get_page_blocks(external_id=<id>, page_number=<page>)
```

Fetch adjacent pages only when content visibly continues across page boundaries or references unresolved terms from surrounding pages.

### For Tables, Figures, and Images

If the question asks about numbers, comparisons, criteria, matrices, architecture diagrams, screenshots, or visual content, search or filter by type:

```text
search_blocks(query=<query>, block_type="table", limit=10)
search_document_blocks(external_id=<id>, query=<query>, block_type="table", limit=10)
get_blocks_by_type(external_id=<id>, block_type="table", limit=100)
get_blocks_by_type(external_id=<id>, block_type="figure", limit=100)
get_blocks_by_type(external_id=<id>, block_type="image", limit=100)
```

Retrieve parent, ancestors, and nearby page blocks for tables and figures so captions, labels, footnotes, and surrounding explanation are included.

## Tool Selection Matrix

Use this mapping when deciding the next tool.

| Need | Tool |
|---|---|
| Find relevant evidence across all documents | `search_blocks` |
| Find likely documents before block drill-down | `search_documents` |
| Find matching headings or chapters globally | `search_sections` |
| Search inside a known document | `search_document_blocks` |
| Search section titles inside a known document | `search_document_sections` |
| Understand document scope | `get_document`, `get_document_overview`, `get_document_toc` |
| List all sections in a document | `list_sections` |
| Get the hierarchy of sections | `get_section_tree` |
| Retrieve all content in a matched section | `get_section_blocks` |
| Retrieve exact hit details | `get_block` |
| Recover headings around a hit | `get_block_ancestors` or `get_block_parent` |
| Recover content under a heading | `get_block_children` or `get_block_descendants` |
| Recover nearby page context | `get_page_blocks` |
| Retrieve type-specific content | `get_blocks_by_type` |

## Completeness Checks

Before answering, verify:

- the retrieved chunks directly answer every part of the user's question
- all key terms in the answer appear in retrieved content or are clearly inferable from it
- a matching block has its section heading or parent context
- tables and figures include captions, labels, units, and footnotes when available
- competing or contradictory documents have been checked when the topic is ambiguous
- document-scoped searches were run for the strongest `external_id` candidates
- no important result is only present in a title, overview, or TOC without supporting blocks

If the evidence is incomplete, continue retrieval with narrower or alternative queries.

## Relevance Ranking Heuristic

Prioritize evidence in this order:

1. Blocks or section blocks that directly contain the answer.
2. Blocks in a highly relevant matched section, especially with matching ancestors.
3. Tables or figures containing exact requested metrics, criteria, or relationships.
4. Multiple blocks from the same document that corroborate each other.
5. Document overview or TOC only as orientation, not final evidence.

Prefer fewer complete chunks over many loosely related hits.

## Query Iteration Patterns

Use targeted retries when initial results are weak.

Examples:

```text
<entity> <concept>
<entity> <metric>
<entity> requirements
<entity> limitations
<entity> implementation
<acronym> OR <expanded term>
"<exact phrase>"
```

For comparisons, search each side separately and then together:

```text
<A> <question focus>
<B> <question focus>
<A> <B> comparison
```

For procedural questions, include action words:

```text
configure <entity>
create <entity>
validate <entity>
troubleshoot <entity>
```

## Answer Construction

When returning an answer:

- state the answer first if evidence is sufficient
- cite or identify the supporting chunks using available document, section, page, and block metadata
- distinguish retrieved facts from inference
- mention uncertainty when retrieved context is incomplete or conflicting
- avoid unsupported claims even if they are generally true

Use this evidence summary shape internally or in the final response when useful:

```text
Evidence used:
- external_id: <id>, section: <title/id>, page: <page>, block_id: <block_id> - <why it matters>
```

## When To Stop Searching

Stop retrieval when:

- the answer is supported by complete section or page context
- all parts of the user's question are covered
- additional top results repeat the same information
- contradictory evidence has been checked or no longer appears in likely candidates

Continue retrieval when:

- only headings, snippets, overview, or TOC entries support the answer
- a table or figure is referenced but not retrieved
- a block mentions “above”, “below”, “following”, “previous”, “this section”, or other unresolved context
- the hit appears inside a list or nested structure whose siblings may change the meaning
- the user asks for exhaustive coverage, all requirements, all steps, all exceptions, or a comparison

## Common Failure Modes

- Using `search_blocks` once and answering from the top snippet only.
- Ignoring `external_id` and failing to run document-scoped search.
- Missing section headings, parent blocks, captions, footnotes, or units.
- Treating document overview as primary evidence.
- Returning many fragments instead of a concise, complete evidence set.
- Not searching tables or figures for numeric or visual questions.
- Failing to resolve acronyms, synonyms, and alternate terminology.
