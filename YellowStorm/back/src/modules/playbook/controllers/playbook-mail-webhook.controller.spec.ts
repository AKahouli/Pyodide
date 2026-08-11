import { type Response } from 'express';
import { PlaybookMailWebhookController } from './playbook-mail-webhook.controller';
import type { PlaybookMailWebhookService } from '../services/playbook-mail-webhook.service';

describe('PlaybookMailWebhookController', () => {
  it('returns the raw validation token as plain text', () => {
    const webhookService = {
      handleNotifications: jest.fn(),
    } as unknown as PlaybookMailWebhookService;
    const controller = new PlaybookMailWebhookController(webhookService);
    const res = {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
      end: jest.fn(),
    } as unknown as Response;

    controller.validateWebhook('Validation: token', res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', String(Buffer.byteLength('Validation: token', 'utf8')));
    expect(res.end).toHaveBeenCalledWith('Validation: token');
  });

  it('returns the raw validation token for POST webhook validation', async () => {
    const webhookService = {
      handleNotifications: jest.fn(),
    } as unknown as PlaybookMailWebhookService;
    const controller = new PlaybookMailWebhookController(webhookService);
    const res = {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
      end: jest.fn(),
    } as unknown as Response;

    await controller.receiveWebhook('Validation: token', { value: [] }, res);

    expect(webhookService.handleNotifications).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', String(Buffer.byteLength('Validation: token', 'utf8')));
    expect(res.end).toHaveBeenCalledWith('Validation: token');
  });

  it('acknowledges webhook notifications with 202 and no body', async () => {
    const webhookService = {
      handleNotifications: jest.fn().mockResolvedValue({ processed: 0, results: [] }),
    } as unknown as PlaybookMailWebhookService;
    const controller = new PlaybookMailWebhookController(webhookService);
    const res = {
      status: jest.fn().mockReturnThis(),
      end: jest.fn(),
    } as unknown as Response;
    const payload = { value: [{ subscriptionId: 'sub-1', resourceData: { id: 'msg-1' } }] };

    await controller.receiveWebhook(undefined, payload, res);

    expect(webhookService.handleNotifications).toHaveBeenCalledWith(payload);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.end).toHaveBeenCalledWith();
  });
});
