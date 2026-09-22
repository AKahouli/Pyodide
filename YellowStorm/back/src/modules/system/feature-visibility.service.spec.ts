import { DEFAULT_FEATURE_VISIBILITY } from './interfaces/feature-visibility.interface';
import type { SystemSettingRow } from './persistence/system-setting.store';
import { FeatureVisibilityService } from './feature-visibility.service';

const settingRow = (value: unknown): SystemSettingRow => ({
  key: 'feature_visibility',
  value,
  updatedAt: new Date(),
});

describe('FeatureVisibilityService', () => {
  const get = jest.fn<Promise<SystemSettingRow | null>, []>();
  const upsert = jest.fn<Promise<SystemSettingRow>, [string, unknown]>();
  const store = { get, upsert };

  beforeEach(() => {
    jest.clearAllMocks();
    upsert.mockResolvedValue(settingRow({}));
  });

  it('returns Platform Copilot disabled when no setting is persisted', async () => {
    get.mockResolvedValue(null);
    const service = new FeatureVisibilityService(store as any);

    await expect(service.getVisibility()).resolves.toEqual(DEFAULT_FEATURE_VISIBILITY);
  });

  it('normalizes old persisted settings with Platform Copilot disabled', async () => {
    get.mockResolvedValue(settingRow({ worky: false }));
    const service = new FeatureVisibilityService(store as any);

    await expect(service.getVisibility()).resolves.toEqual({
      ...DEFAULT_FEATURE_VISIBILITY,
      worky: false,
      platformCopilot: false,
    });
  });

  it('adds runtime feature defaults to old persisted settings', async () => {
    get.mockResolvedValue(settingRow({ governance: false }));
    const service = new FeatureVisibilityService(store as any);

    await expect(service.getVisibility()).resolves.toEqual({
      ...DEFAULT_FEATURE_VISIBILITY,
      governance: false,
    });
  });

  it('serves runtime checks from the persisted cache', async () => {
    get.mockResolvedValue(settingRow({ dataRoomOutboxDispatch: false }));
    const service = new FeatureVisibilityService(store as any);

    await service.getVisibility();

    expect(service.isEnabled('dataRoomOutboxDispatch')).toBe(false);
    expect(service.isEnabled('dataRoomWorkspaceEvents')).toBe(true);
  });

  it('persists the complete visibility map', async () => {
    get.mockResolvedValue(null);
    const value = { ...DEFAULT_FEATURE_VISIBILITY, governance: false };
    const service = new FeatureVisibilityService(store as any);

    await expect(service.updateVisibility(value)).resolves.toEqual(value);
    expect(upsert).toHaveBeenCalledWith('feature_visibility', value);
  });

  it('merges an older partial update without resetting runtime settings', async () => {
    const stored = { ...DEFAULT_FEATURE_VISIBILITY, playbookMcpAssistant: false };
    get.mockResolvedValue(settingRow(stored));
    const service = new FeatureVisibilityService(store as any);

    await expect(service.updateVisibility({ governance: false })).resolves.toEqual({
      ...stored,
      governance: false,
    });
  });
});
