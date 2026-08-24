import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  canUseFeature,
  getCachedBillingPlan,
  limitProductsForPlan,
} from "../billing.server";
import { appSettingsFromRow } from "../app-settings";
import { getSavedProducts } from "../products.server";
import { resolveSliderOptions, sliderOptionsFromRow } from "../slider-options";

const toGraphqlProductId = (productId: string | null) => {
  if (!productId) return null;
  if (productId.startsWith("gid://shopify/Product/")) return productId;
  if (/^\d+$/.test(productId)) return `gid://shopify/Product/${productId}`;
  return null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);

  if (!session?.shop) {
    return Response.json({ enabled: false }, { status: 401 });
  }

  const url = new URL(request.url);
  const productId = toGraphqlProductId(url.searchParams.get("product_id"));
  const { setting, products: saved } = await getSavedProducts(session.shop);
  const plan = await getCachedBillingPlan(session.shop);
  const products = limitProductsForPlan(saved, plan);
  const productIds = products.map((product) => product.id);
  const selectedProduct = products.find((product) => product.id === productId);
  const appSettings = appSettingsFromRow(setting);
  // Per-product overrides win over the shop defaults; a product without any just
  // gets the defaults back unchanged.
  const options = resolveSliderOptions(sliderOptionsFromRow(setting), selectedProduct);

  return Response.json(
    {
      enabled:
        appSettings.appEnabled && Boolean(productId && productIds.includes(productId)),
      variantImageMap: selectedProduct?.variantImageMap,
      imageCaptions: selectedProduct?.imageCaptions,
      mediaOrder: selectedProduct?.mediaOrder,
      ...options,
      lazyLoadImages: appSettings.lazyLoadImages,
      accentColor: appSettings.accentColor,
      // Shop-wide gallery targeting. The theme editor can override both per theme, which
      // is why the storefront reads its own dataset first.
      themeProfile: appSettings.themeProfile,
      customGallerySelector: appSettings.customGallerySelector,
      // Only so non-Enterprise shops skip the beacon entirely; the events endpoint
      // re-checks the plan regardless of what the storefront was told.
      analyticsEnabled: canUseFeature(plan, "analytics"),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
};
