/**
 * Plan tier enum for type safety (types only since the 1B.3 PostgreSQL
 * cutover — plan rows live in catalog.plans via PlanRecord).
 */
export enum PlanTier {
  FREE = 'free',
  BASIC = 'basic',
  ENTERPRISE = 'enterprise',
  UNLIMITED = 'unlimited',
}
