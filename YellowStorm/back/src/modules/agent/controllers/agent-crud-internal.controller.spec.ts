import { AgentCrudInternalController } from './agent-crud-internal.controller';
import { AgentService } from '../agent.service';
import { AgentTypeService } from '../../agent-type/agent-type.service';
import { ModelsService } from '../../models/models.service';
import { BadRequestException } from '@modules/exceptions';

/**
 * Focused checks for the trusted agent-crud ingress: agent type resolution
 * accepts both ObjectId and slug, and unknown slugs fail closed.
 */
describe('AgentCrudInternalController', () => {
  const createPersonal = jest.fn();
  const findBySlug = jest.fn();
  let controller: AgentCrudInternalController;
  const headers = {
    'x-internal-token': 'secret',
    'x-yellowstorm-user-id': '6984baadd6b2ec4585e8c707',
    'x-correlation-id': 'corr-1',
  };

  beforeEach(() => {
    createPersonal.mockReset();
    findBySlug.mockReset();
    controller = new AgentCrudInternalController(
      { createPersonal } as unknown as AgentService,
      { findBySlug } as unknown as AgentTypeService,
      {} as unknown as ModelsService,
    );
  });

  it('passes an ObjectId agent type through untouched', async () => {
    createPersonal.mockResolvedValue({ id: 'agent-1' });

    await controller.createAgent({ headers } as never, {
      name: 'SEO Writer',
      agentType: '64b000000000000000000000',
      role: 'Write SEO content',
    } as never);

    expect(findBySlug).not.toHaveBeenCalled();
    expect(createPersonal).toHaveBeenCalledWith(
      '6984baadd6b2ec4585e8c707',
      expect.objectContaining({ agentType: '64b000000000000000000000', slug: 'SEO Writer' }),
    );
  });

  it('resolves a slug agent type to its id', async () => {
    findBySlug.mockResolvedValue({ id: '64b000000000000000000001', slug: 'mono-agent' });
    createPersonal.mockResolvedValue({ id: 'agent-1' });

    await controller.createAgent({ headers } as never, {
      name: 'Helper',
      agentType: 'mono-agent',
      role: 'Helps',
    } as never);

    expect(findBySlug).toHaveBeenCalledWith('mono-agent');
    expect(createPersonal).toHaveBeenCalledWith(
      '6984baadd6b2ec4585e8c707',
      expect.objectContaining({ agentType: '64b000000000000000000001' }),
    );
  });

  it('rejects an unknown agent type slug', async () => {
    findBySlug.mockResolvedValue(null);

    await expect(controller.createAgent({ headers } as never, {
      name: 'Helper',
      agentType: 'does-not-exist',
      role: 'Helps',
    } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(createPersonal).not.toHaveBeenCalled();
  });
});
