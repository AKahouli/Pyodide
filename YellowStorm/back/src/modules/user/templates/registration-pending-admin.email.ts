function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const REQUESTED_AT_TIME_ZONE = 'Europe/Paris';

export interface RegistrationPendingAdminEmailParams {
  appName: string;
  applicantEmail: string;
  requestedAt: Date;
  usersAdminUrl: string;
}

export interface RegistrationPendingAdminEmailContent {
  subject: string;
  html: string;
  text: string;
}

export function formatRegistrationRequestedAt(date: Date): string {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: REQUESTED_AT_TIME_ZONE,
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

export function buildAdminUsersUrl(frontendUrl: string): string {
  const base = frontendUrl.replace(/\/$/, '');
  return `${base}/#/admin/users`;
}

export function buildRegistrationPendingAdminEmail(
  params: RegistrationPendingAdminEmailParams,
): RegistrationPendingAdminEmailContent {
  const requestedAt = formatRegistrationRequestedAt(params.requestedAt);
  const email = escapeHtml(params.applicantEmail);
  const usersAdminUrl = params.usersAdminUrl;

  const appName = escapeHtml(params.appName);

  return {
    subject: `New registration request - ${params.appName}`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Registration Request</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; max-width: 600px;">
    <tr>
      <td bgcolor="#667eea" style="background-color: #667eea; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px;">${appName}</h1>
      </td>
    </tr>
    <tr>
      <td style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
        <h2 style="color: #667eea; margin-top: 0;">New registration request</h2>
        <p>A standard user has requested access and is waiting for Super Admin review.</p>

    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #666; width: 120px;">Email:</td>
          <td style="padding: 8px 0; font-weight: 500;">${email}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Requested at:</td>
          <td style="padding: 8px 0; font-weight: 500;">${escapeHtml(requestedAt)}</td>
        </tr>
      </table>
    </div>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 30px auto;">
      <tr>
        <td align="center" bgcolor="#667eea" style="background-color: #667eea; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 5px;">
          <a href="${usersAdminUrl}" style="background-color: #667eea; color: #ffffff; display: inline-block; font-weight: bold; padding: 14px 28px; text-decoration: none; border-radius: 5px;">Open users page</a>
        </td>
      </tr>
    </table>
    <p style="color: #666; font-size: 14px;">You must be signed in as Super Admin. This link opens the users list in the admin panel.</p>
    <p style="color: #667eea; font-size: 14px; word-break: break-all;">${usersAdminUrl}</p>
    <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
        <p style="color: #999; font-size: 12px;">The account stays Inactive until you approve it.</p>
      </td>
    </tr>
  </table>
</body>
</html>`,
    text: `
${params.appName}

New registration request

A standard user has requested access and is waiting for Super Admin review.

Email: ${params.applicantEmail}
Requested at: ${requestedAt}

Open users page: ${usersAdminUrl}

You must be signed in as Super Admin. This link opens the users list in the admin panel.
The account stays Inactive until you approve it.
`,
  };
}
