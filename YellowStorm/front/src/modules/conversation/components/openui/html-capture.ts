import { htmlState, sanitizeHtmlCapture } from './html-sandbox';
import { miniAppStateSignature, type MiniAppStateIdentity } from './mini-app-state';

export interface HtmlCapture { html: string; width: number; height: number; text: string }
export interface HtmlCaptureProps { html: string; name?: string; value?: unknown }
type Capture = (state: Record<string, unknown>) => Promise<HtmlCapture>;
const captures = new Map<string, Set<Capture>>();
function key(identity: MiniAppStateIdentity, props: HtmlCaptureProps): string {
  return JSON.stringify([identity.userId, identity.conversationId, identity.messageId, identity.componentId, identity.programDigest, props.html, props.name ?? '']);
}
export function registerHtmlCapture(identity: MiniAppStateIdentity, props: HtmlCaptureProps, capture: Capture): () => void {
  const id = key(identity, props), entries = captures.get(id) ?? new Set<Capture>();
  entries.add(capture); captures.set(id, entries);
  return () => { entries.delete(capture); if (!entries.size) captures.delete(id); };
}
export async function captureHtmlView(props: HtmlCaptureProps, identity: MiniAppStateIdentity): Promise<HtmlCapture> {
  const entries = captures.get(key(identity, props));
  if (!entries?.size) throw new Error('Open the saved HTML view before exporting');
  // Multiple copies can be mounted (preview and transcript). Each must acknowledge the same state.
  const state = htmlState(props.value ?? {});
  const result = await [...entries][0](state);
  return sanitizeHtmlCapture(result);
}
export function sameHtmlState(left: unknown, right: unknown): boolean {
  return miniAppStateSignature(htmlState(left ?? {})) === miniAppStateSignature(htmlState(right ?? {}));
}
