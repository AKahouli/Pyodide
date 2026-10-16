# Inline clarification and next-step experience

Qualification date: 2026-10-10. Existing Smart Agent and signed-in Chrome tab reused throughout.

## Behavior

- Native input is shown inside its trusted originating assistant message. Tasks remains an overview; legacy inputs without an origin retain the fallback form.
- Waiting, sending and continuing are distinct states. Sending/continuing use reduced-motion-aware animation. Activity-only messages no longer imply a completed answer.
- Fields support readable labels, descriptions, multiline text and editable example suggestions. Enums retain their original validation. Visible submissions are readable text; the typed native continuation envelope is unchanged.
- Drafts and failure recovery are scoped to account, conversation and native input identity. Accepted assistant IDs are bound before early stream errors replay. A correlated failure restores the draft without automatically retrying.
- The attached orchestration skill and ROOT invocation guidance request essential clarifications, current-request isolation and relevant next steps. Background synthesis receives the same next-step guidance.

## Verification

- Backend: 37 focused schema/root-input/root-work tests passed; final root-input suite 7 passed; build passed.
- Native: 33 invocation/compiler tests passed; compiler 9 passed again after isolation guidance.
- Frontend: 93 focused presentation tests passed; latest store/form suites 82 passed, including early stream failure recovery. Typecheck and production build passed.
- Observability policy and whitespace checks passed. Existing build chunk warnings remain.
- Live: fresh public-speaking native continuation succeeded and presented next-step choices. Unrelated math answered independently while two older requests waited. A definition-fingerprint rejection restored both answer fields and an explanatory failure after loading the latest client.
- Desktop and 390px responsive views inspected. Same Chrome session/tab retained; viewport override reset.
- Read-only review and source UI QA passed without major/critical findings; Full memory updated through Obsidian.

## Limits

- Suggestion quality and consistent next-step wording remain model behavior, guided rather than guaranteed by a deterministic validator. The live clarification included examples in prose; structured schema examples are covered by tests.
- Changing a skill while a native request is paused can invalidate its immutable definition fingerprint. This correctly rejects the old continuation; start a fresh request against the updated definition.
- Drafts survive panel changes and scoped failures within the current page; they are not persisted across reloads.
- Old JSON transcript entries are not rewritten. Old request activity and unavailable-model metadata remain historical.
- Graph navigation tools were unavailable; investigation used focused source scans. Unrelated semantic-model-runtime changes were excluded from this work.
- Source UI QA flagged existing complex-schema follow-ups: object/array/boolean descriptions are not displayed, and array rows need a dedicated narrow-screen check. The qualified live flows used scalar fields.
