import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import {
  TTS_VOICES,
  VOICE_LIMITS,
  useVoiceSettings,
  type WorkyVoiceSettings,
} from '../../voice/voiceSettings';

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="flex items-center justify-between gap-4">
        <Label className="text-sm font-medium text-foreground">{label}</Label>
        {children}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function SliderRow({
  label,
  hint,
  value,
  limits,
  format,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  limits: { min: number; max: number; step: number };
  format: (v: number) => string;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="flex items-center justify-between gap-4">
        <Label className="text-sm font-medium text-foreground">{label}</Label>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{format(value)}</span>
      </div>
      <Slider
        value={[value]}
        min={limits.min}
        max={limits.max}
        step={limits.step}
        onValueChange={([v]) => onChange(v)}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="flex flex-col">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
      <Separator className="mt-3" />
    </section>
  );
}

/**
 * Per-device voice tuning. Every knob writes straight into the persisted
 * settings store, so changes apply to the next take without restarting the
 * session. The input meter is the important control here: a raw RMS threshold
 * is unusable without seeing your own room's level against it.
 */
export function VoiceSettingsSheet({
  open,
  onOpenChange,
  level,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Live input RMS from the active session, for the calibration meter. */
  level?: number;
}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const s = useVoiceSettings();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  // Device labels are only exposed once mic permission has been granted, so
  // this list fills in properly after the first session.
  useEffect(() => {
    if (!open || !navigator.mediaDevices?.enumerateDevices) return;
    void navigator.mediaDevices
      .enumerateDevices()
      .then((all) => setDevices(all.filter((d) => d.kind === 'audioinput')))
      .catch(() => undefined);
  }, [open]);

  const set = <K extends keyof WorkyVoiceSettings>(key: K) => (value: WorkyVoiceSettings[K]) =>
    s.set(key, value);

  const ms = (v: number): string => `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}s`;
  const pct = (v: number): string => `${Math.round(v * 100)}%`;

  const meterPct = Math.min(100, ((level ?? 0) / VOICE_LIMITS.speechThreshold.max) * 100);
  const thresholdPct = Math.min(
    100,
    (s.speechThreshold / VOICE_LIMITS.speechThreshold.max) * 100,
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="pb-2">
          <SheetTitle>{t('voiceSettings.title')}</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-3 pb-6">
          <Section title={t('voiceSettings.section.capture')}>
            <Row label={t('voiceSettings.device')}>
              <Select
                value={s.inputDeviceId ?? 'default'}
                onValueChange={(v) => s.set('inputDeviceId', v === 'default' ? null : v)}
              >
                <SelectTrigger className="w-52" data-testid="voice-device">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{t('voiceSettings.deviceDefault')}</SelectItem>
                  {devices.map((d, i) => (
                    <SelectItem key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `${t('voiceSettings.device')} ${i + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>

            <Row label={t('voiceSettings.echoCancellation')} hint={t('voiceSettings.echoHint')}>
              <Switch checked={s.echoCancellation} onCheckedChange={set('echoCancellation')} />
            </Row>
            <Row label={t('voiceSettings.noiseSuppression')}>
              <Switch checked={s.noiseSuppression} onCheckedChange={set('noiseSuppression')} />
            </Row>
            <Row label={t('voiceSettings.autoGain')}>
              <Switch checked={s.autoGainControl} onCheckedChange={set('autoGainControl')} />
            </Row>
            <Row label={t('voiceSettings.adaptive')} hint={t('voiceSettings.adaptiveHint')}>
              <Switch checked={s.adaptiveThreshold} onCheckedChange={set('adaptiveThreshold')} />
            </Row>

            <SliderRow
              label={t('voiceSettings.threshold')}
              hint={t('voiceSettings.thresholdHint')}
              value={s.speechThreshold}
              limits={VOICE_LIMITS.speechThreshold}
              format={(v) => v.toFixed(3)}
              onChange={(v) => s.set('speechThreshold', v)}
            />
            {/* Live level against the threshold — turns primary once speech
                would register, so the knob can be set by talking normally. */}
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted" data-testid="voice-meter">
              <div
                className={cn(
                  'h-full rounded-full transition-[width] duration-75',
                  meterPct >= thresholdPct ? 'bg-primary' : 'bg-muted-foreground/50',
                )}
                style={{ width: `${meterPct}%` }}
              />
              <span
                className="absolute inset-y-0 w-0.5 bg-foreground/70"
                style={{ left: `${thresholdPct}%` }}
                aria-hidden
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t('voiceSettings.meterHint')}</p>
          </Section>

          <Section title={t('voiceSettings.section.turn')}>
            <Row label={t('voiceSettings.mode')} hint={t('voiceSettings.modeHint')}>
              <Select value={s.turnMode} onValueChange={(v) => s.set('turnMode', v as 'auto' | 'manual')}>
                <SelectTrigger className="w-52" data-testid="voice-turn-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t('voiceSettings.modeAuto')}</SelectItem>
                  <SelectItem value="manual">{t('voiceSettings.modeManual')}</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <SliderRow
              label={t('voiceSettings.silence')}
              hint={t('voiceSettings.silenceHint')}
              value={s.silenceTimeoutMs}
              limits={VOICE_LIMITS.silenceTimeoutMs}
              format={ms}
              onChange={(v) => s.set('silenceTimeoutMs', v)}
            />
            <SliderRow
              label={t('voiceSettings.minSpeech')}
              hint={t('voiceSettings.minSpeechHint')}
              value={s.minSpeechMs}
              limits={VOICE_LIMITS.minSpeechMs}
              format={ms}
              onChange={(v) => s.set('minSpeechMs', v)}
            />
            <SliderRow
              label={t('voiceSettings.maxTake')}
              value={s.maxDurationMs}
              limits={VOICE_LIMITS.maxDurationMs}
              format={ms}
              onChange={(v) => s.set('maxDurationMs', v)}
            />
            <SliderRow
              label={t('voiceSettings.replyTimeout')}
              hint={t('voiceSettings.replyTimeoutHint')}
              value={s.replyTimeoutMs}
              limits={VOICE_LIMITS.replyTimeoutMs}
              format={ms}
              onChange={(v) => s.set('replyTimeoutMs', v)}
            />
          </Section>

          <Section title={t('voiceSettings.section.behaviour')}>
            <Row label={t('voiceSettings.realtime')} hint={t('voiceSettings.realtimeHint')}>
              <Switch
                checked={s.realtimeVoice}
                onCheckedChange={set('realtimeVoice')}
                data-testid="voice-realtime-toggle"
              />
            </Row>
            <Row
              label={t('voiceSettings.bargeIn')}
              hint={s.echoCancellation ? t('voiceSettings.bargeInHint') : t('voiceSettings.bargeInBlocked')}
            >
              <Switch
                checked={s.bargeIn && s.echoCancellation}
                disabled={!s.echoCancellation}
                onCheckedChange={set('bargeIn')}
              />
            </Row>
            <Row label={t('voiceSettings.autoRearm')} hint={t('voiceSettings.autoRearmHint')}>
              <Switch checked={s.autoRearm} onCheckedChange={set('autoRearm')} />
            </Row>
          </Section>

          <Section title={t('voiceSettings.section.playback')}>
            <Row label={t('voiceSettings.voice')}>
              <Select value={s.ttsVoice} onValueChange={(v) => s.set('ttsVoice', v)}>
                <SelectTrigger className="w-52" data-testid="voice-tts-voice">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TTS_VOICES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <SliderRow
              label={t('voiceSettings.speed')}
              value={s.ttsSpeed}
              limits={VOICE_LIMITS.ttsSpeed}
              format={(v) => `${v.toFixed(2)}x`}
              onChange={(v) => s.set('ttsSpeed', v)}
            />
            <SliderRow
              label={t('voiceSettings.volume')}
              value={s.volume}
              limits={VOICE_LIMITS.volume}
              format={pct}
              onChange={(v) => s.set('volume', v)}
            />
          </Section>

          <Button type="button" variant="outline" onClick={s.reset} data-testid="voice-reset">
            {t('voiceSettings.reset')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
