import type { authenticate } from "./shopify.server";
import prisma from "./db.server";
import { BILLING_TEST } from "./shopify.server";
import {
  BASIC_PLAN,
  BILLING_PLANS,
  ENTERPRISE_PLAN,
  PLAN_LIMITS,
  STARTER_PLAN,
  type GalleryNestPlan,
} from "./billing-plans";

export {
  PLAN_PRICES,
  STARTER_PLAN,
  canUseFeature,
  type GalleryNestPlan,
  type PlanFeature,
} from "./billing-plans";

export const planProductLimit = (plan: GalleryNestPlan) => PLAN_LIMITS[plan];

export const canUseProductCount = (plan: GalleryNestPlan, count: number) => {
  const limit = planProductLimit(plan);
  return limit === null || count <= limit;
};

export const limitProductsForPlan = <T,>(products: T[], plan: GalleryNestPlan) => {
  const limit = planProductLimit(plan);
  return limit === null ? products : products.slice(0, limit);
};

const normalizePlan = (plan: string | null | undefined): GalleryNestPlan => {
  if (plan === BASIC_PLAN || plan === ENTERPRISE_PLAN || plan === STARTER_PLAN) {
    return plan;
  }
  return STARTER_PLAN;
};

/**
 * Refreshes the shop's plan from Shopify and records it.
 *
 * The billing check is a live Admin API call, so it can fail for reasons that have
 * nothing to do with this shop — a dropped connection, DNS, a Shopify blip. That must
 * not take down the pages that merely *display* the plan, so a failed check falls back
 * to the last value we successfully stored and reports itself as `stale` rather than
 * throwing. The DB is deliberately left untouched in that case: a network failure is
 * no evidence the subscription changed, and overwriting would downgrade a paying shop
 * to Starter.
 */
export const syncBillingPlan = async ({
  billing,
  shop,
}: {
  billing: Awaited<ReturnType<typeof authenticate.admin>>["billing"];
  shop: string;
}) => {
  let billingCheck: Awaited<ReturnType<typeof billing.check>>;
  try {
    billingCheck = await billing.check({
      plans: [...BILLING_PLANS],
      isTest: BILLING_TEST,
    });
  } catch (error) {
    console.error(`[billing] check failed for ${shop}, using cached plan:`, error);
    const cached = await prisma.shopBilling.findUnique({ where: { shop } });

    return {
      plan: normalizePlan(cached?.plan),
      subscriptionId: cached?.subscriptionId ?? null,
      starterAccepted: cached?.starterAcceptedAt != null,
      stale: true,
    };
  }

  const subscription = billingCheck.appSubscriptions?.find(
    (appSubscription) =>
      appSubscription.name === BASIC_PLAN || appSubscription.name === ENTERPRISE_PLAN,
  );
  const plan = normalizePlan(subscription?.name);

  /**
   * Writes `plan` and `subscriptionId` and **nothing else**.
   *
   * That omission is load-bearing: `starterAcceptedAt` records a merchant's deliberate
   * choice of the free plan, and this function runs on every request. Adding it to `update`
   * — even as `starterAcceptedAt: null` for tidiness — would erase that choice on the next
   * page load and the paywall would reappear at random.
   */
  const record = await prisma.shopBilling.upsert({
    where: { shop },
    create: {
      shop,
      plan,
      subscriptionId: subscription?.id ?? null,
    },
    update: {
      plan,
      subscriptionId: subscription?.id ?? null,
    },
  });

  return {
    plan,
    subscriptionId: subscription?.id ?? null,
    starterAccepted: record.starterAcceptedAt != null,
    stale: false,
  };
};

/**
 * Records that the merchant chose the free Starter plan, which is what lifts the paywall for
 * a shop with no paid subscription.
 *
 * There is no Shopify call to make here — Starter is the absence of a subscription, so
 * accepting it is purely local state.
 */
export const acceptStarterPlan = async (shop: string) => {
  await prisma.shopBilling.upsert({
    where: { shop },
    create: {
      shop,
      plan: STARTER_PLAN,
      starterAcceptedAt: new Date(),
    },
    update: {
      plan: STARTER_PLAN,
      subscriptionId: null,
      starterAcceptedAt: new Date(),
    },
  });
};

export const getCachedBillingPlan = async (shop: string) => {
  const billing = await prisma.shopBilling.findUnique({ where: { shop } });
  return normalizePlan(billing?.plan);
};
