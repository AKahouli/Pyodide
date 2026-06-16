/** Dynamic import wrapper — Baileys is ESM-only. */
let baileysModule: typeof import('@whiskeysockets/baileys') | null = null;

export async function loadBaileys(): Promise<typeof import('@whiskeysockets/baileys')> {
  if (!baileysModule) {
    baileysModule = await import('@whiskeysockets/baileys');
  }
  return baileysModule;
}
