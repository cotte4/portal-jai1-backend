/**
 * Commission tiers for JAI1GENTS
 * % of JAI1's fee based on completed referrals count
 */
export const COMMISSION_TIERS = [
  { min: 1, max: 3, percent: 5 },
  { min: 4, max: 10, percent: 10 },
  { min: 11, max: 25, percent: 15 },
  { min: 26, max: 50, percent: 20 },
  { min: 51, max: Infinity, percent: 25 },
];

/**
 * Get commission percentage based on completed referrals count
 */
export function getCommissionPercent(completedReferrals: number): number {
  for (const tier of COMMISSION_TIERS) {
    if (completedReferrals >= tier.min && completedReferrals <= tier.max) {
      return tier.percent;
    }
  }
  return COMMISSION_TIERS[0].percent; // Default to first tier
}

/**
 * Get next tier info for dashboard display
 */
export function getNextTierInfo(completedReferrals: number): {
  nextTierAt: number;
  nextPercent: number;
} | null {
  // Find the current tier first
  const currentTier = getCurrentTierInfo(completedReferrals);

  // Find the next tier after the current one
  for (const tier of COMMISSION_TIERS) {
    if (tier.percent > currentTier.percent) {
      return {
        nextTierAt: tier.min,
        nextPercent: tier.percent,
      };
    }
  }
  return null; // Already at max tier
}

/**
 * Get current tier info
 */
export function getCurrentTierInfo(completedReferrals: number): {
  tierNumber: number;
  percent: number;
  min: number;
  max: number;
} {
  for (let i = 0; i < COMMISSION_TIERS.length; i++) {
    const tier = COMMISSION_TIERS[i];
    if (completedReferrals >= tier.min && completedReferrals <= tier.max) {
      return {
        tierNumber: i + 1,
        percent: tier.percent,
        min: tier.min,
        max: tier.max === Infinity ? -1 : tier.max,
      };
    }
  }
  // No completed referrals yet — show Tier 1 since that's what they'll earn
  return {
    tierNumber: 1,
    percent: COMMISSION_TIERS[0].percent,
    min: COMMISSION_TIERS[0].min,
    max: COMMISSION_TIERS[0].max === Infinity ? -1 : COMMISSION_TIERS[0].max,
  };
}
