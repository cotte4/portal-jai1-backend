/**
 * Log Sanitizer Utility
 * Redacts PII (Personally Identifiable Information) from log messages
 * to prevent sensitive data from appearing in logs.
 */

/**
 * Redact an email address, showing only first 2 chars and domain
 * Example: "john.doe@example.com" -> "jo***@example.com"
 */
export function redactEmail(email: string): string {
  if (!email || typeof email !== 'string') return '[invalid-email]';
  const atIndex = email.indexOf('@');
  if (atIndex <= 0) return '[invalid-email]';

  const localPart = email.substring(0, atIndex);
  const domain = email.substring(atIndex);
  const visibleChars = Math.min(2, localPart.length);

  return `${localPart.substring(0, visibleChars)}***${domain}`;
}

/**
 * Redact a user ID, showing only first 8 chars
 * Example: "550e8400-e29b-41d4-a716-446655440000" -> "550e8400..."
 */
export function redactUserId(userId: string): string {
  if (!userId || typeof userId !== 'string') return '[invalid-id]';
  if (userId.length <= 8) return userId;
  return `${userId.substring(0, 8)}...`;
}

/**
 * Redact a person's name, showing only first initial
 * Example: "John Doe" -> "J. D."
 */
export function redactName(name: string): string {
  if (!name || typeof name !== 'string') return '[name]';
  const parts = name.trim().split(/\s+/);
  return parts.map(part => part.charAt(0).toUpperCase() + '.').join(' ');
}

/**
 * Redact a file name, showing only extension
 * Example: "my-tax-w2-2024.pdf" -> "[file].pdf"
 */
export function redactFileName(fileName: string): string {
  if (!fileName || typeof fileName !== 'string') return '[file]';
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) return '[file]';
  return `[file]${fileName.substring(lastDot)}`;
}

/**
 * Redact a storage path, showing only bucket and file extension
 * Example: "documents/user-123/w2-2024.pdf" -> "documents/[path].pdf"
 */
export function redactStoragePath(path: string): string {
  if (!path || typeof path !== 'string') return '[path]';
  const parts = path.split('/');
  const bucket = parts[0] || '[bucket]';
  const fileName = parts[parts.length - 1] || '';
  const lastDot = fileName.lastIndexOf('.');
  const ext = lastDot !== -1 ? fileName.substring(lastDot) : '';
  return `${bucket}/[path]${ext}`;
}

/**
 * Sanitize metadata object by redacting sensitive fields
 * Returns a safe-to-log version of the metadata
 */
export function sanitizeMetadata(metadata: Record<string, any>): Record<string, any> {
  if (!metadata || typeof metadata !== 'object') return {};

  const sensitiveFields = [
    'email', 'password', 'ssn', 'phone', 'address',
    'firstName', 'lastName', 'first_name', 'last_name',
    'fileName', 'file_name', 'storagePath', 'storage_path',
  ];

  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(metadata)) {
    const lowerKey = key.toLowerCase();

    if (sensitiveFields.some(field => lowerKey.includes(field.toLowerCase()))) {
      // Redact sensitive fields
      if (lowerKey.includes('email')) {
        sanitized[key] = typeof value === 'string' ? redactEmail(value) : '[redacted]';
      } else if (lowerKey.includes('name') && typeof value === 'string') {
        sanitized[key] = redactName(value);
      } else {
        sanitized[key] = '[redacted]';
      }
    } else if (typeof value === 'object' && value !== null) {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeMetadata(value);
    } else {
      // Keep non-sensitive values
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Create a safe log context object for structured logging
 */
export function safeLogContext(data: {
  userId?: string;
  email?: string;
  taxCaseId?: string;
  fileName?: string;
  storagePath?: string;
  [key: string]: any;
}): Record<string, any> {
  const context: Record<string, any> = {};

  if (data.userId) context.userId = redactUserId(data.userId);
  if (data.email) context.email = redactEmail(data.email);
  if (data.taxCaseId) context.taxCaseId = redactUserId(data.taxCaseId);
  if (data.fileName) context.fileName = redactFileName(data.fileName);
  if (data.storagePath) context.storagePath = redactStoragePath(data.storagePath);

  // Copy other non-sensitive fields
  for (const [key, value] of Object.entries(data)) {
    if (!context[key] && !['userId', 'email', 'taxCaseId', 'fileName', 'storagePath'].includes(key)) {
      context[key] = value;
    }
  }

  return context;
}
