# Feature index

Read the page matching the requested behavior, then its linked source/tests and
relevant scoped instructions. These pages describe this branch's implemented
features; code and tests remain authoritative. Consult architecture/contracts only
when affected. Do not load the entire documentation tree.

| Feature / task | Page | Primary source scope |
| --- | --- | --- |
| Chat, messages, streaming, cancellation, saved conversations | [Conversations](conversations.md) | `YellowStorm/front/src/modules/conversation/`, `YellowStorm/back/src/modules/conversation/` |
| Semantic-model catalog/editor, concepts, source data, population/extraction | [Semantic model](semantic-model.md) | `YellowStorm/front/src/modules/semantic-model/`, `YellowStorm/back/src/modules/semantic-model/`, `YellowStorm/semantic-model-runtime/` |

For cross-feature flows, read both affected pages and verify sender/receiver code.
This initial index is not an exhaustive product inventory; add a row for each
new feature and link its actual implementation.

Updates and branch sharing follow [documentation workflow](../documentation-workflow.md).
The primary assigns affected pages to `maintainer` once source is stable, with
disjoint file ownership and evidence. Documentation changes belong in the same
branch/PR as implementation. Reviewed main-branch docs become shared context when
developers merge/rebase; another branch's unmerged docs remain provisional.
