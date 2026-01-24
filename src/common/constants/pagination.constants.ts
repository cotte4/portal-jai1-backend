/**
 * Centralized pagination limits for all paginated endpoints.
 * These constants prevent magic numbers scattered across controllers
 * and make it easy to adjust limits globally.
 */
export const PAGINATION_LIMITS = {
  /** Admin client list endpoint */
  CLIENTS: { DEFAULT: 20, MAX: 1000 },

  /** Admin accounts endpoint */
  ACCOUNTS: { DEFAULT: 50, MAX: 500 },

  /** Admin payments endpoint */
  PAYMENTS: { DEFAULT: 50, MAX: 500 },

  /** Admin delays endpoint */
  DELAYS: { DEFAULT: 50, MAX: 500 },

  /** Support tickets endpoint */
  TICKETS: { DEFAULT: 20, MAX: 100 },

  /** Notifications endpoint */
  NOTIFICATIONS: { DEFAULT: 20, MAX: 100 },

  /** Referrals endpoints */
  REFERRALS: { DEFAULT: 50, MAX: 1000 },
  REFERRALS_SUMMARY: { DEFAULT: 50, MAX: 100 },
  LEADERBOARD: { DEFAULT: 10, MAX: 100 },

  /** Audit logs endpoint */
  AUDIT_LOGS: { DEFAULT: 50, MAX: 100 },
  AUDIT_LOGS_PAGE: { DEFAULT: 1, MAX: 10000 },
} as const;

/**
 * Helper function to validate and constrain pagination limit.
 * Parses string input and clamps to valid range.
 */
export function validateLimit(
  input: string | undefined,
  defaults: { DEFAULT: number; MAX: number },
): number {
  if (!input) return defaults.DEFAULT;
  const parsed = parseInt(input, 10);
  if (isNaN(parsed) || parsed < 1) return defaults.DEFAULT;
  return Math.min(parsed, defaults.MAX);
}

/**
 * Helper function to validate and constrain page number.
 */
export function validatePage(
  input: string | undefined,
  max: number = PAGINATION_LIMITS.AUDIT_LOGS_PAGE.MAX,
): number {
  if (!input) return 1;
  const parsed = parseInt(input, 10);
  if (isNaN(parsed) || parsed < 1) return 1;
  return Math.min(parsed, max);
}

/**
 * Helper function to validate offset for offset-based pagination.
 */
export function validateOffset(
  input: string | undefined,
  maxOffset: number = 100000,
): number {
  if (!input) return 0;
  const parsed = parseInt(input, 10);
  if (isNaN(parsed) || parsed < 0) return 0;
  return Math.min(parsed, maxOffset);
}
