import { SemanticModelShareService } from './semantic-model-share.service';

const model = { id: 'model-1', name: 'mail_model', ownerUserId: 'owner-1' };

function build(overrides: { users?: Record<string, unknown>; notifications?: unknown } = {}) {
  const query = jest.fn().mockResolvedValue({ rows: [{ inserted: true }] });
  const database = { transaction: jest.fn(async (fn: (client: { query: typeof query }) => unknown) => fn({ query })), query };
  const models = { requireRole: jest.fn().mockResolvedValue(model) };
  const users = {
    findByEmail: jest.fn().mockResolvedValue({ _id: { toString: () => 'user-2' }, email: 'fkahia@yellowsys.fr', profile: {} }),
    findById: jest.fn().mockResolvedValue({ email: 'agara@yellowsys.fr', profile: { firstName: 'Amine', lastName: 'Gara' } }),
    ...overrides.users,
  };
  const grants = { revokeModelGrants: jest.fn() };
  const notifications = overrides.notifications ?? { sendToUser: jest.fn().mockResolvedValue({}) };
  const service = new SemanticModelShareService(database as never, models as never, users as never, grants as never, notifications as never);
  return { service, users, notifications: notifications as { sendToUser: jest.Mock }, grants };
}

describe('SemanticModelShareService', () => {
  it('notifies the recipient with a link to the model when a model is first shared', async () => {
    const { service, notifications } = build();

    await service.share('owner-1', 'model-1', { shares: [{ email: 'fkahia@yellowsys.fr', role: 'editor' }] } as never);

    expect(notifications.sendToUser).toHaveBeenCalledWith('user-2', expect.objectContaining({
      message: expect.stringContaining('Amine Gara shared "mail_model"'),
      actions: [{ label: 'Open model', url: '/semantic-models/model-1' }],
      data: expect.objectContaining({ eventType: 'semantic_model_shared', modelId: 'model-1', role: 'editor' }),
    }));
  });

  it('still shares the model when the notification fails', async () => {
    const { service } = build({ notifications: { sendToUser: jest.fn().mockRejectedValue(new Error('sse down')) } });

    const result = await service.share('owner-1', 'model-1', { shares: [{ email: 'fkahia@yellowsys.fr', role: 'viewer' }] } as never);

    expect(result.shared).toEqual([{ userId: 'user-2', email: 'fkahia@yellowsys.fr', role: 'viewer' }]);
  });

  it('tells the recipient when their access is revoked, without an open link', async () => {
    const { service, notifications } = build();

    await service.revoke('owner-1', 'model-1', 'user-2');

    expect(notifications.sendToUser).toHaveBeenCalledWith('user-2', expect.objectContaining({
      title: 'Business model access revoked',
      actions: undefined,
    }));
  });

  it('names the owner on shared models only, and looks each owner up once', async () => {
    const { service, users } = build();
    const page = { items: [
      { ownerUserId: 'owner-1', role: 'editor' as const },
      { ownerUserId: 'owner-1', role: 'viewer' as const },
      { ownerUserId: 'me', role: 'owner' as const },
    ] };

    await service.attachOwners(page);

    expect(users.findById).toHaveBeenCalledTimes(1);
    expect(page.items[0]).toMatchObject({ ownerName: 'Amine Gara', ownerEmail: 'agara@yellowsys.fr' });
    expect(page.items[2]).not.toHaveProperty('ownerName');
  });
});
