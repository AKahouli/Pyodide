function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface RegistrationPendingAdminEmailParams {
  appName: string;
  applicantEmail: string;
  userId: string;
  requestedAt: Date;
  approveUrl: string;
  rejectUrl: string;
}

export interface RegistrationPendingAdminEmailContent {
  subject: string;
  html: string;
  text: string;
}

export function buildRegistrationPendingAdminEmail(
  params: RegistrationPendingAdminEmailParams,
): RegistrationPendingAdminEmailContent {
  const requestedAt = params.requestedAt.toISOString();
  const email = escapeHtml(params.applicantEmail);
  const userId = escapeHtml(params.userId);

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
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">${escapeHtml(params.appName)}</h1>
  </div>
  <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #333; margin-top: 0;">New registration request</h2>
    <p>A standard user has requested access and is waiting for Super Admin review.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr>
        <td style="padding: 8px 0; color: #666; width: 140px;">Email</td>
        <td style="padding: 8px 0;">${email}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #666;">User ID</td>
        <td style="padding: 8px 0; word-break: break-all;">${userId}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #666;">Requested at</td>
        <td style="padding: 8px 0;">${escapeHtml(requestedAt)}</td>
      </tr>
    </table>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.approveUrl}" style="background: #16a34a; color: white; padding: 14px 28px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; margin: 0 8px 12px;">Approve</a>
      <a href="${params.rejectUrl}" style="background: #dc2626; color: white; padding: 14px 28px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; margin: 0 8px 12px;">Reject</a>
    </div>
    <p style="color: #666; font-size: 14px;">You must be signed in as Super Admin. These links open the users admin page; they do not approve or reject by themselves.</p>
    <p style="color: #667eea; font-size: 14px; word-break: break-all;">${params.approveUrl}</p>
    <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">The account stays Inactive until you approve it.</p>
  </div>
</body>
</html>`,
    text: `
New registration request

A standard user has requested access and is waiting for Super Admin review.

Email: ${params.applicantEmail}
User ID: ${params.userId}
Requested at: ${requestedAt}

Approve: ${params.approveUrl}
Reject: ${params.rejectUrl}

You must be signed in as Super Admin. These links open the users admin page; they do not approve or reject by themselves.
The account stays Inactive until you approve it.
`,
  };
}

export function buildRegistrationReviewUrl(
  frontendUrl: string,
  userId: string,
  decision: 'approve' | 'reject',
): string {
  const base = frontendUrl.replace(/\/$/, '');
  return `${base}/#/admin/users?status=inactive&review=${encodeURIComponent(userId)}&decision=${decision}`;
}
