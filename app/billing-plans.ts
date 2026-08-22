export const STARTER_PLAN = "Starter";
export const BASIC_PLAN = "Basic";
export const ENTERPRISE_PLAN = "Enterprise";
export const BILLING_PLANS = [BASIC_PLAN, ENTERPRISE_PLAN] as const;

export type GalleryNestPlan =
  | typeof STARTER_PLAN
  | typeof BASIC_PLAN
  | typeof ENTERPRISE_PLAN;

export const PLAN_LIMITS: Record<GalleryNestPlan, number | null> = {
  [STARTER_PLAN]: 5,
  [BASIC_PLAN]: 100,
  [ENTERPRISE_PLAN]: null,
};

/**
 * Capabilities a plan unlocks, as opposed to `PLAN_LIMITS` which only sizes the
 * catalogue. Kept in this pure module so the admin UI can decide what to render
 * without pulling in Prisma.
 */
export type PlanFeature = "analytics";

export const PLAN_FEATURES: Record<GalleryNestPlan, readonly PlanFeature[]> = {
  [STARTER_PLAN]: [],
  [BASIC_PLAN]: [],
  [ENTERPRISE_PLAN]: ["analytics"],
};

export const canUseFeature = (plan: GalleryNestPlan, feature: PlanFeature) =>
  PLAN_FEATURES[plan].includes(feature);

export const PLAN_PRICES: Record<GalleryNestPlan, string> = {
  [STARTER_PLAN]: "Free",
  [BASIC_PLAN]: "$9.99",
  [ENTERPRISE_PLAN]: "$17.99",
};
