import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../logger';
import { ConnectedAppTokenService } from '../../connected-app/services/connected-app-token.service';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const MSG_SELECT = '$select=id,conversationId,receivedDateTime,subject,body,bodyPreview,from,toRecipients,ccRecipients,hasAttachments';

@Injectable()
export class PlaybookMailGraphClientService {
  constructor(
    private readonly connectedAppTokenService: ConnectedAppTokenService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PlaybookMailGraphClientService.name);
  }

  async createInboxSubscription(userId: string, mailboxAppKey: string, notificationUrl: string, clientState: string) {
    const accessToken = await this.connectedAppTokenService.getValidToken(userId, mailboxAppKey);
    const expires = new Date(Date.now() + 45 * 60 * 1000).toISOString();
    const payload = {
      changeType: 'created',
      notificationUrl,
      resource: "me/mailFolders('inbox')/messages",
      expirationDateTime: expires,
      clientState,
    };

    this.logger.log('Creating Graph mailbox subscription', { userId, mailboxAppKey });

    const response = await fetch(`${GRAPH_BASE}/subscriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error('Graph subscription create failed', {
        userId,
        mailboxAppKey,
        status: response.status,
        body,
      });
      throw new Error(`Graph subscription create failed: ${response.status} ${body}`);
    }

    return response.json() as Promise<Record<string, any>>;
  }

  async renewSubscription(userId: string, mailboxAppKey: string, subscriptionId: string) {
    const accessToken = await this.connectedAppTokenService.getValidToken(userId, mailboxAppKey);
    const expires = new Date(Date.now() + 45 * 60 * 1000).toISOString();

    this.logger.log('Renewing Graph subscription', { userId, subscriptionId });

    const response = await fetch(`${GRAPH_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expirationDateTime: expires }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error('Graph subscription renewal failed', {
        userId,
        subscriptionId,
        status: response.status,
        body,
      });
      throw new Error(`Graph subscription renewal failed: ${response.status} ${body}`);
    }

    return response.json() as Promise<Record<string, any>>;
  }

  async deleteSubscription(userId: string, mailboxAppKey: string, subscriptionId: string) {
    const accessToken = await this.connectedAppTokenService.getValidToken(userId, mailboxAppKey);

    this.logger.log('Deleting Graph subscription', { userId, subscriptionId });

    const response = await fetch(`${GRAPH_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok && response.status !== 404) {
      const body = await response.text();
      this.logger.error('Graph subscription deletion failed', {
        userId,
        subscriptionId,
        status: response.status,
        body,
      });
      throw new Error(`Graph subscription deletion failed: ${response.status} ${body}`);
    }

    this.logger.log('Graph subscription deleted', { subscriptionId });
  }

  async listAttachments(userId: string, mailboxAppKey: string, messageId: string) {
    const accessToken = await this.connectedAppTokenService.getValidToken(userId, mailboxAppKey);
    const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline`;

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!resp.ok) {
      const body = await resp.text();
      this.logger.warn('Graph list attachments failed', { messageId, status: resp.status, body });
      return [];
    }

    const data = (await resp.json()) as { value?: Array<Record<string, any>> };
    return (data.value ?? []).filter((a) => a.isInline !== true);
  }

  async downloadAttachment(userId: string, mailboxAppKey: string, messageId: string, attachmentId: string) {
    const accessToken = await this.connectedAppTokenService.getValidToken(userId, mailboxAppKey);
    const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Graph attachment download failed: ${resp.status} ${body}`);
    }

    return Buffer.from(await resp.arrayBuffer());
  }

  async getMessage(userId: string, mailboxAppKey: string, messageId: string) {
    return this.getMessageByResource(userId, mailboxAppKey, `/me/messages/${encodeURIComponent(messageId)}`);
  }

  async getMessageByResource(userId: string, mailboxAppKey: string, resource: string) {
    const accessToken = await this.connectedAppTokenService.getValidToken(userId, mailboxAppKey);
    const normalizedResource = (resource.startsWith('/') ? resource : `/${resource}`)
      .replace(/^\/Users\//, '/users/')
      .replace(/\/Messages\//, '/messages/');

    const graphHeaders = () => ({
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    });

    const directUrl = `${GRAPH_BASE}${normalizedResource}?${MSG_SELECT}`;

    const directResp = await fetch(directUrl, { headers: graphHeaders() });
    if (directResp.ok) {
      return directResp.json() as Promise<Record<string, any>>;
    }

    const directBody = await directResp.text();
    this.logger.warn('Graph message fetch failed (direct)', {
      resource: normalizedResource,
      status: directResp.status,
    });

    const translated = await this.tryTranslateResource(accessToken, normalizedResource);
    if (translated) {
      const transUrl = `${GRAPH_BASE}${translated}?${MSG_SELECT}`;
      const transResp = await fetch(transUrl, { headers: graphHeaders() });
      if (transResp.ok) {
        return transResp.json() as Promise<Record<string, any>>;
      }
    }

    const recentMessage = await this.fetchMostRecentMessage(accessToken);
    if (recentMessage) {
      return recentMessage;
    }

    throw new Error(`Graph message fetch failed: all strategies exhausted. Direct: ${directResp.status} ${directBody}`);
  }

  private async tryTranslateResource(accessToken: string, resource: string): Promise<string | null> {
    const match = resource.match(/^\/users\/([^/]+)\/messages\/([^/?]+)$/i);
    if (!match) return null;

    const [, graphUserId, messageId] = match;
    const pairs: Array<{ source: string; target: string }> = [
      { source: 'entryId', target: 'restId' },
      { source: 'restImmutableEntryId', target: 'restId' },
      { source: 'immutableEntryId', target: 'restId' },
      { source: 'ewsId', target: 'restId' },
    ];

    for (const pair of pairs) {
      try {
        const resp = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(graphUserId)}/translateExchangeIds`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputIds: [messageId],
            sourceIdType: pair.source,
            targetIdType: pair.target,
          }),
        });

        if (!resp.ok) continue;

        const parsed = (await resp.json()) as { value?: Array<{ targetId?: string | null }> };
        const targetId = parsed.value?.[0]?.targetId;
        if (targetId) {
          return `/users/${graphUserId}/messages/${encodeURIComponent(targetId)}`;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async fetchMostRecentMessage(accessToken: string): Promise<Record<string, any> | null> {
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const url = `${GRAPH_BASE}/me/messages?${MSG_SELECT}&$orderby=receivedDateTime desc&$top=1&$filter=receivedDateTime ge ${encodeURIComponent(twoMinAgo)}`;

    try {
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!resp.ok) return null;

      const data = (await resp.json()) as { value?: Array<Record<string, any>> };
      return data.value?.[0] ?? null;
    } catch {
      return null;
    }
  }
}
