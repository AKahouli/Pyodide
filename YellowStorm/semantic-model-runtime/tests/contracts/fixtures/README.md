# Phase 0 contract fixtures (P0.6)

Five captured scenarios that demonstrate unambiguous Workspace/asset
resolution under the v1 contracts. Each fixture states the source values taken
from the real backend columns and the expected runtime resolution. Phase 2+
contract tests load these files and validate them against `contracts/v1/*.schema.json`.

| File | Scenario | Key expectation |
|---|---|---|
| `xlsx-source.fixture.json` | XLSX asset, backend-buffered upload (MD5 present) | `sourceVersionVerification: partial`; dataset preparation required for population. |
| `csv-source.fixture.json` | CSV asset, presigned upload (no contentHash) | `sourceVersionVerification: unknown`; observation fingerprint recorded, never labelled verified. |
| `indexed-document.fixture.json` | Uploaded document, indexing `completed` | Resolves to an `indexObservationId`; verification via existing upload/index correlation. |
| `unindexed-document.fixture.json` | Document upload that failed indexing | Discovery returns `status: indexing_required`; no evidence packets; user reuses the unchanged upload/indexing workflow. |
| `cross-workspace-selection.fixture.json` | Model home Workspace A selects an authorized asset in Workspace B | Resolution requires current authorization on **both** workspaces at read time; a grant from A alone resolves nothing. |

Conventions: ids are 24-char lowercase hex (backend ObjectId convention);
`assetVersionId` uses `sha256:`/`md5:`/`obs:` prefixes as defined in
`asset-ref.schema.json`.
