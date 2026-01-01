/**
 * Freshness Thresholds Configuration
 * Defines per-model freshness classification thresholds (in minutes)
 */

export type FreshnessState = 'fresh' | 'aging' | 'stale';

export interface FreshnessThreshold {
  fresh: number;   // Minutes: 0 to (fresh - 1) = Fresh
  aging: number;   // Minutes: fresh to (aging - 1) = Aging
  // aging+ = Stale
}

/**
 * Default and per-model freshness thresholds in minutes.
 * Models update at different frequencies, so we allow per-model overrides.
 */
export const FRESHNESS_THRESHOLDS: Record<string, FreshnessThreshold> = {
  default: { fresh: 30, aging: 60 },
  ECMWF: { fresh: 45, aging: 90 },   // Updates less frequently
  GFS: { fresh: 30, aging: 60 },
  ICON: { fresh: 30, aging: 60 },
  GEM: { fresh: 30, aging: 60 },
};

/**
 * Classify the freshness state of a model based on its data age.
 */
export function classifyFreshness(
  modelName: string,
  updatedAt: Date | number,
  now: Date = new Date()
): FreshnessState {
  const updatedAtMs = typeof updatedAt === 'number' ? updatedAt * 1000 : updatedAt.getTime();
  const ageMinutes = (now.getTime() - updatedAtMs) / 60000;
  
  const thresholds = FRESHNESS_THRESHOLDS[modelName] ?? FRESHNESS_THRESHOLDS.default;
  
  if (ageMinutes < thresholds.fresh) return 'fresh';
  if (ageMinutes < thresholds.aging) return 'aging';
  return 'stale';
}

/**
 * Get the worst (stalest) freshness state from an array of states.
 * Used for aggregate ring display.
 */
export function getWorstFreshnessState(states: FreshnessState[]): FreshnessState {
  if (states.includes('stale')) return 'stale';
  if (states.includes('aging')) return 'aging';
  return 'fresh';
}

/**
 * Format age in minutes to a human-readable string.
 */
export function formatFreshnessAge(ageMinutes: number): string {
  const minutes = Math.floor(ageMinutes);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 
    ? `${hours}h ${remainingMinutes}m ago`
    : `${hours}h ago`;
}
