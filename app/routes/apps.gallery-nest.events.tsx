/**
 * App proxy endpoint the storefront flushes gallery interaction counts to.
 *
 * Action only — there is nothing to read here. Every request is treated as untrusted:
 * an app proxy path is reachable by anyone who can load the storefront, so the plan
 * and the product are both re-checked server-side rather than believed from the
 * client. The response is always 204, which keeps the endpoint from confirming which
 * products a shop has configured.
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  canUseFeature,
  getCachedBillingPlan,
  limitProductsForPlan,
} from "../billing.server";
import { getSavedProducts } from "../products.server";
import { recordEvents, sanitizeEventCounts } from "../analytics.server";

const toGraphqlProductId = (productId: unknown) => {
  if (typeof productId !== "string" || !productId) return null;
  if (productId.startsWith("gid://shopify/Product/")) return productId;
  if (/^\d+$/.test(productId)) return `gid://shopify/Product/${productId}`;
  return null;
};

const accepted = () => new Response(null, { status: 204 });

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session?.shop) return accepted();

  const plan = await getCachedBillingPlan(session.shop);
  // The client is told whether to send via `analyticsEnabled`, but this is the check
  // that actually decides — a downgraded shop must stop accumulating stats even if a
  // cached page keeps beaconing.
  if (!canUseFeature(plan, "analytics")) return accepted();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return accepted();
  }

  const body = (payload ?? {}) as { productId?: unknown; counts?: unknown };
  const productId = toGraphqlProductId(body.productId);
  if (!productId) return accepted();

  const counts = sanitizeEventCounts(body.counts);
  if (!counts.length) return accepted();

  // Same gate the settings endpoint applies, so a product beyond the plan's limit
  // cannot accumulate stats it would never be allowed to display.
  const { products: saved } = await getSavedProducts(session.shop);
  const allowed = limitProductsForPlan(saved, plan).some(
    (product) => product.id === productId,
  );
  if (!allowed) return accepted();

  await recordEvents(session.shop, productId, counts);

  return accepted();
};
