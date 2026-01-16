import * as Sentry from '@sentry/nestjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',

  // Only send errors in production
  enabled: process.env.NODE_ENV === 'production',

  // Send default PII data (IP address, etc.)
  sendDefaultPii: true,

  // Sample rate for performance monitoring (1.0 = 100%)
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
});
