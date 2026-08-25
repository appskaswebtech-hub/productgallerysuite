import type { TranslationKey } from "./i18n/translations";

export const STARTER_PLAN = "Starter";
export const BASIC_PLAN = "Basic";
export const ENTERPRISE_PLAN = "Enterprise";

/**
 * The **paid** plans, and deliberately only those.
 *
 * This feeds `billing.check({ plans })`, which asks Shopify which subscription the shop
 * holds. Starter is not a Shopify subscription — it is the absence of one — so adding it
 * here would ask Shopify about a plan it has never heard of. Use `PLAN_ORDER` for anything
 * that renders plans; use this only for talking to the Billing API.
 */
export const BILLING_PLANS = [BASIC_PLAN, ENTERPRISE_PLAN] as const;

export type GalleryNestPlan =
  | typeof STARTER_PLAN
  | typeof BASIC_PLAN
  | typeof ENTERPRISE_PLAN;

/**
 * Every plan, cheapest first, as merchants should see them.
 *
 * Shared so the Billing page and the paywall gate in `app.tsx` cannot drift into different
 * orders — the same reason `PLAN_FEATURE_KEYS` lives here.
 */
export const PLAN_ORDER: GalleryNestPlan[] = [
  STARTER_PLAN,
  BASIC_PLAN,
  ENTERPRISE_PLAN,
];

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

/**
 * The bullet list each plan advertises.
 *
 * Here rather than in the billing route because two surfaces render it — the Billing page
 * and the paywall gate in `app.tsx` — and a second copy would drift the first time a plan's
 * features change. The `TranslationKey` import is type-only, so this module stays pure.
 */
export const PLAN_FEATURE_KEYS: Record<GalleryNestPlan, TranslationKey[]> = {
  [STARTER_PLAN]: [
    "billing.featureUseUpTo5",
    "billing.featureProductSlider",
    "billing.rowZoomGallery",
    "billing.rowVariantMapping",
  ],
  [BASIC_PLAN]: [
    "billing.featureUseUpTo100",
    "billing.featureProductSlider",
    "billing.rowZoomGallery",
    "billing.rowVariantMapping",
    "billing.featureCustomArrows",
  ],
  [ENTERPRISE_PLAN]: [
    "billing.featureUseUnlimited",
    "billing.featureEverythingBasic",
    "billing.featureUnlimitedMapping",
    "billing.featureAnalytics",
    "billing.rowPrioritySupport",
  ],
};

export const PLAN_PRICES: Record<GalleryNestPlan, string> = {
  [STARTER_PLAN]: "Free",
  [BASIC_PLAN]: "$9.99",
  [ENTERPRISE_PLAN]: "$17.99",
};
