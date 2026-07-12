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

  it('adds safe accessibility defaults for existing widgets', () => {
    const settings = normalizeWidgetSettings({ launcher: { ...DEFAULT_WIDGET_SETTINGS.launcher } });

    expect(settings.accessibility.defaultProfile).toBe('standard');
    expect(settings.accessibility.voiceInput.retainAudio).toBe(false);
    expect(settings.accessibility.readAloud.autoPlay).toBe(false);
  });

  it('sanitizes invalid accessibility values and forced-safe speech settings', () => {
    const settings = normalizeWidgetSettings({
      accessibility: {
        ...DEFAULT_WIDGET_SETTINGS.accessibility,
        defaultProfile: 'unknown' as never,
        availableProfiles: ['unknown' as never],
        voiceInput: { ...DEFAULT_WIDGET_SETTINGS.accessibility.voiceInput, retainAudio: true as never, autoSend: true as never, stopAfterSilenceMs: 99999 },
        readAloud: { ...DEFAULT_WIDGET_SETTINGS.accessibility.readAloud, autoPlay: true as never, defaultRate: 99 },
        screenReader: { ...DEFAULT_WIDGET_SETTINGS.accessibility.screenReader, announcementIntervalMs: 10 },
      },
    });

    expect(settings.accessibility.defaultProfile).toBe('standard');
    expect(settings.accessibility.voiceInput).toMatchObject({ retainAudio: false, autoSend: false, stopAfterSilenceMs: 15000 });
    expect(settings.accessibility.readAloud).toMatchObject({ autoPlay: false, defaultRate: 2 });
    expect(settings.accessibility.screenReader.announcementIntervalMs).toBe(500);
  });
});
