import * as Sentry from '@sentry/react';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || '';

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.05,
    sendDefaultPii: false,
  });
}

export { Sentry };
