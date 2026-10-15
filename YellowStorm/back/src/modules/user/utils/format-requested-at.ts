const TIME_ZONE = 'Europe/Paris';

/** Formats a registration request instant as `dd/MM/yyyy à HH:mm` (Paris time). */
export function formatRegistrationRequestedAt(date: Date): string {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  const day = value('day').padStart(2, '0');
  const month = value('month').padStart(2, '0');
  const year = value('year');
  const hour = value('hour').padStart(2, '0');
  const minute = value('minute').padStart(2, '0');

  return `${day}/${month}/${year} à ${hour}:${minute}`;
}
