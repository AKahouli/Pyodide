export interface EmailAddress {
  name?: string;
  address: string;
}

export interface EmailAttachment {
  /** Filename to be shown in the email */
  filename: string;

  /** File content as Buffer or string */
  content?: Buffer | string;

  /** Path to file (alternative to content) */
  path?: string;

  /** Content type (e.g., 'application/pdf') */
  contentType?: string;

  /** Content ID for inline attachments */
  cid?: string;
}

export interface SendEmailOptions {
  /** Recipient email address(es) */
  to: string | string[] | EmailAddress | EmailAddress[];

  /** Email subject */
  subject: string;

  /** Plain text body */
  text?: string;

  /** HTML body */
  html?: string;

  /** CC recipients */
  cc?: string | string[] | EmailAddress | EmailAddress[];

  /** BCC recipients */
  bcc?: string | string[] | EmailAddress | EmailAddress[];

  /** Reply-to address */
  replyTo?: string | EmailAddress;

  /** Email attachments */
  attachments?: EmailAttachment[];

  /** Custom headers */
  headers?: Record<string, string>;

  /** Priority: 'high', 'normal', 'low' */
  priority?: 'high' | 'normal' | 'low';

  /** Custom from address (overrides default) */
  from?: string | EmailAddress;

  /** Custom metadata for tracking */
  metadata?: Record<string, unknown>;
}

export interface SendEmailResult {
  /** Whether the email was sent successfully */
  success: boolean;

  /** Message ID from the SMTP server */
  messageId?: string;

  /** Accepted recipients */
  accepted?: string[];

  /** Rejected recipients */
  rejected?: string[];

  /** Error message if failed */
  error?: string;

  /** Number of retry attempts made */
  attempts: number;

  /** Timestamp when sent */
  sentAt?: Date;
}

export interface BulkEmailOptions {
  /** List of emails to send */
  emails: SendEmailOptions[];

  /** Whether to stop on first failure */
  stopOnError?: boolean;

  /** Delay between emails in ms (for rate limiting) */
  delayBetweenMs?: number;
}

export interface BulkEmailResult {
  /** Total emails attempted */
  total: number;

  /** Successfully sent count */
  successful: number;

  /** Failed count */
  failed: number;

  /** Individual results */
  results: SendEmailResult[];
}

export interface EmailHealthStatus {
  /** Whether the service is available */
  available: boolean;

  /** Whether SMTP connection is verified */
  connected: boolean;

  /** Last successful connection time */
  lastConnectedAt?: Date;

  /** Error message if unavailable */
  error?: string;
}
