import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  canUseProductCount,
  getCachedBillingPlan,
  limitProductsForPlan,
  planProductLimit,
  syncBillingPlan,
} from "../billing.server";
import prisma from "../db.server";
import {
  normalizeProducts,
  normalizeShopifyId,
  type SliderProduct,
} from "../products";
import { getSavedProducts, hydrateProducts, saveProducts } from "../products.server";
import {
  hasSliderOverrides,
  sliderOptionsFromFormData,
  sliderOptionsFromRow,
  type SliderOptions,
} from "../slider-options";
import {
  SliderOptionsFields,
  SliderOptionsInputs,
} from "../components/SliderOptionsFields";
import { useLanguage } from "../i18n/LanguageContext";
import { resolveLocale } from "../settings.server";
import { translate, type TranslationKey } from "../i18n/translations";

/**
 * What the resource picker hands back. Its own types are loose, and the image
 * fields differ by API version (`originalSrc` on older payloads, `url` on newer),
 * so both are read.
 */
type PickedImage = {
  id?: string | number;
  originalSrc?: string;
  url?: string;
  altText?: string | null;
};

type PickedProduct = {
  id: string;
  title: string;
  handle?: string;
  images?: PickedImage[];
  variants?: {
    id: string;
    title: string;
    sku?: string | null;
    image?: PickedImage | null;
  }[];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const { plan } = await syncBillingPlan({ billing, shop: session.shop });
  const { setting, products: saved } = await getSavedProducts(session.shop);
  const products = await hydrateProducts(
    admin,
    limitProductsForPlan(saved, plan),
  );

  return {
    plan,
    productLimit: planProductLimit(plan),
    products,
    shopDefaults: sliderOptionsFromRow(setting),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const locale = await resolveLocale(request, session.shop);
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent === "clear") {
    await saveProducts(session.shop, []);

    return { ok: true, message: translate(locale, "dashboard.toastProductsRemoved") };
  }

  if (intent === "publish-draft" || intent === "discard-draft") {
    // Patched against the saved products rather than the list the page posts back: that
    // copy has been through `hydrateProducts`, and a single-product change should not
    // let a stale client snapshot rewrite every other product.
    const targetId = normalizeShopifyId(formData.get("productId")?.toString());
    const { products: saved } = await getSavedProducts(session.shop);

    await saveProducts(
      session.shop,
      saved.map((product) => {
        if (normalizeShopifyId(product.id) !== targetId) return product;

        return intent === "publish-draft"
          ? { ...product, overrides: product.draft?.overrides ?? null, draft: null }
          : { ...product, draft: null };
      }),
    );

    return {
      ok: true,
      message: translate(
        locale,
        intent === "publish-draft"
          ? "products.toastDraftPublished"
          : "products.toastDraftDiscarded",
      ),
    };
  }

  if (intent === "defaults") {
    const options = sliderOptionsFromFormData(formData);
    await prisma.productSliderSetting.upsert({
      where: { shop: session.shop },
      create: { shop: session.shop, ...options },
      update: { ...options },
    });

    return { ok: true, message: translate(locale, "products.toastDefaultsSaved") };
  }

  const plan = await getCachedBillingPlan(session.shop);
  const requested = normalizeProducts(
    JSON.parse(formData.get("products")?.toString() ?? "[]"),
  );

  if (!canUseProductCount(plan, requested.length)) {
    return {
      ok: false,
      message: translate(locale, "dashboard.toastPlanLimit", {
        plan,
        limit: planProductLimit(plan) ?? "",
      }),
    };
  }

  await saveProducts(session.shop, requested);

  return { ok: true, message: translate(locale, "products.toastProductsSaved") };
};

/**
 * Tokens a redirect may carry in `?toast=`, mapped to translation keys. A whitelist
 * rather than putting the message itself in the URL: the text stays translated, and a
 * crafted link cannot put arbitrary words into a merchant's toast.
 */
const ARRIVAL_TOASTS: Record<string, TranslationKey> = {
  "draft-saved": "products.toastDraftSaved",
};

export default function Products() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useLanguage();

  // The list is rendered straight from the loader — never from a second copy in
  // component state. A local copy is what let the Open link point at a product
  // that had not been written yet.
  const products = loaderData.products;
  const [shopDefaults, setShopDefaults] = useState<SliderOptions>(
    loaderData.shopDefaults,
  );
  /** Product awaiting removal confirmation; `"all"` for Remove all. */
  const [pendingRemoval, setPendingRemoval] = useState<SliderProduct | "all" | null>(
    null,
  );
  /** Product whose draft is awaiting discard confirmation — discarding has no undo. */
  const [pendingDiscard, setPendingDiscard] = useState<SliderProduct | null>(null);

  const isWriting = fetcher.state !== "idle";
  const productLimitLabel =
    loaderData.productLimit === null
      ? t("dashboard.unlimited")
      : String(loaderData.productLimit);

  useEffect(() => {
    setShopDefaults(loaderData.shopDefaults);
  }, [loaderData.shopDefaults]);

  useEffect(() => {
    if (fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message, {
        isError: fetcher.data.ok === false,
      });
    }
  }, [fetcher.data, shopify]);

  // Confirms a save that happened on another route before redirecting here — the
  // editor's own toast never arrives once its action redirects.
  useEffect(() => {
    const token = searchParams.get("toast");
    if (!token) return;

    const key = ARRIVAL_TOASTS[token];
    if (key) shopify.toast.show(t(key));

    // Cleared so a reload does not re-announce a save that already happened, and
    // replaced so Back never lands on the toast URL. The effect then re-runs with no
    // token and returns early, so this does not loop.
    const next = new URLSearchParams(searchParams);
    next.delete("toast");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, shopify, t]);

  /** Persists a product list immediately, so the saved state is the only state. */
  const commitProducts = (next: SliderProduct[]) =>
    fetcher.submit(
      { products: JSON.stringify(next) },
      { method: "post", action: "/app/products" },
    );

  const confirmDiscard = () => {
    if (!pendingDiscard) return;

    fetcher.submit(
      {
        intent: "discard-draft",
        productId: normalizeShopifyId(pendingDiscard.id),
      },
      { method: "post", action: "/app/products" },
    );
    setPendingDiscard(null);
  };

  const confirmRemoval = () => {
    if (pendingRemoval === "all") {
      fetcher.submit({ intent: "clear" }, { method: "post", action: "/app/products" });
    } else if (pendingRemoval) {
      commitProducts(
        products.filter((product) => product.id !== pendingRemoval.id),
      );
    }
    setPendingRemoval(null);
  };

  const chooseProducts = async () => {
    const selection = await shopify.resourcePicker({
      type: "product",
      action: "select",
      multiple: true,
      selectionIds: products.map((product) => ({ id: product.id })),
      filter: { hidden: false, variants: true },
    });

    if (!selection?.selection) return;

    // Keep any overrides and mapping already saved for a re-selected product.
    const savedById = new Map(products.map((product) => [product.id, product]));
    const selectedProducts = normalizeProducts(
      (selection.selection as PickedProduct[]).map((product) => {
        const previous = savedById.get(product.id);
        const images =
          product.images
            ?.map((image) => ({
              id: String(image.id ?? image.originalSrc ?? image.url ?? ""),
              url: image.originalSrc ?? image.url ?? "",
              alt: image.altText ?? null,
            }))
            .filter((image) => image.id && image.url) ?? [];
        const variants =
          product.variants?.map((variant) => ({
            id: variant.id,
            title: variant.title,
            sku: variant.sku ?? null,
            image:
              variant.image?.originalSrc ??
              variant.image?.url ??
              product.images?.[0]?.originalSrc ??
              null,
            imageId: variant.image?.id ? String(variant.image.id) : null,
          })) ?? [];

        return {
          id: product.id,
          title: product.title,
          handle: product.handle,
          image: product.images?.[0]?.originalSrc ?? null,
          images,
          variants,
          variantImageMap: previous?.variantImageMap,
          overrides: previous?.overrides ?? null,
        };
      }),
    );

    if (
      loaderData.productLimit !== null &&
      selectedProducts.length > loaderData.productLimit
    ) {
      shopify.toast.show(
        t("dashboard.toastPlanLimit", {
          plan: loaderData.plan,
          limit: loaderData.productLimit,
        }),
        { isError: true },
      );
      return;
    }

    // Saved straight away: the Open link on a new row must reach a stored product.
    commitProducts(selectedProducts);
  };

  return (
    <s-page heading={t("products.pageTitle")}>
      <s-link slot="breadcrumb-actions" href="/app">
        {t("nav.dashboard")}
      </s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        icon="product-add"
        onClick={chooseProducts}
      >
        {t("products.addProducts")}
      </s-button>

      <s-section>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
            borderRadius: 14,
            padding: "24px 28px",
            background: "linear-gradient(135deg, #1c1730 0%, #3a2d63 55%, #6c4fc7 100%)",
            boxShadow: "0 8px 24px rgba(45, 24, 90, 0.25)",
            color: "#f6f3ff",
          }}
        >
          <s-stack direction="block" gap="small">
            <span
              style={{
                color: "#ffffff",
                letterSpacing: "0.04em",
                fontSize: 26,
                fontWeight: 700,
              }}
            >
              {t("products.pageTitle")}
            </span>
            <span style={{ color: "#d8c9ff", fontSize: 13 }}>
              {t("products.heroTagline")}
            </span>
          </s-stack>
          <s-badge tone="info">
            {products.length} / {productLimitLabel}
          </s-badge>
        </div>
      </s-section>

      <s-section
        heading={t("dashboard.selectedProductsHeading", { count: products.length })}
      >
        {products.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              padding: "32px 16px",
              borderRadius: 12,
              background: "#faf8ff",
              border: "1px dashed #c9b8f5",
              textAlign: "center",
            }}
          >
            <s-text tone="neutral">{t("dashboard.emptyStateText")}</s-text>
            <s-button variant="primary" icon="product-add" onClick={chooseProducts}>
              {t("products.addProducts")}
            </s-button>
          </div>
        ) : (
          <s-stack direction="block" gap="base">
            {products.map((product) => (
              <s-box
                key={product.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="inline" gap="base" alignItems="center">
                  {product.image ? (
                    <img
                      src={product.image}
                      alt=""
                      width="56"
                      height="56"
                      style={{ objectFit: "cover", borderRadius: 6 }}
                    />
                  ) : null}
                  <s-stack direction="block" gap="small">
                    <s-text>{product.title}</s-text>
                    <s-text tone="neutral">{product.handle ?? product.id}</s-text>
                    {product.variants?.length ? (
                      <s-text tone="neutral">
                        {t("dashboard.mappedVariantsLine", {
                          mapped: product.variants.filter(
                            (variant) =>
                              (product.variantImageMap?.[variant.id] ?? []).length > 0,
                          ).length,
                          total: product.variants.length,
                        })}
                      </s-text>
                    ) : null}
                  </s-stack>
                  <s-badge tone={hasSliderOverrides(product) ? "info" : "neutral"}>
                    {hasSliderOverrides(product)
                      ? t("products.badgeCustom")
                      : t("products.badgeDefault")}
                  </s-badge>
                  {/* Independent of the badge above: a product drafted for the first
                      time has no live overrides, so Default + Draft is expected. */}
                  {product.draft ? (
                    <s-badge tone="warning">{t("products.badgeDraft")}</s-badge>
                  ) : null}
                  {product.draft ? (
                    <s-button
                      variant="tertiary"
                      disabled={isWriting || undefined}
                      onClick={() =>
                        fetcher.submit(
                          {
                            intent: "publish-draft",
                            productId: normalizeShopifyId(product.id),
                          },
                          { method: "post", action: "/app/products" },
                        )
                      }
                    >
                      {t("products.publish")}
                    </s-button>
                  ) : null}
                  {product.draft ? (
                    <s-button
                      variant="tertiary"
                      tone="critical"
                      command="--show"
                      commandFor="gn-confirm-discard-draft"
                      disabled={isWriting || undefined}
                      onClick={() => setPendingDiscard(product)}
                    >
                      {t("products.discardDraft")}
                    </s-button>
                  ) : null}
                  <s-link href={`/app/products/${normalizeShopifyId(product.id)}`}>
                    {t("dashboard.open")}
                  </s-link>
                  <s-button
                    variant="tertiary"
                    command="--show"
                    commandFor="gn-confirm-removal"
                    disabled={isWriting || undefined}
                    onClick={() => setPendingRemoval(product)}
                  >
                    {t("dashboard.remove")}
                  </s-button>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      {products.length > 0 ? (
        <s-section>
          <s-button
            tone="critical"
            variant="secondary"
            icon="delete"
            command="--show"
            commandFor="gn-confirm-removal"
            disabled={isWriting || undefined}
            onClick={() => setPendingRemoval("all")}
          >
            {t("dashboard.removeAll")}
          </s-button>
        </s-section>
      ) : null}

      <s-modal
        id="gn-confirm-removal"
        heading={t("products.confirmRemoveHeading")}
        onHide={() => setPendingRemoval(null)}
      >
        <s-paragraph>
          {pendingRemoval === "all"
            ? t("products.confirmRemoveAllBody", { count: products.length })
            : t("products.confirmRemoveBody", {
                product: pendingRemoval?.title ?? "",
              })}
        </s-paragraph>
        {/*
          The variants are load-bearing, not styling: s-modal accepts only a
          `primary` variant in primary-action and only `secondary`/`auto` in
          secondary-actions. Anything else is dropped and the button never
          renders. `tone` is separate, so a critical primary stays red.
        */}
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          command="--hide"
          commandFor="gn-confirm-removal"
          onClick={confirmRemoval}
        >
          {t("products.confirmRemoveButton")}
        </s-button>
        <s-button
          slot="secondary-actions"
          variant="secondary"
          command="--hide"
          commandFor="gn-confirm-removal"
        >
          {t("common.cancel")}
        </s-button>
      </s-modal>

      <s-modal
        id="gn-confirm-discard-draft"
        heading={t("products.confirmDiscardHeading")}
        onHide={() => setPendingDiscard(null)}
      >
        <s-paragraph>
          {t("products.confirmDiscardBody", {
            product: pendingDiscard?.title ?? "",
          })}
        </s-paragraph>
        {/* Same variant constraint as the removal modal above — a wrong variant here is
            dropped and the button silently never renders. */}
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          command="--hide"
          commandFor="gn-confirm-discard-draft"
          onClick={confirmDiscard}
        >
          {t("products.discardDraft")}
        </s-button>
        <s-button
          slot="secondary-actions"
          variant="secondary"
          command="--hide"
          commandFor="gn-confirm-discard-draft"
        >
          {t("common.cancel")}
        </s-button>
      </s-modal>

      <s-section heading={t("products.defaultsHeading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("products.defaultsIntro")}</s-paragraph>
          <SliderOptionsFields value={shopDefaults} onChange={setShopDefaults} />
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="defaults" />
            <SliderOptionsInputs value={shopDefaults} />
            <s-button
              type="submit"
              variant="primary"
              icon="save"
              loading={isWriting || undefined}
            >
              {t("dashboard.saveSettings")}
            </s-button>
          </fetcher.Form>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
