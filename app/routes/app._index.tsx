import type { CSSProperties } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  canUseFeature,
  limitProductsForPlan,
  planProductLimit,
  syncBillingPlan,
} from "../billing.server";
import type { GalleryEventType } from "../analytics";
import { getAnalyticsReport } from "../analytics.server";
import { getSavedProducts } from "../products.server";
import { ActivityBreakdown } from "../components/ActivityBreakdown";
import { AnalyticsChart } from "../components/AnalyticsChart";
import { StatCard, StatGrid } from "../components/StatCard";
import { useLanguage } from "../i18n/LanguageContext";
import {
  LANGUAGE_LABELS,
  SUPPORTED_LOCALES,
  normalizeLocale,
} from "../i18n/languages";
import type { TranslationKey } from "../i18n/translations";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const { plan } = await syncBillingPlan({ billing, shop: session.shop });
  const { products: saved } = await getSavedProducts(session.shop);
  const products = limitProductsForPlan(saved, plan);

  return {
    plan,
    productLimit: planProductLimit(plan),
    productCount: products.length,
    mappedVariantCount: products.reduce(
      (total, product) =>
        total +
        Object.values(product.variantImageMap ?? {}).filter(
          (imageIds) => imageIds.length > 0,
        ).length,
      0,
    ),
    customisedCount: products.filter((product) => product.overrides).length,
    // Skipped entirely when the plan cannot show it — no point querying stats the
    // page will replace with an upsell. Totals and the daily series are folded from a
    // single read, so charting the trend here costs no extra query; the per-product
    // breakdown is dropped because only /app/analytics tabulates it.
    analytics: canUseFeature(plan, "analytics")
      ? await getAnalyticsReport(session.shop).then(({ totals, daily }) => ({
          totals,
          daily,
        }))
      : null,
  };
};

/**
 * Accents are decorative — every tile and every breakdown row is named in text. See the
 * note in `AnalyticsChart`: these four fail a colour-blindness check as a *data* palette
 * and must not become chart series.
 */
const DASHBOARD_METRICS: Array<[GalleryEventType, TranslationKey, string]> = [
  ["gallery_view", "dashboard.statGalleryViews", "#6c4fc7"],
  ["image_view", "dashboard.statImageViews", "#3f8ae0"],
  ["zoom", "dashboard.statZooms", "#2fae87"],
  ["lightbox_open", "dashboard.statLightbox", "#d68f2f"],
];

const chartTitleStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#6d6d7a",
  marginBottom: 8,
};

export default function Index() {
  const loaderData = useLoaderData<typeof loader>();
  const { t, locale, setLocale } = useLanguage();
  const analytics = loaderData.analytics;

  const productLimitLabel =
    loaderData.productLimit === null
      ? t("dashboard.unlimited")
      : String(loaderData.productLimit);
  const usageRatio =
    loaderData.productLimit === null
      ? 0
      : Math.min(1, loaderData.productCount / Math.max(1, loaderData.productLimit));

  return (
    <s-page heading={t("dashboard.pageTitle")}>
      <s-link slot="primary-action" href="/app/products">
        {t("products.addProducts")}
      </s-link>

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
              {t("dashboard.heroTitle")}
            </span>
            <span style={{ fontSize: 16, fontWeight: 500, color: "#ffffff" }}>
              {t("dashboard.heroHeadline")}
            </span>
            <span style={{ color: "#d8c9ff", fontSize: 13 }}>
              {t("dashboard.heroTagline")}
            </span>
          </s-stack>

          <div style={{ minWidth: 160 }}>
            <s-select
              label={t("common.language")}
              value={locale}
              onChange={(event) =>
                setLocale(normalizeLocale(event.currentTarget.value))
              }
            >
              {SUPPORTED_LOCALES.map((code) => (
                <s-option key={code} value={code}>
                  {LANGUAGE_LABELS[code]}
                </s-option>
              ))}
            </s-select>
          </div>
        </div>
      </s-section>

      <s-section heading={t("dashboard.dashboardSection")}>
        <StatGrid>
          <StatCard
            accent="#6c4fc7"
            label={t("dashboard.selectedProducts")}
            value={loaderData.productCount}
            caption={`/ ${productLimitLabel}`}
          >
            {loaderData.productLimit !== null ? (
              <div
                style={{
                  height: 4,
                  borderRadius: 999,
                  background: "#eee8ff",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${usageRatio * 100}%`,
                    borderRadius: 999,
                    background: "linear-gradient(90deg, #6c4fc7, #a084e8)",
                    transition: "width 200ms ease",
                  }}
                />
              </div>
            ) : null}
            <s-link href="/app/products">{t("products.manageProducts")}</s-link>
          </StatCard>
          <StatCard
            accent="#3f8ae0"
            label={t("dashboard.currentPlan")}
            value={loaderData.plan}
          >
            <s-link href="/app/billing">{t("dashboard.manageBilling")}</s-link>
          </StatCard>
          <StatCard
            accent="#2fae87"
            label={t("dashboard.mappedVariants")}
            value={loaderData.mappedVariantCount}
          />
          <StatCard
            accent="#d68f2f"
            label={t("products.badgeCustom")}
            value={loaderData.customisedCount}
          />
        </StatGrid>
      </s-section>

      <s-section heading={t("dashboard.analyticsSection")}>
        {analytics ? (
          <s-stack direction="block" gap="base">
            <StatGrid>
              {DASHBOARD_METRICS.map(([key, labelKey, accent]) => (
                <StatCard
                  key={key}
                  accent={accent}
                  label={t(labelKey)}
                  value={analytics.totals[key]}
                />
              ))}
            </StatGrid>

            <div>
              <div style={chartTitleStyle}>{t("analytics.dailyChartTitle")}</div>
              <AnalyticsChart
                label={t("dashboard.statGalleryViews")}
                points={analytics.daily.map((entry) => ({
                  day: entry.day,
                  value: entry.counts.gallery_view,
                }))}
              />
            </div>

            <div>
              <div style={chartTitleStyle}>{t("dashboard.breakdownTitle")}</div>
              <ActivityBreakdown
                rows={DASHBOARD_METRICS.map(([key, labelKey]) => ({
                  label: t(labelKey),
                  value: analytics.totals[key],
                }))}
              />
            </div>

            <s-link href="/app/analytics">{t("dashboard.viewAnalytics")}</s-link>
          </s-stack>
        ) : (
          <s-stack direction="block" gap="base">
            <s-paragraph>{t("dashboard.analyticsLocked")}</s-paragraph>
            <s-link href="/app/billing">{t("dashboard.analyticsUpgrade")}</s-link>
          </s-stack>
        )}
      </s-section>

      <s-section slot="aside" heading={t("dashboard.themeSetup")}>
        <div
          style={{
            borderRadius: 12,
            padding: 14,
            background: "linear-gradient(160deg, #f7f4ff 0%, #efe9ff 100%)",
            border: "1px solid #e2d8fb",
          }}
        >
          <s-paragraph>{t("dashboard.themeSetupText")}</s-paragraph>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
