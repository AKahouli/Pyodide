import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getModel, getModels, getModelsByChef } from './api';

const getMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  apiClient: { get: getMock },
  API_ENDPOINTS: {
    models: {
      list: '/model-catalog',
      byId: (id: string) => `/model-catalog/${id}`,
      byChef: (slug: string) => `/model-catalog/chef/${slug}`,
    },
  },
}));

describe('models api', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('fetches all models', async () => {
    getMock.mockResolvedValue({ data: { data: { items: [], total: 0 } } });

    const result = await getModels();

    expect(getMock).toHaveBeenCalledWith('/model-catalog');
    expect(result).toEqual({ items: [], total: 0 });
  });

  it('fetches model by id', async () => {
    getMock.mockResolvedValue({ data: { data: { id: 'm1', name: 'Model' } } });

    const result = await getModel('m1');

    expect(getMock).toHaveBeenCalledWith('/model-catalog/m1');
    expect(result).toEqual({ id: 'm1', name: 'Model' });
  });

  it('fetches models by chef slug', async () => {
    getMock.mockResolvedValue({ data: { data: { items: [{ id: 'm1' }], total: 1 } } });

    const result = await getModelsByChef('chef-x');

    expect(getMock).toHaveBeenCalledWith('/model-catalog/chef/chef-x');
    expect(result).toEqual({ items: [{ id: 'm1' }], total: 1 });
  });
});
