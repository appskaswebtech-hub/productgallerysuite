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

  /**
   * Two id shapes meet here, and reconciling them is this loader's job.
   *
   * `GalleryStat.productId` holds a full GID — `apps.gallery-nest.events` canonicalizes to
   * one on write so it can compare against `SliderProduct.id`, which is also a GID. But
   * routes and this title map are keyed by the bare numeric id. Handing the raw GID to the
   * component is what made the table print `gid://shopify/Product/…` instead of a name and
   * build a link with extra path segments that matched no route at all.
   */
  const titles = new Map(
    products.map((product) => [normalizeShopifyId(product.id), product.title]),
  );

  return {
    locked: false as const,
    days,
    report: {
      ...report,
      products: report.products.map((entry) => {
        const productId = normalizeShopifyId(entry.productId);
        return { ...entry, productId, title: titles.get(productId) ?? null };
      }),
    },
  };
};

/**
 * One hue per metric, worn consistently by that metric's stat tile and its breakdown bar.
 * Colour follows the entity, never the row position.
 *
 * Validated as a categorical palette, not chosen by eye. The previous set failed on
 * `#3f8ae0`↔`#6c4fc7` at ΔE 14.9 for normal vision — below the 15 floor, meaning full-colour
 * readers struggled to tell blue from purple — which is why these were once barred from
 * charts. Replacing the blue clears every hard gate: worst adjacent pair is now
 * `#eda100`↔`#1baf7a` at ΔE 22.9 normal / 9.1 protan.
 *
 * Aqua and yellow sit below 3:1 against the white card surface, which obliges visible
 * labels. Every tile and every breakdown row names its metric in text and shows its count —
 * **do not remove those labels**, or this palette stops being legal.
 */
const METRICS: Array<[GalleryEventType, TranslationKey, string]> = [
  ["gallery_view", "dashboard.statGalleryViews", "#6c4fc7"],
  ["image_view", "dashboard.statImageViews", "#eb6834"],
  ["zoom", "dashboard.statZooms", "#1baf7a"],
  ["lightbox_open", "dashboard.statLightbox", "#eda100"],
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

  const { report, days } = data;

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
          rows={METRICS.map(([key, labelKey, accent]) => ({
            label: t(labelKey),
            value: report.totals[key],
            accent,
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
                    {/*
                      Only linked when the product is still in the merchant's list. Stats
                      outlive removal, and the product route rejects anything not in that
                      list — so a link here would be a dead end. The id keeps the row
                      identifiable without pretending to be navigable.
                    */}
                    {entry.title ? (
                      <s-link href={`/app/products/${entry.productId}`}>
                        {entry.title}
                      </s-link>
                    ) : (
                      <s-text tone="neutral">
                        {t("analytics.productRemoved", { id: entry.productId })}
                      </s-text>
                    )}
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
