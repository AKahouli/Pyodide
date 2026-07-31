import { DEFAULT_FEATURE_VISIBILITY } from './interfaces/feature-visibility.interface';
import { FeatureVisibilityService } from './feature-visibility.service';

describe('FeatureVisibilityService', () => {
  const findOne = jest.fn();
  const findOneAndUpdate = jest.fn();
  const model = { findOne, findOneAndUpdate };

  beforeEach(() => jest.clearAllMocks());

  it('returns all features enabled when no setting is persisted', async () => {
    findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(null) }) });
    const service = new FeatureVisibilityService(model as any);

    await expect(service.getVisibility()).resolves.toEqual(DEFAULT_FEATURE_VISIBILITY);
  });

  it('merges partial persisted values with enabled defaults', async () => {
    findOne.mockReturnValue({
      lean: () => ({ exec: jest.fn().mockResolvedValue({ value: { worky: false } }) }),
    });
    const service = new FeatureVisibilityService(model as any);

    await expect(service.getVisibility()).resolves.toEqual({
      ...DEFAULT_FEATURE_VISIBILITY,
      worky: false,
    });
  });

  it('persists the complete visibility map', async () => {
    const value = { ...DEFAULT_FEATURE_VISIBILITY, governance: false };
    findOneAndUpdate.mockReturnValue({
      lean: () => ({ exec: jest.fn().mockResolvedValue({ value }) }),
    });
    const service = new FeatureVisibilityService(model as any);

    await expect(service.updateVisibility(value)).resolves.toEqual(value);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { key: 'feature_visibility' },
      { key: 'feature_visibility', value },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  });
});
