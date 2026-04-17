import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../logger';
import { ConnectedAppTokenService } from '../../connected-app/services/connected-app-token.service';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

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
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const response = await fetch(`${GRAPH_BASE}/subscriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changeType: 'created',
        notificationUrl,
        resource: 'me/messages',
        expirationDateTime: expires,
        clientState,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Graph subscription create failed: ${response.status} ${body}`);
    }

    return response.json() as Promise<Record<string, any>>;
  }

  async getMessage(userId: string, mailboxAppKey: string, messageId: string) {
    const accessToken = await this.connectedAppTokenService.getValidToken(userId, mailboxAppKey);
    const response = await fetch(
      `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}?$select=id,conversationId,receivedDateTime,subject,body,bodyPreview,from,toRecipients,ccRecipients,hasAttachments`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Graph message fetch failed: ${response.status} ${body}`);
    }

    return response.json() as Promise<Record<string, any>>;
  }
}
