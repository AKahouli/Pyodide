export interface AttentionPreferences { sound: boolean; focus: boolean }
const KEY = 'worky:attention-preferences';
const DEFAULTS: AttentionPreferences = { sound: true, focus: true };

export function readAttentionPreferences(): AttentionPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AttentionPreferences>;
    return { sound: typeof value.sound === 'boolean' ? value.sound : true, focus: typeof value.focus === 'boolean' ? value.focus : true };
  } catch { return DEFAULTS; }
}

export function saveAttentionPreferences(value: AttentionPreferences): void {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* Browser storage may be unavailable. */ }
}
