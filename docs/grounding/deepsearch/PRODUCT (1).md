# Deep Search - Product Guide

## What is Deep Search?

Deep Search is a feature that enriches your documents beyond standard keyword indexing. When enabled, each uploaded document is analyzed by AI to extract its key concepts, generate a summary, identify citations, and build a knowledge graph that connects related documents together.

The result: your agents can find information that is **topically related** even when the exact keywords do not match, and you can **visualize** how your documents relate to each other through an interactive graph.

---

## How to Use It

### Step 1: Enable Deep Search

On the workspace page, toggle **"Recherche approfondie"** to ON. This applies to all documents you upload while the toggle is active.

### Step 2: Upload Documents

Upload your documents as usual. With deep search enabled, each document goes through an enriched pipeline in addition to standard indexing.

### Step 3: View the Knowledge Graph

Click the **"Graphe"** button on the workspace page. An interactive graph opens showing:

- **Document nodes** colored by community cluster
- **Concept nodes** (high-level and low-level topics)
- **Edges** connecting related documents (similarity, shared concepts, citations)

Click any node to see its details: description, extracted concepts, table of contents, metadata (title, author, date, type...), and connections to other documents.

---

## What Happens When Deep Search is Enabled

When you upload a document with deep search ON, the following happens automatically:

```
1. STANDARD INDEXING
   Your document is indexed normally (text chunks, embeddings, Qdrant search)

2. CONCEPT EXTRACTION
   An AI reads the document and identifies:
   - 5 to 8 high-level concepts (broad topics)
   - 5 to 8 low-level concepts (specific terms)

3. METADATA EXTRACTION
   An AI reads the first 10 pages and dynamically generates
   metadata keys based on what it finds. The keys are filled
   with values from those pages and normalized against keys
   already used in your workspace.
   Examples: title, author, date, document_type, subject,
   jurisdiction, language, keywords...

4. GRAPH INGESTION
   The document is added to the knowledge graph with:
   - Its description and embedding
   - Its extracted concepts (linked back to the document)
   - Its metadata
   - Community assignment (grouped with similar documents)

5. CITATION DETECTION
   References to other documents are detected and stored
   as citation edges in the graph.
```

All of this happens in the background. The document is available for standard search immediately, and the graph enrichment completes within seconds to minutes depending on document size.

---

## The Knowledge Graph

### What You See

When you open the graph viewer, you see a visual representation of your workspace's documents and how they relate:

| Element | What it means |
|---------|---------------|
| **Colored circles** | Documents, colored by their community cluster |
| **Small squares** | Concepts (toggleable, high-level topics) |
| **Solid lines** | Similarity relationships between documents |
| **Dashed orange lines** | Documents sharing common concepts |
| **Red dashed lines** | Citation references |

### Community Colors

Documents are automatically grouped into communities based on concept similarity. Each community gets a unique color. The legend at the top shows which colors map to which community level and how many documents are in each.

### Detail Panel

Clicking a document node opens a detail panel with:

- **Metadata section**: all extracted key-value pairs (title, author, type, etc.)
- **Table of contents**: the document's structural outline
- **High-level concepts**: broad topic tags
- **Low-level concepts**: specific term tags
- **Community info**: which cluster the document belongs to
- **Connections**: similarity scores, shared concepts, and citation links to other documents

---

## Metadata Extraction

### How It Works

The metadata extraction is **dynamic**. Unlike a fixed form with predefined fields, the system generates the metadata keys based on the content of each document:

1. The AI reads the **first 10 pages** of the document
2. It identifies what metadata is relevant (this varies by document type)
3. It **generates the keys** (e.g., "title", "author", "date", "document_type", "subject")
4. It **fills the values** from the text of those pages
5. It **normalizes the keys** against what already exists in the workspace (so if the workspace already uses "document_type", a new document that produces "doc_type" will be aligned)

This means:

- A legal contract might produce: parties, jurisdiction, effective_date, contract_value
- A research paper might produce: title, authors, abstract, keywords, arxiv_id, institution
- An invoice might produce: vendor, invoice_number, amount, due_date, currency

The keys adapt to the document, not the other way around.

---

## Deep Search for Agents

### Playbook-Level Toggle

Deep search can also be enabled at the **playbook level**. When activated, all agents in the playbook gain access to a semantic search tool called `search_relevant_documents`.

This tool allows the agent to:

- Search across all documents in a workspace using **natural language queries**
- Find **topically related** documents even without exact keyword matches
- Discover documents connected through **citations** or **shared concepts**
- Get **ranked results** with relevance scores

### How Agents Use It

When deep search is ON for a playbook:

1. The agent sees the `search_relevant_documents` tool in its available tools
2. The agent can call it with a query like "find documents about revenue recognition"
3. The tool searches the knowledge graph and returns ranked results
4. The agent uses those results to answer the user's question with sourced information

When deep search is OFF:

1. The tool is **completely hidden** from the agent (not just disabled)
2. The agent cannot see or call it
3. Standard search tools remain available

---

## Key Benefits

| Benefit | Without Deep Search | With Deep Search |
|---------|---------------------|------------------|
| Document search | Keyword and embedding match | + Concept matching + graph expansion + citation traversal |
| Document relationships | Not visible | Interactive graph showing all connections |
| Metadata | Manual or absent | Automatically extracted and normalized |
| Agent capabilities | Standard retrieval | Semantic graph-aware retrieval |
| Document clustering | None | Automatic community detection with visual grouping |

---

## Performance Expectations

| Operation | Typical time |
|-----------|-------------|
| Standard indexing (without deep search) | 10-60 seconds |
| Deep search enrichment (concepts + metadata + graph) | +30-120 seconds |
| Graph visualization load | 1-3 seconds |
| Agent semantic search query | 1-5 seconds |

Deep search enrichment adds time because it involves multiple LLM calls (concept extraction, metadata extraction, description generation). The document remains usable for standard search during this process.

---

## Current Limitations (POC)

- Community reoptimization (Leiden clustering) must be triggered manually via `POST /api/reoptimize` after uploading documents. It does not run automatically after each ingestion. Communities start as PROVISIONAL until reoptimization promotes them to REAL.
- Citation detection is basic (title matching). More sophisticated resolution is planned.
- Metadata extraction reads only the first 10 pages. Longer documents may have metadata in later pages.
- The graph viewer is optimized for workspaces with up to ~100 documents. Larger workspaces may experience layout delays.
