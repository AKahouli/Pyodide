import { DEFAULT_WIDGET_SETTINGS, normalizeWidgetSettings } from './widget-default-settings';

describe('normalizeWidgetSettings', () => {
  it('adds default layout settings for existing widgets', () => {
    const settings = normalizeWidgetSettings({
      launcher: { ...DEFAULT_WIDGET_SETTINGS.launcher },
    });

    expect(settings.layout).toEqual({ desktopWidth: 400, desktopHeight: 620 });
  });

  it('preserves supported desktop dimensions', () => {
    const settings = normalizeWidgetSettings({
      layout: { desktopWidth: 480, desktopHeight: 720 },
    });

    expect(settings.layout).toEqual({ desktopWidth: 480, desktopHeight: 720 });
  });

  it('falls back for malformed persisted layout dimensions', () => {
    const settings = normalizeWidgetSettings({
      layout: { desktopWidth: 999, desktopHeight: 300 } as unknown as typeof DEFAULT_WIDGET_SETTINGS.layout,
    });

    expect(settings.layout).toEqual({ desktopWidth: 400, desktopHeight: 620 });
  });
});
