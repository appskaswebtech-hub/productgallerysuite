import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigation, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { canUseFeature, syncBillingPlan } from "../billing.server";
// Split deliberately: the range picker and metric columns render in the browser, so
// they must come from the pure module — React Router strips `.server` from the client
// bundle and the build fails if a component reaches into it.
import { ANALYTICS_RANGES, safeRange, type GalleryEventType } from "../analytics";
import { getAnalyticsReport } from "../analytics.server";
import { getSavedProducts } from "../products.server";
import { normalizeShopifyId } from "../products";
import { ActivityBreakdown } from "../components/ActivityBreakdown";
import { AnalyticsChart } from "../components/AnalyticsChart";
import { StatCard, StatGrid } from "../components/StatCard";
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslationKey } from "../i18n/translations";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const { plan } = await syncBillingPlan({ billing, shop: session.shop });
  const days = safeRange(new URL(request.url).searchParams.get("days"));

  // Nothing is queried when the plan cannot display it.
  if (!canUseFeature(plan, "analytics")) {
    return { locked: true as const, days };
  }

  const [report, { products }] = await Promise.all([
    getAnalyticsReport(session.shop, days),
    getSavedProducts(session.shop),
  ]);

  return {
    locked: false as const,
    days,
    report,
    productTitles: Object.fromEntries(
      products.map((product) => [normalizeShopifyId(product.id), product.title]),
    ) as Record<string, string>,
  };
};

/**
 * The accent is decorative only — each tile carries a text label, so identity never
 * rests on colour. These four fail a CVD check as a data palette and must not be
 * promoted into chart series without re-stepping them first.
 */
const METRICS: Array<[GalleryEventType, TranslationKey, string]> = [
  ["gallery_view", "dashboard.statGalleryViews", "#6c4fc7"],
  ["image_view", "dashboard.statImageViews", "#3f8ae0"],
  ["zoom", "dashboard.statZooms", "#2fae87"],
  ["lightbox_open", "dashboard.statLightbox", "#d68f2f"],
];

const RANGE_LABEL_KEYS: Record<number, TranslationKey> = {
  7: "analytics.range7",
  30: "analytics.range30",
  90: "analytics.range90",
};

export default function Analytics() {
  const data = useLoaderData<typeof loader>();
  const { t, locale } = useLanguage();
  const [, setSearchParams] = useSearchParams();
  const navigation = useNavigation();

  // `days` only changes once the new loader resolves, so binding the select straight to
  // it would flick back to the old range mid-navigation. The in-flight URL is the
  // truthful answer to "what did the merchant just pick".
  const pendingDays = navigation.location
    ? new URLSearchParams(navigation.location.search).get("days")
    : null;

  if (data.locked) {
    return (
      <s-page heading={t("analytics.pageTitle")}>
        <s-section>
          <s-stack direction="block" gap="base">
            <s-paragraph>{t("dashboard.analyticsLocked")}</s-paragraph>
            <s-link href="/app/billing">{t("dashboard.analyticsUpgrade")}</s-link>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const { report, productTitles, days } = data;

  return (
    <s-page heading={t("analytics.pageTitle")}>
      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph tone="neutral">{t("analytics.intro")}</s-paragraph>

          {/* Writes the range to the URL rather than to local state, so it still
              survives a reload, follows the back button and can be shared. */}
          <div style={{ maxWidth: 220 }}>
            <s-select
              key={`days-${locale}`}
              label={t("analytics.rangeLabel")}
              value={pendingDays ?? String(days)}
              onChange={(event) =>
                setSearchParams({ days: event.currentTarget.value })
              }
            >
              {ANALYTICS_RANGES.map((range) => (
                <s-option key={range} value={String(range)}>
                  {t(RANGE_LABEL_KEYS[range])}
                </s-option>
              ))}
            </s-select>
          </div>

          <StatGrid>
            {METRICS.map(([key, labelKey, accent]) => (
              <StatCard
                key={key}
                accent={accent}
                label={t(labelKey)}
                value={report.totals[key]}
              />
            ))}
          </StatGrid>
        </s-stack>
      </s-section>

      <s-section heading={t("analytics.dailyChartTitle")}>
        <AnalyticsChart
          label={t("dashboard.statGalleryViews")}
          points={report.daily.map((entry) => ({
            day: entry.day,
            value: entry.counts.gallery_view,
          }))}
        />
      </s-section>

      <s-section heading={t("dashboard.breakdownTitle")}>
        <ActivityBreakdown
          rows={METRICS.map(([key, labelKey]) => ({
            label: t(labelKey),
            value: report.totals[key],
          }))}
        />
      </s-section>

      <s-section heading={t("analytics.productTableHeading")}>
        {report.products.length ? (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">
                {t("analytics.colProduct")}
              </s-table-header>
              {METRICS.map(([key, labelKey]) => (
                <s-table-header key={key} listSlot="labeled">
                  {t(labelKey)}
                </s-table-header>
              ))}
            </s-table-header-row>
            <s-table-body>
              {report.products.map((entry) => (
                <s-table-row key={entry.productId}>
                  <s-table-cell>
                    <s-link href={`/app/products/${entry.productId}`}>
                      {productTitles[entry.productId] ?? entry.productId}
                    </s-link>
                  </s-table-cell>
                  {METRICS.map(([key]) => (
                    <s-table-cell key={key}>{entry.counts[key]}</s-table-cell>
                  ))}
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        ) : (
          <s-paragraph tone="neutral">{t("analytics.noData")}</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
