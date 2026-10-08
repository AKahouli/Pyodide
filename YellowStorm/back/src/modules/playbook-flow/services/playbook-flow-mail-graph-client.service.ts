import { Injectable } from '@nestjs/common';
import { LoggerService } from '@modules/logger';
import { ConnectedAppTokenService } from '@modules/connected-app/services/connected-app-token.service';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const MSG_SELECT = '$select=id,conversationId,receivedDateTime,subject,body,bodyPreview,from,toRecipients,ccRecipients,hasAttachments';
const GRAPH_SUBSCRIPTION_MAX_WINDOW_MS = 4320 * 60 * 1000; // Graph max for mailFolders: 72 hours

/** Graph notification resource for an inbox subscription; ids are opaque Graph ids. */
const INBOX_RESOURCE = /^\/?(?:me\/)?(?:users\/[^/]+\/)?mailfolders\('([^'"\s?&#%]+)'\)\/messages(?:\('([^'"\s?&#%]+)'\)|\/([^'"\s?&#%/]+))$/i;
/** Well-known folder names Graph resolves for anyone — only the subscribed inbox may be named. */
const WELLKNOWN_FOLDERS = new Set([
  'inbox', 'drafts', 'sentitems', 'deleteditems', 'archive', 'junkemail',
  'outbox', 'recoverableitems', 'syncissues', 'conflicts', 'conversationhistory',
]);
/** A single opaque Graph id segment (no delimiters that could escape the path we rebuild). */
const OPAQUE_ID = /^[^'"\s/?&#]+$/;

/**
 * Pin a notification's `resource` to the subscribed inbox shape before it is
 * used as a Graph path. Graph does not sign notifications, so the resource
 * path is attacker-controlled on a public webhook — reading it verbatim would
 * let a spoofed notification point the fetch at any mailbox resource the
 * owner's token can reach (sent items, drafts, other paths). A resource that
 * is present but does not match the subscribed shape is refused; only a
 * missing resource falls back to `resourceData.id` in the subscribed folder.
 * Returns the reconstructed `me/mailFolders('<folder>')/messages/<id>` or
 * null when the shape does not match the subscription.
 */
export function pinInboxMessageResource(resource: unknown, messageIdFallback?: unknown): string | null {
  const raw = typeof resource === 'string' ? resource.trim() : '';
  if (raw.length > 0) {
    const match = INBOX_RESOURCE.exec(raw);
    if (!match) return null;
    const folder = match[1];
    if (folder.toLowerCase() !== 'inbox' && WELLKNOWN_FOLDERS.has(folder.toLowerCase())) return null;
    // Quoted ids are Graph key syntax and may contain `/`; keep that form
    // verbatim. The unquoted form is a plain path segment and stays strict.
    return match[2] !== undefined
      ? `me/mailFolders('${folder}')/messages('${match[2]}')`
      : `me/mailFolders('${folder}')/messages/${match[3]}`;
  }
  if (typeof messageIdFallback === 'string' && OPAQUE_ID.test(messageIdFallback)) {
    return `me/mailFolders('inbox')/messages/${messageIdFallback}`;
  }
  return null;
}

@Injectable()
export class PlaybookFlowMailGraphClientService {
  constructor(
    private readonly connectedAppTokenService: ConnectedAppTokenService,
    private readonly logger: LoggerService,
  ) { this.logger.setContext('PlaybookFlowMailGraphClient'); }

  async createInboxSubscription(
    userId: string,
    mailboxAppKey: string,
    notificationUrl: string,
    clientState: string,
    autoRenewUntil?: string | Date | null,
  ): Promise<{ subscription: Record<string, any>; resolvedAppKey: string }> {
    // Use getM365ValidToken so the correct key is found even if mailboxAppKey is stale
    const { token: accessToken, appKey: resolvedAppKey } =
      await this.connectedAppTokenService.getM365ValidToken(userId, mailboxAppKey);
    const expires = this.buildExpirationDateTime(autoRenewUntil);

    const response = await fetch(`${GRAPH_BASE}/subscriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changeType: 'created',
        notificationUrl,
        resource: "me/mailFolders('inbox')/messages",
        expirationDateTime: expires,
        clientState,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error('Graph subscription create failed', { userId, resolvedAppKey, status: response.status, body });
      throw new Error(`Graph subscription create failed: ${response.status} ${body}`);
    }

    const subscription = await response.json() as Record<string, any>;
    return { subscription, resolvedAppKey };
  }

  async renewSubscription(
    userId: string,
    mailboxAppKey: string,
    subscriptionId: string,
    autoRenewUntil?: string | Date | null,
  ) {
    const { token: accessToken } =
      await this.connectedAppTokenService.getM365ValidToken(userId, mailboxAppKey);
    const expires = this.buildExpirationDateTime(autoRenewUntil);

    const response = await fetch(`${GRAPH_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expirationDateTime: expires }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error('Graph subscription renewal failed', { userId, subscriptionId, status: response.status, body });
      throw new Error(`Graph subscription renewal failed: ${response.status} ${body}`);
    }

    return response.json() as Promise<Record<string, any>>;
  }

  async deleteSubscription(userId: string, mailboxAppKey: string, subscriptionId: string) {
    const { token: accessToken } =
      await this.connectedAppTokenService.getM365ValidToken(userId, mailboxAppKey);

    const response = await fetch(`${GRAPH_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok && response.status !== 404) {
      const body = await response.text();
      this.logger.error('Graph subscription deletion failed', { userId, subscriptionId, status: response.status, body });
      throw new Error(`Graph subscription deletion failed: ${response.status} ${body}`);
    }
  }

  /**
   * Inbox messages received since `since`, newest first.
   *
   * Graph notifications are best-effort: it drops them, and a subscription can
   * be briefly dead around renewal. Polling the inbox directly is the only way
   * to find what a webhook never told us about.
   */
  async listInboxMessagesSince(
    userId: string,
    mailboxAppKey: string,
    since: Date,
    top = 50,
  ): Promise<Record<string, any>[]> {
    const { token: accessToken } =
      await this.connectedAppTokenService.getM365ValidToken(userId, mailboxAppKey);
    const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`);
    const url =
      `${GRAPH_BASE}/me/mailFolders('inbox')/messages` +
      `?$filter=${filter}&$top=${top}&$orderby=receivedDateTime desc&${MSG_SELECT}`;

    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Graph inbox list failed: ${response.status} ${body}`);
    }
    const payload = (await response.json()) as { value?: Record<string, any>[] };
    return payload.value ?? [];
  }

  /**
   * Recent messages in a 1:1 Teams chat, for the reply poller. Graph forbids
   * $filter/$orderby on chatMessage, so this reads the newest page and drops
   * anything older than `since` client-side. Re-reading is safe — claim-once
   * downstream makes a replay a no-op — so a generous overlap costs nothing.
   */
  async listChatMessagesSince(
    userId: string,
    mailboxAppKey: string,
    chatId: string,
    since: Date,
    top = 20,
  ): Promise<Record<string, any>[]> {
    const { token: accessToken } =
      await this.connectedAppTokenService.getM365ValidToken(userId, mailboxAppKey);
    const url = `${GRAPH_BASE}/chats/${encodeURIComponent(chatId)}/messages?$top=${top}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Graph chat list failed: ${response.status} ${body}`);
    }
    const payload = (await response.json()) as { value?: Record<string, any>[] };
    const cutoff = since.getTime();
    return (payload.value ?? []).filter((m) => {
      const ts = Date.parse((m.createdDateTime as string) ?? '');
      return Number.isNaN(ts) || ts >= cutoff;
    });
  }

  /**
   * The signed-in account's own AAD id — used to tell worky's OWN outgoing Teams
   * message apart from the human's reply in the same chat, so the poller never
   * feeds worky's own message back as the answer.
   */
  async getMyId(userId: string, mailboxAppKey: string): Promise<string> {
    const { token: accessToken } =
      await this.connectedAppTokenService.getM365ValidToken(userId, mailboxAppKey);
    const response = await fetch(`${GRAPH_BASE}/me?$select=id`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Graph /me failed: ${response.status} ${body}`);
    }
    const payload = (await response.json()) as { id?: string };
    return payload.id ?? '';
  }

  async listAttachments(userId: string, mailboxAppKey: string, messageId: string) {
    const { token: accessToken } =
      await this.connectedAppTokenService.getM365ValidToken(userId, mailboxAppKey);
    const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline`;

    try {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
      if (!resp.ok) return [];
      const data = (await resp.json()) as { value?: Record<string, any>[] };
      return (data.value ?? []).filter((a) => a.isInline !== true);
    } catch (err) {
      this.logger.warn('Graph list attachments failed', { messageId, error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  }

  async downloadAttachment(userId: string, mailboxAppKey: string, messageId: string, attachmentId: string) {
    const { token: accessToken } =
      await this.connectedAppTokenService.getM365ValidToken(userId, mailboxAppKey);
    const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`;

    const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Graph attachment download failed: ${resp.status} ${body}`);
    }
    return Buffer.from(await resp.arrayBuffer());
  }

  async getMessageByResource(userId: string, mailboxAppKey: string, resource: string) {
    const { token: accessToken } =
      await this.connectedAppTokenService.getM365ValidToken(userId, mailboxAppKey);
    const normalizedResource = (resource.startsWith('/') ? resource : `/${resource}`)
      .replace(/^\/Users\//, '/users/')
      .replace(/\/Messages\//, '/messages/');

    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

    const directUrl = `${GRAPH_BASE}${normalizedResource}?${MSG_SELECT}`;
    const directResp = await fetch(directUrl, { headers });
    if (directResp.ok) return directResp.json() as Promise<Record<string, any>>;

    const translated = await this.tryTranslateResource(accessToken, normalizedResource);
    if (translated) {
      const transResp = await fetch(`${GRAPH_BASE}${translated}?${MSG_SELECT}`, { headers });
      if (transResp.ok) return transResp.json() as Promise<Record<string, any>>;
    }

    throw new Error(`Graph message fetch failed: all strategies exhausted. Direct: ${directResp.status}`);
  }

  private buildExpirationDateTime(autoRenewUntil?: string | Date | null): string {
    const graphMaxExpiry = Date.now() + GRAPH_SUBSCRIPTION_MAX_WINDOW_MS;
    const requestedCutoff = autoRenewUntil ? new Date(autoRenewUntil).getTime() : Number.NaN;
    const effectiveExpiry = Number.isFinite(requestedCutoff)
      ? Math.min(graphMaxExpiry, requestedCutoff)
      : graphMaxExpiry;
    return new Date(effectiveExpiry).toISOString();
  }

  private async tryTranslateResource(accessToken: string, resource: string): Promise<string | null> {
    const match = /^\/users\/([^/]+)\/messages\/([^/?]+)$/i.exec(resource);
    if (!match) return null;
    const [, graphUserId, messageId] = match;

    const pairs = [
      { source: 'entryId', target: 'restId' },
      { source: 'restImmutableEntryId', target: 'restId' },
      { source: 'immutableEntryId', target: 'restId' },
      { source: 'ewsId', target: 'restId' },
    ];

    for (const pair of pairs) {
      try {
        const resp = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(graphUserId)}/translateExchangeIds`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ inputIds: [messageId], sourceIdType: pair.source, targetIdType: pair.target }),
        });
        if (!resp.ok) continue;
        const parsed = (await resp.json()) as { value?: { targetId?: string | null }[] };
        const targetId = parsed.value?.[0]?.targetId;
        if (targetId) return `/users/${graphUserId}/messages/${encodeURIComponent(targetId)}`;
      } catch { continue; }
    }
    return null;
  }
}
