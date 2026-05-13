# Email Module

Global email module supporting **SMTP** (Nodemailer) and **Outlook/Office 365** (Microsoft Graph API) with production-grade reliability features.

## Features

- **Dual Provider Support**: SMTP or Outlook (Microsoft Graph API), selectable via `EMAIL_PROVIDER`
- **SMTP Support**: Works with any SMTP provider (Gmail, Outlook SMTP, SendGrid, AWS SES, etc.)
- **Outlook / Graph API Support**: Sends via Microsoft Graph API with MSAL client credentials flow
- **Connection Pooling**: Reuses SMTP connections for better performance
- **Retry with Backoff**: Automatic retry with exponential backoff (both providers)
- **Bulk Email**: Send multiple emails with rate limiting
- **Attachments**: Support for file attachments and inline images
- **HTML & Text**: Send both HTML and plain text emails
- **Graceful Degradation**: Service continues if email provider not configured
- **Health Monitoring**: Connection verification for health checks (both providers)
- **Structured Logging**: Detailed logging with email masking for privacy

## Configuration

### Provider Selection

| Variable | Default | Description |
|----------|---------|-------------|
| `EMAIL_PROVIDER` | `smtp` | Email provider: `smtp` or `outlook` |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | - | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_SECURE` | `false` | Use TLS (true for port 465) |
| `SMTP_USER` | - | SMTP username |
| `SMTP_PASSWORD` | - | SMTP password |
| `EMAIL_FROM_NAME` | `YelloStorm` | Default sender name |
| `EMAIL_FROM_ADDRESS` | `noreply@yellostorm.com` | Default sender email |

### Connection Pool Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `EMAIL_POOL_ENABLED` | `true` | Enable connection pooling |
| `EMAIL_POOL_MAX_CONNECTIONS` | `5` | Max concurrent connections |
| `EMAIL_POOL_MAX_MESSAGES` | `100` | Max messages per connection |

### Retry Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `EMAIL_RETRY_ENABLED` | `true` | Enable automatic retry |
| `EMAIL_RETRY_MAX_ATTEMPTS` | `3` | Maximum retry attempts |
| `EMAIL_RETRY_INITIAL_DELAY` | `1000` | Initial retry delay (ms) |
| `EMAIL_RETRY_MAX_DELAY` | `10000` | Maximum retry delay (ms) |
| `EMAIL_RETRY_MULTIPLIER` | `2` | Backoff multiplier |

### Timeout Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `EMAIL_CONNECTION_TIMEOUT` | `10000` | Connection timeout (ms) |
| `EMAIL_SOCKET_TIMEOUT` | `30000` | Socket timeout (ms) |

### Outlook / Azure AD Settings (required when `EMAIL_PROVIDER=outlook`)

| Variable | Default | Description |
|----------|---------|-------------|
| `AZURE_AD_CLIENT_ID` | - | Azure AD application (client) ID |
| `AZURE_AD_CLIENT_SECRET` | - | Azure AD client secret |
| `AZURE_AD_TENANT_ID` | - | Azure AD tenant ID |
| `AZURE_AD_INSTANCE` | `https://login.microsoftonline.com` | Azure AD authority URL |
| `OUTLOOK_SENDER_EMAIL` | `EMAIL_FROM_ADDRESS` | Sender email for Graph API |

#### Azure AD Setup

1. Register an application in [Azure AD](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Add the **Mail.Send** application permission under Microsoft Graph
3. Grant admin consent for the permission
4. Create a client secret and note the client ID, tenant ID, and secret value
5. Set the environment variables above

## Usage

### Inject EmailService

```typescript
import { Injectable } from '@nestjs/common';
import { EmailService } from '@modules/email';

@Injectable()
export class MyService {
  constructor(private readonly emailService: EmailService) {}
}
```

### Send a Simple Text Email

```typescript
const result = await this.emailService.sendText(
  'user@example.com',
  'Welcome to YelloStorm',
  'Thank you for signing up!',
);

if (result.success) {
  console.log('Email sent:', result.messageId);
} else {
  console.error('Failed:', result.error);
}
```

### Send an HTML Email

```typescript
const result = await this.emailService.sendHtml(
  'user@example.com',
  'Your Weekly Report',
  '<h1>Weekly Report</h1><p>Here are your stats...</p>',
);
```

### Send with Full Options

```typescript
const result = await this.emailService.send({
  to: 'user@example.com',
  subject: 'Important Update',
  html: '<h1>Update</h1><p>Please review...</p>',
  text: 'Update\n\nPlease review...', // Fallback for non-HTML clients
  cc: ['manager@example.com'],
  bcc: ['audit@example.com'],
  replyTo: 'support@yellostorm.com',
  priority: 'high',
  headers: {
    'X-Custom-Header': 'value',
  },
  metadata: {
    userId: '123',
    campaign: 'onboarding',
  },
});
```

### Send to Multiple Recipients

```typescript
const result = await this.emailService.send({
  to: [
    'user1@example.com',
    'user2@example.com',
    { name: 'John Doe', address: 'john@example.com' },
  ],
  subject: 'Team Update',
  text: 'Hello team...',
});
```

### Send with Attachments

```typescript
const result = await this.emailService.send({
  to: 'user@example.com',
  subject: 'Your Invoice',
  html: '<p>Please find your invoice attached.</p>',
  attachments: [
    {
      filename: 'invoice.pdf',
      content: pdfBuffer,
      contentType: 'application/pdf',
    },
    {
      filename: 'logo.png',
      path: '/path/to/logo.png', // Alternative: use file path
      cid: 'logo', // For inline image: <img src="cid:logo">
    },
  ],
});
```

### Send Bulk Emails

```typescript
const result = await this.emailService.sendBulk({
  emails: [
    { to: 'user1@example.com', subject: 'Welcome', text: 'Hello User 1' },
    { to: 'user2@example.com', subject: 'Welcome', text: 'Hello User 2' },
    { to: 'user3@example.com', subject: 'Welcome', text: 'Hello User 3' },
  ],
  stopOnError: false, // Continue even if one fails
  delayBetweenMs: 100, // Rate limiting: 100ms between emails
});

console.log(`Sent: ${result.successful}/${result.total}`);
```

### Check Service Availability

```typescript
if (!this.emailService.isAvailable()) {
  throw new ServiceUnavailableException('Email service not configured');
}
```

### Get Health Status

```typescript
const health = await this.emailService.getHealthStatus();
// {
//   available: true,
//   connected: true,
//   lastConnectedAt: Date,
//   error: undefined
// }
```

## SMTP Provider Examples

### Gmail (App Password Required)

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
```

### Outlook/Office 365

```env
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@outlook.com
SMTP_PASSWORD=your-password
```

### SendGrid

```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASSWORD=your-sendgrid-api-key
```

### AWS SES

```env
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-ses-smtp-username
SMTP_PASSWORD=your-ses-smtp-password
```

### Mailgun

```env
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=postmaster@your-domain.mailgun.org
SMTP_PASSWORD=your-mailgun-password
```

### Outlook / Office 365 (Graph API)

```env
EMAIL_PROVIDER=outlook
AZURE_AD_CLIENT_ID=your-app-client-id
AZURE_AD_CLIENT_SECRET=your-client-secret
AZURE_AD_TENANT_ID=your-tenant-id
OUTLOOK_SENDER_EMAIL=sender@yourcompany.com
```

## Error Handling

### Non-Retryable Errors

The service won't retry for these errors (failing fast):
- Invalid login / Authentication failed
- Invalid recipient
- Mailbox not found
- User unknown
- Recipient rejected

### Result Object

```typescript
interface SendEmailResult {
  success: boolean;        // Whether email was sent
  messageId?: string;      // SMTP message ID
  accepted?: string[];     // Recipients that accepted
  rejected?: string[];     // Recipients that rejected
  error?: string;          // Error message if failed
  attempts: number;        // Number of attempts made
  sentAt?: Date;          // When successfully sent
}
```

## Health Check Integration

The email service is integrated with the health module:

- **`/health`**: Shows email service status
- **`/health/ready`**: Returns `not_ready` if SMTP can't connect

Health check response (SMTP):
```json
{
  "email": {
    "status": "up",
    "message": "SMTP email connected",
    "responseTime": 45,
    "lastChecked": "2024-01-15T12:00:00.000Z"
  }
}
```

Health check response (Outlook):
```json
{
  "email": {
    "status": "up",
    "message": "Outlook email connected",
    "responseTime": 120,
    "lastChecked": "2024-01-15T12:00:00.000Z"
  }
}
```

## Security Considerations

1. **Credentials**: Store SMTP credentials in environment variables
2. **TLS**: Use `SMTP_SECURE=true` or STARTTLS (port 587)
3. **Email Masking**: Logs mask email addresses for privacy
4. **Rate Limiting**: Use `delayBetweenMs` in bulk sends
5. **Validation**: Validate email addresses before sending

## Logging

All email operations are logged:

| Event | Level | Details |
|-------|-------|---------|
| Service init | INFO | Host, port, pool settings |
| Send success | INFO | MessageId, masked recipient, subject |
| Send failure | WARN | Attempt number, error |
| Final failure | ERROR | All attempts exhausted |
| Bulk complete | INFO | Total, successful, failed counts |
