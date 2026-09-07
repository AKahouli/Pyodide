import { useContext, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Globe2, Image, Mail, Palette, Save, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { COLOR_THEMES, ThemeProviderContext, type ColorTheme } from '@/contexts/ThemeContext';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { useAuth } from '@/modules/auth/useAuth';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey } from '@/modules/localization';
import {
  deleteEmailLogo,
  getAppearanceSettings,
  getEmailLogo,
  setAppearanceSettings,
  uploadEmailLogo,
} from '../api';
import type { AppearanceLogo, AppearanceSettings, EmailLogo } from '../types';
import { ColorThemeCard } from '../appearance/ColorThemeCard';
import { LogoLibrarySection } from '../appearance/LogoLibrarySection';
import { DEFAULT_LOGO_MAP, FALLBACK_LOGOS } from '../appearance/constants';
import {
  appearanceLogoSrc,
  buildAppearanceSettings,
  logoMapForAllThemes,
  logosFromSettings,
  mapFromSettings,
  notifyAppearanceSettingsUpdated,
  replaceMissingLogos,
} from '../appearance/utils';

type LoadState = 'loading' | 'ready' | 'error';

export function AppearancePage() {
  const { t } = useModuleTranslation('admin');
  const { refreshUser } = useAuth();
  const { setColorTheme, setLogo } = useContext(ThemeProviderContext);
  const persistLock = useRef(false);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedTheme, setSelectedTheme] = useState<ColorTheme>('default');
  const [savedTheme, setSavedTheme] = useState<ColorTheme>('default');
  const [themeLogoMap, setThemeLogoMap] = useState<Record<ColorTheme, string>>(DEFAULT_LOGO_MAP);
  const [logos, setLogos] = useState<AppearanceLogo[]>(FALLBACK_LOGOS);
  const [saving, setSaving] = useState(false);
  const [assigningLogo, setAssigningLogo] = useState(false);
  const [emailLogo, setEmailLogo] = useState<EmailLogo | null>(null);
  const [emailLogoFile, setEmailLogoFile] = useState<File | null>(null);
  const [uploadingEmailLogo, setUploadingEmailLogo] = useState(false);
  const [resettingEmailLogo, setResettingEmailLogo] = useState(false);
  const emailLogoInputRef = useRef<HTMLInputElement>(null);

  const applySettings = (settings: AppearanceSettings) => {
    const nextLogos = logosFromSettings(settings);
    const nextMap = mapFromSettings(settings);
    setSelectedTheme(settings.defaultColorTheme);
    setSavedTheme(settings.defaultColorTheme);
    setThemeLogoMap(nextMap);
    setLogos(nextLogos);
  };

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    getAppearanceSettings()
      .then((settings) => {
        if (cancelled) return;
        applySettings(settings);
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) {
          setLoadState('error');
          showError(t('appearance.actions.loadFailed'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t, reloadToken]);

  useEffect(() => {
    getEmailLogo()
      .then(setEmailLogo)
      .catch(() => {
        // Keep default state if the logo cannot be loaded
      });
  }, []);

  const hasUnsavedTheme = selectedTheme !== savedTheme;
  const pageReady = loadState === 'ready';
  const persistBusy = saving || assigningLogo;

  const persistAppearance = async () => {
    if (!pageReady || persistLock.current || persistBusy || !hasUnsavedTheme) {
      return;
    }
    persistLock.current = true;
    setSaving(true);
    try {
      const nextSettings = buildAppearanceSettings(selectedTheme, themeLogoMap, logos);
      const saved = await setAppearanceSettings(nextSettings, { applyToAllUsers: true });
      applySettings(saved);
      setColorTheme(saved.defaultColorTheme);
      try {
        await refreshUser();
      } catch {
        // Keep the live theme even if /me is unavailable.
      }
      notifyAppearanceSettingsUpdated(saved);
      showSuccess(t('appearance.actions.applied'));
    } catch (error) {
      showError(parseApiError(error).message || t('appearance.actions.applyFailed'));
    } finally {
      persistLock.current = false;
      setSaving(false);
    }
  };

  const persistAssignedLogo = async (logoId: string, catalog: AppearanceLogo[], notifyUser: boolean) => {
    if (!pageReady || persistLock.current || persistBusy || themeLogoMap[savedTheme] === logoId) {
      return;
    }
    const nextMap = logoMapForAllThemes(logoId);
    const entry = catalog.find((item) => item.id === logoId);
    persistLock.current = true;
    setAssigningLogo(true);
    setThemeLogoMap(nextMap);
    setLogo({ id: logoId, url: entry ? appearanceLogoSrc(entry) : undefined, name: entry?.name });
    try {
      const saved = await setAppearanceSettings(buildAppearanceSettings(savedTheme, nextMap, catalog), {
        applyToAllUsers: false,
      });
      applySettings(saved);
      notifyAppearanceSettingsUpdated(saved);
      if (notifyUser) {
        showSuccess(t('appearance.logo.applied'));
      }
    } catch (error) {
      showError(parseApiError(error).message || t('appearance.logo.applyFailed'));
      getAppearanceSettings().then(applySettings).catch(() => undefined);
    } finally {
      persistLock.current = false;
    }
  };

  const handleLogosChange = (nextLogos: AppearanceLogo[], assignId?: string) => {
    setLogos(nextLogos);
    const validIds = new Set(nextLogos.map((logo) => logo.id));
    if (!validIds.has(themeLogoMap[savedTheme])) {
      setLogo({ id: 'yellowmind', name: 'Yellowmind' });
    }
    setThemeLogoMap((current) => replaceMissingLogos(current, validIds));
    if (assignId) {
      void persistAssignedLogo(assignId, nextLogos, false);
      return;
    }
    notifyAppearanceSettingsUpdated();
  };

  const onThemeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = COLOR_THEMES.findIndex((theme) => theme.value === selectedTheme);
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedTheme(COLOR_THEMES[(index + 1) % COLOR_THEMES.length].value);
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedTheme(COLOR_THEMES[(index - 1 + COLOR_THEMES.length) % COLOR_THEMES.length].value);
    }
  };

  const onEmailLogoFileChange = (file: File | undefined) => {
    if (!file) return;
    const isSupported = file.type === 'image/png' || file.type === 'image/jpeg';
    const isWithinLimit = file.size > 0 && file.size <= 512 * 1024;
    if (!isSupported || !isWithinLimit) {
      showError(t('appearance.emailLogo.actions.saveFailed'));
      return;
    }
    setEmailLogoFile(file);
  };

  const saveEmailLogo = async () => {
    if (!emailLogoFile) return;
    setUploadingEmailLogo(true);
    try {
      const logo = await uploadEmailLogo(emailLogoFile);
      setEmailLogo(logo);
      setEmailLogoFile(null);
      showSuccess(t('appearance.emailLogo.actions.saved'));
    } catch {
      showError(t('appearance.emailLogo.actions.saveFailed'));
    } finally {
      setUploadingEmailLogo(false);
    }
  };

  const resetEmailLogo = async () => {
    setResettingEmailLogo(true);
    try {
      await deleteEmailLogo();
      setEmailLogo(null);
      setEmailLogoFile(null);
      showSuccess(t('appearance.emailLogo.actions.removeSuccess'));
    } catch {
      showError(t('appearance.emailLogo.actions.removeFailed'));
    } finally {
      setResettingEmailLogo(false);
    }
  };

  return (
    <div className='space-y-6'>
      <div>
        <h1 className='text-2xl font-semibold tracking-tight'>{t('appearance.title')}</h1>
        <p className='text-sm text-muted-foreground'>{t('appearance.description')}</p>
      </div>

      {loadState === 'error' ? (
        <Card>
          <CardContent className='flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between'>
            <p className='text-sm text-muted-foreground'>{t('appearance.actions.loadFailed')}</p>
            <Button type='button' variant='outline' onClick={() => setReloadToken((token) => token + 1)}>
              {t('appearance.actions.retry')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className='flex items-start gap-3'>
                <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
                  <Palette className='h-5 w-5' />
                </div>
                <div className='space-y-1'>
                  <CardTitle>{t('appearance.colorTheme.label')}</CardTitle>
                  <CardDescription>{t('appearance.colorTheme.description')}</CardDescription>
                </div>
              </div>
            </CardHeader>
          <CardContent className='space-y-5'>
            {loadState === 'loading' ? (
              <p className='text-sm text-muted-foreground'>{t('appearance.actions.loading')}</p>
            ) : (
              <>
                <div
                  role='radiogroup'
                  aria-label={t('appearance.colorTheme.label')}
                  onKeyDown={onThemeKeyDown}
                  className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
                  {COLOR_THEMES.map((themeOption) => (
                    <ColorThemeCard
                      key={themeOption.value}
                      value={themeOption.value}
                      label={t(themeOption.labelKey as ModuleTranslationKey<'admin'>)}
                      selected={selectedTheme === themeOption.value}
                      isActive={savedTheme === themeOption.value}
                      activeLabel={t('appearance.colorTheme.active')}
                      onSelect={setSelectedTheme}
                    />
                  ))}
                </div>
                <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                  <p className='text-sm text-muted-foreground'>
                    {hasUnsavedTheme ? t('appearance.colorTheme.applyHint') : t('appearance.colorTheme.alreadyApplied')}
                  </p>
                  <Button
                    onClick={() => void persistAppearance()}
                    disabled={!pageReady || persistBusy || !hasUnsavedTheme}
                    className='sm:w-auto'>
                    <Globe2 className='mr-2 h-4 w-4' />
                    {saving ? t('appearance.actions.applying') : t('appearance.actions.applyToAll')}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        </Card>

        <Card>
          <CardHeader>
            <div className='flex items-start gap-3'>
              <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
                <Image className='h-5 w-5' />
              </div>
              <div className='space-y-1'>
                <CardTitle>{t('appearance.logo.title')}</CardTitle>
                <CardDescription>{t('appearance.logo.description')}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadState === 'loading' ? (
              <p className='text-sm text-muted-foreground'>{t('appearance.actions.loading')}</p>
            ) : (
              <LogoLibrarySection
                logos={logos}
                selectedLogoId={themeLogoMap[savedTheme]}
                assigning={!pageReady || persistBusy}
                onSelectLogo={(logoId) => void persistAssignedLogo(logoId, logos, true)}
                onLogosChange={handleLogosChange}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className='flex items-center gap-3'>
              <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-muted'>
                <Mail className='h-5 w-5' />
              </div>
              <div>
                <CardTitle>{t('appearance.emailLogo.title')}</CardTitle>
                <CardDescription>{t('appearance.emailLogo.description')}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div>
              <p className='mb-2 text-sm font-medium'>{t('appearance.emailLogo.current')}</p>
              <div className='flex h-16 w-40 items-center justify-center rounded-lg border bg-background'>
                {emailLogo ? (
                  <img
                    src={emailLogo.dataUri}
                    alt={emailLogo.filename}
                    className='max-h-12 max-w-[9rem] rounded object-contain'
                  />
                ) : (
                  <div className='flex h-12 w-28 items-center justify-center text-xs text-muted-foreground'>
                    {t('appearance.emailLogo.none')}
                  </div>
                )}
              </div>
              {!emailLogo && (
                <p className='mt-2 text-xs text-muted-foreground'>
                  {t('appearance.emailLogo.none')}
                </p>
              )}
            </div>

            <input
              ref={emailLogoInputRef}
              type='file'
              accept='image/png,image/jpeg'
              className='hidden'
              aria-label={t('appearance.emailLogo.chooseFile')}
              onChange={(event) => onEmailLogoFileChange(event.target.files?.[0])}
            />

            {emailLogoFile ? (
              <p className='text-sm text-muted-foreground'>
                {t('appearance.emailLogo.selected', { name: emailLogoFile.name })}
              </p>
            ) : (
              <p className='text-sm text-muted-foreground'>{t('appearance.emailLogo.dropHint')}</p>
            )}

            <div className='flex gap-3'>
              <Button
                variant='outline'
                onClick={() => emailLogoInputRef.current?.click()}
                disabled={uploadingEmailLogo || resettingEmailLogo}>
                <Upload className='mr-2 h-4 w-4' />
                {t('appearance.emailLogo.chooseFile')}
              </Button>
              <Button
                onClick={saveEmailLogo}
                disabled={!emailLogoFile || uploadingEmailLogo || resettingEmailLogo}>
                <Save className='mr-2 h-4 w-4' />
                {uploadingEmailLogo
                  ? t('appearance.emailLogo.actions.saving')
                  : t('appearance.emailLogo.actions.save')}
              </Button>
              {emailLogo && (
                <Button
                  variant='destructive'
                  onClick={resetEmailLogo}
                  disabled={uploadingEmailLogo || resettingEmailLogo}>
                  <Trash2 className='mr-2 h-4 w-4' />
                  {resettingEmailLogo
                    ? t('appearance.emailLogo.actions.removing')
                    : t('appearance.emailLogo.actions.remove')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        </>
      )}
    </div>
  );
}
