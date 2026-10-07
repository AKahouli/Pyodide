# App Builder — proposed commits

Split for the current uncommitted Studio / Template Studio / preview work.
Messages follow the repo style: `feat(app-builder): <3 keywords>`.

Do **not** treat this file as already committed — it is a commit plan only.

---

## 1. `feat(app-builder): studio public routes`

Product routes `/studio` (+ legacy redirects); history and cards deep-link there.

**Files**

- `YellowStorm/front/src/Router.tsx`
- `YellowStorm/front/src/modules/conversation-v2/studio-paths.ts` *(new)*
- `YellowStorm/front/src/modules/conversation-v2/startAgentSession.ts`
- `YellowStorm/front/src/modules/conversation-v2/startAgentSession.test.ts`
- `YellowStorm/front/src/modules/conversation-v2/template-clone-draft.ts`
- `YellowStorm/front/src/modules/conversation-v2/template-clone-draft.test.ts`
- `YellowStorm/front/src/modules/app-builder/components/DeployedAppCard.tsx`
- `YellowStorm/front/src/modules/app-builder/components/DraftAppCard.tsx`
- `YellowStorm/front/src/modules/app-builder/components/AppBuilderPage.test.tsx`
- `YellowStorm/front/src/modules/sidebar/components/chatGroups.ts`
- `YellowStorm/front/src/modules/sidebar/components/chatGroups.test.ts`
- `YellowStorm/front/src/modules/sidebar/components/RecentChats.tsx`
- `YellowStorm/front/src/modules/sidebar/hooks/useAutoCollapse.ts`
- `YellowStorm/front/src/modules/sidebar/hooks/useAutoCollapse.test.tsx`

---

## 2. `feat(app-builder): studio session ux`

User-facing Studio naming (no “conversation-v2”), empty state, header/composer polish.

**Files**

- `YellowStorm/front/src/modules/conversation-v2/ConversationV2Page.tsx`
- `YellowStorm/front/src/modules/conversation-v2/ConversationV2SessionPage.tsx`
- `YellowStorm/front/src/modules/conversation-v2/components/ConversationV2Header.tsx`
- `YellowStorm/front/src/modules/conversation-v2/components/Composer.tsx`
- `YellowStorm/front/src/modules/conversation-v2/components/AgentComposer.tsx`
- `YellowStorm/front/src/modules/conversation-v2/components/MessageList.tsx`
- `YellowStorm/front/src/modules/conversation-v2/api.ts`
- `YellowStorm/front/src/modules/conversation-v2/store.ts`
- `YellowStorm/front/src/modules/conversation-v2/interfaces/session.ts`
- `YellowStorm/front/src/modules/conversation-v2/hooks/useBrowserRuntimeBoot.ts`
- `YellowStorm/front/src/modules/conversation-v2/hooks/useInitialAgentMessage.ts`
- `YellowStorm/front/src/modules/conversation-v2/runtime/NodepodRuntimeAdapter.ts`
- `YellowStorm/front/src/modules/conversation-v2/runtime/dev-toolchain.ts`
- `YellowStorm/front/src/modules/conversation-v2/locales/en.json`
- `YellowStorm/front/src/modules/conversation-v2/locales/fr.json`
- `YellowStorm/front/src/modules/app-builder/locales/en.json` *(Studio hub copy)*
- `YellowStorm/front/src/modules/app-builder/locales/fr.json`

---

## 3. `feat(app-builder): preview browser chrome`

Lovable-style preview frame; Aperçu/Preview labels only (no Canvas, no new features).

**Files**

- `YellowStorm/front/src/modules/conversation-v2/components/RightPanel/preview/PreviewBrowserFrame.tsx` *(new)*
- `YellowStorm/front/src/modules/conversation-v2/components/RightPanel/preview/PreviewCenteredStatus.tsx`
- `YellowStorm/front/src/modules/conversation-v2/components/RightPanel/ApplicationComponentView.tsx`
- `YellowStorm/front/src/modules/conversation-v2/components/RightPanel/RightPanel.tsx`
- `YellowStorm/front/src/modules/conversation-v2/components/RightPanel/AppSourceFileTree.tsx`
- `YellowStorm/front/src/modules/conversation-v2/locales/en.json` *(preview chrome keys)*
- `YellowStorm/front/src/modules/conversation-v2/locales/fr.json`

---

## 4. `feat(app-builder): template studio preview`

Admin ZIP validate → full-screen Template Studio → cover capture (replaces old dialogs).

**Files**

- `YellowStorm/front/src/modules/app-builder/components/templates/TemplateStudio.tsx` *(new)*
- `YellowStorm/front/src/modules/app-builder/components/templates/TemplateStudioBootState.tsx` *(new)*
- `YellowStorm/front/src/modules/app-builder/components/templates/TemplateStudioBootState.test.tsx` *(new)*
- `YellowStorm/front/src/modules/app-builder/components/templates/template-studio-motion.css` *(new)*
- `YellowStorm/front/src/modules/app-builder/components/templates/TemplateFormDrawer.tsx`
- `YellowStorm/front/src/modules/app-builder/components/templates/TemplateFormDrawer.test.tsx`
- `YellowStorm/front/src/modules/app-builder/components/templates/TemplateDetailDialog.tsx`
- `YellowStorm/front/src/modules/app-builder/components/templates/TemplateValidatePreviewDialog.tsx` *(deleted)*
- `YellowStorm/front/src/modules/app-builder/components/templates/TemplatePlatformSummary.tsx` *(deleted)*
- `YellowStorm/front/src/modules/app-builder/components/templates/validation/zip-preview-validation-step.ts` *(new)*
- `YellowStorm/front/src/modules/app-builder/components/templates/validation/zip-nodepod-validation-step.ts` *(deleted)*
- `YellowStorm/front/src/modules/app-builder/components/templates/validation/pipeline.ts`
- `YellowStorm/front/src/modules/app-builder/components/templates/validation/extract-template-zip.ts`
- `YellowStorm/front/src/modules/app-builder/components/templates/validation/wait-for-preview-capture.ts`
- `YellowStorm/front/src/modules/app-builder/components/templates/validation/capture-preview-screenshot.ts`
- `YellowStorm/front/src/modules/app-builder/components/templates/cover/cover-focus.ts`
- `YellowStorm/front/src/modules/app-builder/hooks/useCoverImageItems.ts`
- `YellowStorm/front/src/modules/app-builder/api.ts`
- `YellowStorm/front/src/components/ui/dialog.tsx`
- `YellowStorm/front/src/modules/app-builder/locales/en.json` *(templateStudio.*)*
- `YellowStorm/front/src/modules/app-builder/locales/fr.json`

---

## 5. `feat(app-builder): template ceph cleanup`

Backend publish/delete Ceph cleanup, platform report, template catalog errors.

**Files**

- `YellowStorm/back/src/modules/conversation-v2/utils/template-ceph-cleanup.util.ts` *(new)*
- `YellowStorm/back/src/modules/conversation-v2/utils/template-ceph-cleanup.util.spec.ts` *(new)*
- `YellowStorm/back/src/modules/conversation-v2/utils/template-zip.util.ts`
- `YellowStorm/back/src/modules/conversation-v2/admin-template.controller.ts`
- `YellowStorm/back/src/modules/conversation-v2/conversation-v2.controller.ts`
- `YellowStorm/back/src/modules/conversation-v2/conversation-v2.controller.spec.ts`
- `YellowStorm/back/src/modules/conversation-v2/dto/create-session.dto.ts`
- `YellowStorm/back/src/modules/conversation-v2/persistence/conversation-v2-template.store.ts`
- `YellowStorm/back/src/modules/conversation-v2/persistence/postgres/pg-conversation-v2-template.store.ts`
- `YellowStorm/back/src/modules/conversation-v2/proto/conversation.proto`
- `YellowStorm/back/src/modules/conversation-v2/services/conversation-v2-template.service.ts`
- `YellowStorm/back/src/modules/conversation-v2/services/conversation-v2-template.service.spec.ts`
- `YellowStorm/back/src/modules/conversation-v2/services/conversation-v2-template-publish.service.ts`
- `YellowStorm/back/src/modules/conversation-v2/services/conversation-v2-template-publish.service.spec.ts`
- `YellowStorm/back/src/modules/conversation-v2/services/conversation-v2-template-category.service.ts`
- `YellowStorm/back/src/modules/conversation-v2/services/conversation-v2-template-category.service.spec.ts`
- `YellowStorm/back/src/modules/conversation-v2/services/conversation-v2.grpc-client.service.ts`
- `YellowStorm/back/src/modules/conversation-v2/services/conversation-v2.grpc-client.service.spec.ts`
- `YellowStorm/back/src/modules/app-runtime/platform-kit/platform-template-report.ts`
- `YellowStorm/back/src/modules/app-runtime/services/runtime-binding.service.spec.ts`
- `YellowStorm/back/src/modules/exceptions/constants/error-codes.ts`
- `YellowStorm/front/src/lib/error-codes.ts`
- `YellowStorm/front/src/modules/localization/locales/en/errors.json`
- `YellowStorm/front/src/modules/localization/locales/fr/errors.json`
- `YellowStorm/back/BACKEND_GUIDELINES.md`

---

## 6. `feat(app-builder): docs module readme`

Module docs aligned with Studio routes, Template Studio, preview chrome.

**Files**

- `YellowStorm/front/src/modules/app-builder/README.md`
- `YellowStorm/front/src/modules/app-builder/COMMITS.md` *(this file)*
- `YellowStorm/front/src/modules/conversation-v2/README.md`
- `YellowStorm/front/src/modules/sidebar/README.md`
- `YellowStorm/back/src/modules/conversation-v2/README.md`

---

## Outside this git repo (reference only)

Demo template ZIPs for marketplace seeding (starter-react-vite-v6):

`C:\Users\bader\Desktop\template\yellowmid-apps`

| Commit-style label | Description |
|---|---|
| `feat(app-builder): demo template catalog` | 15 apps (5×3 categories) |
| `feat(app-builder): crypto money templates` | +3 crypto apps (18 total) |

Not part of YellowStorm-poc commits unless those folders are moved into the monorepo.

---

## Suggested apply order

1. studio public routes  
2. studio session ux  
3. preview browser chrome  
4. template studio preview  
5. template ceph cleanup  
6. docs module readme  
