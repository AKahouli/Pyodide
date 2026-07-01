import { normalizeWhatsappUserJid } from './whatsapp-user-jid.util';

describe('normalizeWhatsappUserJid', () => {
  it('strips multi-device suffix from Baileys user id', () => {
    expect(normalizeWhatsappUserJid('21651856582:21@s.whatsapp.net')).toBe(
      '21651856582@s.whatsapp.net',
    );
  });

  it('keeps canonical user jid unchanged', () => {
    expect(normalizeWhatsappUserJid('21651856582@s.whatsapp.net')).toBe(
      '21651856582@s.whatsapp.net',
    );
  });

  it('builds jid from digits-only input', () => {
    expect(normalizeWhatsappUserJid('21651856582')).toBe('21651856582@s.whatsapp.net');
  });
});
