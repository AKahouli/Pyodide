---
id: ADR-0028
status: proposed
scope: conversation-openui-html-artifacts
---

# Configurable isolated HTML artifacts

Implementation scope was approved on 2026-10-18 as `OpenUiHtmlSandbox`. After review
identified JavaScript self-navigation as a browser limitation, the user requested
both modes under Admin → Conversation → Generative UI. This record proposes the
durable boundary; it does not supersede ADR-0025.

The existing conversation settings record carries `generativeUi.htmlMode`:
`strict` (default, including absent/unknown settings) or `interactive`.
Only the existing administrator settings route writes it. The authenticated
conversation settings GET returns it; mounted viewers refresh it through the
existing settings hook. Changes apply to stored and new artifacts, remounting the
frame and closing its port. Revocation propagation follows the settings cache
refresh, not instantaneous cross-replica push.

Reuse upstream HtmlView's html/height/title calls and optional name/object binding.
For private persistence use HtmlView inside MiniApp. Its state uses ADR-0025's
actor/conversation/message/component/program identity, JSON bounds, serialized
autosave, CAS and explicit conflict recovery. A fresh MessageChannel binds each
frame instance after verifying opaque event origin, current frame source and a
fresh per-frame token; validate declared keys, JSON size/depth, message rate and heights.
No privileged task, document, credential, file, storage or arbitrary RPC bridge
exists inside the frame. Host MiniDocument/AskAgent/MiniTaskResult remain outside.

Strict mode removes generated scripts, inline event handlers, external/navigation
attributes, nested documents, templates and SVG resource/animation elements.
An exact script URL permits only the trusted external bridge, which implements declared controls
and bounded text/filter/progress/SVG bindings without eval or innerHTML updates.
Interactive mode permits generated inline scripts, with an explicit visible
warning. The frame permits only the trusted loader URL and local evaluation;
remote scripts, inline script execution and workers remain denied. Fetch/resource restrictions do **not** prevent JavaScript self-navigation:
declared state could be sent in a navigation URL. Administrators select this
tradeoff explicitly. Neither mode provides hard CPU or memory containment.

The application's CSP forbids inline scripts and remains unchanged. HtmlView uses
`srcdoc` with an exact URL to `/openui-html.js`, a trusted external classic script.
Both parent and frame policies permit that asset. Strict mode permits no eval;
interactive mode adds eval only inside the frame (already permitted by the parent
policy), for sanitized generated scripts stored as inert data. Use one generated
script; separate scripts execute in separate function scopes. The loader waits
for initial state before evaluating, so initial syntax/runtime failures reach the
host. No script text or errors are logged with private state.

The iframe has only `allow-scripts`, retaining an opaque origin without same-origin,
forms, popups or downloads. Policy precedes model markup. Instance source, opaque
origin and fresh token are verified before transferring a port. Subsequent
navigation is never initialized again. The earlier normal-URL shell was replaced
because saved conversation startup left its browsing context at about:blank;
srcdoc avoids that navigation dependency and restored both saved dashboards.

Streaming content never mounts the frame. Stop/restart, source and expansion are
host controls. Restart retains saved values. HtmlView capture/export is the next
phase and currently fails explicitly; native reactive exports continue unchanged.
