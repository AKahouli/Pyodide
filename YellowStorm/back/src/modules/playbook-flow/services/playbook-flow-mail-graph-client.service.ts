import { Injectable } from '@nestjs/common';
import { LoggerService } from '@modules/logger';
import { ConnectedAppTokenService } from '@modules/connected-app/services/connected-app-token.service';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const MSG_SELECT = '$select=id,conversationId,receivedDateTime,subject,body,bodyPreview,from,toRecipients,ccRecipients,hasAttachments';
const GRAPH_SUBSCRIPTION_MAX_WINDOW_MS = 45 * 60 * 1000;

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

  async listAttachments(userId: string, mailboxAppKey: string, messageId: string) {
    const { token: accessToken } =
      await this.connectedAppTokenService.getM365ValidToken(userId, mailboxAppKey);
    const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline`;

    try {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
      if (!resp.ok) return [];
      const data = (await resp.json()) as { value?: Array<Record<string, any>> };
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
    const match = resource.match(/^\/users\/([^/]+)\/messages\/([^/?]+)$/i);
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
        const parsed = (await resp.json()) as { value?: Array<{ targetId?: string | null }> };
        const targetId = parsed.value?.[0]?.targetId;
        if (targetId) return `/users/${graphUserId}/messages/${encodeURIComponent(targetId)}`;
      } catch { continue; }
    }
    return null;
  }
}
